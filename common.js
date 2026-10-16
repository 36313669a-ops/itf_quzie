export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];
export function message(el, text, kind = "") {
  if (!el) return;
  el.textContent = text;
  el.className = `notice ${kind}`.trim();
}
export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
export function formatTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function gameCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
