import json, tempfile, unittest
from pathlib import Path
from app import create_app


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(
            {
                "TESTING": True,
                "DATABASE": str(Path(self.temp.name) / "test.db"),
                "SECRET_KEY": "test-key",
            }
        )
        self.clients = {}
        for name in (
            "candidate",
            "candidate2",
            "candidate3",
            "chief",
            "examiner",
            "admin",
        ):
            c = self.app.test_client()
            csrf = c.get("/api/session").json["csrf"]
            d = c.post(
                "/api/login",
                json={"username": name, "password": "Demo2026!"},
                headers={"X-CSRF-Token": csrf},
            ).json
            self.clients[name] = (c, d["csrf"])

    def tearDown(self):
        self.temp.cleanup()

    def get(self, name, path):
        return self.clients[name][0].get("/api" + path)

    def post(self, name, path, data):
        c, token = self.clients[name]
        return c.post("/api" + path, json=data, headers={"X-CSRF-Token": token})

    def ready(self, name, rid=1):
        self.assertEqual(
            self.post(name, f"/rooms/{rid}/ready", {"mode": "text"}).status_code, 200
        )

    def control(self, action, rid=1, name="chief"):
        version = self.get(name, f"/rooms/{rid}").json["room"]["version"]
        return self.post(
            name, f"/rooms/{rid}/control", {"action": action, "version": version}
        )

    def start(self, rid=1):
        for name in (
            ("candidate", "chief")
            if rid == 1
            else ("candidate", "candidate2", "candidate3", "chief")
        ):
            self.ready(name, rid)
        self.assertEqual(self.control("start", rid).status_code, 200)

    def test_waiting_privacy_and_permissions(self):
        d = self.get("candidate", "/rooms/1").json
        self.assertEqual(d["questions"][0]["body"], "请先检查设备并准备候考。")
        self.assertEqual(self.get("candidate2", "/rooms/1").status_code, 403)
        self.assertEqual(self.control("start", name="examiner").status_code, 403)
        self.assertEqual(
            self.post(
                "candidate",
                "/rooms/1/presence",
                {"client": "candidate-client-0001", "media": True},
            ).status_code,
            409,
        )
        self.assertEqual(self.control("start").status_code, 400)

    def test_full_interview_score_archive(self):
        self.start()
        d = self.get("candidate", "/rooms/1").json
        q = d["questions"][0]["id"]
        self.assertEqual(
            self.post(
                "candidate",
                "/rooms/1/answer",
                {"question_id": q, "content": "先了解群众实际困难，再优化服务流程。"},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.post(
                "chief",
                "/rooms/1/scores",
                {
                    "candidate_id": 1,
                    "values": [80] * 6,
                    "comment": "观点清晰，建议进一步具体化。",
                    "submit": True,
                },
            ).status_code,
            400,
        )
        self.assertEqual(self.control("end").status_code, 200)
        self.assertEqual(self.control("publish").status_code, 400)
        for name, score in [("chief", 80), ("examiner", 90)]:
            self.assertEqual(
                self.post(
                    name,
                    "/rooms/1/scores",
                    {
                        "candidate_id": 1,
                        "values": [score] * 6,
                        "comment": "观点清晰，建议进一步具体化。",
                        "submit": True,
                    },
                ).status_code,
                200,
            )
        self.assertEqual(self.control("publish").status_code, 200)
        d = self.get("candidate", "/rooms/1").json
        self.assertEqual(d["results"][0]["total"], 85)
        self.assertEqual(self.get("candidate", "/export/1").status_code, 200)
        self.assertEqual(self.get("candidate2", "/export/1").status_code, 403)
        self.assertEqual(
            self.post(
                "chief",
                "/rooms/1/scores",
                {
                    "candidate_id": 1,
                    "values": [20] * 6,
                    "comment": "试图覆盖已经归档的分数",
                },
            ).status_code,
            409,
        )

    def test_pause_extension_and_version(self):
        self.start()
        v = self.get("chief", "/rooms/1").json["room"]["version"]
        self.assertEqual(self.control("pause").status_code, 200)
        self.assertEqual(
            self.post(
                "chief", "/rooms/1/control", {"action": "resume", "version": v}
            ).status_code,
            409,
        )
        self.assertEqual(
            self.post(
                "candidate",
                "/rooms/1/answer",
                {"question_id": 1, "content": "暂停期间不应作答"},
            ).status_code,
            409,
        )
        old = self.get("candidate", "/rooms/1").json["room"]["seconds_left"]
        self.assertEqual(
            self.post(
                "candidate", "/rooms/1/extension", {"reason": "设备中断需要补偿时间"}
            ).status_code,
            200,
        )
        self.assertEqual(
            self.post(
                "candidate", "/rooms/1/extension", {"reason": "重复申请延长答题时间"}
            ).status_code,
            409,
        )
        self.assertEqual(
            self.post(
                "examiner", "/rooms/1/extension", {"id": 1, "approve": True}
            ).status_code,
            403,
        )
        self.assertEqual(
            self.post(
                "chief", "/rooms/1/extension", {"id": 1, "approve": True}
            ).status_code,
            200,
        )
        self.assertEqual(
            self.get("candidate", "/rooms/1").json["room"]["seconds_left"], old + 60
        )
        self.assertEqual(self.control("resume").status_code, 200)

    def test_private_notes_messages_and_scores(self):
        self.start()
        self.post("candidate", "/rooms/1/note", {"content": "我的私人笔记"})
        self.post(
            "chief",
            "/rooms/1/message",
            {"kind": "examiner", "content": "内部评分合议不应公开"},
        )
        self.post(
            "chief",
            "/rooms/1/scores",
            {
                "candidate_id": 1,
                "values": [70, None, None, None, None, None],
                "comment": "暂存",
            },
        )
        candidate = self.get("candidate", "/rooms/1").json
        examiner = self.get("examiner", "/rooms/1").json
        admin = self.get("admin", "/rooms/1").json
        self.assertEqual(candidate["note"], "我的私人笔记")
        self.assertEqual(examiner["note"], "")
        self.assertFalse(candidate["scores"])
        self.assertFalse(examiner["scores"])
        self.assertFalse(
            any(
                m["kind"] == "examiner"
                for m in candidate["messages"] + admin["messages"]
            )
        )
        self.assertTrue(any(m["kind"] == "examiner" for m in examiner["messages"]))
        self.assertEqual(
            self.post(
                "candidate",
                "/rooms/1/message",
                {"kind": "examiner", "content": "越权尝试"},
            ).status_code,
            403,
        )

    def test_group_stages_and_hands(self):
        self.ready("candidate", 2)
        self.ready("chief", 2)
        self.assertEqual(self.control("start", 2).status_code, 400)
        self.ready("candidate2", 2)
        self.ready("candidate3", 2)
        self.assertEqual(self.control("start", 2).status_code, 200)
        self.assertEqual(self.post("candidate2", "/rooms/2/hand", {}).status_code, 200)
        self.assertEqual(self.control("next", 2).status_code, 200)
        self.assertEqual(self.get("candidate2", "/rooms/2").json["room"]["phase"], 1)
        self.assertEqual(self.control("next", 2).status_code, 200)
        self.assertEqual(self.control("next", 2).status_code, 400)

    def test_real_signaling_ownership(self):
        self.start()
        a = "candidate-client-123"
        b = "chief-client-456"
        for name, client in [("candidate", a), ("chief", b)]:
            self.assertEqual(
                self.post(
                    name, "/rooms/1/presence", {"client": client, "media": True}
                ).status_code,
                200,
            )
        payload = {"type": "offer", "sdp": "v=0\r\n"}
        self.assertEqual(
            self.post(
                "candidate",
                "/rooms/1/signal",
                {"sender": a, "receiver": b, "payload": payload},
            ).status_code,
            200,
        )
        result = self.post(
            "chief", "/rooms/1/presence", {"client": b, "media": True}
        ).json
        self.assertEqual(json.loads(result["signals"][0]["payload"]), payload)
        self.assertEqual(
            self.post(
                "examiner", "/rooms/1/presence", {"client": a, "media": True}
            ).status_code,
            409,
        )
        self.assertEqual(
            self.post(
                "examiner",
                "/rooms/1/signal",
                {"sender": a, "receiver": b, "payload": payload},
            ).status_code,
            409,
        )
        self.control("end")
        self.assertEqual(
            self.post(
                "candidate",
                "/rooms/1/signal",
                {"sender": a, "receiver": b, "payload": payload},
            ).status_code,
            409,
        )

    def test_room_creation_and_device_checks(self):
        data = {
            "title": "真实设备房间",
            "kind": "structured",
            "duration": 1200,
            "candidates": [1],
            "examiners": [4, 5],
            "chief_id": 4,
            "questions": [{"title": "问题", "body": "请分析社区服务问题"}],
        }
        r = self.post("admin", "/rooms", data)
        self.assertEqual(r.status_code, 201)
        rid = r.json["id"]
        self.assertEqual(
            self.post("candidate", f"/rooms/{rid}/ready", {"mode": "text"}).status_code,
            400,
        )
        check = {
            "mode": "devices",
            "camera": True,
            "microphone": True,
            "speaker": True,
            "network": True,
            "width": 640,
            "height": 480,
        }
        self.assertEqual(
            self.post("candidate", f"/rooms/{rid}/ready", check).status_code, 400
        )
        check.update(width=1280, height=720)
        self.assertEqual(
            self.post("candidate", f"/rooms/{rid}/ready", check).status_code, 200
        )
        data["candidates"] = [1, 2]
        self.assertEqual(self.post("admin", "/rooms", data).status_code, 400)
        self.assertEqual(self.post("candidate", "/rooms", data).status_code, 403)

    def test_score_validation_and_archive_visibility(self):
        self.start()
        self.control("end")
        for vals, comment in [
            ([101] * 6, "有效的评分说明"),
            ([None] * 6, "有效的评分说明"),
            ([80] * 6, "短"),
        ]:
            self.assertEqual(
                self.post(
                    "chief",
                    "/rooms/1/scores",
                    {
                        "candidate_id": 1,
                        "values": vals,
                        "comment": comment,
                        "submit": True,
                    },
                ).status_code,
                400,
            )
        self.assertFalse(self.get("candidate", "/rooms/1").json["results"])
        self.assertEqual(self.get("candidate", "/export/1").status_code, 409)
        self.assertEqual(len(self.get("candidate", "/history").json["items"]), 1)
        self.assertEqual(len(self.get("candidate2", "/history").json["items"]), 0)

    def test_csrf_registration_and_auth(self):
        c = self.app.test_client()
        self.assertEqual(c.get("/api/rooms").status_code, 401)
        self.assertEqual(c.post("/api/login", json={}).status_code, 403)
        token = c.get("/api/session").json["csrf"]
        headers = {"X-CSRF-Token": token}
        self.assertEqual(
            c.post(
                "/api/register",
                json={
                    "username": "student_new",
                    "name": "新考生",
                    "password": "Password123",
                },
                headers=headers,
            ).status_code,
            201,
        )
        self.assertEqual(
            c.post(
                "/api/login",
                json={"username": "student_new", "password": "bad"},
                headers=headers,
            ).status_code,
            401,
        )
        r = c.post(
            "/api/login",
            json={"username": "student_new", "password": "Password123"},
            headers=headers,
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json["user"]["role"], "candidate")
        self.assertEqual(c.get("/api/rooms").json["items"], [])

    def test_https_certificate_chain_and_host(self):
        import ssl, threading, urllib.request
        import lan
        from werkzeug.serving import make_server

        old_base = lan.BASE
        try:
            lan.BASE = Path(self.temp.name) / "tls"
            lan.certificates()
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(
                lan.BASE / "server.crt", lan.BASE / "server.key"
            )
            server = make_server(
                "127.0.0.1", 0, self.app, threaded=True, ssl_context=server_context
            )
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                context = ssl.create_default_context(
                    cafile=str(lan.BASE / "classroom-ca.crt")
                )
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler({}),
                    urllib.request.HTTPSHandler(context=context),
                )
                with opener.open(
                    f"https://127.0.0.1:{server.server_port}/api/session", timeout=5
                ) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(len(json.load(response)["dimensions"]), 6)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)
        finally:
            lan.BASE = old_base


if __name__ == "__main__":
    unittest.main()
