import { db } from "./firebase.js";
import { $, escapeHtml, formatTime } from "./common.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const code = new URLSearchParams(location.search).get("code");
let latestGame = null;
$("#codeBadge").textContent = code ? `遊戲代碼 ${code}` : "等待遊戲";
$("#bigCode").textContent = code || "------";
const playerUrl = code ? `${location.origin}/play.html?code=${encodeURIComponent(code)}` : `${location.origin}/play.html`;
$("#joinUrl").innerHTML = `玩家加入網址：<a href="${playerUrl}">${playerUrl}</a><p class="muted">也可直接在玩家頁輸入六位數代碼。</p>`;
if (code && /^\d{6}$/.test(code)) {
  if (window.QRCode) new QRCode($("#qrcode"), { text: playerUrl, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  onValue(ref(db, `games/${code}/public`), snap => {
    const g = snap.val();
    if (!g) { $("#waiting").textContent = "找不到此遊戲，請確認代碼。"; return; }
    latestGame = g;
    $("#waiting").textContent = ({ lobby: "等待主持人開始第一題。", question: "玩家作答中……", results: "本題作答已結束。", finished: "遊戲結束，恭喜所有參與者！" })[g.status] || "";
    $("#joinBlock").classList.toggle("hidden", g.status !== "lobby");
    const qid = g.questionIds?.[g.currentIndex], q = g.questions?.[qid];
    $("#questionBlock").classList.toggle("hidden", !q || g.status === "lobby" || g.status === "finished");
    if (q) {
      $("#questionNo").textContent = `第 ${g.currentIndex + 1} 題`;
      $("#questionText").textContent = q.text;
      $("#displayOptions").innerHTML = (q.options || []).map((o, i) => `<div class="answer" style="cursor:default">${["A", "B", "C", "D"][i]}　${escapeHtml(o)}</div>`).join("");
      const stats = g.answerStats?.[g.currentIndex] || { answered: 0 };
      $("#answerCount").textContent = `已作答 ${stats.answered || 0} 人`;
      const endAt = Number(g.questionStartedAt || 0) + Number(q.duration || 20) * 1000;
      $("#timer").textContent = g.status === "question" ? formatTime(endAt - Date.now()) : "本題結束";
    }
    const players = Object.values(g.players || {}).sort((a, b) => (b.score || 0) - (a.score || 0));
    $("#leaderboard").innerHTML = players.length
      ? `<table class="leaderboard"><thead><tr><th>排名</th><th>玩家</th><th>分數</th></tr></thead><tbody>${players.slice(0, 10).map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.nickname)}</td><td>${p.score || 0}</td></tr>`).join("")}</tbody></table>`
      : '<p class="muted">等待玩家加入。</p>';
  }, error => { $("#waiting").textContent = "無法讀取遊戲資料，請確認 Firebase 設定。"; console.error(error); });
} else {
  $("#waiting").textContent = "請使用 /display.html?code=六位數代碼 開啟投影畫面。";
}
setInterval(() => {
  const g = latestGame;
  if (!g || g.status !== "question") return;
  const qid = g.questionIds?.[g.currentIndex], q = g.questions?.[qid];
  if (!q) return;
  const endAt = Number(g.questionStartedAt || 0) + Number(q.duration || 20) * 1000;
  $("#timer").textContent = formatTime(endAt - Date.now());
}, 250);
