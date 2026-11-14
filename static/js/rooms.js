import { $, badge, btn, date, empty, esc, heading, icon, kindNames, modal, phases, roleNames, statusNames, timeText } from './ui.js';
import { appState } from './state.js';
import { api } from './api.js';
import { pollPresence, stopCall } from './webrtc.js';
import { renderScore, resultCards, updateScoreProgress } from './scoring.js';
import { readDraft } from './drafts.js';

export function roomsView() {
  $("#main").innerHTML =
    heading(
      appState.user.role === "candidate" ? "我的面试房间" : "面试房间管理",
      "按计划参加练习，清晰掌握候考、面试与归档进度。",
      appState.user.role === "admin"
        ? btn(icon("plus") + " 创建面试房间", "create", "primary")
        : btn(icon("help") + " 练习指南", "guide"),
    ) +
    `<section class="hero"><div><span class="eyebrow">A CALM START. A CONFIDENT ANSWER.</span><h2>准备充分，表达更从容</h2><p>进入候考房间后先检查设备。正式面试由主考官开始，音视频连接需要你主动开启。</p></div><div class="flow"><span><b>01</b> 进入候考</span>→<span><b>02</b> 设备自检</span>→<span><b>03</b> 正式面试</span></div></section><div class="stats">${[
      ["全部房间", appState.rooms.length, "已分配的模拟场次"],
      [
        "待开始",
        appState.rooms.filter((x) => x.status === "waiting").length,
        "提前检查设备与环境",
      ],
      [
        "进行中",
        appState.rooms.filter((x) => x.status === "active").length,
        "按主考官指引参与",
      ],
      [
        "已结束",
        appState.rooms.filter((x) => x.status === "ended").length,
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
          `<button class="${appState.roomFilter === a ? "active" : ""}" data-act="filter" data-value="${a}">${b}</button>`,
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

export function roomTable() {
  const q = ($("#room-search")?.value || "").toLowerCase(),
    s = $("#status-filter")?.value || "all",
    rs = appState.rooms.filter(
      (r) =>
        (appState.roomFilter === "all" || r.kind === appState.roomFilter) &&
        (s === "all" || r.status === s) &&
        (r.title + "RM" + String(r.id).padStart(4, "0"))
          .toLowerCase()
          .includes(q),
    );
  $("#room-table").innerHTML = rs.length
    ? `<div class="table-wrap"><table><thead><tr><th>面试房间</th><th>面试形式</th><th>主考官</th><th>计划时间</th><th>时长 / 考生</th><th>状态</th><th>操作</th></tr></thead><tbody>${rs.map((r) => `<tr><td><strong>${esc(r.title)}</strong><small>RM${String(r.id).padStart(4, "0")}</small></td><td>${badge(r.kind)}</td><td>${esc(r.chief)}</td><td>${date(r.scheduled)}</td><td>${r.duration / 60} 分钟 · ${r.candidate_count} 人</td><td>${badge(r.status)}</td><td>${btn(r.status === "waiting" ? "进入候考房间" : r.status === "active" ? "进入面试房间" : r.published ? "查看成绩" : "评分与归档", "enter", r.status === "waiting" ? "primary small" : "small", `data-id="${r.id}"`)}</td></tr>`).join("")}</tbody></table></div>`
    : empty("暂无符合条件的房间", "调整筛选条件，或请管理员安排新的练习场次。");
}

export async function createDialog() {
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

export async function roomView(rid, gen) {
  const d = await api("/rooms/" + rid);
  if (gen !== appState.routeGeneration) return;
  appState.roomId = rid;
  appState.roomData = d;
  appState.questionKey = "";
  appState.messagesKey = "";
  appState.membersKey = "";
  appState.loadedNote = false;
  appState.selectedCandidate = d.members.find((m) => m.role === "candidate")?.id;
  const isAdmin = appState.user.role === "admin",
    isExam = appState.user.role === "examiner";
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
  arrangeWorkspace();
  updateRoom(d, true);
  appState.roomTimer = setInterval(() => refreshRoom().catch(showOffline), 3000);
  if (!isAdmin) {
    await pollPresence();
    appState.presenceTimer = setInterval(() => pollPresence(), 1500);
  }
  appState.clockTimer = setInterval(updateClock, 500);
}

export function showOffline(e) {
  if ($("#connection-warning"))
    $("#connection-warning").innerHTML =
      `<div class="notice danger">连接暂时中断：${esc(e.message)}。${btn("重新连接", "refresh-room", "small")} 已输入的内容仍保留在页面。</div>`;
}

export async function refreshRoom() {
  if (!appState.roomId) return;
  const rid = appState.roomId,
    d = await api("/rooms/" + rid);
  if (appState.roomId !== rid) return;
  appState.roomData = d;
  updateRoom(d);
  $("#connection-warning").innerHTML = "";
}

export function updateRoom(d, initial = false) {
  const r = d.room,
    isExam = appState.user.role === "examiner",
    isChief = appState.user.id === r.chief_id,
    isCandidate = appState.user.role === "candidate";
  appState.deadlineLocal = Date.now() + r.seconds_left * 1000;
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
      ? `<div class="notice">${appState.user.role === "admin" ? "管理监控视角：房间尚未开始。请查看参与者的准备状态，开始面试由主考官操作。" : "已进入候考房间，尚未开始面试。请完成设备自检并确认就绪，等待主考官宣布开始。"}${r.allow_text ? " 本场允许明确标记的文字演练。" : ""}</div>`
      : r.status === "ended"
        ? `<div class="notice">面试已结束，音视频连接已关闭。${r.published ? "成绩已归档，可查看反馈。" : "等待考官提交评分与主考官归档。"}</div>`
        : `<div class="notice ${r.paused ? "warning" : ""}">正式面试${r.paused ? "已暂停" : "进行中"}。${r.allow_text ? "本场允许文字演练；设备是否验证见成员状态。" : "请主动连接音视频，确保考官能听到你的表达。"}</div>`;
  if (r.status !== "active" && appState.callActive) stopCall();
  if (r.status === "ended" && appState.stream) {
    appState.stream.getTracks().forEach((t) => t.stop());
    appState.stream = null;
    attachLocal();
  }
  if ($("#connect-btn")) {
    $("#connect-btn").disabled = r.status !== "active";
    $("#connect-btn").textContent = appState.callActive ? "断开音视频" : "连接音视频";
  }
  const mk = JSON.stringify(d.members);
  if (mk !== appState.membersKey) {
    appState.membersKey = mk;
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
            : m.id === appState.user.id
              ? appState.callActive
                ? "通话中"
                : "本地预览"
              : m.ready
                ? "已就绪"
                : "等待设备";
      });
  }
  $("#ready-controls").innerHTML =
    r.status === "waiting" && appState.user.role !== "admin"
      ? `${btn("设备自检并就绪", "devices", "primary full")}${r.allow_text ? btn("仅文字演练就绪", "text-ready", "ghost full small") : ""}`
      : "";
  const q = d.questions[r.current_question] || d.questions[0],
    qkey = JSON.stringify([r.status, r.current_question, r.phase, q]);
  if (qkey !== appState.questionKey) {
    appState.questionKey = qkey;
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
  if (!appState.loadedNote && $("#note")) {
    const draft = readDraft("note");
    $("#note").value = draft?.content ?? d.note;
    if (draft) $("#note-status").textContent = "已恢复浏览器中的未保存草稿";
    appState.loadedNote = true;
  }
  const msgkey = JSON.stringify(d.messages);
  if (msgkey !== appState.messagesKey) {
    appState.messagesKey = msgkey;
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
  updatePreparation(d);
  updateMediaStatus();
  updateSupport();
  if (isExam && (initial || appState.scorePhase !== r.status + ":" + r.published)) {
    appState.scorePhase = r.status + ":" + r.published;
    renderScore();
  }
  updateScoreProgress();
  if ($("#message-form")) $("#message-form button").disabled = !!r.published;
}

export function updateClock() {
  if (!appState.roomData || !$("#clock")) return;
  const r = appState.roomData.room;
  $("#clock").classList.toggle("waiting-clock", r.status === "waiting");
  $("#clock").textContent = timeText(
    r.status === "active" && !r.paused
      ? (appState.deadlineLocal - Date.now()) / 1000
      : r.seconds_left,
  );
}

export function renderTiles(d) {
  if (!$("#videos")) return;
  $("#videos").innerHTML = d.members
    .map(
      (m) =>
        `<div class="tile ${m.id === appState.user.id ? "self" : ""}" data-tile="${m.id}"><div class="placeholder"><b>${esc(m.name[0])}</b><small>设备未开启 / 未连接</small></div><video ${m.id === appState.user.id ? "muted" : ""} autoplay playsinline></video><span class="tile-status">${m.id === appState.user.id ? "本地预览" : "等待连接"}</span><span class="tile-label">${esc(m.name)} · ${m.id === d.room.chief_id ? "主考官" : roleNames[m.role]}</span></div>`,
    )
    .join("");
  attachLocal();
}

export function attachLocal() {
  for (const v of document.querySelectorAll(
    `[data-tile="${appState.user?.id}"] video,#checkvideo`,
  )) {
    v.srcObject = appState.stream;
    v.muted = true;
    if (appState.stream) v.play().catch(() => {});
  }
}

export function arrangeWorkspace() {
  const main = $(".main-column"),
    question = $("#question").closest("section");
  question.classList.add("question-panel");
  main.prepend(question);
  $("#room-notice").insertAdjacentHTML(
    "afterend",
    '<div id="preparation"></div>',
  );
  if (appState.user.role !== "admin")
    $(".room-top .meta").insertAdjacentHTML(
      "afterend",
      `<div class="room-contact">${btn(appState.user.id === appState.roomData.room.chief_id ? "候场联系" : "联系主考官", "support", "small")}${appState.user.role === "examiner" ? '<a class="btn small" href="#" id="score-jump">前往评分 ↓</a>' : ""}<span class="muted">私密消息仅联系双方可见</span></div>`,
    );
  if ($("#score-jump"))
    $("#score-jump").addEventListener("click", (e) => {
      e.preventDefault();
      $("#score-candidate").focus();
    });
  const panes = [
    ["note", appState.user.role === "examiner" ? "观察笔记" : "个人笔记"],
    ["chatlog", "讨论记录"],
    ["answers", "答题记录"],
  ].filter(([id]) => $("#" + id));
  const workbench = document.createElement("section");
  workbench.className = "workbench";
  workbench.innerHTML = `<div class="workspace-tabs" role="tablist" aria-label="面试辅助工作区">${panes.map(([id, label]) => `<button class="btn ghost" data-act="workspace-tab" data-tab="${id}" id="tab-${id}" role="tab" aria-controls="pane-${id}">${label}</button>`).join("")}</div>`;
  main.insertBefore(
    workbench,
    panes.length ? $("#" + panes[0][0]).closest("section") : $("#results"),
  );
  panes.forEach(([id]) => {
    const panel = $("#" + id).closest("section");
    panel.classList.add("workspace-pane");
    panel.id = "pane-" + id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "tab-" + id);
    workbench.append(panel);
  });
  selectWorkspaceTab(panes[0][0]);
  $(".workspace-tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const tabs = [...document.querySelectorAll("[data-tab]")],
      i = tabs.indexOf(document.activeElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectWorkspaceTab(tabs[next].dataset.tab);
    tabs[next].focus();
  });
}

export function selectWorkspaceTab(id) {
  document.querySelectorAll("[data-tab]").forEach((b) => {
    const selected = b.dataset.tab === id;
    b.setAttribute("aria-selected", String(selected));
    b.tabIndex = selected ? 0 : -1;
    b.classList.toggle("selected", selected);
    $("#pane-" + b.dataset.tab).classList.toggle("hidden", !selected);
  });
}

export function updatePreparation(d) {
  const r = d.room,
    el = $("#preparation");
  if (!el) return;
  if (r.status !== "waiting") {
    el.innerHTML = "";
    return;
  }
  const self = d.members.find((m) => m.id === appState.user.id),
    chief = d.members.find((m) => m.id === r.chief_id),
    pending = d.members.filter((m) => m.role === "candidate" && !m.ready),
    timeReady = new Date(r.scheduled).getTime() <= r.server_time * 1000;
  const readyAll = !pending.length && chief?.ready,
    reason = !timeReady
      ? `尚未到计划时间 ${date(r.scheduled)}`
      : !readyAll
        ? `等待 ${[...pending.map((m) => m.name), ...(!chief?.ready ? [chief?.name + "（主考官）"] : [])].join("、")} 完成准备`
        : "准备条件已满足，等待主考官点击“正式开始面试”";
  const steps = [
    [true, "已进入候考", "尚未启动计时"],
    [
      !!self?.ready,
      appState.user.role === "admin"
        ? "管理观察"
        : self?.ready
          ? "个人已就绪"
          : "个人准备",
      self?.device?.mode === "text"
        ? "文字演练 · 设备未验证"
        : self?.ready
          ? "设备自检已确认"
          : "完成设备自检后确认就绪",
    ],
    [
      readyAll,
      "核对开考条件",
      readyAll ? "所有考生及主考官已就绪" : "检查成员准备状态",
    ],
    [false, "等待正式开始", timeReady ? "由主考官控制" : "尚未到计划时间"],
  ];
  el.innerHTML = `<section class="preparation"><div class="preparation-heading"><b>候考准备清单</b><span>当前：${esc(reason)}</span></div><ol>${steps.map(([ok, title, detail], i) => `<li class="${ok ? "done" : ""}"><span>${ok ? "✓" : i + 1}</span><div><b>${title}</b><small>${detail}</small></div></li>`).join("")}</ol></section>`;
}

export function supportDialog() {
  const d = appState.roomData,
    chief = appState.user.id === d.room.chief_id,
    recipients = d.members.filter(
      (m) => m.id !== appState.user.id && (chief || m.id === d.room.chief_id),
    );
  modal(
    chief ? "候场联系" : "私密联系主考官",
    "用于候考、设备与流程问题；消息仅发送者和接收者可见。",
    `<form id="support-form"><label class="field">联系对象<select name="recipient_id" id="support-recipient">${recipients.map((m) => `<option value="${m.id}">${esc(m.name)} · ${m.id === d.room.chief_id ? "主考官" : roleNames[m.role]}</option>`).join("")}</select></label><div id="support-log" class="chatlog support-log" aria-live="polite"></div><label class="field">消息内容<textarea name="content" required maxlength="1000" placeholder="例如：我已进入候考，但设备权限被拒绝，需要帮助。" ${d.room.published ? "disabled" : ""}></textarea></label><div class="inline-error" role="alert"></div><div class="dialog-footer"><button class="btn primary" ${d.room.published ? "disabled" : ""}>${d.room.published ? "归档后只读" : "发送私密消息"}</button></div></form>`,
  );
  updateSupport();
}

export function updateSupport() {
  const el = $("#support-log");
  if (!el) return;
  const recipient = Number($("#support-recipient").value),
    items = (appState.roomData.support || []).filter(
      (m) => m.sender_id === recipient || m.recipient_id === recipient,
    ),
    key = JSON.stringify(items);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML =
    items
      .map(
        (m) =>
          `<div class="chatitem ${m.sender_id === appState.user.id ? "mine" : ""}"><small>${esc(m.sender_name)} → ${esc(m.recipient_name)} · ${date(m.created)}</small>${esc(m.content).replaceAll("\n", "<br>")}</div>`,
      )
      .join("") ||
    '<p class="muted">尚无私密消息。公共讨论和考官内部频道不会显示这里的内容。</p>';
  el.scrollTop = el.scrollHeight;
}

export function updateMediaStatus() {
  const el = $("#media-status");
  if (!el) return;
  const live = appState.stream?.getTracks().filter((t) => t.readyState === "live") || [],
    connected = [...appState.peers.values()].filter(
      (p) => p.pc.connectionState === "connected",
    ).length,
    failed = [...appState.peers.values()].some((p) =>
      ["failed", "disconnected"].includes(p.pc.connectionState),
    );
  let label =
    appState.roomData?.room.status === "ended"
      ? "面试已结束 · 设备已释放"
      : !appState.callActive
        ? live.length
          ? appState.hadCall
            ? "已断开通话 · 仅本地预览，未向他人发送"
            : "仅本地预览 · 未向他人发送音视频"
          : "设备未开启 · 未向他人发送音视频"
        : connected
          ? `通话已连接 ${connected} 人 · ${live.some((t) => t.kind === "audio" && t.enabled) ? "麦克风开启" : "麦克风静音"} · ${live.some((t) => t.kind === "video" && t.enabled) ? "摄像头开启" : "摄像头关闭"}`
          : failed
            ? "通话连接中断 · 正在尝试恢复"
            : appState.peers.size
              ? "正在建立通话连接 · 等待连接成功"
              : "等待其他参与者连接 · 尚未向他人发送";
  el.textContent = label;
  el.className = connected ? "media-state sending" : "media-state local";
  const own = $(`[data-tile="${appState.user?.id}"] .tile-status`);
  if (own)
    own.textContent = connected
      ? "通话已连接"
      : appState.callActive
        ? "等待通话连接"
        : live.length
          ? "仅本地预览"
          : "设备未开启";
}
