FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# LibreOffice lets faculty uploads (DOCX, PPTX, XLSX, images, etc.) be converted to PDF.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
       fonts-liberation fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p /app/instance/uploads

EXPOSE 10000
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 8 --timeout 120 app:app"]
