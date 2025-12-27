// assets/app.js
const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const WAITLIST_LIMIT = 6;

const PSYCHO_LINES = [
  "「可能」唔係選項。請揀「出席 / 後補 / 缺席」。",
  "你揀「可能」= 令我哋難分隊、難訂場。拜託揀 YES / WAITLIST / NO。",
  "系統已偵測到猶豫（講笑）。請改返 YES / WAITLIST / NO。",
  "「可能」會令統計崩潰。你肯定係好人，所以請揀 YES / WAITLIST / NO。",
];
const MAYBE_COOLDOWN_MS = 900;

const el = (id)=>document.getElementById(id);
let sessions = [];
let currentSessionId = null;
let psychoIdx = 0;
let remainingSeats = null;
let remainingWait = null;

function esc(s="") {
  return String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function normalizeDateYYYYMMDD(v){
  const s=String(v||"").trim();
  if(!s) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d=new Date(s);
  if(!isNaN(d.getTime())){
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${dd}`;
  }
  return s;
}
function normalizeTimeHHMM(v){
  const s=String(v||"").trim();
  if(!s) return "";
  const m1=s.match(/^(\d{1,2}):(\d{2})$/);
  if(m1) return `${m1[1].padStart(2,"0")}:${m1[2]}`;
  const d=new Date(s);
  if(!isNaN(d.getTime())) return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  const m2=s.match(/(\d{1,2}):(\d{2})/);
  if(m2) return `${m2[1].padStart(2,"0")}:${m2[2]}`;
  return s;
}
async function apiGet(params){
  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("GET failed");
  return res.json();
}
async function apiPost(payload){
  const res = await fetch(API_BASE,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify(payload)
  });
  if(!res.ok) throw new Error("POST failed");
  return res.json();
}
function setMsg(t){ el("msg").textContent = t||""; }
function setWarning(t){
  const w=el("statusWarning");
  if(!t){ w.style.display="none"; w.textContent=""; return; }
  w.style.display="block"; w.textContent=t;
}
function nextPsychoLine(){
  const line=PSYCHO_LINES[psychoIdx % PSYCHO_LINES.length];
  psychoIdx += 1;
  return line;
}
function setSubmitCooldown(ms){
  const btn=el("submitBtn");
  btn.disabled=true;
  window.setTimeout(()=>btn.disabled=false, ms);
}
function enforceRadioAvailability(){
  const yes=document.querySelector('input[name="status"][value="YES"]');
  const wl=document.querySelector('input[name="status"][value="WAITLIST"]');
  if(yes) yes.disabled = (remainingSeats !== null && remainingSeats <= 0);
  if(wl) wl.disabled = (remainingWait !== null && remainingWait <= 0);
}
function parseSessionStartMs_(s){
  const date=normalizeDateYYYYMMDD(s.date);
  const start=normalizeTimeHHMM(s.start);
  const dm=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm=start.match(/^(\d{2}):(\d{2})$/);
  if(!dm||!tm) return NaN;
  return new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2]),0,0).getTime();
}
function pickClosestOpenSessionId_(){
  const now=Date.now();
  const open=sessions.filter(s=>!!s.isOpen);
  if(!open.length) return "";
  const sorted=open.map(s=>({s,ms:parseSessionStartMs_(s)})).filter(x=>!isNaN(x.ms)).sort((a,b)=>a.ms-b.ms);
  if(!sorted.length) return open[0].sessionId;
  const upcoming=sorted.find(x=>x.ms>=now);
  return (upcoming?upcoming.s.sessionId:sorted[sorted.length-1].s.sessionId) || "";
}
function renderSessionInfo(s){
  const date=normalizeDateYYYYMMDD(s.date);
  const start=normalizeTimeHHMM(s.start);
  const end=normalizeTimeHHMM(s.end);
  const cap=Number(s.capacity||0)||0;
  const venue=String(s.venue||"").trim();
  const note=String(s.note||"").trim();
  el("sessionInfo").innerHTML = `
    <div><b>${esc(s.title||"Badminton")}</b></div>
    <div>${esc(date)} ${esc(start)}-${esc(end)}</div>
    <div>${esc(venue)} ｜ 上限：${cap||"-"} ｜ 後補上限：${WAITLIST_LIMIT}${note?` ｜ ${esc(note)}`:""}</div>
  `;
}
function dedupeLatestByName_(rsvps){
  const by=new Map();
  for(const r of (rsvps||[])){
    const k=String(r.name||"").trim().toLowerCase();
    if(!k) continue;
    by.set(k,r);
  }
  return Array.from(by.values());
}
function renderLists(rsvps){
  const uniq=dedupeLatestByName_(rsvps);
  const yes=uniq.filter(r=>String(r.status||"").toUpperCase()==="YES");
  const wl=uniq.filter(r=>String(r.status||"").toUpperCase()==="WAITLIST");

  const yesSum=yes.reduce((s,r)=>s+(Number(r.pax)||1),0);
  const wlSum=wl.reduce((s,r)=>s+(Number(r.pax)||1),0);

  const sess=sessions.find(x=>x.sessionId===currentSessionId)||{};
  const cap=Number(sess.capacity||0)||0;

  remainingSeats = cap ? Math.max(0, cap-yesSum) : null;
  remainingWait = Math.max(0, WAITLIST_LIMIT-wlSum);
  enforceRadioAvailability();

  el("summary").innerHTML = cap
    ? `出席：<b>${yesSum}</b> / ${cap} ｜ 尚餘名額：<b>${remainingSeats}</b>`
    : `出席：<b>${yesSum}</b>`;
  el("waitSummary").innerHTML = `後補：<b>${wlSum}</b> / ${WAITLIST_LIMIT} ｜ 尚餘後補：<b>${remainingWait}</b>`;

  const item=(r,tag)=> {
    const name=esc(r.name||"");
    const pax=Number(r.pax)||1;
    const note=String(r.note||"").trim();
    return `
      <div class="item">
        <b>${name}</b>（${pax}）${tag?` <span class="badge">${tag}</span>`:""}
        ${note?`<div class="muted">${esc(note)}</div>`:""}
      </div>`;
  };

  el("list").innerHTML = yes.length
    ? yes.sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).map(r=>item(r,"")).join("")
    : `<div class="muted">暫時未有人出席</div>`;

  el("waitList").innerHTML = wl.length
    ? wl.sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).map(r=>item(r,"WAITLIST")).join("")
    : `<div class="muted">暫時未有人後補</div>`;
}
async function loadSessions(){
  const data=await apiGet({action:"sessions"});
  sessions=data.sessions||[];
  const open=sessions.filter(s=>!!s.isOpen);
  const sel=el("sessionSelect");
  sel.innerHTML="";
  if(!open.length){
    const opt=document.createElement("option");
    opt.value=""; opt.textContent="暫時無開放場次 / No open session";
    sel.appendChild(opt);
    currentSessionId=null;
    el("sessionInfo").textContent="";
    return;
  }
  open.sort((a,b)=> normalizeDateYYYYMMDD(a.date).localeCompare(normalizeDateYYYYMMDD(b.date)) ||
                    normalizeTimeHHMM(a.start).localeCompare(normalizeTimeHHMM(b.start)));
  for(const s of open){
    const opt=document.createElement("option");
    opt.value=s.sessionId;
    opt.textContent=`${normalizeDateYYYYMMDD(s.date)} ${normalizeTimeHHMM(s.start)}-${normalizeTimeHHMM(s.end)} · ${s.venue}`;
    sel.appendChild(opt);
  }
  const pick=pickClosestOpenSessionId_();
  if(pick) sel.value=pick;
  currentSessionId=sel.value;
  const s=sessions.find(x=>x.sessionId===currentSessionId);
  if(s) renderSessionInfo(s);
}
async function loadRsvps(){
  if(!currentSessionId){
    el("list").innerHTML=`<div class="muted">未有開放場次</div>`;
    el("waitList").innerHTML="";
    el("summary").textContent="";
    el("waitSummary").textContent="";
    return;
  }
  const data=await apiGet({action:"list", sessionId: currentSessionId});
  renderLists(data.rsvps||[]);
}
async function init(){
  await loadSessions();
  await loadRsvps();

  document.querySelectorAll('input[name="status"]').forEach(r=>r.addEventListener("change",(e)=>{
    if(e.target.value==="MAYBE"){
      setWarning(nextPsychoLine());
      setMsg("提示：你揀咗「可能」，請改為「出席 / 後補 / 缺席」。");
      setSubmitCooldown(MAYBE_COOLDOWN_MS);
    } else setWarning("");
  }));

  el("sessionSelect").addEventListener("change", async (e)=>{
    currentSessionId=e.target.value;
    const s=sessions.find(x=>x.sessionId===currentSessionId);
    if(s) renderSessionInfo(s);
    setWarning(""); setMsg("");
    await loadRsvps();
  });

  el("cancelBtn").addEventListener("click", async ()=>{
    try{
      setMsg("");
      if(!currentSessionId){ setMsg("暫時未有開放場次。"); return; }
      const name=el("name").value.trim();
      if(!name){ setMsg("請先填姓名 / 暱稱。"); return; }
      const res=await apiPost({action:"rsvp", sessionId: currentSessionId, name, status:"NO", pax:1, note:(el("note").value||"").trim()||"Cancelled"});
      if(!res?.ok){ setMsg(`取消失敗：${res?.error||"未知錯誤"}`); return; }
      setMsg("已取消（已更新為 NO）。 / Cancelled (set to NO).");
      await loadRsvps();
    }catch(e){ setMsg("取消失敗，請稍後再試。"); }
  });

  el("rsvpForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    setMsg("");
    const btn=el("submitBtn"); btn.disabled=true;
    try{
      if(!currentSessionId){ setMsg("暫時未有開放場次。"); return; }
      const name=el("name").value.trim();
      const pax=Number(el("pax").value||1)||1;
      const note=el("note").value.trim();
      const status=document.querySelector('input[name="status"]:checked')?.value;
      if(!name){ setMsg("請填寫姓名 / 暱稱。"); return; }
      if(status==="MAYBE"){
        setWarning(nextPsychoLine());
        setMsg("「可能」唔係選項，請改為「出席 / 後補 / 缺席」。");
        setSubmitCooldown(MAYBE_COOLDOWN_MS);
        return;
      }
      const res=await apiPost({action:"rsvp", sessionId: currentSessionId, name, status, pax, note});
      if(!res?.ok){
        const err=String(res.error||"").toLowerCase();
        if(err.includes("capacity")){
          setMsg("已滿額 / Full. 如要出席可改揀「後補」。");
          setWarning("已滿額 / Full. 可選後補。");
        } else if(err.includes("waitlist")){
          setMsg(`後補已滿（最多 ${WAITLIST_LIMIT}）。`);
          setWarning(`後補已滿（最多 ${WAITLIST_LIMIT}）。`);
        } else setMsg(`提交失敗：${res.error||"未知錯誤"}`);
        await loadRsvps();
        return;
      }
      setMsg("已提交。");
      setWarning("");
      await loadRsvps();
    }catch(err){ setMsg("提交失敗，請稍後再試。"); }
    finally{ btn.disabled=false; }
  });
}
init();
