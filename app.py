"""Application factory and command-line entry point."""
from flask import Flask
from db import initialize
import os
import secrets
from datetime import timedelta

from server.config import BASE
from server.config import DIMENSIONS
from server.validation import RuleError
from server.validation import require
from server.validation import text
from server.validation import integer
from server import lifecycle
from server.routes import accounts, rooms, collaboration, control, scores, signalling

def create_app(config=None):
    app = Flask(__name__, static_folder="static")
    local = BASE / ".local"
    local.mkdir(exist_ok=True)
    key = local / "session.key"
    if not key.exists():
        key.write_text(secrets.token_hex(32))
    app.config.update(
        SECRET_KEY=os.environ.get("INTERVIEW_SECRET") or key.read_text(),
        DATABASE=str(local / "interview.sqlite3"),
        SESSION_COOKIE_NAME="interview_lab_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=128 * 1024,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
    )
    if config:
        app.config.update(config)
    initialize(app.config["DATABASE"], app.config.get("SEED", True))
    lifecycle.register(app)
    accounts.register(app)
    rooms.register(app)
    collaboration.register(app)
    control.register(app)
    scores.register(app)
    signalling.register(app)
    return app



if __name__ == "__main__":
    from waitress import serve

    print("Interview lab: http://localhost:5200", flush=True)
    serve(
        create_app(),
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5200")),
        threads=16,
    )
