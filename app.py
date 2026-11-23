"""Serve Termfolio on a local browser without a web framework."""

import argparse
import io
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from extractor import METHODS, extract

ROOT = Path(__file__).resolve().parent
MAX_TEXT = 60_000
MAX_FILE = 5 * 1024 * 1024
STATIC = {"/": ("index.html", "text/html"), "/styles.css": ("styles.css", "text/css"),
          "/workbench.js": ("workbench.js", "text/javascript")}


def text_from_file(data, filename):
    extension = Path(filename).suffix.lower()
    if extension in {".txt", ".md"}:
        try:
            return data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("Save this document as UTF-8 and upload it again.") from exc
    if extension != ".pdf":
        raise ValueError("Choose a .txt, .md or .pdf file.")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("This PDF is encrypted. Upload an unlocked copy.")
        if len(reader.pages) > 40:
            raise ValueError("Upload a PDF with 40 pages or fewer.")
        pages = []
        for page in reader.pages:
            raw = page.extract_text() or ""
            # A single PDF line break usually comes from layout, so join wrapped lines.
            paragraphs = raw.replace("\r\n", "\n").strip().split("\n\n")
            pages.append("\n\n".join(" ".join(part.split()) for part in paragraphs))
        result = "\n\n".join(pages).strip()
    except (PyPdfError, OSError, RecursionError) as exc:
        raise ValueError("Could not read this PDF. Try a text file or another PDF.") from exc
    if not result:
        raise ValueError("This PDF has no selectable text. Paste the text or upload an OCR copy.")
    return result


class Handler(BaseHTTPRequestHandler):
    def send_bytes(self, data, content_type, status=HTTPStatus.OK):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, data, status=HTTPStatus.OK):
        self.send_bytes(json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)

    def do_GET(self):
        if self.path == "/api/evaluation":
            self.send_json(self.server.evaluation)
        elif self.path in STATIC:
            filename, mime = STATIC[self.path]
            self.send_bytes((ROOT / "web" / filename).read_bytes(), f"{mime}; charset=utf-8")
        elif self.path == "/favicon.ico":
            self.send_bytes(b"", "image/x-icon", HTTPStatus.NO_CONTENT)
        else:
            self.send_json({"error": "Page not found."}, HTTPStatus.NOT_FOUND)

    def read_body(self, maximum):
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= maximum:
            raise ValueError("The request is empty or exceeds the size limit.")
        return self.rfile.read(size)

    def do_POST(self):
        try:
            if self.path == "/api/extract":
                payload = json.loads(self.read_body(MAX_TEXT * 8))
                if not isinstance(payload, dict):
                    raise ValueError("Send a text document, method and result count.")
                text, method, limit = (payload.get(key) for key in ("text", "method", "limit"))
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("Paste some text or upload a document first.")
                if len(text) > MAX_TEXT:
                    raise ValueError("Use 60,000 characters or fewer.")
                if method not in METHODS or type(limit) is not int or not 1 <= limit <= 30:
                    raise ValueError("Choose a valid method and a result count from 1 to 30.")
                response = extract(text, self.server.model, method, limit)
            elif self.path == "/api/document":
                filename = self.headers.get("X-Document-Name", "")
                text = text_from_file(self.read_body(MAX_FILE), filename).strip()
                if not text:
                    raise ValueError("This document is empty.")
                if len(text) > MAX_TEXT:
                    raise ValueError("This document exceeds 60,000 characters. Try a shorter excerpt.")
                response = {"text": text}
            else:
                self.send_json({"error": "Page not found."}, HTTPStatus.NOT_FOUND)
                return
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json({"error": "Could not read the submitted data."}, HTTPStatus.BAD_REQUEST)
            return
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self.send_json(response)


def server_at(port):
    model = json.loads((ROOT / "artifacts/model.json").read_text(encoding="utf-8"))
    evaluation = json.loads((ROOT / "artifacts/evaluation.json").read_text(encoding="utf-8"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.model, server.evaluation = model, evaluation
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    options = parser.parse_args()
    with server_at(options.port) as server:
        print(f"Termfolio is running at http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
