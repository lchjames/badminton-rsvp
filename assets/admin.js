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

function init(){
  el("btnLoad").addEventListener("click", async ()=>{
    try{
      ensureKey();
      await loadSessions();
      setMsg("topMsg","已載入。");
    }catch(e){ setMsg("topMsg", e.message||String(e)); }
  });
  el("btnCreateSession").addEventListener("click", ()=>{ setMsg("createMsg",""); createSession().catch(e=>setMsg("createMsg", e.message||String(e))); });
  el("showClosed").addEventListener("change", ()=>renderSessionsTable());
  el("btnLoadRsvps").addEventListener("click", ()=>loadRsvps().catch(e=>setMsg("topMsg", e.message||String(e))));
  el("rsvpFilter").addEventListener("change", ()=>loadRsvps().catch(()=>{}));
  el("rsvpSession").addEventListener("change", ()=>loadRsvps().catch(()=>{}));
  setMsg("topMsg","請輸入 Admin Key 後按「載入 / Load」。");
}
init();
