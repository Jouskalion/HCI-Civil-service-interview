"use strict";
const $ = (s) => document.querySelector(s),
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
const roleNames = { candidate: "考生", examiner: "考官", admin: "管理员" },
  statusNames = { waiting: "待开始", active: "进行中", ended: "已结束" },
  kindNames = { structured: "结构化面试", group: "无领导小组" },
  phases = ["个人陈述", "自由讨论", "总结陈述"];
const paths = {
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
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
}
let user = null,
  csrf = "",
  dimensions = [],
  rooms = [],
  roomData = null,
  roomId = null,
  roomTimer = null,
  presenceTimer = null,
  clockTimer = null,
  routeGeneration = 0,
  loadedNote = false,
  questionKey = "",
  messagesKey = "",
  membersKey = "",
  selectedCandidate = null,
  deadlineLocal = 0,
  roomFilter = "all";
let stream = null,
  audioCtx = null,
  meterRAF = null,
  micPeak = 0,
  speakerPlayed = false,
  networkOkay = false,
  callActive = false,
  peers = new Map(),
  clientId = crypto.randomUUID(),
  signalCursor = 0,
  pollBusy = false,
  pollErrors = 0,
  seenPeers = [];
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw new Error("服务器响应异常，请重试");
  }
  if (!r.ok) throw new Error(d.error || "请求失败");
  return d;
}
function btn(t, act, cl = "", extra = "") {
  return `<button class="btn ${cl}" data-act="${act}" ${extra}>${t}</button>`;
}
function heading(t, s, actions = "") {
  return `<div class="heading"><div><h1>${t}</h1><p>${s}</p></div>${actions}</div>`;
}
function badge(value) {
  return `<span class="badge ${value}">${statusNames[value] || kindNames[value] || esc(value)}</span>`;
}
function empty(t, s) {
  return `<div class="empty">${icon("file")}<h2>${t}</h2><p>${s}</p></div>`;
}
function timeText(s) {
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function date(s) {
  return new Date(s)
    .toLocaleString("zh-CN", { hour12: false })
    .replaceAll("/", "-");
}
function renderHeader() {
  const page = location.hash.slice(1).split("/")[0] || "rooms";
  $("#header").innerHTML =
    `<a class="brand" href="#rooms"><span class="brandmark">${icon("building")}</span><span><strong>仕途面试通</strong><small>公务员面试模拟系统</small></span></a><nav class="navs" aria-label="主导航">${[
      ["rooms", user?.role === "candidate" ? "我的房间" : "面试房间"],
      ["history", "历史成绩"],
      ["guide", "使用指南"],
    ]
      .map(
        ([p, t]) =>
          `<button class="nav ${page === p ? "active" : ""}" data-page="${p}">${t}</button>`,
      )
      .join(
        "",
      )}</nav><div class="account"><span class="env">课程模拟环境</span>${user ? `<button class="userbtn" data-act="login"><span class="avatar">${esc(user.name[0])}</span>${esc(user.name)} <small>${roleNames[user.role]}</small></button>${btn(icon("exit"), "logout", "ghost small", 'aria-label="退出登录"')}` : btn("登录平台", "login", "primary")}</div>`;
}
function modal(title, sub, body, narrow = false) {
  const d = $("#dialog");
  d.className = narrow ? "narrow" : "";
  d.innerHTML = `<div class="dialog-head"><div><h2>${title}</h2><p>${sub}</p></div><button class="close" data-act="close" aria-label="关闭">×</button></div>${body}`;
  if (!d.open) d.showModal();
}
function closeModal() {
  $("#dialog").close();
  cancelAnimationFrame(meterRAF);
}
function loginDialog() {
  modal(
    "欢迎回到面试课堂",
    "使用演示角色，或登录自己的考生账号",
    `<form id="login-form"><div class="checks">${[
      ["candidate", "考生"],
      ["chief", "主考官"],
      ["examiner", "考官"],
      ["admin", "管理员"],
    ]
      .map(([a, b]) =>
        btn(b, "demo", "small", `data-value="${a}" type="button"`),
      )
      .join(
        "",
      )}</div><label class="field">账号<input name="username" value="candidate" required autocomplete="username"></label><label class="field">密码<input name="password" value="Demo2026!" type="password" required autocomplete="current-password"></label><div class="inline-error" role="alert"></div><button class="btn primary full">登录</button><p class="muted" style="margin-top:15px">演示密码：Demo2026!　${btn("注册考生账号", "register", "ghost small", 'type="button"')}</p></form>`,
    true,
  );
}
function registerDialog() {
  modal(
    "创建考生账号",
    "管理员会将新账号分配到面试房间",
    `<form id="register-form"><label class="field">姓名<input name="name" required maxlength="30"></label><label class="field">账号<input name="username" required minlength="3" maxlength="30"></label><label class="field">密码<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><div class="inline-error" role="alert"></div><button class="btn primary full">注册</button></form>`,
    true,
  );
}
async function route() {
  const gen = ++routeGeneration;
  await leaveRoom();
  renderHeader();
  const [page, id] = (location.hash.slice(1) || "rooms").split("/");
  $("#main").innerHTML =
    '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    if (page === "guide") return guideView();
    if (!user) {
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
      if (gen === routeGeneration) historyView(d);
    } else {
      const d = await api("/rooms");
      if (gen !== routeGeneration) return;
      rooms = d.items;
      roomsView();
    }
  } catch (e) {
    $("#main").innerHTML =
      empty("暂时无法加载", esc(e.message)) +
      btn("重新加载", "reload", "primary");
  }
}
function roomsView() {
  $("#main").innerHTML =
    heading(
      user.role === "candidate" ? "我的面试房间" : "面试房间管理",
      "按计划参加练习，清晰掌握候考、面试与归档进度。",
      user.role === "admin"
        ? btn(icon("plus") + " 创建面试房间", "create", "primary")
        : btn(icon("help") + " 练习指南", "guide"),
    ) +
    `<section class="hero"><div><span class="eyebrow">A CALM START. A CONFIDENT ANSWER.</span><h2>准备充分，表达更从容</h2><p>进入候考房间后先检查设备。正式面试由主考官开始，音视频连接需要你主动开启。</p></div><div class="flow"><span><b>01</b> 进入候考</span>→<span><b>02</b> 设备自检</span>→<span><b>03</b> 正式面试</span></div></section><div class="stats">${[
      ["全部房间", rooms.length, "已分配的模拟场次"],
      [
        "待开始",
        rooms.filter((x) => x.status === "waiting").length,
        "提前检查设备与环境",
      ],
      [
        "进行中",
        rooms.filter((x) => x.status === "active").length,
        "按主考官指引参与",
      ],
      [
        "已结束",
        rooms.filter((x) => x.status === "ended").length,
        "归档后查看成绩反馈",
      ],
    ]
      .map(
        ([a, b, c]) =>
          `<div class="stat"><span>${a}</span><strong>${b}</strong><small>${c}</small></div>`,
      )
      .join("")}</div><section class="panel"><div class="tabs">${[
      ["all", "全部场次"],
      ["structured", "结构化面试"],
      ["group", "无领导小组"],
    ]
      .map(
        ([a, b]) =>
          `<button class="${roomFilter === a ? "active" : ""}" data-act="filter" data-value="${a}">${b}</button>`,
      )
      .join(
        "",
      )}</div><div class="toolbar"><input id="room-search" aria-label="搜索房间" placeholder="搜索房间名称或编号"><span class="spacer"></span><label>房间状态<select id="status-filter"><option value="all">全部状态</option>${Object.entries(
      statusNames,
    )
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join(
        "",
      )}</select></label>${btn(icon("refresh") + " 刷新", "reload", "small")}</div><div id="room-table"></div></section><div class="notice" style="margin-top:22px">预置场次与历史成绩均为教学模拟数据。新建正式音视频练习房间默认要求设备自检，也可明确选择文字演练模式。</div>`;
  roomTable();
}
function roomTable() {
  const q = ($("#room-search")?.value || "").toLowerCase(),
    s = $("#status-filter")?.value || "all",
    rs = rooms.filter(
      (r) =>
        (roomFilter === "all" || r.kind === roomFilter) &&
        (s === "all" || r.status === s) &&
        (r.title + "RM" + String(r.id).padStart(4, "0"))
          .toLowerCase()
          .includes(q),
    );
  $("#room-table").innerHTML = rs.length
    ? `<div class="table-wrap"><table><thead><tr><th>面试房间</th><th>面试形式</th><th>主考官</th><th>计划时间</th><th>时长 / 考生</th><th>状态</th><th>操作</th></tr></thead><tbody>${rs.map((r) => `<tr><td><strong>${esc(r.title)}</strong><small>RM${String(r.id).padStart(4, "0")}</small></td><td>${badge(r.kind)}</td><td>${esc(r.chief)}</td><td>${date(r.scheduled)}</td><td>${r.duration / 60} 分钟 · ${r.candidate_count} 人</td><td>${badge(r.status)}</td><td>${btn(r.status === "waiting" ? "进入候考房间" : r.status === "active" ? "进入面试房间" : r.published ? "查看成绩" : "评分与归档", "enter", r.status === "waiting" ? "primary small" : "small", `data-id="${r.id}"`)}</td></tr>`).join("")}</tbody></table></div>`
    : empty("暂无符合条件的房间", "调整筛选条件，或请管理员安排新的练习场次。");
}
async function createDialog() {
  const { items } = await api("/users");
  modal(
    "创建面试房间",
    "分配参与者、题目与主考官，建立独立练习场次",
    `<form id="create-form"><div class="form-grid"><label class="field">房间名称<input name="title" required maxlength="80" placeholder="例如：综合能力结构化练习"></label><label class="field">面试形式<select name="kind"><option value="structured">结构化面试（1 位考生）</option><option value="group">无领导小组（2–6 位考生）</option></select></label><label class="field">计划开始时间<input type="datetime-local" name="scheduled" required value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></label><label class="field">总时长（分钟）<input name="duration" type="number" value="20" min="1" max="120" required></label></div><label class="field">考生</label><div class="checks">${items
      .filter((x) => x.role === "candidate")
      .map(
        (x) =>
          `<label><input type="checkbox" name="candidates" value="${x.id}"> ${esc(x.name)}</label>`,
      )
      .join(
        "",
      )}</div><label class="field">考官（1–3 位，须包含主考官）</label><div class="checks">${items
      .filter((x) => x.role === "examiner")
      .map(
        (x) =>
          `<label><input type="checkbox" name="examiners" value="${x.id}" checked> ${esc(x.name)}</label>`,
      )
      .join("")}</div><label class="field">主考官<select name="chief_id">${items
      .filter((x) => x.role === "examiner")
      .map((x) => `<option value="${x.id}">${esc(x.name)}</option>`)
      .join(
        "",
      )}</select></label><label class="field">题目（每行一道，最多 8 道）<textarea name="questions" required>群众反映办事流程复杂，你会如何提出改进建议？</textarea></label><label class="field">练习提示（可选）<input name="hint" maxlength="1000" value="先分析问题，再提出具体措施，最后说明如何验证改进效果。"></label><label class="check"><input name="allow_text" type="checkbox">允许文字演练（无需摄像头，明确标记设备未验证）</label><div class="inline-error" role="alert"></div><div class="dialog-footer"><button class="btn primary">创建并分配</button></div></form>`,
  );
}
async function roomView(rid, gen) {
  const d = await api("/rooms/" + rid);
  if (gen !== routeGeneration) return;
  roomId = rid;
  roomData = d;
  questionKey = "";
  messagesKey = "";
  membersKey = "";
  loadedNote = false;
  selectedCandidate = d.members.find((m) => m.role === "candidate")?.id;
  const isAdmin = user.role === "admin",
    isExam = user.role === "examiner";
  $("#main").innerHTML =
    `<div class="room-top"><div><div class="room-title">${btn("← 返回房间", "back", "ghost small")}<h1>${esc(d.room.title)}</h1><span id="room-badge"></span></div><div class="meta">RM${String(rid).padStart(4, "0")} · ${kindNames[d.room.kind]} · 主考官：${esc(d.members.find((x) => x.id === d.room.chief_id)?.name)} · 计划 ${date(d.room.scheduled)}</div></div><div><div class="clock" id="clock">--:--</div><div class="muted" style="text-align:center" id="timer-label">全场剩余时间</div></div></div><div id="connection-warning"></div><div id="room-notice"></div><div class="room-layout ${isAdmin ? "admin-view" : ""}"><div class="main-column">${!isAdmin ? `<section class="panel"><div class="panel-head"><div><h2>${d.room.kind === "group" ? "讨论成员" : "面试现场"}</h2><small id="media-status">未连接通话 · 本地预览不会自动发送</small></div><span class="badge ${d.room.kind}">${d.room.kind === "group" ? "小组协作" : "一对一练习"}</span></div><div class="videos ${d.room.kind === "group" ? "group-grid" : ""}" id="videos"></div><div class="media-controls">${btn(icon("video") + " 设备自检", "devices")}${btn("连接音视频", "connect", "primary", 'id="connect-btn"')}${btn(icon("mic") + " 麦克风", "mic", "small", 'id="mic-btn"')}${btn(icon("video") + " 摄像头", "camera", "small", 'id="camera-btn"')}${btn(icon("refresh") + " 切换摄像头", "switch", "small")}${btn("重新连接", "reconnect", "small")}</div><div class="media-note">设备自检仅本地预览；连接通话后，音视频会发送给本房间已连接的参与者。系统不录音录像。</div></section>` : ""}<section class="panel"><div class="panel-head"><div><h2>面试题目与任务</h2><small id="question-progress"></small></div><div id="question-actions"></div></div><div class="panel-body"><div id="stages"></div><div class="question" id="question"></div><div id="hint" class="hint hidden"></div><div class="section-actions" id="candidate-actions"></div></div></section>${!isAdmin ? `<section class="panel"><div class="panel-head"><div><h2>${isExam ? "观察笔记" : "个人草稿纸"}</h2><small>仅本人可见 · 手动保存到本机服务器</small></div><span id="note-status" class="muted">尚未修改</span></div><div class="panel-body"><textarea id="note" aria-label="个人笔记" placeholder="记录分析框架、关键要点与反思…" maxlength="10000"></textarea><div class="section-actions">${btn("保存笔记", "save-note", "small")}<span class="muted">切换房间前请保存</span></div></div></section>` : ""}<section class="panel"><div class="panel-head"><div><h2>${isExam ? "讨论与考官内部沟通" : "公共讨论记录"}</h2><small>${isExam ? "内部频道仅本房间考官可见，可用于评分合议" : "公共内容对本房间参与者可见"}</small></div></div><div class="panel-body"><div class="chatlog" id="chatlog"></div>${!isAdmin ? `<form id="message-form" class="chatinput">${isExam ? '<select name="kind" aria-label="消息频道"><option value="public">公共频道</option><option value="examiner">考官内部 / 合议</option></select>' : '<input type="hidden" name="kind" value="public">'}<input name="content" aria-label="消息内容" placeholder="输入消息…" required maxlength="1000"><button class="btn primary">发送</button></form>` : ""}</div></section><section class="panel"><div class="panel-head"><h2>已提交答题记录</h2></div><div class="panel-body" id="answers"></div></section><div id="results"></div></div><aside class="side"><section class="panel"><div class="panel-head"><h2>考场成员</h2></div><div class="panel-body"><ul class="members" id="members"></ul><div id="ready-controls"></div></div></section><section class="panel"><div class="panel-head"><h2>${isExam ? "面试控制" : "面试进程"}</h2></div><div class="panel-body"><div id="control-buttons"></div><div id="extensions"></div></div></section>${
      isExam
        ? `<section class="panel"><div class="panel-head"><div><h2>考官评分</h2><small>六维等权 · 各考官独立评分</small></div></div><div class="panel-body"><label class="field">选择考生<select id="score-candidate">${d.members
            .filter((m) => m.role === "candidate")
            .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
            .join(
              "",
            )}</select></label><div id="score-form-container"></div></div></section>`
        : ""
    }</aside></div>`;
  updateRoom(d, true);
  roomTimer = setInterval(() => refreshRoom().catch(showOffline), 3000);
  if (!isAdmin) {
    await pollPresence();
    presenceTimer = setInterval(() => pollPresence(), 1500);
  }
  clockTimer = setInterval(updateClock, 500);
}
function showOffline(e) {
  if ($("#connection-warning"))
    $("#connection-warning").innerHTML =
      `<div class="notice danger">连接暂时中断：${esc(e.message)}。${btn("重新连接", "refresh-room", "small")} 已输入的内容仍保留在页面。</div>`;
}
async function refreshRoom() {
  if (!roomId) return;
  const rid = roomId,
    d = await api("/rooms/" + rid);
  if (roomId !== rid) return;
  roomData = d;
  updateRoom(d);
  $("#connection-warning").innerHTML = "";
}
function updateRoom(d, initial = false) {
  const r = d.room,
    isExam = user.role === "examiner",
    isChief = user.id === r.chief_id,
    isCandidate = user.role === "candidate";
  deadlineLocal = Date.now() + r.seconds_left * 1000;
  $("#room-badge").innerHTML =
    badge(r.status) +
    (r.paused ? ' <span class="badge waiting">计时暂停</span>' : "");
  updateClock();
  $("#timer-label").textContent =
    r.status === "waiting"
      ? "计划总时长"
      : r.status === "ended"
        ? "结束时剩余时间"
        : r.paused
          ? "计时已暂停"
          : "全场剩余时间";
  $("#room-notice").innerHTML =
    r.status === "waiting"
      ? `<div class="notice">${user.role === "admin" ? "管理监控视角：房间尚未开始。请查看参与者的准备状态，开始面试由主考官操作。" : "已进入候考房间，尚未开始面试。请完成设备自检并确认就绪，等待主考官宣布开始。"}${r.allow_text ? " 本场允许明确标记的文字演练。" : ""}</div>`
      : r.status === "ended"
        ? `<div class="notice">面试已结束，音视频连接已关闭。${r.published ? "成绩已归档，可查看反馈。" : "等待考官提交评分与主考官归档。"}</div>`
        : `<div class="notice ${r.paused ? "warning" : ""}">正式面试${r.paused ? "已暂停" : "进行中"}。${r.allow_text ? "本场允许文字演练；设备是否验证见成员状态。" : "请主动连接音视频，确保考官能听到你的表达。"}</div>`;
  if (r.status !== "active" && callActive) stopCall();
  if (r.status === "ended" && stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    attachLocal();
  }
  if ($("#connect-btn")) {
    $("#connect-btn").disabled = r.status !== "active";
    $("#connect-btn").textContent = callActive ? "断开音视频" : "连接音视频";
  }
  const mk = JSON.stringify(d.members);
  if (mk !== membersKey) {
    membersKey = mk;
    $("#members").innerHTML = d.members
      .map(
        (m) =>
          `<li><span class="avatar">${esc(m.name[0])}</span><span class="member-info">${esc(m.name)} ${m.raised ? "✋" : ""}<small>${m.id === r.chief_id ? "主考官" : roleNames[m.role]} · ${m.device.mode === "text" ? "文字演练" : m.ready ? "设备已验证" : "尚未就绪"}</small></span><span class="badge ${m.online ? "active" : "ended"}">${m.online ? "在线" : "离线"}</span></li>`,
      )
      .join("");
    if (initial) renderTiles(d);
    else
      d.members.forEach((m) => {
        const el = $(`[data-tile="${m.id}"] .tile-status`);
        if (el)
          el.textContent = m.raised
            ? "已举手"
            : m.id === user.id
              ? callActive
                ? "通话中"
                : "本地预览"
              : m.ready
                ? "已就绪"
                : "等待设备";
      });
  }
  $("#ready-controls").innerHTML =
    r.status === "waiting" && user.role !== "admin"
      ? `${btn("设备自检并就绪", "devices", "primary full")}${r.allow_text ? btn("仅文字演练就绪", "text-ready", "ghost full small") : ""}`
      : "";
  const q = d.questions[r.current_question] || d.questions[0],
    qkey = JSON.stringify([r.status, r.current_question, r.phase, q]);
  if (qkey !== questionKey) {
    questionKey = qkey;
    $("#question-progress").textContent =
      r.kind === "group"
        ? "按阶段推进讨论"
        : `第 ${r.current_question + 1} / ${d.questions.length} 题 · 全场共用倒计时`;
    $("#question").innerHTML = `<h3>${esc(q?.title)}</h3>${esc(q?.body)}`;
    $("#hint").textContent = q?.hint || "本题未设置提示。";
    $("#hint").classList.add("hidden");
    $("#stages").innerHTML =
      r.kind === "group"
        ? `<div class="stage">${phases.map((x, i) => `<span class="${i === r.phase ? "on" : ""}">${i + 1} ${x}</span>`).join("")}</div>`
        : "";
    $("#question-actions").innerHTML =
      isCandidate && r.status === "active"
        ? btn("答题提示", "hint", "ghost small")
        : "";
    $("#candidate-actions").innerHTML =
      isCandidate && r.status === "active"
        ? `${btn("提交作答要点", "answer", "primary")}<div>${r.kind === "group" ? btn(icon("hand") + " 举手 / 放下", "hand", "small") : ""} ${btn("申请延时", "extension", "small")}</div>`
        : "";
  }
  $("#control-buttons").innerHTML = isChief
    ? `<div class="checks">${r.status === "waiting" ? btn("正式开始面试", "start", "primary full") : r.status === "active" ? `${btn(r.paused ? "恢复计时" : "暂停计时", r.paused ? "resume" : "pause", "full")}${btn(r.kind === "group" ? "推进下一阶段" : "展示下一题", "next", "full")}${btn("结束面试", "end", "danger full")}` : !r.published ? btn("归档并公布成绩", "publish", "primary full") : '<span class="badge active">已归档</span>'}</div>`
    : `<p class="muted">${r.status === "waiting" ? "等待主考官宣布开始。" : r.status === "active" ? "计时、题目和阶段由主考官统一控制。" : "等待评分归档，或前往历史成绩查看反馈。"}</p>`;
  $("#extensions").innerHTML = d.extensions
    .map(
      (x) =>
        `<div class="record"><b>${esc(x.name)} · 延时 60 秒</b><br>${esc(x.reason)}<br><small>${{ pending: "待主考官处理", approved: "已批准", rejected: "未批准" }[x.status]}</small>${isChief && x.status === "pending" ? `<div style="margin-top:8px">${btn("同意", "approve", "small", `data-id="${x.id}"`)} ${btn("拒绝", "reject", "small", `data-id="${x.id}"`)}</div>` : ""}</div>`,
    )
    .join("");
  if (!loadedNote && $("#note")) {
    const draft = readDraft("note");
    $("#note").value = draft?.content ?? d.note;
    if (draft) $("#note-status").textContent = "已恢复浏览器中的未保存草稿";
    loadedNote = true;
  }
  const msgkey = JSON.stringify(d.messages);
  if (msgkey !== messagesKey) {
    messagesKey = msgkey;
    $("#chatlog").innerHTML =
      d.messages
        .map(
          (m) =>
            `<div class="chatitem ${m.kind}"><small>${m.kind === "examiner" ? "考官内部 · " : ""}${esc(m.name || "系统")} · ${date(m.created)}</small>${esc(m.content).replaceAll("\n", "<br>")}</div>`,
        )
        .join("") || '<p class="muted">暂无讨论记录。</p>';
    $("#chatlog").scrollTop = $("#chatlog").scrollHeight;
  }
  $("#answers").innerHTML =
    d.answers
      .map(
        (a) =>
          `<div class="record"><b>${esc(a.name)} · ${esc(d.questions.find((q) => q.id === a.question_id)?.title)}</b><small> ${date(a.submitted)}</small><br>${esc(a.content)}</div>`,
      )
      .join("") ||
    '<p class="muted">暂无已提交的答题要点。口头表达通过音视频通话进行，本系统不自动转写或录制。</p>';
  $("#results").innerHTML = r.published
    ? `<section class="panel" style="margin-top:20px"><div class="panel-head"><h2>成绩回顾</h2><a class="btn small" href="/api/export/${r.id}">导出成绩 CSV</a></div>${resultCards(d.results)}</section>`
    : "";
  if (initial && isExam) renderScore();
  if ($("#message-form")) $("#message-form button").disabled = !!r.published;
}
function updateClock() {
  if (!roomData || !$("#clock")) return;
  const r = roomData.room;
  $("#clock").textContent = timeText(
    r.status === "active" && !r.paused
      ? (deadlineLocal - Date.now()) / 1000
      : r.seconds_left,
  );
}
function renderTiles(d) {
  if (!$("#videos")) return;
  $("#videos").innerHTML = d.members
    .map(
      (m) =>
        `<div class="tile ${m.id === user.id ? "self" : ""}" data-tile="${m.id}"><div class="placeholder"><b>${esc(m.name[0])}</b><small>设备未开启 / 未连接</small></div><video ${m.id === user.id ? "muted" : ""} autoplay playsinline></video><span class="tile-status">${m.id === user.id ? "本地预览" : "等待连接"}</span><span class="tile-label">${esc(m.name)} · ${m.id === d.room.chief_id ? "主考官" : roleNames[m.role]}</span></div>`,
    )
    .join("");
  attachLocal();
}
function attachLocal() {
  for (const v of document.querySelectorAll(
    `[data-tile="${user?.id}"] video,#checkvideo`,
  )) {
    v.srcObject = stream;
    v.muted = true;
    if (stream) v.play().catch(() => {});
  }
}
function renderScore() {
  let s = roomData.scores.find((x) => x.candidate_id === selectedCandidate);
  const draft = readDraft("score-" + selectedCandidate);
  if (draft && !s?.submitted && !roomData.room.published)
    s = { values_json: JSON.stringify(draft.values), comment: draft.comment };
  const values = s ? JSON.parse(s.values_json) : Array(6).fill(null),
    locked = s?.submitted || roomData.room.published;
  $("#score-form-container").innerHTML =
    `<form id="score-form">${dimensions.map((name, i) => `<label class="score-row">${name}<input name="s${i}" aria-label="${name}" type="number" min="0" max="100" step="0.5" value="${values[i] ?? ""}" ${locked ? "disabled" : ""}></label>`).join("")}<div class="score-total"><span>当前均分</span><strong id="score-total">${values.every((x) => x !== null) ? (values.reduce((a, b) => a + b, 0) / 6).toFixed(1) : "—"}</strong></div><label class="field">考官评语<textarea name="comment" rows="3" style="min-height:80px" placeholder="记录具体表现与改进建议…" maxlength="2000" ${locked ? "disabled" : ""}>${esc(s?.comment || "")}</textarea></label><div class="inline-error" role="alert"></div>${locked ? '<span class="badge active">已提交评分</span>' : `${btn("暂存评分", "save-score", "full", 'type="button"')}${btn("提交最终评分", "submit-score", "primary full", 'type="button" style="margin-top:10px"')}`}<p class="muted" style="margin-top:12px">结束后才能最终提交；提交后锁定。主考官收齐全部评分后归档。</p></form>`;
}
async function saveScore(submit) {
  const f = $("#score-form"),
    data = new FormData(f),
    values = dimensions.map((_, i) =>
      data.get("s" + i) === "" ? null : Number(data.get("s" + i)),
    );
  try {
    await api(`/rooms/${roomId}/scores`, "POST", {
      candidate_id: selectedCandidate,
      values,
      comment: data.get("comment"),
      submit,
    });
    removeDraft("score-" + selectedCandidate);
    toast(submit ? "评分已提交并锁定" : "评分已暂存");
    await refreshRoom();
    renderScore();
  } catch (e) {
    f.querySelector(".inline-error").textContent = e.message;
  }
}
function resultCards(items) {
  return items
    .map(
      (x) =>
        `<article class="resultcard"><div class="result-head"><div><h3>${esc(x.name)}</h3><small>六维等权均分，再对考官取平均</small></div><strong class="bigscore">${x.total ?? "—"}<small style="font-size:12px"> / 100</small></strong></div><div class="bars">${x.dimensions.map((v, i) => `<div class="bar">${dimensions[i]}<b>${v}</b><div><span style="width:${v}%"></span></div></div>`).join("")}</div>${x.comments.map((c) => `<p class="muted"><b>${esc(c.examiner)}：</b>${esc(c.comment)}</p>`).join("")}</article>`,
    )
    .join("");
}
function historyView(d) {
  const scores = d.items
    .flatMap((x) => x.results.map((y) => y.total))
    .filter((x) => x !== null);
  $("#main").innerHTML =
    heading(
      "历史成绩回顾",
      "复盘每一次表达，把考官反馈转化为下一次练习的目标。",
    ) +
    `<div class="stats"><div class="stat"><span>已归档场次</span><strong>${d.items.length}</strong><small>仅展示已公布的结果</small></div><div class="stat"><span>${user.role === "candidate" ? "我的平均成绩" : "可见考生成绩均值"}</span><strong>${scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—"}</strong><small>课程模拟 · 不用于招录判断</small></div></div>${d.items.map((x) => `<section class="panel"><div class="panel-head"><div><h2>${esc(x.room.title)}</h2><small>${kindNames[x.room.kind]} · ${date(x.room.scheduled)}</small></div><div>${btn("查看归档", "enter", "small", `data-id="${x.room.id}"`)} <a class="btn small" href="/api/export/${x.room.id}">导出 CSV</a></div></div>${resultCards(x.results)}</section>`).join("") || empty("还没有已归档成绩", "完成面试后，由考官提交评分并由主考官归档。")}`;
}
function guideView() {
  $("#main").innerHTML =
    heading(
      "练习前，先了解这些",
      "把设备准备、候考、正式通话和评分归档分清楚。",
      '<a class="btn" href="/static/diagnostics.html">浏览器连接诊断</a>',
    ) +
    `<div class="guide-grid">${[
      [
        "从候考到正式面试",
        "进入房间只代表加入候考。先做设备自检，再确认就绪。主考官核对准备状态、到达计划时间后点击“正式开始面试”。",
        "候考不会启动答题计时，也不会发送音视频。正式开始后，每位参与者需主动点击“连接音视频”。",
      ],
      [
        "设备与隐私",
        "设备自检会请求摄像头和麦克风权限。预览流只连接本地 video 元素，检测音量，不录制、不上传。",
        "连接音视频后，WebRTC 将音视频发送给同房间已连接成员。服务器只交换连接信息。离开房间或面试结束会断开通话。",
      ],
      [
        "局域网与浏览器",
        "本机可用 http://localhost:5200。其他设备使用 HTTPS 入口，安装并信任本项目生成的局域网证书后才能访问摄像头与麦克风。",
        "运行说明给出了证书与启动步骤。普通 HTTP 局域网地址可以看页面，但浏览器通常不允许开启媒体设备。",
      ],
      [
        "评分与合议",
        "六个中文维度各 0–100 分，等权平均。考官独立暂存，可在内部频道沟通和合议。面试结束后补齐分值与评语再提交。",
        "提交评分会锁定。主考官收齐全部评分后归档公布，考生仅能查看自己的分数与评语。",
      ],
      [
        "断网与设备异常",
        "网络异常会保留页面中已输入内容，并提示重新连接。音视频可尝试重连；仍失败时联系主考官暂停计时并检查网络或设备。",
        "本地预览目标为 720p、延迟不超过 200ms。页面展示实际分辨率；延迟需要专门测量，不用网络时延冒充画面延迟。",
      ],
      [
        "演示账号",
        "考生：candidate、candidate2、candidate3；主考官：chief；普通考官：examiner；管理员：admin。演示密码均为 Demo2026!。",
        "同一浏览器的同一主机名共享登录会话。多人请使用不同设备或浏览器。本机双角色演示可分别使用 localhost 与 127.0.0.1。",
      ],
    ]
      .map(
        ([t, a, b]) =>
          `<section class="panel"><div class="panel-head"><h2>${t}</h2></div><div class="panel-body"><p class="muted">${a}</p><p class="muted">${b}</p></div></section>`,
      )
      .join("")}</div>`;
}

async function deviceDialog() {
  if (!roomId) return;
  modal(
    "设备自检与本地预览",
    "此处不会建立音视频通话；画面与声音只在本机检测。",
    `<div class="device-layout"><div><video id="checkvideo" class="device-video" muted autoplay playsinline></video><p class="muted">请正对镜头，检查光线、取景与着装。建议使用耳机。</p><label class="field">选择摄像头<select id="camera-select"><option value="">默认摄像头</option></select></label>${btn("开启摄像头与麦克风", "start-devices", "primary full")}</div><div><div class="device-row"><b>摄像头 · 目标 1280 × 720</b><small id="camera-check">设备未开启</small></div><div class="device-row"><b>麦克风 · 请正常说一句话</b><div class="meter"><span id="mic-meter"></span></div><small id="mic-check">设备未开启</small></div><div class="device-row"><b>扬声器</b>${btn("播放测试声音", "speaker", "small")}<label class="check"><input id="speaker-heard" type="checkbox">我已听清测试声音</label></div><div class="device-row"><b>网络与安全环境</b><small id="network-check">正在检查…</small></div></div></div><div class="notice">预览画面仅本地显示。实际分辨率可核验；端到端预览延迟尚未专门测量，不把网络往返时间当作预览延迟。</div><div class="inline-error" id="device-error" role="alert"></div><div class="dialog-footer">${btn("关闭，返回房间", "close")}${roomData.room.status === "waiting" ? btn("自检通过，确认就绪", "ready", "primary") : ""}</div>`,
  );
  attachLocal();
  await enumerateCameras();
  const t = performance.now();
  try {
    await api("/session");
    networkOkay = true;
    $("#network-check").textContent =
      `服务器往返 ${Math.round(performance.now() - t)} ms · ${window.isSecureContext ? "安全环境可用" : "当前非安全环境，摄像头需要 HTTPS"}`;
  } catch {
    networkOkay = false;
    $("#network-check").textContent = "网络未连接，请检查服务器";
  }
  if (stream) updateDeviceReadouts();
}
async function enumerateCameras() {
  if (!navigator.mediaDevices) return;
  try {
    const list = await navigator.mediaDevices.enumerateDevices(),
      select = $("#camera-select");
    if (select) {
      const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
      select.innerHTML =
        list
          .filter((x) => x.kind === "videoinput")
          .map(
            (d, i) =>
              `<option value="${esc(d.deviceId)}" ${d.deviceId === current ? "selected" : ""}>${esc(d.label || "摄像头 " + (i + 1))}</option>`,
          )
          .join("") || '<option value="">默认摄像头</option>';
    }
  } catch {}
}
async function acquireMedia(constraints) {
  let expired = false;
  let timer;
  const request = navigator.mediaDevices
    .getUserMedia(constraints)
    .then((media) => {
      if (expired) {
        media.getTracks().forEach((t) => t.stop());
        throw new Error("设备请求已取消");
      }
      return media;
    });
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            Object.assign(new Error("授权等待超时"), {
              name: "PermissionTimeout",
            }),
          );
        }, 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function startDevices(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("摄像头需要 localhost 或可信 HTTPS 地址，请查看使用指南");
    return;
  }
  const captureRoom = roomId;
  let errors = [];
  if (!stream) stream = new MediaStream();
  try {
    const video = await acquireMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      audio: false,
    });
    if (roomId !== captureRoom) {
      video.getTracks().forEach((t) => t.stop());
      return;
    }
    const next = video.getVideoTracks()[0],
      old = stream.getVideoTracks()[0];
    if (old) {
      stream.removeTrack(old);
      old.stop();
    }
    stream.addTrack(next);
    for (const { pc } of peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(next);
    }
    next.onended = () => {
      toast("摄像头已断开，请重新检查设备");
      updateDeviceReadouts();
    };
  } catch (e) {
    errors.push("摄像头：" + mediaError(e));
  }
  if (!stream.getAudioTracks().length)
    try {
      const a = await acquireMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (roomId !== captureRoom) {
        a.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.addTrack(a.getAudioTracks()[0]);
    } catch (e) {
      errors.push("麦克风：" + mediaError(e));
    }
  attachLocal();
  await enumerateCameras();
  await meterStart();
  updateDeviceReadouts();
  if ($("#device-error")) $("#device-error").textContent = errors.join("；");
  else if (errors.length) toast(errors.join("；"));
}
function mediaError(e) {
  return (
    {
      PermissionTimeout: "设备授权等待超时，请检查浏览器权限后重试",
      NotAllowedError: "未授权，请在浏览器站点设置中允许",
      NotFoundError: "没有检测到设备",
      NotReadableError: "设备被占用或不可读取",
      OverconstrainedError: "设备不支持所选参数",
    }[e.name] || "开启失败，请检查设备连接"
  );
}
async function meterStart() {
  cancelAnimationFrame(meterRAF);
  if (!stream?.getAudioTracks().length) return;
  if (audioCtx) await audioCtx.close().catch(() => {});
  audioCtx = new AudioContext();
  await audioCtx.resume();
  const source = audioCtx.createMediaStreamSource(stream),
    analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  micPeak = 0;
  function tick() {
    analyser.getByteTimeDomainData(data);
    const energy = Math.sqrt(
      data.reduce((a, v) => a + (v - 128) ** 2, 0) / data.length,
    );
    micPeak = Math.max(micPeak, energy);
    if ($("#mic-meter"))
      $("#mic-meter").style.width = Math.min(100, energy * 6) + "%";
    if ($("#mic-check"))
      $("#mic-check").textContent =
        micPeak > 1 ? "已检测到声音输入" : "麦克风已打开，请说话以确认输入";
    if ($("#dialog").open) meterRAF = requestAnimationFrame(tick);
  }
  tick();
}
function updateDeviceReadouts() {
  const track = stream?.getVideoTracks()[0],
    settings = track?.getSettings();
  if ($("#camera-check"))
    $("#camera-check").textContent =
      track?.readyState === "live"
        ? `${settings.width} × ${settings.height} · ${settings.width >= 1280 && settings.height >= 720 ? "达到 720p" : "低于 720p，请更换设备或调整条件"}`
        : "设备未开启";
  if ($("#mic-check") && !stream?.getAudioTracks().length)
    $("#mic-check").textContent = "设备未开启";
}
async function speakerTest() {
  const ac = new AudioContext();
  await ac.resume();
  const oscillator = ac.createOscillator(),
    gain = ac.createGain();
  oscillator.frequency.value = 523;
  gain.gain.value = 0.07;
  oscillator.connect(gain);
  gain.connect(ac.destination);
  oscillator.start();
  oscillator.stop(ac.currentTime + 0.45);
  oscillator.onended = () => ac.close();
  speakerPlayed = true;
}
async function readyDevices() {
  const v = stream?.getVideoTracks()[0],
    a = stream?.getAudioTracks()[0],
    s = v?.getSettings() || {};
  try {
    if (!speakerPlayed || !$("#speaker-heard").checked)
      throw new Error("请播放测试音并确认已听清");
    if (micPeak <= 1) throw new Error("尚未检测到有效声音，请对麦克风说话");
    await api(`/rooms/${roomId}/ready`, "POST", {
      mode: "devices",
      camera: v?.readyState === "live",
      microphone: a?.readyState === "live",
      speaker: true,
      network: networkOkay,
      width: s.width || 0,
      height: s.height || 0,
    });
    closeModal();
    toast("设备自检已通过；仍处于候考，尚未通话");
    await refreshRoom();
  } catch (e) {
    $("#device-error").textContent = e.message;
  }
}
async function switchCamera() {
  if (!navigator.mediaDevices) return toast("请使用 localhost 或可信 HTTPS");
  const list = (await navigator.mediaDevices.enumerateDevices()).filter(
    (x) => x.kind === "videoinput",
  );
  if (list.length < 2)
    return toast("只检测到一个摄像头，可接入外置摄像头后重试");
  const current = stream?.getVideoTracks()[0]?.getSettings().deviceId,
    index = list.findIndex((x) => x.deviceId === current);
  await startDevices(list[(index + 1) % list.length].deviceId);
  toast("已切换摄像头");
}

async function connectCall() {
  if (callActive) {
    stopCall();
    await pollPresence();
    return;
  }
  if (roomData.room.status !== "active")
    return toast("请等待主考官正式开始面试");
  if (!stream?.getVideoTracks().length || !stream?.getAudioTracks().length)
    await startDevices();
  if (
    !stream?.getVideoTracks().some((t) => t.readyState === "live") ||
    !stream?.getAudioTracks().some((t) => t.readyState === "live")
  )
    return toast("请先成功开启摄像头与麦克风");
  callActive = true;
  $("#media-status").textContent =
    "通话连接中 · 将向本房间已连接成员发送音视频";
  $("#connect-btn").textContent = "断开音视频";
  await pollPresence();
}
function stopCall() {
  callActive = false;
  for (const state of peers.values()) {
    clearTimeout(state.retry);
    state.pc.close();
  }
  peers.clear();
  for (const v of document.querySelectorAll("#videos video"))
    if (v.closest("[data-tile]")?.dataset.tile !== String(user?.id))
      v.srcObject = null;
  if ($("#media-status"))
    $("#media-status").textContent = "未连接通话 · 本地预览不会自动发送";
  if ($("#connect-btn")) $("#connect-btn").textContent = "连接音视频";
}
async function sendSignal(receiver, payload) {
  return api(`/rooms/${roomId}/signal`, "POST", {
    sender: clientId,
    receiver,
    payload,
  });
}
function getPeer(peer) {
  if (peers.has(peer.client_id)) return peers.get(peer.client_id);
  const pc = new RTCPeerConnection({ iceServers: [] }),
    state = { pc, peer, pending: [] };
  peers.set(peer.client_id, state);
  for (const t of stream.getTracks()) pc.addTrack(t, stream);
  pc.onicecandidate = (e) => {
    if (e.candidate && callActive)
      sendSignal(peer.client_id, {
        type: "candidate",
        candidate: e.candidate.toJSON(),
      }).catch(() => {});
  };
  pc.ontrack = (e) => {
    const tile = $(`[data-tile="${peer.user_id}"]`),
      v = tile?.querySelector("video");
    if (v) {
      v.srcObject = e.streams[0] || new MediaStream([e.track]);
      v.play().catch(() => {
        toast("浏览器阻止自动播放，请点击“播放远端声音”");
        if (!$("#play-remote"))
          $(".media-controls").insertAdjacentHTML(
            "beforeend",
            btn("播放远端声音", "play-remote", "small", 'id="play-remote"'),
          );
      });
    }
  };
  pc.onconnectionstatechange = () => {
    const tile = $(`[data-tile="${peer.user_id}"] .tile-status`);
    if (tile)
      tile.textContent =
        {
          connected: "通话已连接",
          connecting: "正在连接",
          failed: "连接失败",
          disconnected: "连接中断",
          closed: "已断开",
        }[pc.connectionState] || "连接准备中";
    if (pc.connectionState === "connected") {
      state.attempts = 0;
    }
    if (pc.connectionState === "connected" && $("#media-status"))
      $("#media-status").textContent =
        "通话已连接 · 音视频正在向其他参与者发送";
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      showOffline(
        new Error("音视频连接中断，正在尝试恢复；必要时请主考官暂停计时"),
      );
      clearTimeout(state.retry);
      state.retry = setTimeout(() => {
        if (
          callActive &&
          peers.get(peer.client_id) === state &&
          pc.connectionState !== "connected"
        ) {
          pc.close();
          peers.delete(peer.client_id);
          pollPresence();
        }
      }, 4000);
    }
  };
  return state;
}
async function pollPresence() {
  if (pollBusy || !roomId || user?.role === "admin") return;
  pollBusy = true;
  const rid = roomId;
  try {
    const d = await api(`/rooms/${rid}/presence`, "POST", {
      client: clientId,
      media: callActive,
      after: signalCursor,
    });
    if (roomId !== rid) return;
    seenPeers = d.peers;
    pollErrors = 0;
    const live = new Set(
      d.peers.filter((p) => p.media).map((p) => p.client_id),
    );
    for (const [id, state] of peers)
      if (!live.has(id)) {
        state.pc.close();
        peers.delete(id);
        const v = $(`[data-tile="${state.peer.user_id}"] video`);
        if (v) v.srcObject = null;
      }
    if (callActive) {
      for (const p of d.peers.filter((p) => p.media && p.user_id !== user.id)) {
        if (!peers.has(p.client_id)) {
          const st = getPeer(p);
          if (clientId < p.client_id) {
            await st.pc.setLocalDescription(await st.pc.createOffer());
            await sendSignal(p.client_id, {
              type: "offer",
              sdp: st.pc.localDescription.sdp,
            });
          }
        }
      }
      for (const item of d.signals) {
        const p = d.peers.find((p) => p.client_id === item.sender);
        if (!p || !p.media) continue;
        const st = getPeer(p),
          payload = JSON.parse(item.payload);
        if (payload.type === "candidate") {
          if (st.pc.remoteDescription)
            await st.pc.addIceCandidate(payload.candidate);
          else st.pending.push(payload.candidate);
        } else {
          await st.pc.setRemoteDescription({
            type: payload.type,
            sdp: payload.sdp,
          });
          for (const candidate of st.pending)
            await st.pc.addIceCandidate(candidate);
          st.pending = [];
          if (payload.type === "offer") {
            await st.pc.setLocalDescription(await st.pc.createAnswer());
            await sendSignal(p.client_id, {
              type: "answer",
              sdp: st.pc.localDescription.sdp,
            });
          }
        }
      }
    }
    for (const item of d.signals)
      signalCursor = Math.max(signalCursor, item.id);
  } catch (e) {
    pollErrors++;
    if (pollErrors >= 3)
      showOffline(
        new Error("网络连接失败，正在重试。请检查局域网或联系主考官"),
      );
  } finally {
    pollBusy = false;
  }
}
async function leaveRoom() {
  clearInterval(roomTimer);
  clearInterval(presenceTimer);
  clearInterval(clockTimer);
  cancelAnimationFrame(meterRAF);
  const old = roomId;
  roomId = null;
  stopCall();
  if (old && user?.role !== "admin")
    api(`/rooms/${old}/presence`, "POST", {
      client: clientId,
      leave: true,
    }).catch(() => {});
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  roomData = null;
  clientId = crypto.randomUUID();
  signalCursor = 0;
  pollBusy = false;
}

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
      case "login":
        loginDialog();
        break;
      case "logout":
        await leaveRoom();
        await api("/logout", "POST", {});
        user = null;
        csrf = (await api("/session")).csrf;
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
        roomFilter = b.dataset.value;
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
        await api(`/rooms/${roomId}/ready`, "POST", { mode: "text" });
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
        const t = stream
          ?.getTracks()
          .find((x) => x.kind === (act === "mic" ? "audio" : "video"));
        if (!t) return toast("请先开启设备");
        t.enabled = !t.enabled;
        b.classList.toggle("danger", !t.enabled);
        b.title = t.enabled ? "已开启" : "已关闭";
        toast(
          (act === "mic" ? "麦克风" : "摄像头") +
            (t.enabled ? "已开启" : "已关闭"),
        );
        break;
      }
      case "reconnect": {
        const active = callActive;
        stopCall();
        await refreshRoom();
        if (active && roomData.room.status === "active") {
          callActive = true;
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
        await api(`/rooms/${roomId}/hand`, "POST", {});
        await refreshRoom();
        break;
      case "save-note":
        await api(`/rooms/${roomId}/note`, "POST", {
          content: $("#note").value,
        });
        removeDraft("note");
        $("#note-status").textContent =
          "已保存 " + new Date().toLocaleTimeString();
        toast("个人笔记已保存");
        break;
      case "answer": {
        const q = roomData.questions[roomData.room.current_question];
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
        await api(`/rooms/${roomId}/extension`, "POST", {
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
          `<p class="muted">当前考生：${esc(roomData.members.find((x) => x.id === selectedCandidate)?.name)}</p><div class="dialog-footer">${btn("返回检查", "close")}${btn("确认提交评分", "confirm-score", "primary")}</div>`,
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
        await api(`/rooms/${roomId}/control`, "POST", {
          action: b.dataset.value,
          version: roomData.room.version,
        });
        closeModal();
        await refreshRoom();
        break;
      case "pause":
      case "resume":
      case "next":
        await api(`/rooms/${roomId}/control`, "POST", {
          action: act,
          version: roomData.room.version,
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
      case "login-form": {
        await leaveRoom();
        const r = await api("/login", "POST", value);
        user = r.user;
        csrf = r.csrf;
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
        await api(`/rooms/${roomId}/message`, "POST", value);
        f.elements.content.value = "";
        await refreshRoom();
        break;
      case "answer-form":
        await api(`/rooms/${roomId}/answer`, "POST", {
          content: value.content,
          question_id: Number(value.question_id),
        });
        closeModal();
        toast("答题要点已归档");
        await refreshRoom();
        break;
      case "extension-form":
        await api(`/rooms/${roomId}/extension`, "POST", value);
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
    const vals = dimensions.map(
      (_, i) => $("#score-form").elements["s" + i].value,
    );
    saveDraft("score-" + selectedCandidate, {
      values: vals.map((x) => (x === "" ? null : Number(x))),
      comment: $("#score-form").elements.comment.value,
    });
    $("#score-total").textContent = vals.every(
      (x) => x !== "" && Number.isFinite(Number(x)),
    )
      ? (vals.reduce((s, x) => s + Number(x), 0) / 6).toFixed(1)
      : "—";
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "status-filter") roomTable();
  if (e.target.id === "score-candidate") {
    selectedCandidate = Number(e.target.value);
    renderScore();
  }
  if (e.target.id === "camera-select" && stream)
    await startDevices(e.target.value);
});
function draftKey(type) {
  return "interview-draft-" + user?.id + "-" + roomId + "-" + type;
}
function readDraft(type) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(type)));
  } catch {
    return null;
  }
}
function saveDraft(type, value) {
  try {
    localStorage.setItem(draftKey(type), JSON.stringify(value));
  } catch {}
}
function removeDraft(type) {
  try {
    localStorage.removeItem(draftKey(type));
  } catch {}
}
window.addEventListener("hashchange", route);
window.addEventListener("offline", () => showOffline(new Error("网络已断开")));
window.addEventListener("online", () => {
  if (roomId) refreshRoom().catch(showOffline);
});
window.addEventListener("beforeunload", () => {
  if (stream) stream.getTracks().forEach((t) => t.stop());
});
(async () => {
  try {
    const d = await api("/session");
    user = d.user;
    csrf = d.csrf;
    dimensions = d.dimensions;
    await route();
  } catch (e) {
    $("#main").innerHTML =
      empty("无法连接服务器", esc(e.message)) +
      btn("重试", "reload", "primary");
  }
})();
