from server.validation import RuleError
from server.security import auth
from server.security import body
from flask import g
from db import get_db
import json
from flask import jsonify
from server.validation import require
from server.room_service import room
from server.validation import text
import time

def register(app):
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


