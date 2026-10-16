import { auth, db, functions } from "./firebase.js";
import { $, message, escapeHtml } from "./common.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

let questions = {}, activeCode = null, unsubscribeGame = null, unsubscribeQuestions = null;
const createGameCall = httpsCallable(functions, "createGame");
const controlCall = httpsCallable(functions, "controlGame");

onAuthStateChanged(auth, async user => {
  $("#controlPanel").classList.add("hidden");
  if (unsubscribeQuestions) { unsubscribeQuestions(); unsubscribeQuestions = null; }
  if (!user) return;
  try {
    const adminSnap = await get(ref(db, `admins/${user.uid}`));
    if (adminSnap.val() !== true) {
      message($("#notice"), "此帳號尚未設定主持人權限，請聯絡系統管理者。", "error");
      await signOut(auth);
      return;
    }
    $("#controlPanel").classList.remove("hidden");
    unsubscribeQuestions = onValue(ref(db, "questions"), s => {
      questions = s.val() || {};
      const select = $("#quizSelect");
      select.innerHTML = Object.keys(questions).length
        ? `<option value="all">全部題目（${Object.keys(questions).length} 題）</option>`
        : '<option value="">請先至題庫管理新增題目</option>';
    });
  } catch (e) {
    message($("#notice"), "無法確認主持人權限，請檢查 Firebase 設定。", "error");
  }
});

$("#loginBtn").onclick = async () => {
  try { await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#password").value); message($("#notice"), "登入成功", "success"); }
  catch (e) { message($("#notice"), "登入失敗：" + e.message, "error"); }
};
$("#logoutBtn").onclick = () => signOut(auth);

$("#createGameBtn").onclick = async () => {
  const ids = Object.keys(questions);
  if (!ids.length) { message($("#gameInfo"), "請先建立題目。", "error"); return; }
  try {
    const result = await createGameCall({ questionIds: ids });
    activeCode = result.data.code;
    const displayUrl = `${location.origin}/display.html?code=${activeCode}`;
    const playerUrl = `${location.origin}/play.html?code=${activeCode}`;
    $("#activeCode").textContent = activeCode;
    $("#displayLink").href = displayUrl;
    $("#displayLink").textContent = `開啟投影畫面：${displayUrl}`;
    $("#playerLink").href = playerUrl;
    $("#playerLink").textContent = `玩家加入網址：${playerUrl}`;
    $("#startBtn").disabled = false; $("#stopBtn").disabled = false; $("#nextBtn").disabled = false;
    message($("#gameInfo"), `已建立場次！遊戲代碼：${activeCode}\n請開啟投影畫面顯示 QR Code，民眾也可輸入代碼加入。`, "success");
    if (unsubscribeGame) unsubscribeGame();
    unsubscribeGame = onValue(ref(db, `games/${activeCode}/public`), s => renderGame(s.val()));
  } catch (e) { message($("#gameInfo"), "建立失敗：" + e.message, "error"); }
};

function renderGame(g) {
  if (!g) return;
  $("#playerCount").textContent = g.playerCount || Object.keys(g.players || {}).length;
  $("#gameStatus").textContent = ({ lobby: "等待玩家", question: "作答中", results: "本題結束", finished: "遊戲結束" })[g.status] || g.status;
  const stats = g.answerStats?.[g.currentIndex] || { answered: 0, correct: 0 };
  $("#stats").textContent = `本題已作答 ${stats.answered || 0} 人｜答對 ${stats.correct || 0} 人｜答錯 ${(stats.answered || 0) - (stats.correct || 0)} 人`;
  const players = Object.entries(g.players || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => (b.score || 0) - (a.score || 0));
  $("#leaderboard").innerHTML = players.length
    ? `<table class="leaderboard"><thead><tr><th>排名</th><th>玩家</th><th>分數</th></tr></thead><tbody>${players.slice(0, 20).map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.nickname)}</td><td>${p.score || 0}</td></tr>`).join("")}</tbody></table>`
    : '<p class="muted">等待玩家加入。</p>';
}
async function control(action) {
  if (!activeCode) return;
  try { await controlCall({ code: activeCode, action }); message($("#controlNotice"), "操作成功。", "success"); }
  catch (e) { message($("#controlNotice"), "操作失敗：" + e.message, "error"); }
}
$("#startBtn").onclick = () => control("start");
$("#stopBtn").onclick = () => control("stop");
$("#nextBtn").onclick = () => control("next");
