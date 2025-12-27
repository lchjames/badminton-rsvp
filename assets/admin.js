const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const WAITLIST_LIMIT = 6;
let sessions = [];

function el(id){ return document.getElementById(id); }
function showMsg(id, t){
  const m = el(id);
  m.textContent = t || "";
  m.classList.toggle("show", !!t);
}
function normalizeDate(s){ return (String(s||"").match(/\d{4}-\d{2}-\d{2}/) ? String(s).slice(0,10) : String(s||"")); }
function normalizeTime(s){
  const m=String(s||"").match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2,"0")}:${m[2]}` : String(s||"");
}
function ensureKey(){
  const k=(el("adminKey").value||"").trim();
  if(!k) throw new Error("請輸入 Admin Key");
  return k;
}
async function apiGet(params){
  const url = new URL(API_BASE);
  Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const r=await fetch(url.toString(),{method:"GET"});
  return await r.json();
}
async function apiPost(body){
  const r=await fetch(API_BASE,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body||{})
  });
  return await r.json();
}

// Sunday only (front-end)
function isSundayISO(iso){ return new Date(iso+"T00:00:00").getDay()===0; }
function nextSundayISO(iso){
  const d=new Date(iso+"T00:00:00");
  const day=d.getDay();
  d.setDate(d.getDate()+((7-day)%7));
  return d.toISOString().slice(0,10);
}
function snapToSunday(inputId,msgId){
  const x=el(inputId);
  if(!x || !x.value) return;
  if(isSundayISO(x.value)) return;
  const fixed=nextSundayISO(x.value);
  x.value=fixed;
  if(msgId) showMsg(msgId,`已自動改為最近的星期日：${fixed}`);
}

function sessionLabel(s){
  return `${normalizeDate(s.date)} ${normalizeTime(s.start)}-${normalizeTime(s.end)} · ${s.venue} · ${s.isOpen?"OPEN":"CLOSED"}`;
}
function escapeAttr(s){ return String(s||"").replace(/"/g,"&quot;"); }

function fillSessionSelects(){
  ["rsvpSession","announceSession"].forEach(id=>{
    const sel=el(id);
    if(!sel) return;
    sel.innerHTML="";
    for(const s of sessions){
      const opt=document.createElement("option");
      opt.value=s.sessionId;
      opt.textContent=sessionLabel(s);
      sel.appendChild(opt);
    }
  });
}

function renderSessionsTable(){
  const showClosed = !!el("showClosed")?.checked;
  const rows = sessions
    .filter(s=>showClosed ? true : !!s.isOpen)
    .sort((a,b)=> (normalizeDate(a.date)+normalizeTime(a.start)).localeCompare(normalizeDate(b.date)+normalizeTime(b.start)));

  el("sessionsTable").innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Time</th><th>Venue</th><th>Cap</th><th>Open</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.map(s=>`
          <tr>
            <td>${normalizeDate(s.date)}</td>
            <td>${normalizeTime(s.start)}-${normalizeTime(s.end)}</td>
            <td><input data-k="venue" data-id="${s.sessionId}" value="${escapeAttr(s.venue||"")}" /></td>
            <td><input data-k="capacity" data-id="${s.sessionId}" type="number" min="1" value="${Number(s.capacity||0)||0}" /></td>
            <td>
              <select data-k="isOpen" data-id="${s.sessionId}">
                <option value="true" ${s.isOpen?"selected":""}>OPEN</option>
                <option value="false" ${!s.isOpen?"selected":""}>CLOSED</option>
              </select>
            </td>
            <td class="row">
              <button class="btn" data-act="save" data-id="${s.sessionId}">Save</button>
              <button class="btn danger" data-act="delete" data-id="${s.sessionId}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  el("sessionsTable").querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const act=btn.dataset.act;
      const id=btn.dataset.id;
      if(act==="save") return saveSession(id);
      if(act==="delete") return deleteSession(id);
    });
  });
}

async function loadSessions(){
  if(!API_BASE || API_BASE.includes("PASTE_YOUR")) throw new Error("API_BASE 未設定");
  const data = await apiGet({ action:"sessions_all" });
  if(!data.ok) throw new Error(data.error||"load sessions failed");
  sessions = data.sessions || [];
  fillSessionSelects();
  renderSessionsTable();
  updateAnnounceSummary().catch(()=>{});
}

async function createSession(){
  const adminKey=ensureKey();
  snapToSunday("newDate","createMsg");
  const payload = {
    action:"admin_createSession",
    adminKey,
    title:(el("title").value||"YR Badminton").trim(),
    date:(el("newDate").value||"").trim(),
    start:(el("start").value||"17:00").trim(),
    end:(el("end").value||"19:00").trim(),
    venue:(el("venue").value||"Goodminton").trim(),
    capacity:Number(el("capacity").value||20)||20,
    note:(el("note").value||"").trim(),
    isOpen:String(el("isOpen").value)==="true"
  };
  const res=await apiPost(payload);
  if(!res.ok) throw new Error(res.error||"create failed");
  showMsg("createMsg","已新增。");
  await loadSessions();
}

async function saveSession(id){
  const adminKey=ensureKey();
  const row=sessions.find(s=>s.sessionId===id);
  if(!row) return;

  const root=el("sessionsTable");
  const venue=root.querySelector(`input[data-k="venue"][data-id="${id}"]`).value.trim();
  const capacity=Number(root.querySelector(`input[data-k="capacity"][data-id="${id}"]`).value||0)||0;
  const isOpen=root.querySelector(`select[data-k="isOpen"][data-id="${id}"]`).value==="true";

  const res=await apiPost({ action:"admin_updateSession", adminKey, session:{...row, venue, capacity, isOpen} });
  if(!res.ok) throw new Error(res.error||"update failed");
  showMsg("sessMsg","已儲存。");
  await loadSessions();
}

async function deleteSession(id){
  const adminKey=ensureKey();
  if(!confirm("確定刪除此場次？（會同時清走所有 bookings）")) return;
  const res=await apiPost({ action:"admin_deleteSession", adminKey, sessionId:id });
  if(!res.ok) throw new Error(res.error||"delete failed");
  showMsg("sessMsg","已刪除。");
  await loadSessions();
}

async function loadRsvps(){
  const adminKey=ensureKey();
  const sessionId=el("rsvpSession").value;
  const filter=el("rsvpFilter").value;

  const data=await apiPost({ action:"admin_listRsvps", adminKey, sessionId });
  if(!data.ok) throw new Error(data.error||"list failed");

  const current=data.current||[];
  const s=sessions.find(x=>x.sessionId===sessionId);
  const cap=Number((s||{}).capacity||0)||0;
  const yes=Number((data.summary||{}).confirmedPax||0)||0;
  const wait=Number((data.summary||{}).waitlistPax||0)||0;
  el("rsvpSummary").textContent = `人數摘要：出席 ${yes}/${cap}（剩餘 ${Math.max(0,cap-yes)}）｜候補 ${wait}/${WAITLIST_LIMIT}（剩餘 ${Math.max(0,WAITLIST_LIMIT-wait)}）`;

  const view=current.filter(x=>{
    if(filter==="ALL") return true;
    if(filter==="NO") return x.status==="NO";
    if(filter==="CONFIRMED") return x.status==="YES" && x.placement==="CONFIRMED";
    if(filter==="WAITLIST") return x.status==="YES" && x.placement==="WAITLIST";
    return true;
  }).sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")));

  if(!view.length){
    el("rsvpsTable").innerHTML = '<div class="muted small" style="padding:12px;">暫時無預約</div>';
    return;
  }

  el("rsvpsTable").innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Status</th><th>Pax</th><th>結果</th><th>Note</th><th>Time</th><th>Action</th></tr></thead>
      <tbody>
        ${view.map(r=>`
          <tr>
            <td><input data-r="name" data-id="${r.rowId}" value="${escapeAttr(r.name||"")}" /></td>
            <td>
              <select data-r="status" data-id="${r.rowId}">
                <option value="YES" ${r.status==="YES"?"selected":""}>YES</option>
                <option value="NO" ${r.status==="NO"?"selected":""}>NO</option>
              </select>
            </td>
            <td><input data-r="pax" data-id="${r.rowId}" type="number" min="1" value="${Number(r.pax||1)}" /></td>
            <td>${r.status==="NO" ? '<span class="badge no">NO</span>' : (r.placement==="CONFIRMED" ? '<span class="badge ok">成功報名</span>' : '<span class="badge warn">候補</span>')}</td>
            <td><input data-r="note" data-id="${r.rowId}" value="${escapeAttr(r.note||"")}" /></td>
            <td class="muted small">${escapeAttr(r.timestamp||"")}</td>
            <td class="row">
              <button class="btn" data-act="rsvpSave" data-id="${r.rowId}">Save</button>
              <button class="btn danger" data-act="rsvpDel" data-id="${r.rowId}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  el("rsvpsTable").querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const act=btn.dataset.act;
      const rowId=btn.dataset.id;
      if(act==="rsvpSave") return saveRsvp(sessionId,rowId);
      if(act==="rsvpDel") return deleteRsvp(sessionId,rowId);
    });
  });
}

async function saveRsvp(sessionId,rowId){
  const adminKey=ensureKey();
  const root=el("rsvpsTable");
  const name=root.querySelector(`input[data-r="name"][data-id="${rowId}"]`).value.trim();
  const status=root.querySelector(`select[data-r="status"][data-id="${rowId}"]`).value;
  const pax=Number(root.querySelector(`input[data-r="pax"][data-id="${rowId}"]`).value||1)||1;
  const note=root.querySelector(`input[data-r="note"][data-id="${rowId}"]`).value.trim();

  const res=await apiPost({ action:"admin_updateRsvp", adminKey, sessionId, rowId, name, status, pax, note });
  if(!res.ok) throw new Error(res.error||"update rsvp failed");
  await loadRsvps();
}

async function deleteRsvp(sessionId,rowId){
  const adminKey=ensureKey();
  if(!confirm("確定刪除此 booking？")) return;
  const res=await apiPost({ action:"admin_deleteRsvp", adminKey, sessionId, rowId });
  if(!res.ok) throw new Error(res.error||"delete rsvp failed");
  await loadRsvps();
}

async function updateAnnounceSummary(){
  const adminKey=ensureKey();
  const sid=el("announceSession").value;
  if(!sid){ el("announceSummary").textContent=""; return; }
  const data=await apiPost({ action:"admin_listRsvps", adminKey, sessionId:sid });
  if(!data.ok){ el("announceSummary").textContent=data.error||"error"; return; }

  const s=sessions.find(x=>x.sessionId===sid);
  const cap=Number((s||{}).capacity||0)||0;
  const yes=Number((data.summary||{}).confirmedPax||0)||0;
  const wait=Number((data.summary||{}).waitlistPax||0)||0;
  el("announceSummary").textContent = `出席 ${yes}/${cap}（剩餘 ${Math.max(0,cap-yes)}）｜候補 ${wait}/${WAITLIST_LIMIT}（剩餘 ${Math.max(0,WAITLIST_LIMIT-wait)}）`;
}

function buildAnnouncement(sid){
  const s=sessions.find(x=>x.sessionId===sid);
  if(!s) throw new Error("session not found");
  const date=normalizeDate(s.date);
  const start=normalizeTime(s.start);
  const end=normalizeTime(s.end);
  const venue=String(s.venue||"").trim();
  const title=String(s.title||"YR Badminton").trim() || "YR Badminton";
  const link = `${location.origin}${location.pathname.replace(/admin\.html.*$/,'index.html')}`;

  const zh = [
    `📢 ${title} 打波登記 / RSVP`,
    `🗓️ ${date} (Sun) ${start}-${end}`,
    `📍 ${venue}`,
    "",
    "",
    "請到以下連結更新出席狀態：",
    link,
    "",
    "Status：出席 YES / 缺席 NO"
  ].join("\\n");

  const en = [
    `📢 ${title} RSVP`,
    `🗓️ ${date} (Sun) ${start}-${end}`,
    `📍 ${venue}`,
    "",
    "",
    "Please update your status via:",
    link,
    "",
    "Status: YES / NO"
  ].join("\\n");

  return zh + "\\n\\n--------------------\\n\\n" + en;
}

function init(){
  // set date min today
  const d=new Date();
  const today=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const nd=el("newDate");
  if(nd){
    nd.min=today;
    nd.value=today;
    nd.addEventListener("input", ()=>snapToSunday("newDate","createMsg"));
    nd.addEventListener("change", ()=>snapToSunday("newDate","createMsg"));
    snapToSunday("newDate","createMsg");
  }

  el("btnLoad").addEventListener("click", async ()=>{
    try{ ensureKey(); await loadSessions(); showMsg("topMsg","已載入。"); }
    catch(e){ showMsg("topMsg", e.message||String(e)); }
  });
  el("btnRefresh").addEventListener("click", async ()=>{
    try{ ensureKey(); await loadSessions(); }
    catch(e){ showMsg("topMsg", e.message||String(e)); }
  });
  el("btnCreate").addEventListener("click", async ()=>{
    try{ showMsg("createMsg",""); await createSession(); }
    catch(e){ showMsg("createMsg", e.message||String(e)); }
  });

  el("showClosed").addEventListener("change", ()=>renderSessionsTable());

  el("btnLoadRsvps").addEventListener("click", ()=>loadRsvps().catch(e=>showMsg("topMsg", e.message||String(e))));
  el("rsvpFilter").addEventListener("change", ()=>loadRsvps().catch(()=>{}));
  el("rsvpSession").addEventListener("change", ()=>{
    loadRsvps().catch(()=>{});
    updateAnnounceSummary().catch(()=>{});
  });
  el("announceSession").addEventListener("change", ()=>updateAnnounceSummary().catch(()=>{}));

  el("btnAnnounce").addEventListener("click", ()=>{
    try{
      const sid=el("announceSession").value || el("rsvpSession").value;
      el("announceText").value = buildAnnouncement(sid);
      showMsg("announceMsg","已生成。");
    }catch(e){
      showMsg("announceMsg", e.message||String(e));
    }
  });
  el("btnCopyAnnounce").addEventListener("click", async ()=>{
    try{
      await navigator.clipboard.writeText(el("announceText").value||"");
      showMsg("announceMsg","已複製。");
    }catch(_){
      showMsg("announceMsg","複製失敗。");
    }
  });

  showMsg("topMsg","請輸入 Admin Key 後按「載入 / Load」。");
}
init();
