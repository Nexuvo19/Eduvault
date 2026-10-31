"""Create a faculty account. Run: python create_faculty.py"""
import getpass
import os

import mysql.connector
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

load_dotenv()


def main():
    identifier = input("Faculty ID or email: ").strip().lower()
    full_name = input("Faculty full name: ").strip()
    password = getpass.getpass("Password (minimum 8 characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if len(identifier) < 3 or len(full_name) < 2 or len(password) < 8:
        raise SystemExit("Enter a valid ID, full name, and password with at least 8 characters.")
    if password != confirmation:
        raise SystemExit("The passwords do not match.")
    options = {
        "host": os.getenv("DB_HOST", "127.0.0.1"), "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "root"), "password": os.getenv("DB_PASSWORD", ""),
        "database": os.getenv("DB_NAME", "eduvault"), "charset": "utf8mb4",
        "connection_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
    }
    ssl_ca = os.getenv("DB_SSL_CA", "").strip()
    if ssl_ca:
        options.update(ssl_ca=ssl_ca, ssl_verify_cert=True, ssl_verify_identity=True)
    connection = mysql.connector.connect(**options)
    try:
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO users (identifier,full_name,password_hash,role) VALUES (%s,%s,%s,'faculty')",
            (identifier, full_name, generate_password_hash(password)),
        )
        connection.commit()
        cursor.close()
        print(f"Faculty account created for {identifier}.")
    except mysql.connector.Error as error:
        connection.rollback()
        if getattr(error, "errno", None) == 1062:
            raise SystemExit("An account with that ID/email already exists.") from error
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
