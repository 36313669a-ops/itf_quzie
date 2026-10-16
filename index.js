const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { randomInt } = require("crypto");

initializeApp();
const db = getDatabase();

async function requireAdmin(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "請先登入主持人帳號。");
  const snap = await db.ref(`admins/${uid}`).get();
  if (snap.val() !== true) throw new HttpsError("permission-denied", "此帳號沒有主持人權限。");
}
function code6() { return String(randomInt(100000, 1000000)); }
function validPlayerId(value) { return /^[a-f0-9]{32}$/.test(String(value || "")); }
function validCode(value) { return /^\d{6}$/.test(String(value || "")); }

// 主持人建立場次。公開資料只包含題目、選項、暱稱、分數及統計摘要。
// 正確答案與逐人作答紀錄放在 gamePrivate，前端規則禁止讀取。
exports.createGame = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const questionIds = Array.isArray(request.data?.questionIds) ? request.data.questionIds : [];
  if (!questionIds.length || questionIds.length > 100) {
    throw new HttpsError("invalid-argument", "請選擇 1–100 題。");
  }

  const publicQuestions = {};
  const privateQuestions = {};
  for (const id of questionIds) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new HttpsError("invalid-argument", "題目識別碼格式錯誤。");
    }
    const snap = await db.ref(`questions/${id}`).get();
    if (!snap.exists()) throw new HttpsError("not-found", `找不到題目：${id}`);
    const q = snap.val();
    if (!q || typeof q.text !== "string" || !Array.isArray(q.options) || q.options.length !== 4 ||
        !Number.isInteger(Number(q.correctIndex)) || Number(q.correctIndex) < 0 || Number(q.correctIndex) > 3) {
      throw new HttpsError("failed-precondition", `題目資料不完整：${id}`);
    }
    publicQuestions[id] = {
      text: q.text.slice(0, 1000),
      options: q.options.map(x => String(x).slice(0, 300)),
      duration: Math.min(120, Math.max(5, Number(q.duration) || 20)),
      points: Math.min(1000, Math.max(100, Number(q.points) || 1000))
    };
    privateQuestions[id] = { correctIndex: Number(q.correctIndex) };
  }

  let code;
  for (let attempt = 0; attempt < 20; attempt++) {
    code = code6();
    const exists = await db.ref(`games/${code}/public`).get();
    if (!exists.exists()) break;
    code = null;
  }
  if (!code) throw new HttpsError("resource-exhausted", "目前無法產生遊戲代碼，請再試一次。");

  const publicGame = {
    code,
    status: "lobby",
    currentIndex: -1,
    questionIds,
    questions: publicQuestions,
    createdAt: Date.now(),
    playerCount: 0,
    players: {},
    answerStats: {},
    questionStartedAt: null,
    questionEndedAt: null
  };
  const updates = {};
  updates[`games/${code}/public`] = publicGame;
  updates[`gamePrivate/${code}/questions`] = privateQuestions;
  await db.ref().update(updates);
  return { code };
});

// 民眾免登入加入。playerId 由瀏覽器產生並存於 localStorage，同一瀏覽器同場次重用。
exports.playerJoin = onCall(async (request) => {
  const code = String(request.data?.code || "").trim();
  const nickname = String(request.data?.nickname || "").trim().replace(/[<>]/g, "").slice(0, 18);
  const playerId = String(request.data?.playerId || "").trim().toLowerCase();
  if (!validCode(code) || !nickname || !validPlayerId(playerId)) {
    throw new HttpsError("invalid-argument", "請輸入正確代碼、暱稱，並重新加入。");
  }

  const publicRef = db.ref(`games/${code}/public`);
  const snap = await publicRef.get();
  if (!snap.exists() || snap.val().status === "finished") {
    throw new HttpsError("not-found", "找不到可加入的遊戲，或本場已結束。");
  }

  const privatePlayerRef = db.ref(`gamePrivate/${code}/players/${playerId}`);
  const existing = await privatePlayerRef.get();
  if (existing.exists()) {
    const saved = existing.val();
    return { playerId, code, nickname: saved.nickname };
  }

  const player = { nickname, score: 0, joinedAt: Date.now() };
  // Transaction ensures simultaneous join requests from the same browser count only once.
  const createTx = await privatePlayerRef.transaction(current => current === null ? player : undefined);
  if (!createTx.committed) {
    const saved = (await privatePlayerRef.get()).val();
    return { playerId, code, nickname: saved.nickname };
  }
  await publicRef.child(`players/${playerId}`).set({ nickname, score: 0 });
  await publicRef.child("playerCount").transaction(n => (Number(n) || 0) + 1);
  return { playerId, code, nickname };
});

exports.controlGame = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const code = String(request.data?.code || "");
  const action = String(request.data?.action || "");
  if (!validCode(code)) throw new HttpsError("invalid-argument", "遊戲代碼錯誤。");
  const gameRef = db.ref(`games/${code}/public`);
  const snap = await gameRef.get();
  if (!snap.exists()) throw new HttpsError("not-found", "找不到遊戲。");
  const game = snap.val();

  if (action === "start") {
    let idx = Number(game.currentIndex);
    if (idx < 0) idx = 0;
    if (idx >= game.questionIds.length) throw new HttpsError("failed-precondition", "沒有更多題目。");
    await gameRef.update({ status: "question", currentIndex: idx, questionStartedAt: Date.now(), questionEndedAt: null });
  } else if (action === "stop") {
    if (game.status !== "question") throw new HttpsError("failed-precondition", "目前沒有正在作答的題目。");
    await gameRef.update({ status: "results", questionEndedAt: Date.now() });
  } else if (action === "next") {
    const idx = Number(game.currentIndex) + 1;
    if (idx >= game.questionIds.length) {
      await gameRef.update({ status: "finished", questionEndedAt: Date.now() });
    } else {
      await gameRef.update({ status: "question", currentIndex: idx, questionStartedAt: Date.now(), questionEndedAt: null });
    }
  } else if (action === "finish") {
    await gameRef.update({ status: "finished", questionEndedAt: Date.now() });
  } else {
    throw new HttpsError("invalid-argument", "未知的操作。");
  }
  return { ok: true };
});

exports.submitAnswer = onCall(async (request) => {
  const code = String(request.data?.code || "");
  const playerId = String(request.data?.playerId || "").toLowerCase();
  const optionIndex = request.data?.optionIndex;
  if (!validCode(code) || !validPlayerId(playerId) || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
    throw new HttpsError("invalid-argument", "作答資料格式錯誤。");
  }

  const gameRef = db.ref(`games/${code}/public`);
  const snap = await gameRef.get();
  if (!snap.exists()) throw new HttpsError("not-found", "找不到遊戲。");
  const game = snap.val();
  if (game.status !== "question") throw new HttpsError("failed-precondition", "目前不是作答時間。");

  const qid = game.questionIds?.[game.currentIndex];
  const q = game.questions?.[qid];
  const privateQSnap = await db.ref(`gamePrivate/${code}/questions/${qid}`).get();
  const privateQ = privateQSnap.val();
  if (!q || !privateQ) throw new HttpsError("internal", "題目資料不存在。");
  const playerSnap = await db.ref(`gamePrivate/${code}/players/${playerId}`).get();
  if (!playerSnap.exists()) throw new HttpsError("permission-denied", "玩家尚未加入此場遊戲。");

  const durationMs = Number(q.duration || 20) * 1000;
  const elapsed = Date.now() - Number(game.questionStartedAt || 0);
  if (elapsed < 0 || elapsed > durationMs) throw new HttpsError("deadline-exceeded", "作答時間已結束。");

  const answerRef = db.ref(`gamePrivate/${code}/answers/${game.currentIndex}/${playerId}`);
  const correct = optionIndex === Number(privateQ.correctIndex);
  const remainingRatio = Math.max(0, 1 - elapsed / durationMs);
  const score = correct ? Math.round((Number(q.points) || 1000) * (0.5 + 0.5 * remainingRatio)) : 0;
  const result = { optionIndex, correct, score, submittedAt: Date.now(), elapsedMs: elapsed };
  const tx = await answerRef.transaction(current => current === null ? result : undefined);
  if (!tx.committed) throw new HttpsError("already-exists", "這一題已經作答，不能重複提交。");

  // Store per-player score privately, then publish only the score needed for leaderboard.
  const privateScoreTx = await db.ref(`gamePrivate/${code}/players/${playerId}/score`).transaction(n => (Number(n) || 0) + score);
  const totalScore = Number(privateScoreTx.snapshot.val()) || 0;
  await db.ref(`games/${code}/public/players/${playerId}/score`).set(totalScore);

  const statsRef = db.ref(`games/${code}/public/answerStats/${game.currentIndex}`);
  await statsRef.transaction(stats => {
    stats = stats || { answered: 0, correct: 0 };
    stats.answered = (Number(stats.answered) || 0) + 1;
    if (correct) stats.correct = (Number(stats.correct) || 0) + 1;
    return stats;
  });
  return { correct, score };
});
