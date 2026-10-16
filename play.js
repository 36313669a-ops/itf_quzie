import { db, functions } from "./firebase.js";
import { $, message, escapeHtml, formatTime } from "./common.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const joinCall = httpsCallable(functions, "playerJoin");
const submitCall = httpsCallable(functions, "submitAnswer");
let code = null, playerId = null, nickname = null, answerSubmitted = false, lastIndex = -2, latestGame = null, unsubscribe = null;

const params = new URLSearchParams(location.search);
const presetCode = params.get("code");
if (presetCode && /^\d{6}$/.test(presetCode)) $("#gameCode").value = presetCode;

function getPlayerId(gameCode) {
  const key = `quizPlayerId_${gameCode}`;
  let id = localStorage.getItem(key);
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, "").toLowerCase();
    localStorage.setItem(key, id);
  }
  return id;
}
function hasAnswered(index) {
  return localStorage.getItem(`quizAnswered_${code}_${playerId}_${index}`) === "1";
}
function markAnswered(index) {
  localStorage.setItem(`quizAnswered_${code}_${playerId}_${index}`, "1");
}

async function joinGame() {
  code = $("#gameCode").value.trim();
  nickname = $("#nickname").value.trim();
  playerId = getPlayerId(code);
  if (!/^\d{6}$/.test(code) || !nickname) {
    message($("#joinNotice"), "請輸入六位數代碼與暱稱。", "error");
    return;
  }
  $("#joinBtn").disabled = true;
  try {
    const result = await joinCall({ code, nickname, playerId });
    playerId = result.data.playerId;
    nickname = result.data.nickname;
    localStorage.setItem(`quizNickname_${code}`, nickname);
    $("#joinCard").classList.add("hidden");
    $("#playCard").classList.remove("hidden");
    $("#playerBadge").textContent = nickname;
    if (unsubscribe) unsubscribe();
    unsubscribe = onValue(ref(db, `games/${code}/public`), snap => render(snap.val()), error => {
      message($("#playNotice"), "無法讀取遊戲狀態，請重新整理或聯絡工作人員。", "error");
      console.error(error);
    });
  } catch (e) {
    message($("#joinNotice"), "加入失敗：" + (e.message || "請確認遊戲代碼。"), "error");
  } finally {
    $("#joinBtn").disabled = false;
  }
}
$("#joinBtn").onclick = joinGame;

function render(g) {
  if (!g) return;
  latestGame = g;
  $("#playerScore").textContent = `${g.players?.[playerId]?.score || 0} 分`;
  const qid = g.questionIds?.[g.currentIndex], q = g.questions?.[qid];
  if (g.status === "finished") {
    $("#playQuestion").textContent = "遊戲結束！";
    $("#playOptions").innerHTML = "";
    message($("#playNotice"), `你的最終分數：${g.players?.[playerId]?.score || 0} 分`, "success");
    return;
  }
  if (!q || g.status === "lobby") {
    $("#playQuestion").textContent = "等待主持人開始……";
    $("#playTimer").textContent = "";
    $("#playOptions").innerHTML = "";
    message($("#playNotice"), "已加入，請等待主持人出題。");
    return;
  }
  if (lastIndex !== g.currentIndex) {
    lastIndex = g.currentIndex;
    answerSubmitted = hasAnswered(g.currentIndex);
  }
  $("#playQuestion").textContent = `第 ${g.currentIndex + 1} 題：${q.text}`;
  const endAt = Number(g.questionStartedAt || 0) + Number(q.duration || 20) * 1000;
  $("#playTimer").textContent = g.status === "question" ? formatTime(endAt - Date.now()) : "本題結束";
  const already = answerSubmitted || g.status !== "question" || Date.now() > endAt;
  $("#playOptions").innerHTML = (q.options || []).map((o, i) => `<button class="answer" data-option="${i}" ${already ? "disabled" : ""}>${["A", "B", "C", "D"][i]}　${escapeHtml(o)}</button>`).join("");
  $("#playOptions").querySelectorAll("button").forEach(btn => btn.onclick = async () => {
    if (answerSubmitted) return;
    answerSubmitted = true;
    [...$("#playOptions").querySelectorAll("button")].forEach(b => b.disabled = true);
    try {
      const res = await submitCall({ code, playerId, optionIndex: Number(btn.dataset.option) });
      markAnswered(g.currentIndex);
      message($("#playNotice"), res.data.correct ? `答對了！獲得 ${res.data.score} 分。` : "答案已送出，再接再厲！", res.data.correct ? "success" : "");
    } catch (e) {
      if (e.code === "functions/already-exists" || /已經作答|重複提交/.test(e.message || "")) {
        markAnswered(g.currentIndex);
        message($("#playNotice"), "這一題已經作答，請等待下一題。");
      } else {
        answerSubmitted = hasAnswered(g.currentIndex);
        message($("#playNotice"), "送出失敗：" + (e.message || "請稍後再試。"), "error");
        if (!answerSubmitted && g.status === "question" && Date.now() <= endAt) {
          $("#playOptions").querySelectorAll("button").forEach(b => b.disabled = false);
        }
      }
    }
  });
  if (g.status === "results") message($("#playNotice"), "本題已結束，等待下一題。");
  else if (already) message($("#playNotice"), "已送出答案或本題已停止作答。");
  else message($("#playNotice"), "請在時間內選擇一個答案。");
}

setInterval(() => {
  if (!latestGame || latestGame.status !== "question") return;
  const qid = latestGame.questionIds?.[latestGame.currentIndex], q = latestGame.questions?.[qid];
  if (!q) return;
  const endAt = Number(latestGame.questionStartedAt || 0) + Number(q.duration || 20) * 1000;
  $("#playTimer").textContent = formatTime(endAt - Date.now());
  if (Date.now() > endAt) $("#playOptions").querySelectorAll("button").forEach(b => b.disabled = true);
}, 250);
