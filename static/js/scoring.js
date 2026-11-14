import { $, btn, date, empty, esc, heading, kindNames, toast } from './ui.js';
import { appState } from './state.js';
import { readDraft, removeDraft } from './drafts.js';
import { api } from './api.js';
import { refreshRoom } from './rooms.js';

export const feedbackFields = [
  ["evidence", "表现证据", "例如：回答中先核实办理环节，再给出具体分流方案。"],
  ["strengths", "优点", "例如：分析层次清楚，能兼顾群众需求和办理规范。"],
  ["suggestions", "改进建议", "例如：补充责任人、完成时限和验证措施。"],
];

export const rubricExamples = [
  "观察是否抓住问题本质、分析原因与影响；例如同时考虑群众诉求和办事规则。",
  "观察表达是否条理清楚、用词准确；例如用分点和过渡句说明处理步骤。",
  "观察论据能否支持结论、推理是否连贯；例如区分事实和假设，再解释方案的因果关系。",
  "观察面对突发情况的判断与调整；例如先稳定现场，再分级处置并反馈。",
  "观察倾听、分工与协调；例如先确认分歧，再提出可接受的共同方案。",
  "观察仪态和回应态度；例如自然得体、尊重提问、保持礼貌。",
];

export function renderScore() {
  let s = appState.roomData.scores.find((x) => x.candidate_id === appState.selectedCandidate);
  const draft = readDraft("score-" + appState.selectedCandidate);
  if (draft && !s?.submitted && !appState.roomData.room.published)
    s = {
      values_json: JSON.stringify(draft.values),
      comment: draft.comment || "",
      feedback_json: JSON.stringify(draft.feedback || {}),
    };
  const values = s ? JSON.parse(s.values_json) : Array(6).fill(null),
    feedback = JSON.parse(s?.feedback_json || "{}"),
    locked =
      s?.submitted ||
      appState.roomData.room.published ||
      appState.roomData.room.status === "waiting";
  $("#score-form-container").innerHTML =
    `<div id="score-progress" class="score-progress"></div><details class="rubric"><summary>查看六维观察要点与示例</summary><p class="muted">课程练习参考，非官方招录标准。六维各 0–100 分，权重相同。</p>${appState.dimensions.map((name, i) => `<p><b>${esc(name)}</b><br>${rubricExamples[i]}</p>`).join("")}</details><form id="score-form">${appState.dimensions.map((name, i) => `<label class="score-row">${name}<input name="s${i}" aria-label="${name}" type="number" min="0" max="100" step="0.5" value="${values[i] ?? ""}" ${locked ? "disabled" : ""}></label>`).join("")}<div class="score-total"><span>六维等权均分</span><strong id="score-total">${values.every((x) => x !== null) ? (values.reduce((a, b) => a + b, 0) / 6).toFixed(1) : "—"}</strong></div>${feedbackFields.map(([key, label, example]) => `<label class="field">${label}<textarea name="${key}" rows="2" placeholder="${example}" maxlength="600" ${locked ? "disabled" : ""}>${esc(feedback[key] || "")}</textarea></label>`).join("")}${s?.comment && !Object.values(feedback).some(Boolean) ? `<details><summary>原有评语（保留）</summary><p>${esc(s.comment)}</p></details>` : ""}<input type="hidden" name="comment" value="${esc(s?.comment || "")}"><div class="inline-error" role="alert"></div>${locked ? `<span class="badge ${s?.submitted ? "active" : "waiting"}">${s?.submitted ? "已提交评分" : "正式开始后可填写评分"}</span>` : `${btn("暂存评分", "save-score", "full", 'type="button"')}${btn("提交最终评分", "submit-score", "primary full", 'type="button" style="margin-top:10px"')}`}<p id="score-save-status" class="muted">${draft ? "已恢复本浏览器的未暂存草稿" : s ? "已从服务器读取保存内容" : "输入会保留为本浏览器草稿，请点击暂存同步"}</p><p class="muted">结束后才能最终提交；提交后锁定。新评语的三项内容各至少 6 字。</p></form>`;
  updateScoreProgress();
}

export function updateScoreProgress() {
  if (!$("#score-progress")) return;
  const submitted = appState.roomData.scores.filter((s) => s.submitted).length,
    count = appState.roomData.members.filter((m) => m.role === "candidate").length;
  const f = $("#score-form"),
    filled = appState.dimensions.filter(
      (_, i) => f.elements["s" + i].value !== "",
    ).length,
    comments = feedbackFields.filter(
      ([k]) => f.elements[k].value.trim().length >= 6,
    ).length;
  const progress = (appState.roomData.submission_progress || []).find(
    (x) => x.candidate_id === appState.selectedCandidate,
  );
  $("#score-progress").textContent =
    `本人已提交 ${submitted}/${count} 位 · 当前分值 ${filled}/6 · 结构化评语 ${comments}/3${progress ? ` · 本考生已收齐 ${progress.submitted}/${progress.expected} 份评分` : ""}`;
}

export async function saveScore(submit) {
  const f = $("#score-form"),
    data = new FormData(f),
    values = appState.dimensions.map((_, i) =>
      data.get("s" + i) === "" ? null : Number(data.get("s" + i)),
    );
  try {
    await api(`/rooms/${appState.roomId}/scores`, "POST", {
      candidate_id: appState.selectedCandidate,
      values,
      comment: data.get("comment"),
      feedback: Object.fromEntries(
        feedbackFields.map(([key]) => [key, data.get(key)]),
      ),
      submit,
    });
    removeDraft("score-" + appState.selectedCandidate);
    toast(submit ? "评分已提交并锁定" : "评分已暂存");
    await refreshRoom();
    renderScore();
  } catch (e) {
    f.querySelector(".inline-error").textContent = e.message;
  }
}

export function resultCards(items) {
  return items
    .map(
      (x) =>
        `<article class="resultcard"><div class="result-head"><div><h3>${esc(x.name)}</h3><small>六维等权均分，再对考官取平均</small></div><strong class="bigscore">${x.total ?? "—"}<small style="font-size:12px"> / 100</small></strong></div><div class="bars">${x.dimensions.map((v, i) => `<div class="bar">${appState.dimensions[i]}<b>${v}</b><div><span style="width:${v}%"></span></div></div>`).join("")}</div>${x.comments.map((c) => `<p class="muted"><b>${esc(c.examiner)}：</b>${Object.values(c.feedback || {}).some(Boolean) ? feedbackFields.map(([k, label]) => `<span class="feedback-line"><b>${label}：</b>${esc(c.feedback[k] || "")}</span>`).join("") : esc(c.comment)}</p>`).join("")}</article>`,
    )
    .join("");
}

export function historyView(d) {
  const scores = d.items
    .flatMap((x) => x.results.map((y) => y.total))
    .filter((x) => x !== null);
  $("#main").innerHTML =
    heading(
      "历史成绩回顾",
      "复盘每一次表达，把考官反馈转化为下一次练习的目标。",
    ) +
    `<div class="stats"><div class="stat"><span>已归档场次</span><strong>${d.items.length}</strong><small>仅展示已公布的结果</small></div><div class="stat"><span>${appState.user.role === "candidate" ? "我的平均成绩" : "可见考生成绩均值"}</span><strong>${scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—"}</strong><small>课程模拟 · 不用于招录判断</small></div></div>${d.items.map((x) => `<section class="panel"><div class="panel-head"><div><h2>${esc(x.room.title)}</h2><small>${kindNames[x.room.kind]} · ${date(x.room.scheduled)}</small></div><div>${btn("查看归档", "enter", "small", `data-id="${x.room.id}"`)} <a class="btn small" href="/api/export/${x.room.id}">导出 CSV</a></div></div>${resultCards(x.results)}</section>`).join("") || empty("还没有已归档成绩", "完成面试后，由考官提交评分并由主考官归档。")}`;
}
