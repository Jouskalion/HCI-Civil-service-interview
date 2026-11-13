"""Independent LAN interview lab. HTTP polling carries signalling; media uses WebRTC."""

import csv, io, json, os, secrets, sqlite3, time, math
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path
from flask import Flask, request, session, g, jsonify, send_from_directory, Response
from werkzeug.security import check_password_hash, generate_password_hash
from db import get_db, initialize, now

BASE = Path(__file__).resolve().parent
DIMENSIONS = [
    "综合分析能力",
    "沟通表达能力",
    "逻辑思维能力",
    "应变能力",
    "团队协作能力",
    "仪表举止",
]


class RuleError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def require(ok, message, status=400):
    if not ok:
        raise RuleError(message, status)


def text(value, limit=5000):
    require(
        isinstance(value, str) and len(value) <= limit, f"请输入不超过 {limit} 字的文本"
    )
    return value.strip()


def integer(value, lo, hi):
    require(type(value) is int and lo <= value <= hi, f"数值须为 {lo} 至 {hi} 的整数")
    return value


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

    def auth(*roles):
        def deco(f):
            @wraps(f)
            def run(*a, **kw):
                require(g.user is not None, "请先登录", 401)
                require(
                    not roles or g.user["role"] in roles, "当前角色无权执行此操作", 403
                )
                return f(*a, **kw)

            return run

        return deco

    def body():
        d = request.get_json(silent=True)
        require(isinstance(d, dict), "请求格式无效")
        return d

    def room(rid):
        r = get_db().execute("SELECT * FROM rooms WHERE id=?", (rid,)).fetchone()
        require(r is not None, "房间不存在", 404)
        require(
            g.user["role"] == "admin"
            or get_db()
            .execute(
                "SELECT 1 FROM members WHERE room_id=? AND user_id=?",
                (rid, g.user["id"]),
            )
            .fetchone(),
            "你未被分配到此房间",
            403,
        )
        return dict(r)

    def chief(r):
        require(r["chief_id"] == g.user["id"], "只有本房间主考官可以控制面试", 403)

    def active(r):
        require(
            r["status"] == "active" and not r["paused"], "当前不在可作答的面试阶段", 409
        )

    def remaining(r):
        return (
            max(0, math.ceil(r["deadline"] - time.time()))
            if r["status"] == "active" and not r["paused"] and r["deadline"]
            else r["remaining"]
        )

    def event(rid, content):
        get_db().execute(
            "INSERT INTO messages(room_id,user_id,kind,content,created) VALUES (?,?,'system',?,?)",
            (rid, g.user["id"], content, now()),
        )

    def member_candidates(rid):
        return (
            get_db()
            .execute(
                "SELECT u.id,u.name,m.ready FROM members m JOIN users u ON u.id=m.user_id WHERE room_id=? AND u.role='candidate'",
                (rid,),
            )
            .fetchall()
        )

    def results(rid):
        out = []
        for c in member_candidates(rid):
            if g.user["role"] == "candidate" and c["id"] != g.user["id"]:
                continue
            rows = (
                get_db()
                .execute(
                    "SELECT s.*,u.name examiner FROM scores s JOIN users u ON u.id=s.examiner_id WHERE room_id=? AND candidate_id=? AND submitted=1",
                    (rid, c["id"]),
                )
                .fetchall()
            )
            vals = [json.loads(x["values_json"]) for x in rows]
            out.append(
                {
                    "id": c["id"],
                    "name": c["name"],
                    "total": (
                        round(sum(sum(v) / 6 for v in vals) / len(vals), 2)
                        if vals
                        else None
                    ),
                    "dimensions": (
                        [
                            round(sum(v[i] for v in vals) / len(vals), 2)
                            for i in range(6)
                        ]
                        if vals
                        else []
                    ),
                    "comments": [
                        {"examiner": x["examiner"], "comment": x["comment"]}
                        for x in rows
                    ],
                }
            )
        return out

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

    @app.get("/api/rooms")
    @auth()
    def rooms():
        sql = "SELECT r.*,u.name chief,(SELECT count(*) FROM members m JOIN users cu ON cu.id=m.user_id WHERE m.room_id=r.id AND cu.role='candidate') candidate_count FROM rooms r JOIN users u ON u.id=r.chief_id"
        args = []
        if g.user["role"] != "admin":
            sql += " WHERE EXISTS(SELECT 1 FROM members m WHERE m.room_id=r.id AND m.user_id=?)"
            args = [g.user["id"]]
        return jsonify(
            items=[dict(x) for x in get_db().execute(sql + " ORDER BY r.id DESC", args)]
        )

    @app.post("/api/rooms")
    @auth("admin")
    def create_room():
        d = body()
        title = text(d.get("title", ""), 80)
        kind = d.get("kind")
        duration = integer(d.get("duration"), 60, 7200)
        require(title and kind in ("structured", "group"), "请填写房间名称和面试形式")
        candidates = d.get("candidates")
        examiners = d.get("examiners")
        cid = d.get("chief_id")
        require(
            isinstance(candidates, list)
            and isinstance(examiners, list)
            and all(type(x) is int for x in candidates + examiners),
            "请选择参与者",
        )
        require(
            len(set(candidates)) == (1 if kind == "structured" else len(candidates))
            and (
                len(candidates) == 1
                if kind == "structured"
                else 2 <= len(candidates) <= 6
            ),
            "结构化面试须 1 位考生，小组面试须 2 至 6 位考生",
        )
        require(
            1 <= len(set(examiners)) <= 3 and cid in examiners,
            "请选择 1 至 3 位考官并指定主考官",
        )
        for ids, role in [(candidates, "candidate"), (examiners, "examiner")]:
            for uid in ids:
                require(
                    get_db()
                    .execute("SELECT 1 FROM users WHERE id=? AND role=?", (uid, role))
                    .fetchone(),
                    "参与者角色不正确",
                )
        questions = d.get("questions")
        require(
            isinstance(questions, list) and 1 <= len(questions) <= 8,
            "请提供 1 至 8 道题目",
        )
        qs = []
        for q in questions:
            require(isinstance(q, dict), "题目格式无效")
            b = text(q.get("body", ""), 3000)
            require(b, "题干不能为空")
            qs.append(
                (text(q.get("title", "面试题"), 80), b, text(q.get("hint", ""), 1000))
            )
        scheduled = text(d.get("scheduled", now()), 50)
        try:
            parsed = datetime.fromisoformat(scheduled)
        except ValueError:
            raise RuleError("计划时间格式无效")
        if parsed.tzinfo is None:
            parsed = parsed.astimezone()
        with get_db() as c:
            rid = c.execute(
                "INSERT INTO rooms(title,kind,chief_id,scheduled,duration,remaining,allow_text,created) VALUES (?,?,?,?,?,?,?,?)",
                (
                    title,
                    kind,
                    cid,
                    parsed.isoformat(),
                    duration,
                    duration,
                    int(d.get("allow_text") is True),
                    now(),
                ),
            ).lastrowid
            c.executemany(
                "INSERT INTO members(room_id,user_id) VALUES (?,?)",
                [(rid, x) for x in set(candidates + examiners)],
            )
            c.executemany(
                "INSERT INTO questions(room_id,position,title,body,hint) VALUES (?,?,?,?,?)",
                [(rid, i, *q) for i, q in enumerate(qs)],
            )
            event(rid, "管理员创建房间并分配考官与考生。")
        return jsonify(id=rid), 201

    @app.get("/api/rooms/<int:rid>")
    @auth()
    def detail(rid):
        r = room(rid)
        c = get_db()
        r["seconds_left"] = remaining(r)
        r["server_time"] = time.time()
        members = [
            dict(x)
            for x in c.execute(
                "SELECT u.id,u.name,u.role,m.ready,m.raised,m.device_json FROM members m JOIN users u ON u.id=m.user_id WHERE room_id=? ORDER BY u.id",
                (rid,),
            )
        ]
        for m in members:
            m["device"] = json.loads(m.pop("device_json"))
            m["online"] = bool(
                c.execute(
                    "SELECT 1 FROM presence WHERE room_id=? AND user_id=? AND seen>?",
                    (rid, m["id"], time.time() - 20),
                ).fetchone()
            )
        questions = [
            dict(x)
            for x in c.execute(
                "SELECT * FROM questions WHERE room_id=? ORDER BY position", (rid,)
            )
        ]
        if r["status"] == "waiting" and g.user["role"] == "candidate":
            questions = [
                {
                    "id": q["id"],
                    "title": "面试开始后展示",
                    "body": "请先检查设备并准备候考。",
                    "hint": "",
                    "position": q["position"],
                }
                for q in questions
            ]
        examiner = g.user["role"] == "examiner"
        messages = [
            dict(x)
            for x in c.execute(
                "SELECT m.*,u.name FROM messages m LEFT JOIN users u ON u.id=m.user_id WHERE room_id=?"
                + ("" if examiner else " AND kind!='examiner'")
                + " ORDER BY m.id DESC LIMIT 100",
                (rid,),
            )
        ][::-1]
        note = c.execute(
            "SELECT content FROM notes WHERE room_id=? AND user_id=?",
            (rid, g.user["id"]),
        ).fetchone()
        scores = (
            [
                dict(x)
                for x in c.execute(
                    "SELECT * FROM scores WHERE room_id=? AND examiner_id=?",
                    (rid, g.user["id"]),
                )
            ]
            if examiner
            else []
        )
        answers = [
            dict(x)
            for x in c.execute(
                "SELECT a.*,u.name FROM answers a JOIN users u ON u.id=a.user_id WHERE room_id=?"
                + (" AND user_id=?" if g.user["role"] == "candidate" else ""),
                (rid, g.user["id"]) if g.user["role"] == "candidate" else (rid,),
            )
        ]
        extensions = [
            dict(x)
            for x in c.execute(
                "SELECT e.*,u.name FROM extensions e JOIN users u ON u.id=e.user_id WHERE room_id=?"
                + (" AND user_id=?" if g.user["role"] == "candidate" else ""),
                (rid, g.user["id"]) if g.user["role"] == "candidate" else (rid,),
            )
        ]
        return jsonify(
            room=r,
            members=members,
            questions=questions,
            messages=messages,
            note=note[0] if note else "",
            scores=scores,
            answers=answers,
            extensions=extensions,
            results=results(rid) if r["published"] else [],
        )

    @app.post("/api/rooms/<int:rid>/ready")
    @auth("candidate", "examiner")
    def ready(rid):
        r = room(rid)
        require(r["status"] == "waiting", "仅候考阶段可以确认准备", 409)
        d = body()
        mode = d.get("mode")
        require(mode in ("devices", "text"), "请选择设备自检或文字演练")
        require(mode != "text" or r["allow_text"], "此房间要求完成设备自检")
        if mode == "devices":
            require(
                d.get("camera") is True
                and d.get("microphone") is True
                and d.get("speaker") is True
                and d.get("network") is True
                and type(d.get("width")) is int
                and type(d.get("height")) is int
                and d["width"] >= 1280
                and d["height"] >= 720,
                "请完成 720p 摄像头、麦克风、扬声器与网络自检",
            )
        allowed = {
            k: d.get(k)
            for k in (
                "mode",
                "camera",
                "microphone",
                "speaker",
                "network",
                "width",
                "height",
            )
        }
        allowed["checked_at"] = now()
        with get_db() as c:
            c.execute(
                "UPDATE members SET ready=1,device_json=? WHERE room_id=? AND user_id=?",
                (json.dumps(allowed), rid, g.user["id"]),
            )
            event(
                rid,
                g.user["name"]
                + (
                    "已完成设备自检。"
                    if mode == "devices"
                    else "已选择文字演练并就绪（无音视频自检结论）。"
                ),
            )
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/control")
    @auth("examiner")
    def control(rid):
        d = body()
        with get_db() as c:
            c.execute("BEGIN IMMEDIATE")
            r = room(rid)
            chief(r)
            require(
                d.get("version") == r["version"], "房间状态已更新，请刷新后重试", 409
            )
            action = d.get("action")
            label = ""
            if action == "start":
                require(r["status"] == "waiting", "房间不能重复开始", 409)
                require(
                    datetime.fromisoformat(r["scheduled"]).timestamp() <= time.time(),
                    "尚未到计划开始时间",
                )
                ms = member_candidates(rid)
                require(
                    len(ms) >= (2 if r["kind"] == "group" else 1)
                    and all(m["ready"] for m in ms),
                    "考生人数不足或尚未全部就绪",
                )
                require(
                    c.execute(
                        "SELECT ready FROM members WHERE room_id=? AND user_id=?",
                        (rid, g.user["id"]),
                    ).fetchone()[0],
                    "主考官尚未确认就绪",
                )
                c.execute(
                    "UPDATE rooms SET status='active',deadline=?,remaining=duration WHERE id=?",
                    (time.time() + r["duration"], rid),
                )
                label = "主考官宣布正式开始面试。请主动连接音视频通话。"
            elif action == "pause":
                active(r)
                c.execute(
                    "UPDATE rooms SET paused=1,remaining=?,deadline=NULL WHERE id=?",
                    (remaining(r), rid),
                )
                label = "主考官暂停计时。"
            elif action == "resume":
                require(r["status"] == "active" and r["paused"], "当前未暂停", 409)
                c.execute(
                    "UPDATE rooms SET paused=0,deadline=? WHERE id=?",
                    (time.time() + r["remaining"], rid),
                )
                label = "主考官恢复计时。"
            elif action == "next":
                active(r)
                if r["kind"] == "group":
                    require(r["phase"] < 2, "已经是总结陈述阶段")
                    c.execute("UPDATE rooms SET phase=phase+1 WHERE id=?", (rid,))
                    label = "进入下一讨论阶段。"
                else:
                    count = c.execute(
                        "SELECT count(*) FROM questions WHERE room_id=?", (rid,)
                    ).fetchone()[0]
                    require(r["current_question"] + 1 < count, "已经是最后一道题")
                    c.execute(
                        "UPDATE rooms SET current_question=current_question+1 WHERE id=?",
                        (rid,),
                    )
                    label = "主考官展示下一题。"
            elif action == "end":
                require(r["status"] == "active", "面试尚未开始或已经结束", 409)
                c.execute(
                    "UPDATE rooms SET status='ended',remaining=?,deadline=NULL,paused=0 WHERE id=?",
                    (remaining(r), rid),
                )
                c.execute("UPDATE presence SET media=0 WHERE room_id=?", (rid,))
                label = "主考官结束面试，进入评分归档。"
            elif action == "publish":
                require(
                    r["status"] == "ended" and not r["published"],
                    "仅已结束且未公布的房间可以归档",
                    409,
                )
                expected = c.execute(
                    "SELECT count(*) FROM members m JOIN users u ON u.id=m.user_id WHERE room_id=? AND role='examiner'",
                    (rid,),
                ).fetchone()[0] * len(member_candidates(rid))
                actual = c.execute(
                    "SELECT count(*) FROM scores WHERE room_id=? AND submitted=1",
                    (rid,),
                ).fetchone()[0]
                require(
                    actual == expected and expected > 0, "仍有考官或考生的评分未提交"
                )
                c.execute("UPDATE rooms SET published=1 WHERE id=?", (rid,))
                label = "全部评分已归档，成绩可在历史回顾中查看。"
            else:
                raise RuleError("控制动作无效")
            c.execute("UPDATE rooms SET version=version+1 WHERE id=?", (rid,))
            event(rid, label)
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/note")
    @auth()
    def note(rid):
        room(rid)
        value = text(body().get("content", ""), 10000)
        with get_db() as c:
            c.execute(
                "INSERT INTO notes VALUES (?,?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET content=excluded.content,updated=excluded.updated",
                (rid, g.user["id"], value, now()),
            )
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/answer")
    @auth("candidate")
    def answer(rid):
        r = room(rid)
        active(r)
        require(remaining(r) > 0, "答题时间已到，请联系主考官")
        d = body()
        value = text(d.get("content", ""), 10000)
        require(value, "请填写作答要点")
        q = (
            get_db()
            .execute(
                "SELECT id FROM questions WHERE room_id=? AND position=?",
                (rid, r["current_question"]),
            )
            .fetchone()
        )
        require(q and q["id"] == d.get("question_id"), "题目已切换，请刷新", 409)
        with get_db() as c:
            c.execute(
                "INSERT INTO answers VALUES (?,?,?,?,?) ON CONFLICT(room_id,user_id,question_id) DO UPDATE SET content=excluded.content,submitted=excluded.submitted",
                (rid, g.user["id"], q["id"], value, now()),
            )
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/message")
    @auth("candidate", "examiner")
    def message(rid):
        r = room(rid)
        d = body()
        kind = d.get("kind", "public")
        value = text(d.get("content", ""), 1000)
        require(value, "请输入内容")
        require(kind in ("public", "examiner"), "频道无效")
        require(
            kind != "examiner" or g.user["role"] == "examiner",
            "考官内部频道不对考生开放",
            403,
        )
        require(not r["published"], "已归档房间只读", 409)
        with get_db() as c:
            c.execute(
                "INSERT INTO messages(room_id,user_id,kind,content,created) VALUES (?,?,?,?,?)",
                (rid, g.user["id"], kind, value, now()),
            )
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/hand")
    @auth("candidate")
    def hand(rid):
        r = room(rid)
        active(r)
        require(r["kind"] == "group", "举手用于无领导小组讨论")
        with get_db() as c:
            c.execute(
                "UPDATE members SET raised=1-raised WHERE room_id=? AND user_id=?",
                (rid, g.user["id"]),
            )
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/extension")
    @auth("candidate", "examiner")
    def extension(rid):
        d = body()
        with get_db() as c:
            c.execute("BEGIN IMMEDIATE")
            r = room(rid)
            require(r["status"] == "active", "只有面试中可以申请或处理延时", 409)
            if g.user["role"] == "candidate":
                value = text(d.get("reason", ""), 300)
                require(len(value) >= 4, "请简要说明延时原因")
                c.execute(
                    "INSERT INTO extensions(room_id,user_id,reason,created) VALUES (?,?,?,?)",
                    (rid, g.user["id"], value, now()),
                )
                event(rid, g.user["name"] + "申请延时 60 秒。")
            else:
                chief(r)
                x = c.execute(
                    "SELECT * FROM extensions WHERE id=? AND room_id=? AND status='pending'",
                    (d.get("id"), rid),
                ).fetchone()
                require(x, "申请已处理或不存在", 409)
                approve = d.get("approve") is True
                c.execute(
                    "UPDATE extensions SET status=? WHERE id=?",
                    ("approved" if approve else "rejected", x["id"]),
                )
                if approve:
                    if r["paused"]:
                        c.execute(
                            "UPDATE rooms SET remaining=remaining+60,version=version+1 WHERE id=?",
                            (rid,),
                        )
                    else:
                        c.execute(
                            "UPDATE rooms SET deadline=?,version=version+1 WHERE id=?",
                            (max(time.time(), r["deadline"]) + 60, rid),
                        )
                event(
                    rid,
                    "主考官"
                    + ("同意延时 60 秒。" if approve else "未同意此次延时申请。"),
                )
        return jsonify(ok=True)

    @app.post("/api/rooms/<int:rid>/scores")
    @auth("examiner")
    def score(rid):
        d = body()
        with get_db() as c:
            c.execute("BEGIN IMMEDIATE")
            r = room(rid)
            require(
                r["status"] != "waiting" and not r["published"], "当前不能编辑评分", 409
            )
            cid = d.get("candidate_id")
            require(
                cid in [m["id"] for m in member_candidates(rid)], "考生不属于本房间"
            )
            values = d.get("values")
            require(
                isinstance(values, list)
                and len(values) == 6
                and all(
                    x is None
                    or (type(x) in (int, float) and math.isfinite(x) and 0 <= x <= 100)
                    for x in values
                ),
                "六个评分项须为 0 至 100 分或留空",
            )
            comment = text(d.get("comment", ""), 2000)
            submitted = d.get("submit") is True
            if submitted:
                require(
                    r["status"] == "ended"
                    and all(x is not None for x in values)
                    and len(comment) >= 6,
                    "面试结束后，补齐六维评分及至少 6 字评语才能提交",
                )
            old = c.execute(
                "SELECT submitted FROM scores WHERE room_id=? AND candidate_id=? AND examiner_id=?",
                (rid, cid, g.user["id"]),
            ).fetchone()
            require(not old or not old[0], "已提交评分不可修改", 409)
            c.execute(
                "INSERT INTO scores VALUES (?,?,?,?,?,?,?) ON CONFLICT(room_id,candidate_id,examiner_id) DO UPDATE SET values_json=excluded.values_json,comment=excluded.comment,submitted=excluded.submitted,updated=excluded.updated",
                (
                    rid,
                    cid,
                    g.user["id"],
                    json.dumps(values),
                    comment,
                    int(submitted),
                    now(),
                ),
            )
        return jsonify(ok=True)

    @app.get("/api/history")
    @auth()
    def history():
        rs = (
            get_db()
            .execute(
                "SELECT * FROM rooms WHERE status='ended' AND published=1 ORDER BY id DESC"
            )
            .fetchall()
        )
        out = []
        for r in rs:
            if (
                g.user["role"] != "admin"
                and not get_db()
                .execute(
                    "SELECT 1 FROM members WHERE room_id=? AND user_id=?",
                    (r["id"], g.user["id"]),
                )
                .fetchone()
            ):
                continue
            out.append({"room": dict(r), "results": results(r["id"])})
        return jsonify(items=out)

    @app.get("/api/export/<int:rid>")
    @auth()
    def export(rid):
        r = room(rid)
        require(r["published"], "成绩尚未归档", 409)
        s = io.StringIO()
        w = csv.writer(s)
        w.writerow(["房间", "考生", "总分"] + DIMENSIONS)

        def safe(v):
            return (
                "'" + str(v)
                if str(v).startswith(("=", "+", "-", "@", "\t", "\r"))
                else v
            )

        for item in results(rid):
            w.writerow(
                [safe(r["title"]), safe(item["name"]), item["total"]]
                + item["dimensions"]
            )
        return Response(
            "\ufeff" + s.getvalue(),
            mimetype="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="interview-{rid}.csv"'
            },
        )

    @app.post("/api/rooms/<int:rid>/presence")
    @auth("candidate", "examiner")
    def presence(rid):
        r = room(rid)
        d = body()
        client = text(d.get("client", ""), 80)
        require(
            len(client) >= 16 and client.replace("-", "").isalnum(), "客户端标识无效"
        )
        media = d.get("media") is True
        require(not media or r["status"] == "active", "只有正式面试中可建立通话", 409)
        existing = (
            get_db()
            .execute("SELECT * FROM presence WHERE client_id=?", (client,))
            .fetchone()
        )
        require(
            not existing
            or (existing["user_id"] == g.user["id"] and existing["room_id"] == rid),
            "客户端标识冲突",
            409,
        )
        with get_db() as c:
            c.execute("DELETE FROM presence WHERE seen<?", (time.time() - 40,))
            c.execute("DELETE FROM signals WHERE created<?", (time.time() - 90,))
            if d.get("leave") is True:
                c.execute("DELETE FROM presence WHERE client_id=?", (client,))
            else:
                c.execute(
                    "INSERT INTO presence VALUES (?,?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET seen=excluded.seen,media=excluded.media",
                    (client, rid, g.user["id"], time.time(), int(media)),
                )
        peers = [
            dict(x)
            for x in get_db().execute(
                "SELECT p.client_id,p.user_id,p.media,u.name,u.role FROM presence p JOIN users u ON u.id=p.user_id WHERE room_id=? AND seen>? AND client_id!=?",
                (rid, time.time() - 20, client),
            )
        ]
        try:
            after = int(d.get("after", 0))
        except (ValueError, TypeError):
            raise RuleError("消息游标无效")
        signals = [
            dict(x)
            for x in get_db().execute(
                "SELECT id,sender,payload FROM signals WHERE receiver=? AND room_id=? AND id>? ORDER BY id LIMIT 100",
                (client, rid, after),
            )
        ]
        return jsonify(peers=peers, signals=signals, server_time=time.time())

    @app.post("/api/rooms/<int:rid>/signal")
    @auth("candidate", "examiner")
    def signal(rid):
        r = room(rid)
        require(r["status"] == "active", "面试未进行", 409)
        d = body()
        sender = text(d.get("sender", ""), 80)
        receiver = text(d.get("receiver", ""), 80)
        c = get_db()
        a = c.execute(
            "SELECT * FROM presence WHERE client_id=? AND room_id=? AND user_id=? AND media=1 AND seen>?",
            (sender, rid, g.user["id"], time.time() - 30),
        ).fetchone()
        b = c.execute(
            "SELECT * FROM presence WHERE client_id=? AND room_id=? AND media=1 AND seen>?",
            (receiver, rid, time.time() - 30),
        ).fetchone()
        require(a and b and sender != receiver, "对方尚未连接或已经离线", 409)
        payload = d.get("payload")
        require(
            isinstance(payload, dict)
            and payload.get("type") in ("offer", "answer", "candidate"),
            "信令格式无效",
        )
        value = json.dumps(payload)
        require(len(value) <= 60000, "信令内容过大")
        with c:
            c.execute(
                "INSERT INTO signals(room_id,sender,receiver,payload,created) VALUES (?,?,?,?,?)",
                (rid, sender, receiver, value, time.time()),
            )
        return jsonify(ok=True)

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
