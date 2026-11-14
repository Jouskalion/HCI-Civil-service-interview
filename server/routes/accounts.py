from server.config import BASE
from server.config import DIMENSIONS
from server.security import auth
from server.security import body
from werkzeug.security import check_password_hash
from flask import g
from werkzeug.security import generate_password_hash
from db import get_db
from flask import jsonify
from server.validation import require
import secrets
from flask import send_from_directory
from flask import session
from server.validation import text

def register(app):
    @app.get("/")
    def index():
        return send_from_directory(BASE / "static", "index.html")


    @app.get("/api/session")
    def current():
        if not session.get("csrf"):
            session["csrf"] = secrets.token_hex(24)
        return jsonify(user=g.user, csrf=session["csrf"], dimensions=DIMENSIONS)


    @app.post("/api/login")
    def login():
        d = body()
        u = (
            get_db()
            .execute(
                "SELECT * FROM users WHERE username=?",
                (text(d.get("username", ""), 60),),
            )
            .fetchone()
        )
        require(
            u is not None
            and check_password_hash(u["password"], text(d.get("password", ""), 200)),
            "账号或密码不正确",
            401,
        )
        session.clear()
        session.update(uid=u["id"], csrf=secrets.token_hex(24))
        session.permanent = True
        return jsonify(
            user={k: u[k] for k in ("id", "username", "name", "role")},
            csrf=session["csrf"],
        )


    @app.post("/api/register")
    def register():
        d = body()
        name = text(d.get("name", ""), 30)
        username = text(d.get("username", ""), 30)
        password = text(d.get("password", ""), 100)
        require(
            name
            and len(password) >= 8
            and 3 <= len(username) <= 30
            and username.isascii()
            and username.replace("_", "").isalnum(),
            "姓名必填；账号为至少 3 位字母数字下划线；密码至少 8 位",
        )
        with get_db() as c:
            c.execute(
                "INSERT INTO users(username,name,password,role) VALUES (?,?,?,'candidate')",
                (username, name, generate_password_hash(password)),
            )
        return jsonify(ok=True), 201


    @app.post("/api/logout")
    @auth()
    def logout():
        with get_db() as c:
            c.execute("DELETE FROM presence WHERE user_id=?", (g.user["id"],))
        session.clear()
        return jsonify(ok=True)


    @app.get("/api/users")
    @auth("admin")
    def users():
        return jsonify(
            items=[
                dict(x)
                for x in get_db().execute("SELECT id,name,role FROM users ORDER BY id")
            ]
        )


