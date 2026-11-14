from server.validation import RuleError
from flask import g
from db import get_db
from flask import jsonify
from flask import request
from server.validation import require
import secrets
from flask import session
import sqlite3

def register(app):
    @app.teardown_appcontext
    def close(_):
        c = g.pop("db", None)
        if c:
            c.close()


    @app.errorhandler(RuleError)
    def error(e):
        return jsonify(error=e.message), e.status


    @app.errorhandler(sqlite3.IntegrityError)
    def duplicate(_):
        return jsonify(error="记录重复或关联无效，请刷新后重试"), 409


    @app.errorhandler(413)
    def large(_):
        return jsonify(error="提交内容过大"), 413


    @app.before_request
    def before():
        g.user = None
        if session.get("uid"):
            u = (
                get_db()
                .execute(
                    "SELECT id,username,name,role FROM users WHERE id=?",
                    (session["uid"],),
                )
                .fetchone()
            )
            if u:
                g.user = dict(u)
        if request.path.startswith("/api/") and request.method == "POST":
            require(
                bool(session.get("csrf"))
                and secrets.compare_digest(
                    request.headers.get("X-CSRF-Token", ""), session["csrf"]
                ),
                "页面验证已过期，请刷新后重试",
                403,
            )


    @app.after_request
    def headers(r):
        r.headers.update(
            {
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Referrer-Policy": "same-origin",
                "Permissions-Policy": "camera=(self), microphone=(self)",
            }
        )
        if request.path.startswith("/api/"):
            r.headers["Cache-Control"] = "no-store"
        return r
