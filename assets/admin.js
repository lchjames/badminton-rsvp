// assets/admin.js
// YR Badminton Admin
// Fixes:
// - Bookings must always show CURRENT (dedupe latest by name).
// - Date inputs: lock to Sunday only (front-end), backend also validates.
// - Keep existing admin functions (create, generate, list, announce) without duplicates.

const API_BASE = "https://script.google.com/macros/s/AKfycbzEqzkHIcMor9K3BJFEmUoJjzgfL_4HDwX699gz-kvFIfyVvDNGCRqRSUx6JeoyOUq5/exec";
const WAITLIST_LIMIT = 6;

const $ = (id) => document.getElementById(id);

let sessions = [];
let rsvpsCache = []; // raw rows for selected session

function pad2(n) { return String(n).padStart(2, "0"); }
function toYMD(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
}
function normYMD(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toYMD(d);
  return s;
}
function normHM(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return `${pad2(m[1])}:${m[2]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const m2 = s.match(/(\d{1,2}):(\d{2})/);
  if (m2) return `${pad2(m2[1])}:${m2[2]}`;
  return s;
}

function esc(s="") {
  return String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

async function apiGet(params) {
  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({ ok:false, error:"Invalid JSON" }));
  if (!res.ok) throw new Error(data.error || "GET failed");
  return data;
}

async function apiPost(payload) {
  const res = await fetch(API_BASE, {
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({ ok:false, error:"Invalid JSON" }));
  if (!res.ok) throw new Error(data.error || "POST failed");
  return data;
}

function setMsg(id, t) {
  const el = $(id);
  if (el) el.textContent = t || "";
}

function ensureKey() {
  const k = String($("adminKey")?.value || "").trim();
  if (!k) throw new Error("請輸入 Admin Key");
  return k;
}

function nextSundayFrom(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const day = d.getDay(); // Sunday=0
  const delta = (7 - day) % 7; // 0 if already Sunday
  d.setDate(d.getDate() + delta);
  return toYMD(d);
}

function lockSundayOnly(inputId, msgId) {
  const el = $(inputId);
  if (!el) return;
  const raw = normYMD(el.value);
  if (!raw) return;
  const fixed = nextSundayFrom(raw);
  if (fixed && fixed !== raw) {
    el.value = fixed;
    if (msgId) setMsg(msgId, "已自動改為星期日（只可 Sunday）。");
  } else {
    if (msgId) setMsg(msgId, "");
  }
}

function sessionLabel(s, withOpen=true) {
  const date = normYMD(s.date);
  const start = normHM(s.start);
  const end = normHM(s.end);
  return `${date} ${start}-${end} · ${s.venue}${withOpen ? (s.isOpen ? " · OPEN" : " · CLOSED") : ""}`;
}

function dedupeLatestByName(rows) {
  const sorted = (rows||[]).slice().sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")));
  const by = new Map();
  for (const r of sorted) {
    const k = String(r.name||"").trim().toLowerCase();
    if (!k) continue;
    by.set(k, r);
  }
  return Array.from(by.values());
}

function allocateCurrent(uniqRows, cap, waitLimit) {
  const yes = uniqRows
    .filter(r=>String(r.status||"").toUpperCase()==="YES")
    .slice()
    .sort((a,b)=>String(a.timestamp||"").localeCompare(String(b.timestamp||"")));
  const no = uniqRows.filter(r=>String(r.status||"").toUpperCase()==="NO");

  let used=0, wused=0;
  const confirmed=[], waitlist=[], overflow=[];
  for(const r of yes) {
    const pax = Math.max(1, Number(r.pax||1)||1);
    if (cap>0 && used+pax<=cap) { used+=pax; confirmed.push(r); }
    else if (wused+pax<=waitLimit) { wused+=pax; waitlist.push(r); }
    else overflow.push(r);
  }
  return {confirmed, waitlist, overflow, no, totals:{confirmedPax:used, waitlistPax:wused}};
}

function buildRsvpTable(currentRows, sess) {
  const cap = Number(sess.capacity||0)||0;
  const uniq = dedupeLatestByName(currentRows);
  const buckets = allocateCurrent(uniq, cap, WAITLIST_LIMIT);

  const filter = String($("rsvpFilter")?.value || "ALL").toUpperCase();

  const view = [];
  for (const r of buckets.confirmed) view.push({...r, _bucket:"CONFIRMED"});
  for (const r of buckets.waitlist) view.push({...r, _bucket:"WAITLIST"});
  for (const r of buckets.no) view.push({...r, _bucket:"NO"});
  for (const r of buckets.overflow) view.push({...r, _bucket:"OVERFLOW"});

  const filtered = view.filter(row => {
    if (filter==="ALL") return true;
    if (filter==="YES" || filter==="CONFIRMED") return row._bucket==="CONFIRMED";
    if (filter==="WAITLIST") return row._bucket==="WAITLIST";
    if (filter==="NO") return row._bucket==="NO";
    return true;
  });

  const sumLine = `出席/Confirmed：${buckets.totals.confirmedPax}/${cap||"-"} ｜ 候補/Waitlist：${buckets.totals.waitlistPax}/${WAITLIST_LIMIT}`;
  const head = `
    <div class="muted small" style="margin-bottom:8px;">${esc(sumLine)}（只顯示 current / latest per name）</div>
    <div style="overflow:auto;">
      <table class="table">
        <thead><tr>
          <th>Name</th><th>Status</th><th>Bucket</th><th>Pax</th><th>Note</th><th>Timestamp</th>
        </tr></thead>
        <tbody>
  `;
  const body = filtered.length ? filtered.map(r=>`
      <tr>
        <td>${esc(r.name||"")}</td>
        <td>${esc(String(r.status||"").toUpperCase())}</td>
        <td>${esc(r._bucket)}</td>
        <td>${esc(r.pax||"")}</td>
        <td>${esc(r.note||"")}</td>
        <td class="muted small">${esc(r.timestamp||"")}</td>
      </tr>
  `).join("") : `<tr><td colspan="6" class="muted">暫時無預約</td></tr>`;

  const tail = `</tbody></table></div>`;
  return head + body + tail;
}

async function loadSessions() {
  let data;
  try {
    data = await apiGet({action:"sessions_all"});
  } catch {
    data = await apiGet({action:"sessions"});
  }
  sessions = data.sessions || [];

  const ann = $("announceSession");
  const rsvpSel = $("rsvpSession");
  if (ann) ann.innerHTML = "";
  if (rsvpSel) rsvpSel.innerHTML = "";

  const sorted = sessions.slice().sort((a,b)=>normYMD(a.date).localeCompare(normYMD(b.date)) || normHM(a.start).localeCompare(normHM(b.start)));
  for (const s of sorted) {
    const opt1 = document.createElement("option");
    opt1.value = s.sessionId;
    opt1.textContent = sessionLabel(s, true);
    ann && ann.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = s.sessionId;
    opt2.textContent = sessionLabel(s, true);
    rsvpSel && rsvpSel.appendChild(opt2);
  }

  renderSessionsTable();
  await updateAnnounceSummary();
}

function renderSessionsTable() {
  const box = $("sessionsTable");
  if (!box) return;

  const showClosed = !!$("showClosed")?.checked;
  const rows = sessions
    .filter(s => showClosed ? true : !!s.isOpen)
    .slice()
    .sort((a,b)=>normYMD(a.date).localeCompare(normYMD(b.date)) || normHM(a.start).localeCompare(normHM(b.start)));

  if (!rows.length) {
    box.innerHTML = `<div class="muted">暫時無場次</div>`;
    return;
  }

  box.innerHTML = `
  <div style="overflow:auto;">
    <table class="table">
      <thead><tr>
        <th>ID</th><th>Title</th><th>Date</th><th>Start</th><th>End</th><th>Venue</th><th>Cap</th><th>Open</th><th>Note</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${rows.map(s=>`
          <tr data-id="${esc(s.sessionId)}">
            <td class="muted small">${esc(s.sessionId)}</td>
            <td><input data-f="title" value="${esc(s.title||"")}" /></td>
            <td><input data-f="date" type="date" value="${esc(normYMD(s.date))}" /></td>
            <td><input data-f="start" value="${esc(normHM(s.start))}" style="width:90px;" /></td>
            <td><input data-f="end" value="${esc(normHM(s.end))}" style="width:90px;" /></td>
            <td><input data-f="venue" value="${esc(s.venue||"")}" /></td>
            <td><input data-f="capacity" type="number" min="1" value="${esc(s.capacity||20)}" style="width:80px;" /></td>
            <td>
              <select data-f="isOpen">
                <option value="TRUE" ${s.isOpen?"selected":""}>TRUE</option>
                <option value="FALSE" ${!s.isOpen?"selected":""}>FALSE</option>
              </select>
            </td>
            <td><input data-f="note" value="${esc(s.note||"")}" /></td>
            <td class="row" style="gap:8px;">
              <button data-act="save" style="width:auto;">儲存</button>
              <button data-act="onlyopen" class="alt" style="width:auto;">唯一開放</button>
              <button data-act="del" class="danger" style="width:auto;">刪除</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  </div>
  <p class="muted small">提示：日期只可 Sunday；後端亦會拒絕非 Sunday。</p>
  `;

  box.querySelectorAll("button[data-act]").forEach(btn=>btn.addEventListener("click", onSessionAction));
  box.querySelectorAll('input[data-f="date"]').forEach(inp=>inp.addEventListener("change", ()=>{
    const v = normYMD(inp.value);
    inp.value = nextSundayFrom(v);
  }));
}

async function onSessionAction(e) {
  const btn = e.target;
  const tr = btn.closest("tr");
  if (!tr) return;
  const id = tr.getAttribute("data-id");
  const act = btn.getAttribute("data-act");
  const adminKey = ensureKey();

  if (act === "del") {
    if (!confirm("確定刪除場次？（會同時刪除該場所有 bookings）")) return;
    const res = await apiPost({action:"admin_deleteSession", adminKey, sessionId:id});
    if (!res.ok) throw new Error(res.error||"delete failed");
    await loadSessions();
    setMsg("topMsg", "已刪除。");
    return;
  }

  const getVal = (f) => tr.querySelector(`[data-f="${f}"]`)?.value;

  const session = {
    sessionId: id,
    title: getVal("title"),
    date: nextSundayFrom(normYMD(getVal("date"))),
    start: normHM(getVal("start")),
    end: normHM(getVal("end")),
    venue: getVal("venue"),
    capacity: Number(getVal("capacity")||20),
    note: getVal("note")||"",
    isOpen: String(getVal("isOpen")||"FALSE").toUpperCase()==="TRUE",
  };

  if (act === "onlyopen") {
    // close others; open this
    for (const s of sessions) s.isOpen = (s.sessionId === id);
    for (const s of sessions) {
      const r = await apiPost({
        action:"admin_updateSession",
        adminKey,
        session:{
          sessionId:s.sessionId,
          title:s.title,
          date: nextSundayFrom(normYMD(s.date)),
          start:normHM(s.start),
          end:normHM(s.end),
          venue:s.venue,
          capacity:Number(s.capacity||20),
          note:s.note||"",
          isOpen: !!s.isOpen
        }
      });
      if (!r.ok) throw new Error(r.error||"update failed");
    }
    await loadSessions();
    setMsg("topMsg", "已設定唯一開放。");
    return;
  }

  if (act === "save") {
    const res = await apiPost({action:"admin_updateSession", adminKey, session});
    if (!res.ok) throw new Error(res.error||"save failed");
    await loadSessions();
    setMsg("topMsg", "已儲存。");
  }
}

async function createSession() {
  const adminKey = ensureKey();

  const title = String($("newTitle")?.value || "YR Badminton").trim();
  const date = nextSundayFrom(normYMD($("newDate")?.value || ""));
  if ($("newDate")) $("newDate").value = date;

  const start = normHM($("newStart")?.value || "17:00");
  const end = normHM($("newEnd")?.value || "19:00");
  const venue = String($("newVenue")?.value || "Goodminton").trim();
  const capacity = Number($("newCap")?.value || 20);
  const note = String($("newNote")?.value || "").trim();
  const isOpen = !!$("newIsOpen")?.checked;
  const onlyOpen = !!$("newOnlyOpen")?.checked;

  const res = await apiPost({
    action:"admin_createSession",
    adminKey,
    title, date, start, end, venue, capacity, note, isOpen, onlyOpen
  });
  if (!res.ok) throw new Error(res.error||"create failed");

  await loadSessions();
  setMsg("createMsg","已建立。");
}

async function generateSundays() {
  const adminKey = ensureKey();

  const start = nextSundayFrom(normYMD($("genStartDate")?.value || toYMD(new Date())));
  if ($("genStartDate")) $("genStartDate").value = start;

  const weeks = Number($("genWeeks")?.value || 8);
  const venue = String($("genVenue")?.value || "Goodminton").trim();
  const cap = Number($("genCap")?.value || 20);
  const openOnly = !!$("genOpenOnly")?.checked;

  const base = new Date(start + "T00:00:00");
  const created = [];
  for (let i=0;i<weeks;i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i*7);
    const date = toYMD(d);
    const isOpen = (i===0);

    const r = await apiPost({
      action:"admin_createSession",
      adminKey,
      title:"YR Badminton",
      date,
      start:"17:00",
      end:"19:00",
      venue,
      capacity: cap,
      note:"",
      isOpen,
      onlyOpen:false
    });
    if (!r.ok) throw new Error(r.error||"generate failed");
    created.push(r.sessionId);
  }

  if (openOnly && created.length) {
    const first = created[0];
    await loadSessions();
    for (const s of sessions) s.isOpen = (s.sessionId === first);
    for (const s of sessions) {
      const r = await apiPost({
        action:"admin_updateSession",
        adminKey,
        session:{
          sessionId:s.sessionId,
          title:s.title,
          date: nextSundayFrom(normYMD(s.date)),
          start:normHM(s.start),
          end:normHM(s.end),
          venue:s.venue,
          capacity:Number(s.capacity||20),
          note:s.note||"",
          isOpen:!!s.isOpen
        }
      });
      if (!r.ok) throw new Error(r.error||"update failed");
    }
  }

  await loadSessions();
  setMsg("genMsg", `已生成 ${created.length} 個星期日場次。`);
}

async function loadRsvps() {
  const adminKey = ensureKey();
  const sid = String($("rsvpSession")?.value || "").trim();
  if (!sid) {
    $("rsvpsTable").innerHTML = `<div class="muted">請先選擇場次</div>`;
    return;
  }

  let data;
  try {
    data = await apiPost({action:"admin_listRsvps", adminKey, sessionId:sid});
  } catch {
    data = await apiGet({action:"list", sessionId:sid});
  }

  const rows = data.rsvps || data.current || [];
  rsvpsCache = rows;

  const sess = sessions.find(s=>s.sessionId===sid) || {};
  $("rsvpsTable").innerHTML = buildRsvpTable(rows, sess);
}

function announceTemplate(session, sumLineZh, sumLineEn) {
  const url = "https://lchjames.github.io/badminton-rsvp/index.html";
  const date = normYMD(session.date);
  const start = normHM(session.start);
  const end = normHM(session.end);
  const venue = String(session.venue||"").trim();

  return `📢 YR Badminton 打波登記 / RSVP\n🗓️ ${date} (Sun) ${start}-${end}\n📍 ${venue}\n\n${sumLineZh}\n\n請到以下連結更新出席狀態：\n${url}\n\nStatus：出席 YES / 缺席 NO\n\n------------------------------\n\n📢 YR Badminton RSVP\n🗓️ ${date} (Sun) ${start}-${end}\n📍 ${venue}\n\n${sumLineEn}\n\nPlease update your status via:\n${url}\n\nStatus: YES / NO`;
}

async function updateAnnounceSummary() {
  const sid = String($("announceSession")?.value || "").trim();
  if (!sid) return;

  try {
    const adminKey = String($("adminKey")?.value || "").trim();
    let rows = [];
    if (adminKey) {
      const data = await apiPost({action:"admin_listRsvps", adminKey, sessionId:sid});
      rows = data.rsvps || data.current || [];
    }
    const sess = sessions.find(s=>s.sessionId===sid) || {};
    const cap = Number(sess.capacity||0)||0;
    const uniq = dedupeLatestByName(rows);
    const buckets = allocateCurrent(uniq, cap, WAITLIST_LIMIT);

    const zh = `👥 名額：${buckets.totals.confirmedPax}/${cap||"-"}（尚餘 ${cap?Math.max(0,cap-buckets.totals.confirmedPax):"-"}）\n📝 候補：${buckets.totals.waitlistPax}/${WAITLIST_LIMIT}（尚餘 ${Math.max(0, WAITLIST_LIMIT-buckets.totals.waitlistPax)}）`;
    const en = `👥 Confirmed: ${buckets.totals.confirmedPax}/${cap||"-"} (Remaining ${cap?Math.max(0,cap-buckets.totals.confirmedPax):"-"})\n📝 Waitlist: ${buckets.totals.waitlistPax}/${WAITLIST_LIMIT} (Remaining ${Math.max(0, WAITLIST_LIMIT-buckets.totals.waitlistPax)})`;

    $("announceSummary").textContent = zh + " / " + en;
  } catch {
    $("announceSummary").textContent = "";
  }
}

async function doAnnounce() {
  const adminKey = ensureKey();
  const sid = String($("announceSession")?.value || "").trim();
  const sess = sessions.find(s=>s.sessionId===sid);
  if (!sess) return;

  const data = await apiPost({action:"admin_listRsvps", adminKey, sessionId:sid});
  const rows = data.rsvps || data.current || [];
  const cap = Number(sess.capacity||0)||0;
  const uniq = dedupeLatestByName(rows);
  const buckets = allocateCurrent(uniq, cap, WAITLIST_LIMIT);

  const zh = `👥 名額：${buckets.totals.confirmedPax}/${cap||"-"}（尚餘 ${cap?Math.max(0,cap-buckets.totals.confirmedPax):"-"}）\n📝 候補：${buckets.totals.waitlistPax}/${WAITLIST_LIMIT}（尚餘 ${Math.max(0, WAITLIST_LIMIT-buckets.totals.waitlistPax)}）`;
  const en = `👥 Confirmed: ${buckets.totals.confirmedPax}/${cap||"-"} (Remaining ${cap?Math.max(0,cap-buckets.totals.confirmedPax):"-"})\n📝 Waitlist: ${buckets.totals.waitlistPax}/${WAITLIST_LIMIT} (Remaining ${Math.max(0, WAITLIST_LIMIT-buckets.totals.waitlistPax)})`;

  $("announceText").value = announceTemplate(sess, zh, en);
  setMsg("announceMsg","已生成。");
  await updateAnnounceSummary();
}

async function copyAnnounce() {
  const t = String($("announceText")?.value || "");
  if (!t) return;
  await navigator.clipboard.writeText(t);
  setMsg("announceMsg","已複製。");
}

function init() {
  const today = toYMD(new Date());

  const nd = $("newDate");
  if (nd) {
    nd.setAttribute("min", today);
    nd.value = today;
    nd.addEventListener("change", ()=>lockSundayOnly("newDate","createMsg"));
  }

  const gs = $("genStartDate");
  if (gs) {
    gs.setAttribute("min", today);
    gs.value = today;
    gs.addEventListener("input", ()=>lockSundayOnly("genStartDate","genMsg"));
    gs.addEventListener("change", ()=>lockSundayOnly("genStartDate","genMsg"));
    lockSundayOnly("genStartDate","genMsg");
  }

  $("btnLoad")?.addEventListener("click", async ()=>{
    try{
      ensureKey();
      await loadSessions();
      setMsg("topMsg","已載入。");
    }catch(e){
      setMsg("topMsg", e.message||String(e));
    }
  });

  $("btnCreateSession")?.addEventListener("click", async ()=>{
    setMsg("createMsg","");
    try { await createSession(); }
    catch(e){ setMsg("createMsg", e.message||String(e)); }
  });

  $("btnGenSundays")?.addEventListener("click", async ()=>{
    setMsg("genMsg","");
    try { await generateSundays(); }
    catch(e){ setMsg("genMsg", e.message||String(e)); }
  });

  $("showClosed")?.addEventListener("change", ()=>renderSessionsTable());

  $("btnLoadRsvps")?.addEventListener("click", async ()=>{
    try { await loadRsvps(); }
    catch(e){ setMsg("topMsg", e.message||String(e)); }
  });
  $("rsvpFilter")?.addEventListener("change", ()=>loadRsvps().catch(()=>{}));
  $("rsvpSession")?.addEventListener("change", ()=>loadRsvps().catch(()=>{}));

  $("announceSession")?.addEventListener("change", ()=>updateAnnounceSummary().catch(()=>{}));
  $("btnAnnounce")?.addEventListener("click", ()=>doAnnounce().catch(e=>setMsg("announceMsg", e.message||String(e))));
  $("btnCopyAnnounce")?.addEventListener("click", ()=>copyAnnounce().catch(()=>{}));

  setMsg("topMsg","請輸入 Admin Key 後按「載入 / Load」。");
}

init();
