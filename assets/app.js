const API_BASE = "https://script.google.com/macros/s/AKfycby6BM-TP-4EnP7usmJigxuUrWtsTeWw83oRYPHQPXhfIsRmLjhbisIMeVNOngQkr9uG/exec"; // .../exec
const WAITLIST_LIMIT = 6;

const PSYCHO_LINES = [
  "你揀『可能』，其實即係你唔想負責任。改返『出席 / 缺席』啦。",
  "『可能』係最貴嘅答案：佢令其他人唔敢報。你確定要咁做？",
  "你而家揀『可能』，未來你都可能唔出現。改返『出席 / 缺席』先啦。",
  "『可能』唔係選項。你只係想拖延決定。請揀『出席 / 缺席』。"
];
let psychoIdx = 0;

let sessions = [];
let currentSessionId = null;

function el(id){ return document.getElementById(id); }
function showMsg(t){
  const m = el("msg");
  m.textContent = t || "";
  m.classList.toggle("show", !!t);
}
function showMaybe(t){
  const w = el("maybeWarning");
  if(t){ w.style.display=""; w.textContent=t; }
  else { w.style.display="none"; w.textContent=""; }
}
function nextPsycho(){ const t=PSYCHO_LINES[psychoIdx%PSYCHO_LINES.length]; psychoIdx++; return t; }

function normalizeDate(s){ return (String(s||"").match(/\d{4}-\d{2}-\d{2}/) ? String(s).slice(0,10) : String(s||"")); }
function normalizeTime(s){
  const m=String(s||"").match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2,"0")}:${m[2]}` : String(s||"");
}

async function apiGet(params){
  const url = new URL(API_BASE);
  Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const r = await fetch(url.toString(), { method:"GET" });
  return await r.json();
}
async function apiPost(body){
  const r = await fetch(API_BASE, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body||{})
  });
  return await r.json();
}

function pickClosestOpenSessionId(){
  const open = sessions.filter(s=>!!s.isOpen);
  if(!open.length) return null;
  const now = new Date();
  const dt = (s)=> new Date(`${normalizeDate(s.date)}T${normalizeTime(s.start)}:00`);
  open.sort((a,b)=> dt(a)-dt(b));
  for(const s of open){ if(dt(s) >= now) return s.sessionId; }
  return open[open.length-1].sessionId;
}

function renderSessionMeta(s){
  el("sessionMeta").textContent =
    `🗓️ ${normalizeDate(s.date)} (Sun) ${normalizeTime(s.start)}-${normalizeTime(s.end)} · 📍 ${s.venue} · CAP ${Number(s.capacity||0)||0}`;
}

function renderSummary(summary, session){
  const cap = Number(session.capacity||0)||0;
  const yes = Number(summary.confirmedPax||0)||0;
  const wait = Number(summary.waitlistPax||0)||0;

  el("sumYes").textContent = `${yes}/${cap}（剩餘 ${Math.max(0,cap-yes)}）`;
  el("sumWait").textContent = `${wait}/${WAITLIST_LIMIT}（剩餘 ${Math.max(0,WAITLIST_LIMIT-wait)}）`;

  el("yesRemain").textContent = `名額：${yes}/${cap}（尚餘 ${Math.max(0,cap-yes)}）`;
  el("waitRemain").textContent = `候補：${wait}/${WAITLIST_LIMIT}（尚餘 ${Math.max(0,WAITLIST_LIMIT-wait)}）`;
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function renderLists(current){
  const yesBox = el("yesList");
  const waitBox = el("waitList");
  yesBox.innerHTML = "";
  waitBox.innerHTML = "";

  const confirmed = current.filter(x=>x.status==="YES" && x.placement==="CONFIRMED");
  const wait = current.filter(x=>x.status==="YES" && x.placement==="WAITLIST");

  const item = (x)=> {
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `
      <div class="left">
        <div><strong>${escapeHtml(x.name||"")}</strong> <span class="badge">${Number(x.pax||1)} pax</span></div>
        <div class="muted small">${escapeHtml(x.note||"")}</div>
      </div>
      <div class="right">
        ${x.placement==="CONFIRMED" ? '<span class="badge ok">成功報名</span>' : '<span class="badge warn">候補</span>'}
      </div>`;
    return div;
  };

  confirmed.forEach(x=>yesBox.appendChild(item(x)));
  wait.forEach(x=>waitBox.appendChild(item(x)));

  if(!confirmed.length) yesBox.innerHTML = '<div class="muted small">暫時無人報名</div>';
  if(!wait.length) waitBox.innerHTML = '<div class="muted small">暫時無候補</div>';
}

async function loadSessions(){
  if(!API_BASE || API_BASE.includes("PASTE_YOUR")) throw new Error("API_BASE 未設定");
  const data = await apiGet({ action:"sessions" });
  if(!data.ok) throw new Error(data.error||"load sessions failed");
  sessions = data.sessions || [];

  const open = sessions.filter(s=>!!s.isOpen);
  const sel = el("sessionSelect");
  sel.innerHTML = "";

  if(!open.length){
    const opt=document.createElement("option");
    opt.value=""; opt.textContent="暫時無開放場次 / No open session";
    sel.appendChild(opt);
    currentSessionId=null;
    el("sessionMeta").textContent="";
    return;
  }

  open.sort((a,b)=> (normalizeDate(a.date)+normalizeTime(a.start)).localeCompare(normalizeDate(b.date)+normalizeTime(b.start)));
  for(const s of open){
    const opt=document.createElement("option");
    opt.value=s.sessionId;
    opt.textContent=`${normalizeDate(s.date)} ${normalizeTime(s.start)}-${normalizeTime(s.end)} · ${s.venue}`;
    sel.appendChild(opt);
  }

  const pick = pickClosestOpenSessionId();
  if(pick) sel.value = pick;
  currentSessionId = sel.value;
  const s = sessions.find(x=>x.sessionId===currentSessionId);
  if(s) renderSessionMeta(s);
}

async function loadRsvps(){
  if(!currentSessionId) return;
  const data = await apiGet({ action:"list", sessionId: currentSessionId });
  if(!data.ok) throw new Error(data.error||"load list failed");

  const s = sessions.find(x=>x.sessionId===currentSessionId);
  if(s) renderSummary(data.summary||{}, s);
  renderLists(data.current||[]);
}

function bindMaybeOnly(){
  document.querySelectorAll('input[name="status"]').forEach(r=>{
    r.addEventListener("change", ()=>{
      const v = document.querySelector('input[name="status"]:checked')?.value;
      if(v==="MAYBE"){
        showMaybe(nextPsycho());
        showMsg("「可能」唔係選項，請改為「出席 / 缺席」。 / “Maybe” is not an option. Please choose YES / NO.");
      }else{
        showMaybe("");
      }
    });
  });
}

async function init(){
  try{
    bindMaybeOnly();

    el("sessionSelect").addEventListener("change", async (e)=>{
      currentSessionId = e.target.value;
      const s = sessions.find(x=>x.sessionId===currentSessionId);
      if(s) renderSessionMeta(s);
      showMsg("");
      await loadRsvps();
    });

    el("cancelBtn").addEventListener("click", async ()=>{
      try{
        showMsg("");
        const name = el("name").value.trim();
        if(!name){ showMsg("請先填姓名 / Name。"); return; }
        if(!currentSessionId){ showMsg("暫時未有開放場次。"); return; }
        const res = await apiPost({ action:"rsvp", sessionId: currentSessionId, name, status:"NO", pax:1, note:"Cancelled" });
        if(!res.ok){ showMsg(res.error||"取消失敗"); return; }
        showMsg("已取消（已更新為 NO）。 / Cancelled (set to NO).");
        await loadRsvps();
      }catch(_){ showMsg("取消失敗"); }
    });

    el("rsvpForm").addEventListener("submit", async (e)=>{
      e.preventDefault();
      showMsg("");

      const btn = el("submitBtn");
      btn.disabled = true;

      try{
        if(!currentSessionId){ showMsg("暫時未有開放場次。"); return; }

        const name = el("name").value.trim();
        const pax = Number(el("pax").value||1)||1;
        const note = el("note").value.trim();
        const status = document.querySelector('input[name="status"]:checked')?.value;

        if(!name){ showMsg("請填寫姓名 / Name。"); return; }

        // MAYBE: no API call, warning only
        if(status==="MAYBE"){
          showMaybe(nextPsycho());
          showMsg("「可能」唔係選項，請改為「出席 / 缺席」。 / “Maybe” is not an option. Please choose YES / NO.");
          return;
        }

        const res = await apiPost({ action:"rsvp", sessionId: currentSessionId, name, status, pax, note });
        if(!res.ok){
          showMsg(`提交失敗：${res.error||"未知錯誤"}`);
          await loadRsvps();
          return;
        }

        if(res.placement==="WAITLIST"){
          showMsg("名額已滿，你已進入候補名單。 / The session is full. You are placed on the waitlist.");
        }else if(res.placement==="CONFIRMED"){
          showMsg("你已成功報名。 / You are successfully registered.");
        }else{
          showMsg("已更新。 / Updated.");
        }
        showMaybe("");
        await loadRsvps();
      }catch(_){
        showMsg("提交失敗，請稍後再試。");
      }finally{
        btn.disabled = false;
      }
    });

    await loadSessions();
    await loadRsvps();
  }catch(e){
    showMsg(e.message||String(e));
  }
}
init();
