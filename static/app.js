import { $, btn, closeModal, empty, esc, modal, toast } from './js/ui.js';
import { appState } from './js/state.js';
import { api } from './js/api.js';
import { loginDialog, registerDialog } from './js/account.js';
import { leaveRoom, route } from './js/navigation.js';
import { createDialog, refreshRoom, roomTable, roomsView, selectWorkspaceTab, showOffline, supportDialog, updateMediaStatus, updateSupport } from './js/rooms.js';
import { feedbackFields, renderScore, saveScore, updateScoreProgress } from './js/scoring.js';
import { deviceDialog, readyDevices, speakerTest, startDevices, switchCamera } from './js/devices.js';
import { connectCall, pollPresence, stopCall } from './js/webrtc.js';
import { removeDraft, saveDraft } from './js/drafts.js';

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act],[data-page]");
  if (!b) return;
  if (b.dataset.page) {
    location.hash = b.dataset.page;
    return;
  }
  const act = b.dataset.act;
  try {
    switch (act) {
      case "workspace-tab":
        selectWorkspaceTab(b.dataset.tab);
        break;
      case "support":
        supportDialog();
        break;
      case "login":
        loginDialog();
        break;
      case "logout":
        await leaveRoom();
        await api("/logout", "POST", {});
        appState.user = null;
        appState.csrf = (await api("/session")).csrf;
        route();
        break;
      case "close":
        closeModal();
        break;
      case "demo":
        $("#login-form [name=username]").value = b.dataset.value;
        break;
      case "register":
        registerDialog();
        break;
      case "reload":
        route();
        break;
      case "back":
        location.hash = "rooms";
        break;
      case "guide":
        location.hash = "guide";
        break;
      case "enter":
        location.hash = "room/" + b.dataset.id;
        break;
      case "filter":
        appState.roomFilter = b.dataset.value;
        roomsView();
        break;
      case "create":
        await createDialog();
        break;
      case "devices":
        await deviceDialog();
        break;
      case "start-devices":
        await startDevices($("#camera-select")?.value);
        break;
      case "speaker":
        await speakerTest();
        break;
      case "ready":
        await readyDevices();
        break;
      case "text-ready":
        await api(`/rooms/${appState.roomId}/ready`, "POST", { mode: "text" });
        toast("已明确选择文字演练；没有设备自检结论");
        await refreshRoom();
        break;
      case "connect":
        await connectCall();
        break;
      case "switch":
        await switchCamera();
        break;
      case "mic":
      case "camera": {
        const t = appState.stream
          ?.getTracks()
          .find((x) => x.kind === (act === "mic" ? "audio" : "video"));
        if (!t) return toast("请先开启设备");
        t.enabled = !t.enabled;
        updateMediaStatus();
        b.classList.toggle("danger", !t.enabled);
        b.title = t.enabled ? "已开启" : "已关闭";
        toast(
          (act === "mic" ? "麦克风" : "摄像头") +
            (t.enabled ? "已开启" : "已关闭"),
        );
        break;
      }
      case "reconnect": {
        const active = appState.callActive;
        stopCall();
        await refreshRoom();
        if (active && appState.roomData.room.status === "active") {
          appState.callActive = true;
          await pollPresence();
        }
        toast("已重新读取状态并重建通话连接");
        break;
      }
      case "play-remote":
        for (const v of document.querySelectorAll("#videos video"))
          if (v.srcObject) await v.play().catch(() => {});
        break;
      case "refresh-room":
        await refreshRoom();
        break;
      case "hint":
        $("#hint").classList.toggle("hidden");
        break;
      case "hand":
        await api(`/rooms/${appState.roomId}/hand`, "POST", {});
        await refreshRoom();
        break;
      case "save-note":
        await api(`/rooms/${appState.roomId}/note`, "POST", {
          content: $("#note").value,
        });
        removeDraft("note");
        $("#note-status").textContent =
          "已保存 " + new Date().toLocaleTimeString();
        toast("个人笔记已保存");
        break;
      case "answer": {
        const q = appState.roomData.questions[appState.roomData.room.current_question];
        modal(
          "提交作答要点",
          "口头作答通过音视频进行；这里归档你填写的文字要点。",
          `<form id="answer-form"><label class="field">${esc(q.title)}<textarea name="content" required maxlength="10000">${esc($("#note").value)}</textarea></label><input name="question_id" type="hidden" value="${q.id}"><div class="inline-error" role="alert"></div><div class="dialog-footer"><button class="btn primary">确认提交</button></div></form>`,
        );
        break;
      }
      case "extension":
        modal(
          "申请延时 60 秒",
          "延时由主考官审批，不会自动改变计时。",
          `<form id="extension-form"><label class="field">申请原因<textarea name="reason" required minlength="4" maxlength="300" placeholder="请说明原因…"></textarea></label><div class="inline-error" role="alert"></div><button class="btn primary">提交申请</button></form>`,
          true,
        );
        break;
      case "approve":
      case "reject":
        await api(`/rooms/${appState.roomId}/extension`, "POST", {
          id: Number(b.dataset.id),
          approve: act === "approve",
        });
        await refreshRoom();
        break;
      case "save-score":
        await saveScore(false);
        break;
      case "submit-score":
        modal(
          "提交最终评分",
          "提交后评分将锁定，请先核对六个维度与评语。",
          `<p class="muted">当前考生：${esc(appState.roomData.members.find((x) => x.id === appState.selectedCandidate)?.name)}</p><div class="dialog-footer">${btn("返回检查", "close")}${btn("确认提交评分", "confirm-score", "primary")}</div>`,
          true,
        );
        break;
      case "confirm-score":
        closeModal();
        await saveScore(true);
        break;
      case "start":
      case "end":
      case "publish":
        modal(
          {
            start: "正式开始面试",
            end: "结束当前面试",
            publish: "归档并公布成绩",
          }[act],
          {
            start: "此操作将展示题目并启动全场计时。参与者仍需主动连接音视频。",
            end: "此操作停止计时和通话，转入评分阶段，不能恢复作答。",
            publish: "所有考官评分齐全后，考生将能够查看本人成绩和评语。",
          }[act],
          `<div class="dialog-footer">${btn("返回", "close")}${btn("确认" + { start: "开始", end: "结束", publish: "归档" }[act], "confirm-control", "primary", `data-value="${act}"`)}</div>`,
          true,
        );
        break;
      case "confirm-control":
        await api(`/rooms/${appState.roomId}/control`, "POST", {
          action: b.dataset.value,
          version: appState.roomData.room.version,
        });
        closeModal();
        await refreshRoom();
        break;
      case "pause":
      case "resume":
      case "next":
        await api(`/rooms/${appState.roomId}/control`, "POST", {
          action: act,
          version: appState.roomData.room.version,
        });
        await refreshRoom();
        break;
    }
  } catch (err) {
    toast(err.message);
  }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target,
    d = new FormData(f),
    value = Object.fromEntries(d);
  const submit = f.querySelector("button[type=submit],button:not([type])");
  if (submit) submit.disabled = true;
  try {
    switch (f.id) {
      case "support-form":
        await api(`/rooms/${appState.roomId}/support`, "POST", {
          recipient_id: Number(value.recipient_id),
          content: value.content,
        });
        f.elements.content.value = "";
        await refreshRoom();
        break;
      case "login-form": {
        await leaveRoom();
        const r = await api("/login", "POST", value);
        appState.user = r.user;
        appState.csrf = r.csrf;
        closeModal();
        location.hash = "rooms";
        await route();
        break;
      }
      case "register-form":
        await api("/register", "POST", value);
        toast("账号已创建，请登录后联系管理员分配房间");
        loginDialog();
        break;
      case "create-form": {
        const r = await api("/rooms", "POST", {
          title: value.title,
          kind: value.kind,
          duration: Number(value.duration) * 60,
          scheduled: value.scheduled,
          chief_id: Number(value.chief_id),
          candidates: d.getAll("candidates").map(Number),
          examiners: d.getAll("examiners").map(Number),
          allow_text: !!value.allow_text,
          questions: value.questions
            .split("\n")
            .filter((x) => x.trim())
            .map((x, i) => ({
              title: "面试题 " + (i + 1),
              body: x,
              hint: value.hint,
            })),
        });
        closeModal();
        location.hash = "room/" + r.id;
        break;
      }
      case "message-form":
        await api(`/rooms/${appState.roomId}/message`, "POST", value);
        f.elements.content.value = "";
        await refreshRoom();
        break;
      case "answer-form":
        await api(`/rooms/${appState.roomId}/answer`, "POST", {
          content: value.content,
          question_id: Number(value.question_id),
        });
        closeModal();
        toast("答题要点已归档");
        await refreshRoom();
        break;
      case "extension-form":
        await api(`/rooms/${appState.roomId}/extension`, "POST", value);
        closeModal();
        toast("延时申请已提交");
        await refreshRoom();
        break;
    }
  } catch (err) {
    const el = f.querySelector(".inline-error");
    if (el) el.textContent = err.message;
    else toast(err.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "room-search") roomTable();
  if (e.target.id === "note") {
    saveDraft("note", { content: e.target.value });
    $("#note-status").textContent = "浏览器草稿已保留，请点击保存同步";
  }
  if (e.target.closest("#score-form")) {
    const vals = appState.dimensions.map(
      (_, i) => $("#score-form").elements["s" + i].value,
    );
    saveDraft("score-" + appState.selectedCandidate, {
      values: vals.map((x) => (x === "" ? null : Number(x))),
      comment: $("#score-form").elements.comment.value,
      feedback: Object.fromEntries(
        feedbackFields.map(([key]) => [
          key,
          $("#score-form").elements[key].value,
        ]),
      ),
    });
    $("#score-save-status").textContent =
      "本浏览器草稿已保留，请点击暂存同步到服务器";
    updateScoreProgress();
    $("#score-total").textContent = vals.every(
      (x) => x !== "" && Number.isFinite(Number(x)),
    )
      ? (vals.reduce((s, x) => s + Number(x), 0) / 6).toFixed(1)
      : "—";
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.id === "support-recipient") updateSupport();
  if (e.target.id === "status-filter") roomTable();
  if (e.target.id === "score-candidate") {
    appState.selectedCandidate = Number(e.target.value);
    renderScore();
  }
  if (e.target.id === "camera-select" && appState.stream)
    await startDevices(e.target.value);
});

window.addEventListener("hashchange", route);

window.addEventListener("offline", () => showOffline(new Error("网络已断开")));

window.addEventListener("online", () => {
  if (appState.roomId) refreshRoom().catch(showOffline);
});

window.addEventListener("beforeunload", () => {
  if (appState.stream) appState.stream.getTracks().forEach((t) => t.stop());
});

(async () => {
  try {
    const d = await api("/session");
    appState.user = d.user;
    appState.csrf = d.csrf;
    appState.dimensions = d.dimensions;
    await route();
  } catch (e) {
    $("#main").innerHTML =
      empty("无法连接服务器", esc(e.message)) +
      btn("重试", "reload", "primary");
  }
})();
