import { auth, db } from "./firebase.js";
import { $, message, escapeHtml } from "./common.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { ref, onValue, push, set, remove, get } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

let questions = {}, unsubscribeQuestions = null;
const formValues = () => ({
  text: $("#questionText").value.trim(),
  options: [0,1,2,3].map(i => $(`#opt${i}`).value.trim()),
  correctIndex: Number($("#correct").value),
  duration: Math.min(120, Math.max(5, Number($("#duration").value) || 20)),
  points: Math.min(1000, Math.max(100, Number($("#points").value) || 1000))
});
function clearForm() { $("#qid").value=""; $("#questionText").value=""; [0,1,2,3].forEach(i=>$(`#opt${i}`).value=""); $("#correct").value="0"; $("#duration").value=20; $("#points").value=1000; }
function fillForm(id,q) { $("#qid").value=id; $("#questionText").value=q.text||""; [0,1,2,3].forEach(i=>$(`#opt${i}`).value=q.options?.[i]||""); $("#correct").value=q.correctIndex??0; $("#duration").value=q.duration||20; $("#points").value=q.points||1000; window.scrollTo({top:0,behavior:"smooth"}); }
function renderList() {
  const list=$("#questionList"), entries=Object.entries(questions);
  if(!entries.length){list.innerHTML='<p class="muted">目前還沒有題目，請先新增。</p>';return;}
  list.innerHTML=entries.map(([id,q],i)=>`<div class="question-item"><div><strong>${i+1}. ${escapeHtml(q.text)}</strong><div class="muted">${(q.options||[]).map(escapeHtml).join(" ／ ")} · ${q.duration||20} 秒</div></div><div class="row"><button class="btn secondary" data-edit="${id}">編輯</button><button class="btn danger" data-delete="${id}">刪除</button></div></div>`).join("");
  list.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>fillForm(b.dataset.edit,questions[b.dataset.edit]));
  list.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("確定刪除此題？")){await remove(ref(db,`questions/${b.dataset.delete}`));message($("#editorNotice"),"題目已刪除","success");}});
}
onAuthStateChanged(auth, async user=>{
  if (unsubscribeQuestions) { unsubscribeQuestions(); unsubscribeQuestions=null; }
  $("#authCard").classList.toggle("hidden",!!user);
  $("#editor").classList.add("hidden");
  if(!user) return;
  try {
    const adminSnap = await get(ref(db,`admins/${user.uid}`));
    if(adminSnap.val() !== true){message($("#authNotice"),"此帳號尚未設定管理員權限。","error");await signOut(auth);return;}
    $("#editor").classList.remove("hidden");
    unsubscribeQuestions = onValue(ref(db,"questions"),s=>{questions=s.val()||{};renderList();});
  } catch(e) { message($("#authNotice"),"無法確認管理員權限，請檢查 Firebase 設定。","error"); }
});
$("#loginBtn").onclick=async()=>{try{await signInWithEmailAndPassword(auth,$("#email").value.trim(),$("#password").value);message($("#authNotice"),"登入成功","success");}catch(e){message($("#authNotice"),"登入失敗："+e.message,"error");}};
$("#logoutBtn").onclick=()=>signOut(auth);
$("#newBtn").onclick=clearForm; $("#clearBtn").onclick=clearForm;
$("#saveBtn").onclick=async()=>{
  const q=formValues();
  if(!q.text||q.options.some(x=>!x)){message($("#editorNotice"),"請填寫題目及四個選項。","error");return;}
  try{const id=$("#qid").value||push(ref(db,"questions")).key;await set(ref(db,`questions/${id}`),q);clearForm();message($("#editorNotice"),"題目已儲存。","success");}
  catch(e){message($("#editorNotice"),"儲存失敗："+e.message,"error");}
};
