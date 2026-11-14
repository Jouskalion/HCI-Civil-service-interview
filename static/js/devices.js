import { $, btn, closeModal, esc, modal, toast } from './ui.js';
import { appState } from './state.js';
import { api } from './api.js';
import { attachLocal, refreshRoom, updateMediaStatus } from './rooms.js';
import { pollPresence, stopCall } from './webrtc.js';

export async function deviceDialog() {
  if (!appState.roomId) return;
  if (appState.roomData.room.status === "ended")
    return toast("面试已结束，设备已释放；可在使用指南查看设备帮助");
  if (appState.callActive) {
    stopCall();
    await pollPresence();
    toast("已断开通话，自检只在本机进行；完成后请主动重新连接");
  }
  modal(
    "设备自检与本地预览",
    "此处不会建立音视频通话；画面与声音只在本机检测。",
    `<div class="device-layout"><div><video id="checkvideo" class="device-video" muted autoplay playsinline></video><p class="muted">请正对镜头，检查光线、取景与着装。建议使用耳机。</p><label class="field">选择摄像头<select id="camera-select"><option value="">默认摄像头</option></select></label>${btn("开启摄像头与麦克风", "start-devices", "primary full")}</div><div><div class="device-row"><b>摄像头 · 目标 1280 × 720</b><small id="camera-check">设备未开启</small></div><div class="device-row"><b>麦克风 · 请正常说一句话</b><div class="meter"><span id="mic-meter"></span></div><small id="mic-check">设备未开启</small></div><div class="device-row"><b>扬声器</b>${btn("播放测试声音", "speaker", "small")}<label class="check"><input id="speaker-heard" type="checkbox">我已听清测试声音</label></div><div class="device-row"><b>网络与安全环境</b><small id="network-check">正在检查…</small></div></div></div><div class="notice">预览画面仅本地显示。实际分辨率可核验；端到端预览延迟尚未专门测量，不把网络往返时间当作预览延迟。</div><details class="device-help"><summary>设备异常？按问题查看处理方法</summary><ol><li><b>权限被拒绝：</b>点击地址栏站点设置，允许摄像头和麦克风，再重试。</li><li><b>设备被占用：</b>关闭其他会议、相机应用或使用设备的网页，再开启。</li><li><b>设备未找到：</b>检查 USB 连接和系统输入设备设置；尝试重新插入。</li><li><b>局域网普通 HTTP：</b>使用运行说明中的可信 HTTPS 地址；本机可用 localhost。</li><li><b>声音没有输入：</b>取消系统静音并选择正确的输入设备；通话中还需检查麦克风开关。</li><li><b>他人听不到或看不到：</b>确认面试已开始、双方都点击连接音视频；必要时重新连接或私密联系主考官。</li></ol></details><div class="inline-error" id="device-error" role="alert"></div><div class="dialog-footer">${btn("关闭，返回房间", "close")}${appState.roomData.room.status === "waiting" ? btn("自检通过，确认就绪", "ready", "primary") : ""}</div>`,
  );
  attachLocal();
  await enumerateCameras();
  const t = performance.now();
  try {
    await api("/session");
    appState.networkOkay = true;
    if ($("#network-check"))
      $("#network-check").textContent =
        `服务器往返 ${Math.round(performance.now() - t)} ms · ${window.isSecureContext ? "安全环境可用" : "当前非安全环境，摄像头需要 HTTPS"}`;
  } catch {
    appState.networkOkay = false;
    if ($("#network-check"))
      $("#network-check").textContent = "网络未连接，请检查服务器";
  }
  if (appState.stream) updateDeviceReadouts();
}

export async function enumerateCameras() {
  if (!navigator.mediaDevices) return;
  try {
    const list = await navigator.mediaDevices.enumerateDevices(),
      select = $("#camera-select");
    if (select) {
      const current = appState.stream?.getVideoTracks()[0]?.getSettings().deviceId;
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

export async function acquireMedia(constraints) {
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

export async function startDevices(deviceId) {
  if (!appState.roomId || appState.roomData?.room.status === "ended") return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("摄像头需要 localhost 或可信 HTTPS 地址，请查看使用指南");
    return;
  }
  const captureRoom = appState.roomId;
  let errors = [];
  if (!appState.stream) appState.stream = new MediaStream();
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
    if (appState.roomId !== captureRoom || appState.roomData?.room.status === "ended") {
      video.getTracks().forEach((t) => t.stop());
      return;
    }
    const next = video.getVideoTracks()[0],
      old = appState.stream.getVideoTracks()[0];
    if (old) {
      appState.stream.removeTrack(old);
      old.stop();
    }
    appState.stream.addTrack(next);
    for (const { pc } of appState.peers.values()) {
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
  if (appState.roomId !== captureRoom || !appState.stream || appState.roomData?.room.status === "ended")
    return;
  if (!appState.stream.getAudioTracks().some((t) => t.readyState === "live"))
    try {
      const a = await acquireMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (appState.roomId !== captureRoom || appState.roomData?.room.status === "ended") {
        a.getTracks().forEach((t) => t.stop());
        return;
      }
      appState.stream.addTrack(a.getAudioTracks()[0]);
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

export function mediaError(e) {
  return (
    {
      PermissionTimeout:
        "授权等待超时。请查看地址栏的权限请求，允许后点击开启设备重试",
      NotAllowedError:
        "权限被拒绝。请打开地址栏站点设置，允许摄像头和麦克风后重试",
      NotFoundError: "未找到设备。请检查连接和系统输入设备设置，再点击开启设备",
      NotReadableError: "设备被占用。请关闭其他会议或相机应用，再点击开启设备",
      OverconstrainedError:
        "所选设备不可用。请切回默认摄像头，或重新插入设备后重试",
    }[e.name] || "开启失败，请检查设备连接"
  );
}

export async function meterStart() {
  cancelAnimationFrame(appState.meterRAF);
  if (!appState.stream?.getAudioTracks().length) return;
  if (appState.audioCtx) await appState.audioCtx.close().catch(() => {});
  appState.audioCtx = new AudioContext();
  await appState.audioCtx.resume();
  const source = appState.audioCtx.createMediaStreamSource(appState.stream),
    analyser = appState.audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  appState.micPeak = 0;
  function tick() {
    analyser.getByteTimeDomainData(data);
    const energy = Math.sqrt(
      data.reduce((a, v) => a + (v - 128) ** 2, 0) / data.length,
    );
    appState.micPeak = Math.max(appState.micPeak, energy);
    if ($("#mic-meter"))
      $("#mic-meter").style.width = Math.min(100, energy * 6) + "%";
    if ($("#mic-check"))
      $("#mic-check").textContent =
        appState.micPeak > 1 ? "已检测到声音输入" : "麦克风已打开，请说话以确认输入";
    if ($("#dialog").open) appState.meterRAF = requestAnimationFrame(tick);
  }
  tick();
}

export function updateDeviceReadouts() {
  updateMediaStatus();
  const track = appState.stream?.getVideoTracks()[0],
    settings = track?.getSettings();
  if ($("#camera-check"))
    $("#camera-check").textContent =
      track?.readyState === "live"
        ? `${settings.width} × ${settings.height} · ${settings.width >= 1280 && settings.height >= 720 ? "达到 720p" : "低于 720p，请更换设备或调整条件"}`
        : "设备未开启";
  if ($("#mic-check") && !appState.stream?.getAudioTracks().length)
    $("#mic-check").textContent = "设备未开启";
}

export async function speakerTest() {
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
  appState.speakerPlayed = true;
}

export async function readyDevices() {
  const v = appState.stream?.getVideoTracks()[0],
    a = appState.stream?.getAudioTracks()[0],
    s = v?.getSettings() || {};
  try {
    if (!appState.speakerPlayed || !$("#speaker-heard").checked)
      throw new Error("请播放测试音并确认已听清");
    if (appState.micPeak <= 1) throw new Error("尚未检测到有效声音，请对麦克风说话");
    await api(`/rooms/${appState.roomId}/ready`, "POST", {
      mode: "devices",
      camera: v?.readyState === "live",
      microphone: a?.readyState === "live",
      speaker: true,
      network: appState.networkOkay,
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

export async function switchCamera() {
  if (!navigator.mediaDevices) return toast("请使用 localhost 或可信 HTTPS");
  const list = (await navigator.mediaDevices.enumerateDevices()).filter(
    (x) => x.kind === "videoinput",
  );
  if (list.length < 2)
    return toast("只检测到一个摄像头，可接入外置摄像头后重试");
  const current = appState.stream?.getVideoTracks()[0]?.getSettings().deviceId,
    index = list.findIndex((x) => x.deviceId === current);
  await startDevices(list[(index + 1) % list.length].deviceId);
  toast("已切换摄像头");
}
