"""Apply database/schema.sql to the configured MySQL database."""
import os
import re
from pathlib import Path

import mysql.connector
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")


def mysql_options(include_database=False):
    options = {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
        "charset": "utf8mb4",
        "connection_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
    }
    if include_database:
        options["database"] = os.getenv("DB_NAME", "eduvault")
    ssl_ca = os.getenv("DB_SSL_CA", "").strip()
    if ssl_ca:
        options.update(ssl_ca=ssl_ca, ssl_verify_cert=True, ssl_verify_identity=True)
    return options


def main():
    database = os.getenv("DB_NAME", "eduvault")
    if not re.fullmatch(r"[A-Za-z0-9_]+", database):
        raise SystemExit("DB_NAME may contain only letters, numbers and underscores.")
    try:
        if os.getenv("DB_CREATE_DATABASE", "true").lower() == "true":
            server = mysql.connector.connect(**mysql_options())
            cursor = server.cursor()
            cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{database}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
            cursor.close()
            server.close()
        connection = mysql.connector.connect(**mysql_options(include_database=True))
        cursor = connection.cursor()
        schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
        statements = []
        for raw in schema.splitlines():
            line = raw.strip()
            if not line or line.startswith("--"):
                continue
            statements.append(raw)
        for statement in "\n".join(statements).split(";"):
            if statement.strip():
                cursor.execute(statement)
        connection.commit()
        cursor.close()
        connection.close()
        migrate_legacy_documents(mysql_options(), database)
        print(f"EduVault database '{database}' is ready.")
        print("Next: create a faculty login with python create_faculty.py")
    except mysql.connector.Error as error:
        raise SystemExit(
            "MySQL setup failed. Verify DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME "
            "and DB_SSL_CA in your environment. For hosted databases, create the database "
            f"in the provider console first. Details: {error}"
        ) from error


def migrate_legacy_documents(common, database):
    """Import metadata for files uploaded by the old JSON-backed version."""
    import json
    legacy_index = ROOT / "instance" / "documents.json"
    if not legacy_index.exists():
        return
    try:
        documents = json.loads(legacy_index.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("Warning: the old documents.json file could not be imported.")
        return
    if not isinstance(documents, list):
        return
    connection = mysql.connector.connect(**common, database=database)
    cursor = connection.cursor()
    for item in documents:
        try:
            cursor.execute(
                """INSERT IGNORE INTO documents (id,original_name,extension,content_type,original_size,pdf_size,owner_id)
                   VALUES (%s,%s,%s,%s,%s,%s,NULL)""",
                (item["id"], item["name"], item.get("extension", ""),
                 item.get("contentType", "application/octet-stream"), int(item.get("size", 0)),
                 int(item.get("pdfSize", 0))),
            )
        except (KeyError, TypeError, ValueError):
            continue
    connection.commit()
    cursor.close()
    connection.close()


if __name__ == "__main__":
    main()
