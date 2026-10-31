# EduVault — public PWA + Flask + MySQL

EduVault is an installable Progressive Web App (PWA). A public deployment gives everyone one HTTPS link; Android users can install it from Chrome, and desktop users can install it from a supported browser. It is not an APK yet and does not require a Play Store listing for people to install it from your link.

The project uses Flask for its backend and MySQL for persistent account, academic, workspace, and uploaded-file data. The deployment files are configured for **Render (web app) + Aiven for MySQL (database)**. These providers have free entry options suitable for a class/demo project, but free services have availability, storage, and usage limitations. Check provider terms before using this for real college-wide data.

## What the app includes

- Password-hashed student/faculty authentication and student self-registration.
- Faculty accounts created only by an administrator.
- Shared resources, assignments and announcements stored in MySQL.
- Per-user bookmarks, assignment status, read state, practice history, chat, support requests and preferences stored in MySQL.
- Faculty document uploads converted to PDF by LibreOffice, with original and PDF bytes stored in MySQL.
- PWA manifest, install icons and service worker. The app shell can be cached; database/API actions still need internet access.

## A. Publish EduVault so everyone can open it

### 1. Create the online MySQL database (Aiven)

1. Create an account at [Aiven](https://aiven.io/) and create an **Aiven for MySQL** service. The Aiven MySQL free tier is limited (currently 1 CPU, 1 GB RAM and 1 GB storage; it can be powered off after extended inactivity).
2. Open the service's **Databases** section and create a database named `eduvault`.
3. Create or choose a database user with access to that database. Record the host, port, username and password from Aiven's connection information.
4. Download the service's **CA certificate** (`ca.pem`). Keep it private and do not commit it to GitHub.

### 2. Create the tables and initial faculty account

Do this from your laptop before deploying. This makes the schema and demo records in the hosted database.

1. Extract this ZIP and open the `EduVault-App` folder in VS Code.
2. Copy `.env.example` to `.env`.
3. Put the Aiven host, port, user and password in `.env`, and set:

   ```dotenv
   DB_NAME=eduvault
   DB_CREATE_DATABASE=false
   DB_SSL_CA=C:/path/to/your/downloaded/ca.pem
   ```

   Use the real path where you saved Aiven's CA file. Keep `.env` and `ca.pem` out of GitHub.
4. In the project terminal run:

   **Windows PowerShell**

   ```powershell
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   py -m pip install -r requirements.txt
   py init_db.py
   py create_faculty.py
   ```

   **macOS/Linux**

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install -r requirements.txt
   python init_db.py
   python create_faculty.py
   ```

   `init_db.py` creates the project tables, adds missing document-storage columns to existing databases, and inserts the supplied demo records. `create_faculty.py` asks for the faculty ID, name and password. Students can register from the app.

### 3. Put the project on GitHub

1. Create a new GitHub repository, for example `eduvault-app`.
2. Upload the **contents inside** the `EduVault-App` folder to the repository root. Make sure `render.yaml`, `Dockerfile`, `app.py`, `requirements.txt`, `database/` and the HTML/CSS/JS files are at the top level / expected paths.
3. Do **not** upload `.env`, `ca.pem`, `.venv`, passwords or private uploaded documents. `.gitignore` and `.dockerignore` are included to help protect them.

### 4. Deploy the Flask app on Render

1. Create an account at [Render](https://render.com/).
2. In the dashboard choose **New → Blueprint**, connect your GitHub repository, and select it. Render reads the included `render.yaml` and creates the web service.
3. If Render asks for the values marked `sync: false`, enter the Aiven values for `DB_HOST`, `DB_PORT`, `DB_USER` and `DB_PASSWORD`.
4. Open the new Render service → **Environment** → **Secret Files** → **Add Secret File**. Set the filename to `ca.pem` and paste the contents of the CA certificate downloaded from Aiven. `DB_SSL_CA` is already set to `/etc/secrets/ca.pem` in `render.yaml`.
5. Save and deploy. The service uses Gunicorn and HTTPS is provided by Render. The Dockerfile installs LibreOffice for faculty document conversion.
6. Wait for the deployment status to show **Live**. Open the public `https://...onrender.com` URL and test sign-up/login. Check `https://YOUR-APP.onrender.com/api/health`; it should return `{"status":"ok","database":"connected"}`.

Render's free web service sleeps after 15 minutes without inbound requests and can take about a minute to wake up. The first visit after it sleeps may therefore feel slow. Aiven's free MySQL service also has inactivity restrictions. This free setup is good for a demo / initial sharing, not a guaranteed always-on production service.

### 5. Share and install the app

Copy the public Render HTTPS URL and send it to anyone. On Android:

1. Open the link in Chrome.
2. Open Chrome's menu (⋮).
3. Tap **Install app** or **Add to Home screen**.
4. EduVault will appear on the phone like an app icon and open in its own app-style window.

On desktop Chrome/Edge, use the install icon in the address bar or the browser menu. Users do not need your laptop to be switched on after the app is deployed.

## B. Storage limits and backups

Student/faculty accounts, academic records, workspace data, document metadata, and new upload bytes are stored in MySQL. Uploads therefore survive Render restarts and redeploys. The original upload is limited to 25 MB; the converted PDF is limited to 40 MB, and both files together must fit within 48 MB for one document. Keep an eye on the Aiven database storage quota and arrange regular database backups before using real student records. Existing older uploads that have metadata but no bytes in MySQL still depend on their original host files; re-upload those documents if the old files are no longer available.

## C. Run locally

For local MySQL, copy `.env.example` to `.env`, set your credentials and keep `DB_CREATE_DATABASE=true`. Then run:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py init_db.py
py app.py
```

Open `http://127.0.0.1:5000`. The `/api/health` endpoint checks the database connection.

## D. Create more faculty accounts later

Run `python create_faculty.py` from a computer whose `.env` points to the hosted MySQL database. The script creates a faculty account directly in the live database. Do not expose faculty registration to the public.

## E. App vs APK vs Play Store

- **PWA link (included):** easiest option now. Anyone with the link can open it and install it from the browser. It works on Android and desktop, and requires no Play Store approval.
- **Android APK/AAB:** a separate Android packaging step. It can wrap the deployed HTTPS app using a Trusted Web Activity / Bubblewrap or a native WebView wrapper. A generated APK can then be distributed manually, but users need to allow installation from that source.
- **Google Play Store:** requires a Play developer account and compliance with current Play policies, app testing and store listing requirements. It is not included in this ZIP.

## Database tables

| Table | Purpose |
|---|---|
| `users` | Student/faculty accounts and password hashes |
| `resources` | Shared notes, papers, lab material and file references |
| `assignments` | Shared assignment records |
| `announcements` | Shared academic announcements |
| `documents` | Uploaded file metadata, original/PDF bytes, and owner reference |
| `user_workspace_data` | Per-user bookmarks, progress, preferences and related state |

## Main project files

- `app.py` — Flask routes, authentication, MySQL APIs and uploads
- `database/schema.sql` — MySQL tables and demo records
- `init_db.py` — creates/applies the schema and adds missing upload columns
- `create_faculty.py` — secure faculty-account creation utility
- `index.html`, `landing.css`, `landing.js` — sign-in and registration
- `dashboard.html`, `STYLE.CSS`, `TYPOGRAPHY.CSS`, `SCRIPTS.JS` — academic workspace
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — installable PWA assets
- `Dockerfile` — production container with LibreOffice
- `render.yaml` — Render deployment blueprint
- `.env.example` — local configuration template

## Official hosting references

- [Render: deploy a Flask app](https://render.com/docs/deploy-flask)
- [Render: free service limitations](https://render.com/docs/free)
- [Render: persistent disks](https://render.com/docs/disks)
- [Render: environment variables and secret files](https://render.com/docs/configure-environment-variables)
- [Aiven: MySQL free tier](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier)
- [Aiven: connect to MySQL from Python](https://aiven.io/docs/products/mysql/howto/connect-with-python)

**Important:** The current hosted instance is available at [eduvault-app-r9b3.onrender.com](https://eduvault-app-r9b3.onrender.com). Keep `.env`, `ca.pem`, passwords, and private uploaded documents out of GitHub.
