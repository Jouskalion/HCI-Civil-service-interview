from server.config import DIMENSIONS
from flask import Response
from server.security import auth
from server.security import body
import csv
from flask import g
from db import get_db
import io
import json
from flask import jsonify
import math
from server.room_service import member_candidates
from db import now
from server.validation import require
from server.room_service import results
from server.room_service import room
from server.validation import text

def register(app):
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
            feedback = d.get("feedback", {})
            require(isinstance(feedback, dict), "评语格式无效")
            feedback = {
                key: text(feedback.get(key, ""), 600)
                for key in ("evidence", "strengths", "suggestions")
            }
            has_feedback = any(feedback.values())
            if has_feedback:
                comment = "\n".join(
                    label + "：" + feedback[key]
                    for key, label in [
                        ("evidence", "表现证据"),
                        ("strengths", "优点"),
                        ("suggestions", "改进建议"),
                    ]
                    if feedback[key]
                )
            submitted = d.get("submit") is True
            if submitted:
                require(
                    not has_feedback or all(len(v) >= 6 for v in feedback.values()),
                    "请补齐表现证据、优点和改进建议，每项至少 6 字",
                )
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
                "INSERT INTO scores(room_id,candidate_id,examiner_id,values_json,comment,submitted,updated,feedback_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(room_id,candidate_id,examiner_id) DO UPDATE SET values_json=excluded.values_json,comment=excluded.comment,submitted=excluded.submitted,updated=excluded.updated,feedback_json=excluded.feedback_json",
                (
                    rid,
                    cid,
                    g.user["id"],
                    json.dumps(values),
                    comment,
                    int(submitted),
                    now(),
                    json.dumps(feedback, ensure_ascii=False) if has_feedback else "{}",
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
