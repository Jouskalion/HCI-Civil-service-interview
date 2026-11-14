import { $, btn, heading, modal } from './ui.js';

export function loginDialog() {
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

export function registerDialog() {
  modal(
    "创建考生账号",
    "管理员会将新账号分配到面试房间",
    `<form id="register-form"><label class="field">姓名<input name="name" required maxlength="30"></label><label class="field">账号<input name="username" required minlength="3" maxlength="30"></label><label class="field">密码<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><div class="inline-error" role="alert"></div><button class="btn primary full">注册</button></form>`,
    true,
  );
}

export function guideView() {
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
