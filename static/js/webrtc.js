import { $, btn, toast } from './ui.js';
import { appState } from './state.js';
import { deviceDialog } from './devices.js';
import { showOffline, updateMediaStatus } from './rooms.js';
import { api } from './api.js';

export async function connectCall() {
  if (appState.callActive) {
    stopCall();
    await pollPresence();
    return;
  }
  if (appState.roomData.room.status !== "active")
    return toast("请等待主考官正式开始面试");
  if (!appState.stream?.getVideoTracks().length || !appState.stream?.getAudioTracks().length) {
    await deviceDialog();
    return toast("先完成本地设备检查，再主动连接音视频");
  }
  if (
    !appState.stream?.getVideoTracks().some((t) => t.readyState === "live") ||
    !appState.stream?.getAudioTracks().some((t) => t.readyState === "live")
  )
    return toast("请先成功开启摄像头与麦克风");
  appState.callActive = true;
  appState.hadCall = true;
  $("#media-status").textContent =
    "通话连接中 · 将向本房间已连接成员发送音视频";
  $("#connect-btn").textContent = "断开音视频";
  await pollPresence();
}

export function stopCall() {
  appState.callActive = false;
  for (const state of appState.peers.values()) {
    clearTimeout(state.retry);
    state.pc.close();
  }
  appState.peers.clear();
  for (const v of document.querySelectorAll("#videos video"))
    if (v.closest("[data-tile]")?.dataset.tile !== String(appState.user?.id))
      v.srcObject = null;
  if ($("#media-status"))
    $("#media-status").textContent = "未连接通话 · 本地预览不会自动发送";
  if ($("#connect-btn")) $("#connect-btn").textContent = "连接音视频";
  updateMediaStatus();
}

export async function sendSignal(receiver, payload) {
  return api(`/rooms/${appState.roomId}/signal`, "POST", {
    sender: appState.clientId,
    receiver,
    payload,
  });
}

export function getPeer(peer) {
  if (appState.peers.has(peer.client_id)) return appState.peers.get(peer.client_id);
  const pc = new RTCPeerConnection({ iceServers: [] }),
    state = { pc, peer, pending: [] };
  appState.peers.set(peer.client_id, state);
  for (const t of appState.stream.getTracks()) pc.addTrack(t, appState.stream);
  pc.onicecandidate = (e) => {
    if (e.candidate && appState.callActive)
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
    updateMediaStatus();
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      showOffline(
        new Error("音视频连接中断，正在尝试恢复；必要时请主考官暂停计时"),
      );
      clearTimeout(state.retry);
      state.retry = setTimeout(() => {
        if (
          appState.callActive &&
          appState.peers.get(peer.client_id) === state &&
          pc.connectionState !== "connected"
        ) {
          pc.close();
          appState.peers.delete(peer.client_id);
          pollPresence();
        }
      }, 4000);
    }
  };
  return state;
}

export async function pollPresence() {
  if (appState.pollBusy || !appState.roomId || appState.user?.role === "admin") return;
  appState.pollBusy = true;
  const rid = appState.roomId;
  try {
    const d = await api(`/rooms/${rid}/presence`, "POST", {
      client: appState.clientId,
      media: appState.callActive,
      after: appState.signalCursor,
    });
    if (appState.roomId !== rid) return;
    appState.seenPeers = d.peers;
    appState.pollErrors = 0;
    const live = new Set(
      d.peers.filter((p) => p.media).map((p) => p.client_id),
    );
    for (const [id, state] of appState.peers)
      if (!live.has(id)) {
        state.pc.close();
        appState.peers.delete(id);
        const v = $(`[data-tile="${state.peer.user_id}"] video`);
        if (v) v.srcObject = null;
      }
    if (appState.callActive) {
      for (const p of d.peers.filter((p) => p.media && p.user_id !== appState.user.id)) {
        if (!appState.peers.has(p.client_id)) {
          const st = getPeer(p);
          if (appState.clientId < p.client_id) {
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
      appState.signalCursor = Math.max(appState.signalCursor, item.id);
  } catch (e) {
    appState.pollErrors++;
    if (appState.pollErrors >= 3)
      showOffline(
        new Error("网络连接失败，正在重试。请检查局域网或联系主考官"),
      );
  } finally {
    appState.pollBusy = false;
    updateMediaStatus();
  }
}
