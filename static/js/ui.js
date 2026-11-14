import { appState } from './state.js';

export const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

export const roleNames = { candidate: "考生", examiner: "考官", admin: "管理员" },
  statusNames = { waiting: "待开始", active: "进行中", ended: "已结束" },
  kindNames = { structured: "结构化面试", group: "无领导小组" },
  phases = ["个人陈述", "自由讨论", "总结陈述"];

export const paths = {
  building: "M3 21h18M5 21V8m14 13V8M3 8l9-5 9 5H3zm6 3v7m6-7v7",
  video: "M15 10l6-4v12l-6-4M3 6h12v12H3z",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8",
  clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  check: "m4 12 5 5L20 6",
  exit: "M9 4H4v16h5m6-13 5 5-5 5m-6-5h11",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 1a4 4 0 0 1 0 8m5 9v-2a4 4 0 0 0-3-4",
  chart: "M4 20V4m0 16h17M8 16v-5m5 5V7m5 9V3",
  file: "M5 3h10l4 4v14H5V3zm9 0v5h5M8 12h8m-8 4h8",
  help: "M9 9a3 3 0 1 1 4 3v2m-1 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  hand: "M8 13V5a2 2 0 0 1 4 0v6m0-6a2 2 0 0 1 4 0v7m0-3a2 2 0 0 1 4 0v7c0 4-3 6-7 6-3 0-4-1-6-4l-4-6c-1-2 2-3 3-1l2 2",
  refresh:
    "M20 7V3m0 4h-4M4 17v4m0-4h4M5 8a8 8 0 0 1 14-3M19 16A8 8 0 0 1 5 19",
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
}

export function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}

export function btn(t, act, cl = "", extra = "") {
  return `<button class="btn ${cl}" data-act="${act}" ${extra}>${t}</button>`;
}

export function heading(t, s, actions = "") {
  return `<div class="heading"><div><h1>${t}</h1><p>${s}</p></div>${actions}</div>`;
}

export function badge(value) {
  return `<span class="badge ${value}">${statusNames[value] || kindNames[value] || esc(value)}</span>`;
}

export function empty(t, s) {
  return `<div class="empty">${icon("file")}<h2>${t}</h2><p>${s}</p></div>`;
}

export function timeText(s) {
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function date(s) {
  return new Date(s)
    .toLocaleString("zh-CN", { hour12: false })
    .replaceAll("/", "-");
}

export function renderHeader() {
  const page = location.hash.slice(1).split("/")[0] || "rooms";
  $("#header").innerHTML =
    `<a class="brand" href="#rooms"><span class="brandmark">${icon("building")}</span><span><strong>仕途面试通</strong><small>公务员面试模拟系统</small></span></a><nav class="navs" aria-label="主导航">${[
      ["rooms", appState.user?.role === "candidate" ? "我的房间" : "面试房间"],
      ["history", "历史成绩"],
      ["guide", "使用指南"],
    ]
      .map(
        ([p, t]) =>
          `<button class="nav ${page === p ? "active" : ""}" data-page="${p}">${t}</button>`,
      )
      .join(
        "",
      )}</nav><div class="account"><span class="env">课程模拟环境</span>${appState.user ? `<button class="userbtn" data-act="login"><span class="avatar">${esc(appState.user.name[0])}</span>${esc(appState.user.name)} <small>${roleNames[appState.user.role]}</small></button>${btn(icon("exit"), "logout", "ghost small", 'aria-label="退出登录"')}` : btn("登录平台", "login", "primary")}</div>`;
}

export function modal(title, sub, body, narrow = false) {
  const d = $("#dialog");
  d.className = narrow ? "narrow" : "";
  d.innerHTML = `<div class="dialog-head"><div><h2>${title}</h2><p>${sub}</p></div><button class="close" data-act="close" aria-label="关闭">×</button></div>${body}`;
  if (!d.open) d.showModal();
}

export function closeModal() {
  $("#dialog").close();
  cancelAnimationFrame(appState.meterRAF);
}
