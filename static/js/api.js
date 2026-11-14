import { appState } from './state.js';

export async function api(path, method = "GET", data) {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": appState.csrf },
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
