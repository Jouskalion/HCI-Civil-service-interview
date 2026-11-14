from server.room_service import active
from server.security import auth
from server.security import body
from server.room_service import chief
from server.room_service import event
from flask import g
from db import get_db
from flask import jsonify
from db import now
from server.room_service import remaining
from server.validation import require
from server.room_service import room
from server.validation import text
import time

def register(app):
    @app.post("/api/rooms/<int:rid>/support")
    @auth("candidate", "examiner")
    def support_message(rid):
        r = room(rid)
        require(not r["published"], "已归档房间只读", 409)
        d = body()
        recipient = d.get("recipient_id")
        require(type(recipient) is int and recipient != g.user["id"], "请选择联系对象")
        require(
            g.user["id"] == r["chief_id"] or recipient == r["chief_id"],
            "只能私密联系本房间主考官",
            403,
        )
        require(
            get_db()
            .execute(
                "SELECT 1 FROM members WHERE room_id=? AND user_id=?", (rid, recipient)
            )
            .fetchone(),
            "联系对象不属于本房间",
            403,
        )
        value = text(d.get("content", ""), 1000)
        require(value, "请说明需要帮助的问题")
        with get_db() as c:
            c.execute(
                "INSERT INTO support_messages(room_id,sender_id,recipient_id,content,created) VALUES (?,?,?,?,?)",
                (rid, g.user["id"], recipient, value, now()),
            )
        return jsonify(ok=True), 201


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
