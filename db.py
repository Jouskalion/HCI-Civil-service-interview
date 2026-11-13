import json, sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from flask import current_app, g
from werkzeug.security import generate_password_hash


def now():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def connect(path):
    c = sqlite3.connect(path, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    return c


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def initialize(path, seed=True):
    with closing(connect(path)) as c, c:
        c.executescript(
            Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
        )
        if not seed or c.execute("SELECT count(*) FROM users").fetchone()[0]:
            return
        password = generate_password_hash("Demo2026!")
        for i, (username, name, role) in enumerate(
            [
                ("candidate", "林同学", "candidate"),
                ("candidate2", "陈同学", "candidate"),
                ("candidate3", "周同学", "candidate"),
                ("chief", "王主考官", "examiner"),
                ("examiner", "李考官", "examiner"),
                ("admin", "实验管理员", "admin"),
            ],
            1,
        ):
            c.execute(
                "INSERT INTO users VALUES (?,?,?,?,?)",
                (i, username, password, name, role),
            )
        for rid, title, kind, status, duration, published in [
            (1, "综合能力 · 结构化模拟", "structured", "waiting", 1200, 0),
            (2, "基层治理 · 无领导小组", "group", "waiting", 1800, 0),
            (3, "公共服务 · 历史演练", "structured", "ended", 1200, 1),
        ]:
            c.execute(
                "INSERT INTO rooms(id,title,kind,status,chief_id,scheduled,duration,remaining,published,allow_text,created) VALUES (?,?,?,?,4,?,?,?,?,1,?)",
                (rid, title, kind, status, now(), duration, duration, published, now()),
            )
            ids = [1, 4, 5] if kind == "structured" else [1, 2, 3, 4, 5]
            c.executemany(
                "INSERT INTO members(room_id,user_id) VALUES (?,?)",
                [(rid, i) for i in ids],
            )
            questions = (
                [
                    (
                        "综合分析",
                        "某地开设“办不成事”反映窗口。有人认为方便群众，有人担心流于形式。请谈谈你的看法。",
                        "先明确服务目标，再分析实施条件与风险，最后提出可检验的改进建议。",
                    ),
                    (
                        "应急应变",
                        "服务大厅系统突发故障，群众排队情绪激动。作为现场工作人员，你会怎样处理？",
                        "先安抚与分流，建立替代办理机制，协同排障并及时告知进度。",
                    ),
                ]
                if kind == "structured"
                else [
                    (
                        "讨论任务",
                        "某社区有 30 万元公共服务预算。备选项目：老年助餐、儿童活动、无障碍改造、夜间照明、数字办事辅导。请讨论确定优先次序，并形成兼顾公平与可行性的分配方案。\n阶段：个人陈述 → 自由讨论 → 总结陈述。",
                        "先统一评价标准，比较需求紧迫程度、覆盖人数与实施成本；尊重分歧并形成可执行共识。",
                    )
                ]
            )
            for j, (title, body, hint) in enumerate(questions):
                c.execute(
                    "INSERT INTO questions(room_id,position,title,body,hint) VALUES (?,?,?,?,?)",
                    (rid, j, title, body, hint),
                )
        for eid, values in [
            (4, [82, 85, 83, 80, 81, 86]),
            (5, [84, 83, 82, 81, 82, 85]),
        ]:
            c.execute(
                "INSERT INTO scores VALUES (3,1,?,?,?,?,?)",
                (
                    eid,
                    json.dumps(values),
                    "教学合成样例：表达较清楚，建议增加具体实施步骤与风险应对。",
                    1,
                    now(),
                ),
            )
        c.execute(
            "INSERT INTO messages(room_id,user_id,kind,content,created) VALUES (1,6,'system',?,?)",
            ("预置房间允许文字演练；真实音视频须主动点击连接。", now()),
        )
