from server.validation import RuleError
from server.security import auth
from server.security import body
from datetime import datetime
from server.room_service import event
from flask import g
from db import get_db
from server.validation import integer
import json
from flask import jsonify
from db import now
from server.room_service import remaining
from server.validation import require
from server.room_service import results
from server.room_service import room
from server.validation import text
import time

def register(app):
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
            support=(
                [
                    dict(x)
                    for x in c.execute(
                        "SELECT m.*,s.name sender_name,t.name recipient_name FROM support_messages m JOIN users s ON s.id=m.sender_id JOIN users t ON t.id=m.recipient_id WHERE m.room_id=? AND (m.sender_id=? OR m.recipient_id=?) ORDER BY m.id DESC LIMIT 100",
                        (rid, g.user["id"], g.user["id"]),
                    )
                ][::-1]
                if g.user["role"] != "admin"
                else []
            ),
            submission_progress=(
                [
                    {
                        "candidate_id": m["id"],
                        "submitted": c.execute(
                            "SELECT count(*) FROM scores WHERE room_id=? AND candidate_id=? AND submitted=1",
                            (rid, m["id"]),
                        ).fetchone()[0],
                        "expected": sum(x["role"] == "examiner" for x in members),
                    }
                    for m in members
                    if m["role"] == "candidate"
                ]
                if g.user["id"] == r["chief_id"]
                else []
            ),
            results=results(rid) if r["published"] else [],
        )


