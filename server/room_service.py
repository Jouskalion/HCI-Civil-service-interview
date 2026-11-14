from flask import g
from db import get_db
import json
import math
from db import now
from server.validation import require
import time

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
                    {
                        "examiner": x["examiner"],
                        "comment": x["comment"],
                        "feedback": json.loads(x["feedback_json"]),
                    }
                    for x in rows
                ],
            }
        )
    return out


