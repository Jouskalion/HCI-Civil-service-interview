import { $, btn, empty, esc, heading, icon, renderHeader } from './ui.js';
import { appState } from './state.js';
import { api } from './api.js';
import { roomView, roomsView } from './rooms.js';
import { historyView } from './scoring.js';
import { guideView } from './account.js';
import { stopCall } from './webrtc.js';

export async function route() {
  const gen = ++appState.routeGeneration;
  await leaveRoom();
  renderHeader();
  const [page, id] = (location.hash.slice(1) || "rooms").split("/");
  $("#main").innerHTML =
    '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    if (page === "guide") return guideView();
    if (!appState.user) {
      $("#main").innerHTML =
        heading(
          "每一次练习，都是更从容的准备",
          "从设备自检到成绩回顾，完整模拟两种面试形式。",
        ) +
        `<div class="hero"><div><span class="eyebrow">PREPARE · PRACTICE · REFLECT</span><h2>让面试练习有秩序、有反馈</h2><p>考生专注表达，考官独立评分，管理员安排考场。登录后进入属于你的练习空间。</p></div>${btn("进入实验平台 " + icon("arrow"), "login", "primary")}</div>`;
      return;
    }
    if (page === "room" && id) {
      await roomView(Number(id), gen);
    } else if (page === "history") {
      const d = await api("/history");
      if (gen === appState.routeGeneration) historyView(d);
    } else {
      const d = await api("/rooms");
      if (gen !== appState.routeGeneration) return;
      appState.rooms = d.items;
      roomsView();
    }
  } catch (e) {
    $("#main").innerHTML =
      empty("暂时无法加载", esc(e.message)) +
      btn("重新加载", "reload", "primary");
  }
}

export async function leaveRoom() {
  clearInterval(appState.roomTimer);
  clearInterval(appState.presenceTimer);
  clearInterval(appState.clockTimer);
  cancelAnimationFrame(appState.meterRAF);
  const old = appState.roomId;
  appState.roomId = null;
  stopCall();
  if (old && appState.user?.role !== "admin")
    api(`/rooms/${old}/presence`, "POST", {
      client: appState.clientId,
      leave: true,
    }).catch(() => {});
  if (appState.stream) {
    appState.stream.getTracks().forEach((t) => t.stop());
    appState.stream = null;
  }
  if (appState.audioCtx) {
    appState.audioCtx.close().catch(() => {});
    appState.audioCtx = null;
  }
  appState.roomData = null;
  appState.hadCall = false;
  appState.clientId = crypto.randomUUID();
  appState.signalCursor = 0;
  appState.pollBusy = false;
}
