import { appState } from './state.js';

export function draftKey(type) {
  return "interview-draft-" + appState.user?.id + "-" + appState.roomId + "-" + type;
}

export function readDraft(type) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(type)));
  } catch {
    return null;
  }
}

export function saveDraft(type, value) {
  try {
    localStorage.setItem(draftKey(type), JSON.stringify(value));
  } catch {}
}

export function removeDraft(type) {
  try {
    localStorage.removeItem(draftKey(type));
  } catch {}
}
