// assets/app.js
const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const WAITLIST_LIMIT = 6;

const PSYCHO_LINES = [
  "「可能」唔係選項。請揀「出席 / 缺席」。 / “Maybe” is not an option. Please choose YES / NO.",
  "你揀「可能」= 未決定；隊伍唔會為你預留位。 / “Maybe” = undecided; no spot will be reserved.",
  "如果你想打，請直接揀「出席」；唔得就揀「缺席」。 / If you want to play, choose YES; otherwise choose NO.",
  "名額有限；「可能」會令安排更困難。 / Spots are limited; “Maybe” makes planning harder.",
  "肯定係好人，所以請揀 YES / NO。 / Be nice: choose YES / NO.",
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
  // No WAITLIST option anymore. YES will auto place into 候補 if over capacity.
  if(yes){
    const capFull = (remainingSeats!==null && remainingSeats<=0);
    const waitFull = (remainingWait!==null && remainingWait<=0);
    yes.disabled = capFull && waitFull;
  }
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
    <div>${esc(venue)} ｜ 上限：${cap||"-"} ｜ 候補上限：${WAITLIST_LIMIT}${note?` ｜ ${esc(note)}`:""}</div>
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

function allocateBucketsClient_(uniq, cap, waitLimit){
  const yes = uniq.filter(r=>String(r.status||"").toUpperCase()==="YES")
    .slice()
    .sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")));
  const no = uniq.filter(r=>String(r.status||"").toUpperCase()==="NO");

  let used=0, wused=0;
  const confirmed=[], waitlist=[], overflow=[];
  for(const r of yes){
    const pax=Number(r.pax||1)||1;
    if(cap>0 && used + pax <= cap){
      used += pax;
      confirmed.push(r);
    } else if(wused + pax <= waitLimit){
      wused += pax;
      waitlist.push(r);
    } else {
      overflow.push(r);
    }
  }
  return { confirmed, waitlist, overflow, totals:{ confirmedPax:used, waitlistPax:wused } };
}


function renderLists(rsvps){
  const uniq=dedupeLatestByName_(rsvps);

  const sess=sessions.find(x=>x.sessionId===currentSessionId)||{};
  const cap=Number(sess.capacity||0)||0;

  const buckets = allocateBucketsClient_(uniq, cap, WAITLIST_LIMIT);
  const confirmed = buckets.confirmed;
  const waitlist = buckets.waitlist;

  const yesSum = buckets.totals.confirmedPax;
  const wlSum = buckets.totals.waitlistPax;

  remainingSeats = cap ? Math.max(0, cap-yesSum) : null;
  remainingWait = Math.max(0, WAITLIST_LIMIT-wlSum);

  enforceRadioAvailability();

  el("summary").innerHTML = cap
    ? `<div class="small muted">名額：${yesSum}/${cap}（尚餘 ${Math.max(0, cap-yesSum)}）</div>`
    : `<div class="small muted">名額：不限</div>`;

  el("waitSummary").innerHTML =
    `<div class="small muted">候補：${wlSum}/${WAITLIST_LIMIT}（尚餘 ${Math.max(0, WAITLIST_LIMIT-wlSum)}）</div>`;

  el("list").innerHTML = confirmed.length
    ? confirmed.sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).map(r=>item(r,"CONFIRMED")).join("")
    : `<div class="muted">暫時未有人成功報名</div>`;

  el("waitList").innerHTML = waitlist.length
    ? waitlist.sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).map(r=>item(r,"WAITLIST")).join("")
    : `<div class="muted">暫時未有人進入候補</div>`;
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

function wireMaybeWarning_(){
  const radios = Array.from(document.querySelectorAll('input[name="status"]'));
  if(!radios.length) return;
  const onChange = ()=>{
    const status=document.querySelector('input[name="status"]:checked')?.value;
    if(status==="MAYBE"){
      setWarning(nextPsychoLine());
    }else{
      // do not erase other warnings caused by capacity checks; only clear if current warning is a psycho line
      const w=el("statusWarning");
      if(w && w.textContent && w.textContent.includes("Maybe")){
        setWarning("");
      }
    }
  };
  radios.forEach(r=>r.addEventListener("change", onChange));
}

async function init(){
  await loadSessions();
  await loadRsvps();

  document.querySelectorAll('input[name="status"]').forEach(r=>r.addEventListener("change",(e)=>{
    if(e.target.value==="MAYBE"){
      setWarning(nextPsychoLine());
      setMsg("提示：你揀咗「可能」，請改為「出席 / 缺席」。");
      setSubmitCooldown(MAYBE_COOLDOWN_MS);
    } else setWarning("");
  }));

  el("sessionSelect")?.addEventListener("change", async (e)=>{
    currentSessionId=e.target.value;
    const s=sessions.find(x=>x.sessionId===currentSessionId);
    if(s) renderSessionInfo(s);
    setWarning(""); setMsg("");
    await loadRsvps();
  });

  el("cancelBtn")?.addEventListener("click", async ()=>{
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

  el("rsvpForm")?.addEventListener("submit", async (e)=>{
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
        setMsg("「可能」唔係選項，請改為「出席 / 缺席」。 / “Maybe” is not an option. Please choose YES / NO.");
        setSubmitCooldown(MAYBE_COOLDOWN_MS);
        return;
      }
      const res=await apiPost({action:"rsvp", sessionId: currentSessionId, name, status, pax, note});
      if(!res?.ok){
        const err=String(res.error||"").toLowerCase();
        if(err.includes("full")){
          setMsg("名額及候補名單已滿 / Full (including waitlist).");
          setWarning("名額及候補名單已滿 / Full (including waitlist).");
        } else if(err.includes("waitlist")){
          setMsg(`候補已滿（最多 ${WAITLIST_LIMIT}）。`);
          setWarning(`候補已滿（最多 ${WAITLIST_LIMIT}）。`);
        } else setMsg(`提交失敗：${res.error||"未知錯誤"}`);
        await loadRsvps();
        return;
      }
      if(res.placement==="WAITLIST"){
        setMsg("名額已滿，你已進入候補名單。 / The session is full. You are placed on the waitlist.");
      } else if(res.placement==="CONFIRMED"){
        setMsg("你已成功報名。 / You are successfully registered.");
      } else {
        setMsg("已更新。 / Updated.");
      }
      setWarning("");
      await loadRsvps();
    }catch(err){ setMsg("提交失敗，請稍後再試。"); }
    finally{ btn.disabled=false; }
  });
}
init();
