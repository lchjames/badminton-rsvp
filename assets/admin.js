// assets/admin.js
const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const WAITLIST_LIMIT = 6;

const el=(id)=>document.getElementById(id);
let sessions=[];

async function apiGet(params){
  const url=`${API_BASE}?${new URLSearchParams(params).toString()}`;
  const res=await fetch(url);
  if(!res.ok) throw new Error("GET failed");
  return res.json();
}
async function apiPost(payload){
  const res=await fetch(API_BASE,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload)});
  if(!res.ok) throw new Error("POST failed");
  return res.json();
}
function setMsg(id,t){ el(id).textContent=t||""; }
function key(){ return el("adminKey").value.trim(); }
function ensureKey(){ const k=key(); if(!k) throw new Error("請輸入 Admin Key"); return k; }

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
function esc(s=""){ return String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }

function fillSessionSelects(){
  const rsvpSel=el("rsvpSession");
  rsvpSel.innerHTML="";
  sessions.slice().sort((a,b)=>normalizeDateYYYYMMDD(a.date).localeCompare(normalizeDateYYYYMMDD(b.date)))
    .forEach(s=>{
      const opt=document.createElement("option");
      opt.value=s.sessionId;
      opt.textContent=`${normalizeDateYYYYMMDD(s.date)} ${normalizeTimeHHMM(s.start)} · ${s.venue}${s.isOpen?" · OPEN":""}`;
      rsvpSel.appendChild(opt);
    });
}

function fillAnnounceSelects_(){
  const a=document.getElementById("announceSession");
  if(!a) return;
  a.innerHTML="";
  const list = sessions.slice().sort((x,y)=>normalizeDateYYYYMMDD(x.date).localeCompare(normalizeDateYYYYMMDD(y.date)) || normalizeTimeHHMM(x.start).localeCompare(normalizeTimeHHMM(y.start)));
  for(const s of list){
    const opt=document.createElement("option");
    opt.value=s.sessionId;
    opt.textContent=`${normalizeDateYYYYMMDD(s.date)} ${normalizeTimeHHMM(s.start)} · ${s.venue}${s.isOpen?" · OPEN":""}`;
    a.appendChild(opt);
  }
  const pick = pickClosestOpenSessionIdAdmin_();
  if(pick) a.value = pick;
}

function renderSessionsTable(){
  const showClosed=el("showClosed").checked;
  const view=sessions.filter(s=>showClosed?true:!!s.isOpen);
  if(!view.length){ el("sessionsTable").innerHTML=`<div class="muted">暫時無場次</div>`; return; }
  el("sessionsTable").innerHTML=`
    <div class="table">
      <div class="tr th small">
        <div>ID</div><div>Date</div><div>Time</div><div>Venue</div><div>Cap</div><div>Open</div><div>Note</div><div>Actions</div>
      </div>
      ${view.map(s=>`
        <div class="tr small" data-sid="${esc(s.sessionId)}">
          <div class="cell"><span class="badge">${esc(s.sessionId)}</span></div>
          <div class="cell"><input data-f="date" value="${esc(normalizeDateYYYYMMDD(s.date))}"></div>
          <div class="cell"><div class="row" style="gap:6px;">
            <input data-f="start" value="${esc(normalizeTimeHHMM(s.start))}">
            <input data-f="end" value="${esc(normalizeTimeHHMM(s.end))}">
          </div></div>
          <div class="cell"><input data-f="venue" value="${esc(s.venue||"")}"></div>
          <div class="cell"><input data-f="capacity" type="number" min="1" value="${Number(s.capacity||20)||20}"></div>
          <div class="cell"><select data-f="isOpen">
            <option value="TRUE" ${s.isOpen?"selected":""}>TRUE</option>
            <option value="FALSE" ${!s.isOpen?"selected":""}>FALSE</option>
          </select></div>
          <div class="cell"><input data-f="note" value="${esc(s.note||"")}"></div>
          <div class="cell"><div class="actions">
            <button data-act="save">儲存</button>
            <button class="alt" data-act="openOnly">唯一開放</button>
            <button class="danger" data-act="delete">刪除</button>
          </div></div>
        </div>
      `).join("")}
    </div>
  `;
  document.querySelectorAll("[data-sid]").forEach(rowEl=>{
    rowEl.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const act=btn.getAttribute("data-act");
        const adminKey=ensureKey();
        const sid=rowEl.getAttribute("data-sid");
        const get=(f)=>rowEl.querySelector(`[data-f="${f}"]`).value;
        try{
          btn.disabled=true;
          if(act==="save"){
            const session={
              sessionId:sid,
              date:normalizeDateYYYYMMDD(get("date")),
              start:normalizeTimeHHMM(get("start")),
              end:normalizeTimeHHMM(get("end")),
              venue:get("venue").trim(),
              capacity:Number(get("capacity")||20)||20,
              note:get("note").trim(),
              isOpen:String(get("isOpen")).toUpperCase()==="TRUE"
            };
            const res=await apiPost({action:"admin_updateSession", adminKey, session});
            if(!res.ok) throw new Error(res.error||"update failed");
            await loadSessions();
          }
          if(act==="openOnly"){
            const res=await apiPost({action:"admin_setOnlyOpen", adminKey, sessionId:sid});
            if(!res.ok) throw new Error(res.error||"setOnlyOpen failed");
            await loadSessions();
          }
                  if(act==="delete"){
            if(!confirm("確定刪除？同時會清走該場所有 bookings。")) return;
            const res=await apiPost({action:"admin_deleteSession", adminKey, sessionId:sid});
            if(!res.ok) throw new Error(res.error||"delete failed");
            await loadSessions();
          }
        }catch(e){
          setMsg("topMsg", e.message||String(e));
        }finally{
          btn.disabled=false;
        }
      });
    });
  });
}
async function loadSessions(){
  const data=await apiGet({action:"sessions"});
  sessions=data.sessions||[];
  fillSessionSelects();
  fillAnnounceSelects_();
  renderSessionsTable();
}
async function createSession(){
  const adminKey=ensureKey();
  const session={
    title:(el("newTitle").value||"YR Badminton").trim(),
    date:normalizeDateYYYYMMDD(el("newDate").value.trim()),
    start:normalizeTimeHHMM(el("newStart").value.trim()||"17:00"),
    end:normalizeTimeHHMM(el("newEnd").value.trim()||"19:00"),
    venue:el("newVenue").value.trim(),
    capacity:Number(el("newCap").value||20)||20,
    note:el("newNote").value.trim(),
    isOpen:el("newIsOpen").checked
  };
  const openOnly=el("newOnlyOpen").checked;
  if(!session.date) throw new Error("請填 Date");
  if(!session.venue) throw new Error("請填 Venue");
  const res=await apiPost({action:"admin_createSession", adminKey, session, openOnly});
  if(!res.ok) throw new Error(res.error||"create failed");
  setMsg("createMsg", `已建立：${res.sessionId}`);
  await loadSessions();
}
async function loadRsvps(){
  const adminKey=ensureKey();
  const sessionId=el("rsvpSession").value;
  if(!sessionId){ el("rsvpsTable").innerHTML=`<div class="muted">未有場次</div>`; return; }
  const data=await apiPost({action:"admin_listRsvps", adminKey, sessionId});
  if(!data.ok) throw new Error(data.error||"list failed");
  const rows=(data.rsvps||[]);
  const filter=el("rsvpFilter").value;
  const view=rows.filter(r=>filter==="ALL"?true:String(r.status||"").toUpperCase()===filter)
    .sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||"")));
  if(!view.length){ el("rsvpsTable").innerHTML=`<div class="muted">暫時無預約</div>`; return; }
  el("rsvpsTable").innerHTML=`
    <div class="table">
      <div class="tr th small" style="grid-template-columns: 90px 190px 1fr 140px 90px 1fr;">
        <div>Row</div><div>Timestamp</div><div>Name</div><div>Status</div><div>Players</div><div>Note</div>
      </div>
      ${view.map(r=>`
        <div class="tr small" style="grid-template-columns: 90px 190px 1fr 140px 90px 1fr;">
          <div class="cell"><span class="badge">#${r.rowNumber}</span></div>
          <div class="cell">${esc(r.timestamp||"")}</div>
          <div class="cell">${esc(r.name||"")}</div>
          <div class="cell">${esc(String(r.status||"").toUpperCase())}</div>
          <div class="cell">${Number(r.pax||1)||1}</div>
          <div class="cell">${esc(r.note||"")}</div>
        </div>
      `).join("")}
    </div>
  `;
}


function toISODate_(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function parseISODate_(s){
  const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), 0,0,0,0);
}
function nextSunday_(fromDate){
  const d=new Date(fromDate.getTime());
  const day=d.getDay(); // 0=Sun
  const add=(7 - day) % 7;
  d.setDate(d.getDate()+add);
  return d;
}

function forceSundayInput_(){
  const gs=document.getElementById("genStartDate");
  if(!gs) return;
  const v=gs.value;
  const d=parseISODate_(v);
  if(!d) return;
  if(d.getDay()!==0){
    const s=nextSunday_(d);
    gs.value = toISODate_(s);
    setMsg("genMsg", "已自動調整為星期日 / Auto-adjusted to Sunday.");
  }
}

async function generateSundays_(){
  const adminKey=ensureKey();
  const startStr=el("genStartDate").value;
  let start=parseISODate_(startStr);
  // lock generator to Sunday
  if(start && start.getDay()!==0){ start = nextSunday_(start); }

  if(!start) throw new Error("請填「從哪一日開始」日期");
  start = nextSunday_(start);

  el("genStartDate").value = toISODate_(start);
  const weeks = Number(el("genWeeks").value||8)||8;
  const venue = (el("genVenue").value||"").trim();
  if(!venue) throw new Error("請填預設 Venue");
  const cap = Number(el("genCap").value||20)||20;
  const openOnly = el("genOpenOnly").checked;

  let created=0;
  for(let i=0;i<weeks;i++){
    const d=new Date(start.getTime());
    d.setDate(d.getDate()+i*7);
    const dateStr=toISODate_(d);

    const session={
      title:"YR Badminton",
      date: dateStr,
      start:"17:00",
      end:"19:00",
      venue: venue,
      capacity: cap,
      note:"",
      isOpen: (i===0) ? true : false
    };

    const res=await apiPost({action:"admin_createSession", adminKey, session, openOnly: (openOnly && i===0)});
    if(!res.ok) throw new Error(res.error||"create failed");
    created += 1;
  }

  await loadSessions();
  setMsg("genMsg", `已生成 ${created} 個星期日場次（第一個 OPEN，其餘關閉）。`);
}



function dedupeLatestByName_(rows){
  const map=new Map();
  for(const r of (rows||[])){
    const k=String(r.name||"").trim().toLowerCase();
    if(!k) continue;
    // admin_listRsvps returns timestamp string
    map.set(k, r);
  }
  return Array.from(map.values());
}
function sumByStatus_(rows, status){
  const S=String(status||"").toUpperCase();
  return (rows||[]).filter(r=>String(r.status||"").toUpperCase()===S)
    .reduce((s,r)=>s+(Number(r.pax)||1),0);
}
function pickClosestOpenSessionIdAdmin_(){
  const now=Date.now();
  const open=sessions.filter(s=>!!s.isOpen);
  if(!open.length) return (sessions[0]||{}).sessionId || "";
  const ms = (s)=>{
    const date=normalizeDateYYYYMMDD(s.date);
    const start=normalizeTimeHHMM(s.start);
    const dm=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const tm=start.match(/^(\d{2}):(\d{2})$/);
    if(!dm||!tm) return NaN;
    return new Date(Number(dm[1]),Number(dm[2])-1,Number(dm[3]),Number(tm[1]),Number(tm[2]),0,0).getTime();
  };
  const sorted=open.map(s=>({s,ms:ms(s)})).filter(x=>!isNaN(x.ms)).sort((a,b)=>a.ms-b.ms);
  if(!sorted.length) return open[0].sessionId;
  const upcoming=sorted.find(x=>x.ms>=now);
  return (upcoming?upcoming.s.sessionId:sorted[sorted.length-1].s.sessionId) || "";
}
async function buildAnnouncement_(){
  const adminKey=ensureKey();
  const sid = document.getElementById("announceSession").value || pickClosestOpenSessionIdAdmin_();
  if(!sid) throw new Error("未有場次可生成公告");
  const s = sessions.find(x=>x.sessionId===sid);
  if(!s) throw new Error("session not found");

  const data = await apiPost({action:"admin_listRsvps", adminKey, sessionId:sid});
  if(!data.ok) throw new Error(data.error||"list failed");
  const uniq = dedupeLatestByName_(data.rsvps||[]);
  const yesTotal = sumByStatus_(uniq,"YES");
  const waitTotal = sumByStatus_(uniq,"WAITLIST");
  const cap = Number(s.capacity||0)||0;
  const remain = cap? Math.max(0, cap-yesTotal) : 0;
  const waitRemain = Math.max(0, WAITLIST_LIMIT-waitTotal);

  const date = normalizeDateYYYYMMDD(s.date);
  const start = normalizeTimeHHMM(s.start);
  const end = normalizeTimeHHMM(s.end);
  const venue = String(s.venue||"").trim();
  const title = String(s.title||"YR Badminton").trim() || "YR Badminton";

  const lines = [];
  lines.push(`📢 ${title} 打波登記 / RSVP`);
  lines.push(`🗓️ ${date} (Sun) ${start}-${end}`);
  lines.push(`📍 ${venue}`);
  if(cap) lines.push(`👥 出席：${yesTotal}/${cap}（尚餘 ${remain}）`);
  else lines.push(`👥 出席：${yesTotal}`);
  lines.push(`📝 後補：${waitTotal}/${WAITLIST_LIMIT}（尚餘 ${waitRemain}）`);
  lines.push("");
  lines.push("請到以下連結更新出席狀態：");
  // Try reuse front-end location if hosted
  lines.push(`${location.origin}${location.pathname.replace(/admin\.html.*$/,'index.html')}`);
  lines.push("");
  lines.push("Status：出席 YES / 後補 WAITLIST / 缺席 NO（「可能」唔係選項）");
  return lines.join("\n");
}
async function doAnnounce_(){
  const ta=document.getElementById("announceText");
  const msg=document.getElementById("announceMsg");
  msg.textContent="";
  ta.value="生成中...";
  try{
    const text = await buildAnnouncement_();
    ta.value=text;
    msg.textContent="已生成公告。";
  }catch(e){
    ta.value="";
    msg.textContent = e.message || String(e);
  }
}
async function copyAnnounce_(){
  const ta=document.getElementById("announceText");
  const msg=document.getElementById("announceMsg");
  try{
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    await navigator.clipboard.writeText(ta.value||"");
    msg.textContent="已複製。";
  }catch(e){
    // fallback
    try{
      document.execCommand("copy");
      msg.textContent="已複製。";
    }catch(_){
      msg.textContent="複製失敗，請手動選取複製。";
    }
  }
}

function init(){
  const today = new Date().toISOString().split("T")[0];
  const nd = document.getElementById("newDate"); if(nd){ nd.setAttribute("min", today); nd.value = today; }
  const gs = document.getElementById("genStartDate"); if(gs){ gs.setAttribute("min", today); gs.value = today; }

  el("btnLoad").addEventListener("click", async ()=>{
    try{
      ensureKey();
      await loadSessions();
      setMsg("topMsg","已載入。");
    }catch(e){ setMsg("topMsg", e.message||String(e)); }
  });
  el("btnCreateSession").addEventListener("click", ()=>{ setMsg("createMsg",""); createSession().catch(e=>setMsg("createMsg", e.message||String(e))); });
  const gsd=document.getElementById("genStartDate");
  if(gsd){ gsd.addEventListener("change", ()=>forceSundayInput_()); }
  const ba=document.getElementById("btnAnnounce");
  if(ba){ ba.addEventListener("click", ()=>doAnnounce_()); }
  const bc=document.getElementById("btnCopyAnnounce");
  if(bc){ bc.addEventListener("click", ()=>copyAnnounce_()); }
  const bg=document.getElementById("btnGenSundays");
  if(bg){ bg.addEventListener("click", ()=>{ setMsg("genMsg",""); generateSundays_().catch(e=>setMsg("genMsg", e.message||String(e))); }); }
  el("showClosed").addEventListener("change", ()=>renderSessionsTable());
  el("btnLoadRsvps").addEventListener("click", ()=>loadRsvps().catch(e=>setMsg("topMsg", e.message||String(e))));
  el("rsvpFilter").addEventListener("change", ()=>loadRsvps().catch(()=>{}));
  el("rsvpSession").addEventListener("change", ()=>loadRsvps().catch(()=>{}));
  setMsg("topMsg","請輸入 Admin Key 後按「載入 / Load」。");
}
init();
