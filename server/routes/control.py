from server.validation import RuleError
from server.room_service import active
from server.security import auth
from server.security import body
from server.room_service import chief
from datetime import datetime
from server.room_service import event
from flask import g
from db import get_db
import json
from flask import jsonify
from server.room_service import member_candidates
from db import now
from server.room_service import remaining
from server.validation import require
from server.room_service import room
import time

def register(app):
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


