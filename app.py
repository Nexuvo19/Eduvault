"""EduVault Flask backend (MySQL + secure session authentication + document storage)."""
from __future__ import annotations

import logging
import mimetypes
import os
import secrets
import shutil
import subprocess
import tempfile
import uuid
from datetime import date, datetime
from functools import wraps
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory, session
from mysql.connector import Error as MySQLError
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

load_dotenv()

ROOT = Path(__file__).resolve().parent
INSTANCE_DIR = ROOT / "instance"
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(INSTANCE_DIR / "uploads"))).expanduser()
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024
MAX_CONVERTED_BYTES = 40 * 1024 * 1024
CONVERSION_TIMEOUT_SECONDS = 60
ALLOWED_EXTENSIONS = {
    ".bmp", ".csv", ".doc", ".docx", ".gif", ".htm", ".html",
    ".jpeg", ".jpg", ".md", ".odt", ".odp", ".ods", ".pdf",
    ".png", ".ppt", ".pptx", ".rtf", ".tif", ".tiff", ".txt",
    ".webp", ".xls", ".xlsx",
}
STATIC_FILES = {
    "STYLE.CSS", "SCRIPTS.JS", "TYPOGRAPHY.CSS", "dashboard.html",
    "index.html", "landing.css", "landing.js", "manifest.webmanifest",
    "sw.js", "icon.svg", "icon-192.png", "icon-512.png",
}
USER_DATA_KEYS = {
    "defaultView", "bookmarks", "asgStatuses", "annRead", "notifRead",
    "chat", "testHistory", "prefs", "semester", "supportRequests",
}

app = Flask(__name__, static_folder=None)
app.config.update(
    SECRET_KEY=os.getenv("SESSION_SECRET") or secrets.token_hex(32),
    MAX_CONTENT_LENGTH=MAX_REQUEST_BYTES,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "false").lower() == "true",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 14,
)
logging.basicConfig(level=logging.INFO)


def db_connect():
    """Open a MySQL connection using environment-based settings."""
    options = {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": os.getenv("DB_NAME", "eduvault"),
        "charset": "utf8mb4",
        "collation": "utf8mb4_unicode_ci",
        "autocommit": False,
        "connection_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
    }
    ssl_ca = os.getenv("DB_SSL_CA", "").strip()
    if ssl_ca:
        options.update(ssl_ca=ssl_ca, ssl_verify_cert=True, ssl_verify_identity=True)
    return mysql.connector.connect(**options)


def json_error(message: str, status: int):
    return jsonify(error=message), status


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return json_error("Please sign in to continue.", 401)
        return view(*args, **kwargs)
    return wrapped


def faculty_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if session.get("role") != "faculty":
            return json_error("Only faculty accounts can make this change.", 403)
        return view(*args, **kwargs)
    return wrapped


def current_user():
    connection = db_connect()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, identifier, full_name, role, branch, semester FROM users WHERE id=%s",
            (session["user_id"],),
        )
        user = cursor.fetchone()
        cursor.close()
        return user
    finally:
        connection.close()


def as_iso(value):
    return value.isoformat() if isinstance(value, (date, datetime)) else value


def fetch_resources(cursor):
    cursor.execute(
        """SELECT r.id, r.title, r.subject_id, r.semester, r.category, r.format,
                  r.resource_date, r.uploader, r.branch, r.study_year,
                  r.file_id, d.original_name, d.content_type
           FROM resources r LEFT JOIN documents d ON d.id=r.file_id
           ORDER BY r.resource_date DESC, r.id"""
    )
    items = []
    for row in cursor.fetchall():
        items.append({
            "id": row["id"], "title": row["title"], "subject": row["subject_id"],
            "sem": row["semester"], "category": row["category"], "format": row["format"],
            "date": as_iso(row["resource_date"]), "uploader": row["uploader"],
            "branch": row["branch"], "year": row["study_year"],
            **({"fileId": row["file_id"], "fileName": row["original_name"],
                "fileContentType": row["content_type"]} if row["file_id"] else {}),
        })
    return items


def fetch_assignments(cursor):
    cursor.execute(
        """SELECT id, title, subject_id, description, assigned_date, due_date, status, priority
           FROM assignments ORDER BY due_date, id"""
    )
    return [{
        "id": row["id"], "title": row["title"], "subject": row["subject_id"],
        "desc": row["description"], "assigned": as_iso(row["assigned_date"]),
        "due": as_iso(row["due_date"]), "status": row["status"], "priority": row["priority"],
    } for row in cursor.fetchall()]


def fetch_announcements(cursor):
    cursor.execute(
        """SELECT id, title, department, announcement_date, priority, description
           FROM announcements ORDER BY announcement_date DESC, id"""
    )
    return [{
        "id": row["id"], "title": row["title"], "dept": row["department"],
        "date": as_iso(row["announcement_date"]), "priority": row["priority"],
        "desc": row["description"], "read": False,
    } for row in cursor.fetchall()]


def fetch_user_data(cursor, user_id):
    cursor.execute("SELECT data_key, data_json FROM user_workspace_data WHERE user_id=%s", (user_id,))
    data = {}
    import json
    for row in cursor.fetchall():
        raw = row["data_json"]
        data[row["data_key"]] = json.loads(raw) if isinstance(raw, str) else raw
    return data


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:filename>")
def static_file(filename):
    if filename not in STATIC_FILES:
        return jsonify(error="Not found."), 404
    return send_from_directory(ROOT, filename)


@app.get("/healthz")
def healthz():
    # Liveness check for hosting platforms; it does not expose database details.
    return jsonify(status="ok")


@app.get("/api/health")
def health():
    try:
        connection = db_connect()
        connection.close()
        return jsonify(status="ok", database="connected")
    except MySQLError:
        app.logger.exception("MySQL health check failed.")
        return jsonify(status="error", database="unavailable"), 503


@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    full_name = str(data.get("fullName", "")).strip()
    identifier = str(data.get("identifier", "")).strip().lower()
    password = str(data.get("password", ""))
    if len(full_name) < 2 or len(full_name) > 100:
        return json_error("Enter your full name (2–100 characters).", 400)
    if len(identifier) < 3 or len(identifier) > 190:
        return json_error("Enter a valid student ID or email address.", 400)
    if len(password) < 8:
        return json_error("Your password must contain at least 8 characters.", 400)
    connection = db_connect()
    try:
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO users (identifier, full_name, password_hash, role) VALUES (%s,%s,%s,'student')",
            (identifier, full_name, generate_password_hash(password)),
        )
        connection.commit()
        user_id = cursor.lastrowid
        cursor.close()
        session.clear()
        session.update(user_id=user_id, identifier=identifier, role="student")
        session.permanent = True
        return jsonify(ok=True, role="student"), 201
    except MySQLError as error:
        connection.rollback()
        if getattr(error, "errno", None) == 1062:
            return json_error("An account with this ID or email already exists.", 409)
        app.logger.exception("Student registration failed.")
        return json_error("The account could not be created. Check your database setup.", 500)
    finally:
        connection.close()


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    identifier = str(data.get("identifier", "")).strip().lower()
    password = str(data.get("password", ""))
    requested_role = str(data.get("role", "student")).strip().lower()
    if not identifier or not password or requested_role not in {"student", "faculty"}:
        return json_error("Enter your ID, password and account type.", 400)
    connection = db_connect()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, identifier, full_name, password_hash, role FROM users WHERE identifier=%s", (identifier,))
        user = cursor.fetchone()
        cursor.close()
        if not user or user["role"] != requested_role or not check_password_hash(user["password_hash"], password):
            return json_error("The ID, password or selected account type is incorrect.", 401)
        session.clear()
        session.update(user_id=user["id"], identifier=user["identifier"], role=user["role"])
        session.permanent = bool(data.get("remember", False))
        return jsonify(ok=True, role=user["role"])
    finally:
        connection.close()


@app.get("/api/auth/me")
@login_required
def auth_me():
    try:
        user = current_user()
        if not user:
            session.clear()
            return json_error("Your account no longer exists. Please sign in again.", 401)
        return jsonify(user={"id": user["id"], "identifier": user["identifier"],
                            "fullName": user["full_name"], "role": user["role"]})
    except MySQLError:
        app.logger.exception("Could not read the current account.")
        return json_error("The database is unavailable.", 503)


@app.post("/api/auth/logout")
@login_required
def logout():
    session.clear()
    return "", 204


@app.get("/api/bootstrap")
@login_required
def bootstrap():
    connection = db_connect()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT id, identifier, full_name, role FROM users WHERE id=%s", (session["user_id"],))
        user = cursor.fetchone()
        if not user:
            session.clear()
            return json_error("Your account no longer exists. Please sign in again.", 401)
        result = {
            "user": {"id": user["id"], "identifier": user["identifier"],
                     "fullName": user["full_name"], "role": user["role"]},
            "resources": fetch_resources(cursor),
            "assignments": fetch_assignments(cursor),
            "announcements": fetch_announcements(cursor),
            "userData": fetch_user_data(cursor, user["id"]),
        }
        cursor.close()
        return jsonify(result)
    finally:
        connection.close()


@app.put("/api/admin/<collection>")
@faculty_required
def replace_collection(collection):
    if collection not in {"resources", "assignments", "announcements"}:
        return json_error("Unknown academic collection.", 404)
    items = request.get_json(silent=True)
    if not isinstance(items, list) or len(items) > 5000:
        return json_error("A valid list of records is required.", 400)
    connection = db_connect()
    try:
        cursor = connection.cursor()
        identifiers = []
        if collection == "resources":
            for item in items:
                if not isinstance(item, dict) or not str(item.get("title", "")).strip():
                    raise ValueError("Each resource must have a title.")
                item_id = str(item.get("id", "")).strip() or uuid.uuid4().hex
                identifiers.append(item_id)
                cursor.execute(
                    """INSERT INTO resources (id,title,subject_id,semester,category,format,resource_date,uploader,branch,study_year,file_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON DUPLICATE KEY UPDATE title=VALUES(title),subject_id=VALUES(subject_id),semester=VALUES(semester),
                       category=VALUES(category),format=VALUES(format),resource_date=VALUES(resource_date),uploader=VALUES(uploader),
                       branch=VALUES(branch),study_year=VALUES(study_year),file_id=VALUES(file_id)""",
                    (item_id, str(item["title"]).strip(), item.get("subject", ""), item.get("sem", "sem1"),
                     item.get("category", "Notes"), item.get("format", "PDF"), item.get("date") or date.today(),
                     item.get("uploader", "Academic Resources Team"), item.get("branch", "Computer Science"),
                     str(item.get("year", "1")), item.get("fileId")),
                )
            if identifiers:
                placeholders = ",".join(["%s"] * len(identifiers))
                cursor.execute(f"DELETE FROM resources WHERE id NOT IN ({placeholders})", tuple(identifiers))
            else:
                cursor.execute("DELETE FROM resources")
        elif collection == "assignments":
            for item in items:
                if not isinstance(item, dict) or not str(item.get("title", "")).strip():
                    raise ValueError("Each assignment must have a title.")
                item_id = str(item.get("id", "")).strip() or uuid.uuid4().hex
                identifiers.append(item_id)
                cursor.execute(
                    """INSERT INTO assignments (id,title,subject_id,description,assigned_date,due_date,status,priority,created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON DUPLICATE KEY UPDATE title=VALUES(title),subject_id=VALUES(subject_id),description=VALUES(description),
                       assigned_date=VALUES(assigned_date),due_date=VALUES(due_date),status=VALUES(status),priority=VALUES(priority)""",
                    (item_id, str(item["title"]).strip(), item.get("subject", ""), item.get("desc", ""),
                     item.get("assigned") or date.today(), item.get("due") or date.today(), item.get("status", "Pending"),
                     item.get("priority", "medium"), session["user_id"]),
                )
            if identifiers:
                placeholders = ",".join(["%s"] * len(identifiers))
                cursor.execute(f"DELETE FROM assignments WHERE id NOT IN ({placeholders})", tuple(identifiers))
            else:
                cursor.execute("DELETE FROM assignments")
        else:
            for item in items:
                if not isinstance(item, dict) or not str(item.get("title", "")).strip():
                    raise ValueError("Each announcement must have a title.")
                item_id = str(item.get("id", "")).strip() or uuid.uuid4().hex
                identifiers.append(item_id)
                cursor.execute(
                    """INSERT INTO announcements (id,title,department,announcement_date,priority,description,created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s)
                       ON DUPLICATE KEY UPDATE title=VALUES(title),department=VALUES(department),announcement_date=VALUES(announcement_date),
                       priority=VALUES(priority),description=VALUES(description)""",
                    (item_id, str(item["title"]).strip(), item.get("dept", "Academic Office"),
                     item.get("date") or date.today(), item.get("priority", "Normal"), item.get("desc", ""), session["user_id"]),
                )
            if identifiers:
                placeholders = ",".join(["%s"] * len(identifiers))
                cursor.execute(f"DELETE FROM announcements WHERE id NOT IN ({placeholders})", tuple(identifiers))
            else:
                cursor.execute("DELETE FROM announcements")
        connection.commit()
        cursor.close()
        return jsonify(ok=True, count=len(items))
    except (MySQLError, ValueError, TypeError) as error:
        connection.rollback()
        app.logger.exception("Could not update %s.", collection)
        return json_error(str(error) if isinstance(error, ValueError) else "The database could not save these changes.", 400 if isinstance(error, ValueError) else 500)
    finally:
        connection.close()


@app.put("/api/me/data/<key>")
@login_required
def save_user_data(key):
    if key not in USER_DATA_KEYS:
        return json_error("This user-data field is not allowed.", 404)
    value = request.get_json(silent=True)
    connection = db_connect()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """INSERT INTO user_workspace_data (user_id,data_key,data_json) VALUES (%s,%s,%s)
               ON DUPLICATE KEY UPDATE data_json=VALUES(data_json),updated_at=CURRENT_TIMESTAMP""",
            (session["user_id"], key, json_dumps(value)),
        )
        connection.commit()
        cursor.close()
        return jsonify(ok=True)
    except MySQLError:
        connection.rollback()
        app.logger.exception("Could not save user workspace data.")
        return json_error("Your changes could not be saved to the database.", 500)
    finally:
        connection.close()


def json_dumps(value):
    import json
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@app.delete("/api/me/data")
@login_required
def clear_user_data():
    connection = db_connect()
    try:
        cursor = connection.cursor()
        cursor.execute("DELETE FROM user_workspace_data WHERE user_id=%s", (session["user_id"],))
        connection.commit()
        cursor.close()
        return "", 204
    finally:
        connection.close()


def pdf_is_valid(path: Path) -> bool:
    with path.open("rb") as converted:
        return b"%PDF-" in converted.read(1024)


def convert_to_pdf(source: Path, extension: str, output_dir: Path) -> Path:
    if extension == ".pdf":
        if not pdf_is_valid(source):
            raise ValueError("The uploaded file is not a valid PDF.")
        return source
    office_binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not office_binary:
        raise RuntimeError("LibreOffice is required to convert this file. Install it and restart EduVault.")
    output_path = output_dir / f"{source.stem}.pdf"
    profile_dir = output_dir / "libreoffice-profile"
    command = [office_binary, "--headless", "--nologo", "--nodefault", "--nolockcheck",
               f"-env:UserInstallation={profile_dir.as_uri()}", "--convert-to", "pdf", "--outdir", str(output_dir), str(source)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=CONVERSION_TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Document conversion timed out.") from error
    if result.returncode != 0 or not output_path.is_file():
        app.logger.error("LibreOffice conversion failed: %s", (result.stderr or result.stdout).strip())
        raise ValueError("This file could not be converted. Use a supported document, image, or PDF file.")
    if output_path.stat().st_size > MAX_CONVERTED_BYTES or not pdf_is_valid(output_path):
        raise ValueError("The converted PDF is too large or invalid.")
    return output_path


@app.post("/api/documents")
@faculty_required
def create_document():
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return json_error("Choose a file to upload.", 400)
    original_name = secure_filename(uploaded.filename)
    extension = Path(original_name).suffix.lower()
    if not original_name or extension not in ALLOWED_EXTENSIONS:
        return json_error("This file type is not supported for PDF conversion.", 415)
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    identifier = uuid.uuid4().hex
    document_dir = UPLOAD_DIR / identifier
    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="eduvault-convert-", dir=INSTANCE_DIR) as work_dir:
            work_path = Path(work_dir)
            source = work_path / f"source{extension}"
            uploaded.save(source)
            if source.stat().st_size == 0:
                return json_error("The uploaded file is empty.", 400)
            if source.stat().st_size > MAX_UPLOAD_BYTES:
                return json_error("The upload exceeds the 25 MB file-size limit.", 413)
            converted = convert_to_pdf(source, extension, work_path)
            document_dir.mkdir(parents=True, exist_ok=False)
            original_path = document_dir / f"original{extension}"
            pdf_path = document_dir / "document.pdf"
            shutil.copyfile(source, original_path)
            shutil.copyfile(converted, pdf_path)
        content_type = mimetypes.guess_type(original_name)[0] or "application/octet-stream"
        connection = db_connect()
        try:
            cursor = connection.cursor()
            cursor.execute(
                """INSERT INTO documents (id,original_name,extension,content_type,original_size,pdf_size,owner_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (identifier, original_name, extension.lstrip(".").upper(), content_type,
                 original_path.stat().st_size, pdf_path.stat().st_size, session["user_id"]),
            )
            connection.commit()
            cursor.close()
        finally:
            connection.close()
        return jsonify({
            "id": identifier, "name": original_name, "extension": extension.lstrip(".").upper(),
            "contentType": content_type, "size": original_path.stat().st_size,
            "pdfSize": pdf_path.stat().st_size, "createdAt": datetime.now().astimezone().isoformat(),
            "pdfUrl": f"/api/documents/{identifier}/pdf", "originalUrl": f"/api/documents/{identifier}/original",
        }), 201
    except (OSError, RuntimeError, ValueError, MySQLError) as error:
        shutil.rmtree(document_dir, ignore_errors=True)
        app.logger.exception("Document upload or conversion failed.")
        return json_error(str(error) if isinstance(error, (RuntimeError, ValueError)) else "The file could not be saved.", 422)


def find_document(identifier):
    if len(identifier) != 32 or any(char not in "0123456789abcdef" for char in identifier):
        return None
    connection = db_connect()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute("SELECT * FROM documents WHERE id=%s", (identifier,))
        result = cursor.fetchone()
        cursor.close()
        return result
    finally:
        connection.close()


@app.get("/api/documents/<identifier>/pdf")
@login_required
def get_document_pdf(identifier):
    try:
        document = find_document(identifier)
    except MySQLError:
        return json_error("The database is unavailable.", 503)
    if document is None:
        return json_error("Document not found.", 404)
    return send_from_directory(UPLOAD_DIR / identifier, "document.pdf", mimetype="application/pdf",
                               as_attachment=True, download_name=f"{Path(document['original_name']).stem}.pdf")


@app.get("/api/documents/<identifier>/original")
@login_required
def get_document_original(identifier):
    try:
        document = find_document(identifier)
    except MySQLError:
        return json_error("The database is unavailable.", 503)
    if document is None:
        return json_error("Document not found.", 404)
    extension = Path(document["original_name"]).suffix.lower()
    return send_from_directory(UPLOAD_DIR / identifier, f"original{extension}",
                               mimetype=document["content_type"],
                               as_attachment=not document["content_type"].startswith("image/"),
                               download_name=document["original_name"])


@app.delete("/api/documents/<identifier>")
@faculty_required
def delete_document(identifier):
    try:
        document = find_document(identifier)
        if document is None:
            return json_error("Document not found.", 404)
        connection = db_connect()
        try:
            cursor = connection.cursor()
            cursor.execute("DELETE FROM documents WHERE id=%s", (identifier,))
            connection.commit()
            cursor.close()
        finally:
            connection.close()
        shutil.rmtree(UPLOAD_DIR / identifier, ignore_errors=True)
        return "", 204
    except MySQLError:
        app.logger.exception("Could not delete an uploaded document.")
        return json_error("The document could not be deleted.", 500)


@app.errorhandler(MySQLError)
def database_error(_error):
    app.logger.exception("A MySQL operation failed.")
    return json_error("The EduVault database is unavailable. Check your MySQL server and .env settings.", 503)


@app.errorhandler(413)
def request_too_large(_error):
    return json_error("The upload exceeds the 25 MB file-size limit.", 413)


@app.after_request
def security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port, debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
