// assets/admin.js
const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const DEFAULT_RSVP_LINK = "https://lchjames.github.io/badminton-rsvp/";
const el = (id) => document.getElementById(id);

let sessions = [];
let dirtySessions = new Map();

async function apiGet(params) {
  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("GET failed");
  return res.json();
}

async function apiPost(payload) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("POST failed");
  return res.json();
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function normalizeDateYYYYMMDD(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  return s;
}

function normalizeTimeHHMM(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const m1 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m1) return `${m1[1].padStart(2,"0")}:${m1[2]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const m2 = s.match(/(\d{1,2}):(\d{2})/);
  if (m2) return `${m2[1].padStart(2,"0")}:${m2[2]}`;
  return s;
}

function key() { return el("adminKey").value.trim(); }
function ensureKey() {
  const k = key();
  if (!k) throw new Error("請輸入 Admin Key");
  return k;
}

function setMsg(id, t) { el(id).textContent = t || ""; }

function fmtSessionLine_(s) {
  const date = normalizeDateYYYYMMDD(s.date);
  const start = normalizeTimeHHMM(s.start);
  const end = normalizeTimeHHMM(s.end);
  const venue = (s.venue || "").trim();
  return { date, start, end, venue };
}

function parseSessionStartMs_(s) {
  const date = normalizeDateYYYYMMDD(s.date);
  const start = normalizeTimeHHMM(s.start);
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = start.match(/^(\d{2}):(\d{2})$/);
  if (!m || !t) return NaN;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0).getTime();
}

function pickClosestOpenSessionId_() {
  const now = Date.now();
  const open = (sessions || []).filter(s => !!s.isOpen);
  if (open.length === 0) return "";
  const sorted = open
    .map(s => ({ s, ms: parseSessionStartMs_(s) }))
    .filter(x => !isNaN(x.ms))
    .sort((a,b)=> a.ms - b.ms);
  if (sorted.length === 0) return open[0].sessionId;
  const upcoming = sorted.find(x => x.ms >= now);
  return (upcoming ? upcoming.s.sessionId : sorted[sorted.length-1].s.sessionId) || "";
}

function buildSessionsTable(rows) {
  const showClosed = el("showClosed").checked;
  const view = rows
    .filter(s => (showClosed ? true : s.isOpen))
    .sort((a,b)=> normalizeDateYYYYMMDD(a.date).localeCompare(normalizeDateYYYYMMDD(b.date)) ||
                 normalizeTimeHHMM(a.start).localeCompare(normalizeTimeHHMM(b.start)));

  if (view.length === 0) return `<div class="muted">暫時無場次</div>`;

  return `
  <div class="table">
    <div class="tr th small">
      <div>ID</div><div>Title</div><div>Date</div><div>Time</div><div>Venue</div><div>Cap</div><div>Open</div><div>Note</div><div>Actions</div>
    </div>
    ${view.map(s => `
      <div class="tr small" data-session="${esc(s.sessionId)}">
        <div class="cell" data-label="ID"><span class="badge">${esc(s.sessionId)}</span></div>
        <div class="cell" data-label="Title"><input data-f="title" value="${esc(s.title||"")}"></div>
        <div class="cell" data-label="Date"><input data-f="date" value="${esc(normalizeDateYYYYMMDD(s.date))}" placeholder="YYYY-MM-DD"></div>
        <div class="cell" data-label="Time">
          <div class="row" style="gap:6px;">
            <input data-f="start" value="${esc(normalizeTimeHHMM(s.start))}" placeholder="17:00">
            <input data-f="end" value="${esc(normalizeTimeHHMM(s.end))}" placeholder="19:00">
          </div>
        </div>
        <div class="cell" data-label="Venue"><input data-f="venue" value="${esc(s.venue||"")}"></div>
        <div class="cell" data-label="Cap"><input data-f="capacity" type="number" min="1" value="${Number(s.capacity||20)||20}"></div>
        <div class="cell" data-label="Open">
          <select data-f="isOpen">
            <option value="TRUE" ${s.isOpen ? "selected":""}>TRUE</option>
            <option value="FALSE" ${!s.isOpen ? "selected":""}>FALSE</option>
          </select>
        </div>
        <div class="cell" data-label="Note"><input data-f="note" value="${esc(s.note||"")}" placeholder="optional"></div>
        <div class="cell" data-label="Actions">
          <div class="actions">
            <button class="alt" data-act="openOnly">設為唯一開放</button>
            <button data-act="save">儲存</button>
            <button class="danger" data-act="delete">刪除</button>
          </div>
        </div>
      </div>
    `).join("")}
  </div>`;
}

function readSessionRow(rowEl) {
  const sessionId = rowEl.getAttribute("data-session");
  const get = (f) => rowEl.querySelector(`[data-f="${f}"]`).value;
  return {
    sessionId,
    title: get("title").trim(),
    date: normalizeDateYYYYMMDD(get("date").trim()),
    start: normalizeTimeHHMM(get("start").trim()),
    end: normalizeTimeHHMM(get("end").trim()),
    venue: get("venue").trim(),
    capacity: Number(get("capacity") || 20) || 20,
    note: get("note").trim(),
    isOpen: String(get("isOpen")).toUpperCase() === "TRUE",
  };
}

function markDirtySession(rowEl) {
  const s = readSessionRow(rowEl);
  dirtySessions.set(s.sessionId, s);
  setMsg("topMsg", `已修改：${dirtySessions.size} 個場次（未儲存）`);
}

function wireSessionEdits() {
  document.querySelectorAll("[data-session]").forEach((rowEl) => {
    rowEl.querySelectorAll("input,select").forEach((inp) => {
      inp.addEventListener("input", () => markDirtySession(rowEl));
      inp.addEventListener("change", () => markDirtySession(rowEl));
    });

    rowEl.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        const k = ensureKey();
        const s = readSessionRow(rowEl);

        try {
          btn.disabled = true;

          if (act === "save") {
            const res = await apiPost({ action: "admin_updateSession", adminKey: k, session: s });
            if (!res.ok) throw new Error(res.error || "update failed");
            dirtySessions.delete(s.sessionId);
            setMsg("topMsg", "已儲存。");
            await loadSessions();
          }

          if (act === "openOnly") {
            const res = await apiPost({ action: "admin_setOnlyOpen", adminKey: k, sessionId: s.sessionId });
            if (!res.ok) throw new Error(res.error || "setOnlyOpen failed");
            await loadSessions();
          }

          if (act === "delete") {
            if (!confirm(`確定刪除場次 ${s.sessionId}？`)) return;
            const alsoDelete = confirm(
              `要同時清走該場所有 bookings 嗎？\n\n確定 = 清走（不可復原）\n取消 = 只刪場次（保留 bookings）`
            );

            const res = await apiPost({
              action: "admin_deleteSession",
              adminKey: k,
              sessionId: s.sessionId,
              cascade: alsoDelete
            });
            if (!res.ok) throw new Error(res.error || "delete failed");

            alert(`已刪除場次。已清走 bookings：${res.deletedBookings || 0} 筆`);
            dirtySessions.delete(s.sessionId);
            await loadSessions();
          }
        } catch (e) {
          alert(e.message || String(e));
        } finally {
          btn.disabled = false;
        }
      });
    });
  });
}

async function saveAllSessions() {
  const k = ensureKey();
  if (dirtySessions.size === 0) {
    setMsg("topMsg", "冇未儲存修改。");
    return;
  }
  const list = Array.from(dirtySessions.values());
  const res = await apiPost({ action: "admin_bulkUpdateSessions", adminKey: k, sessions: list });
  if (!res.ok) throw new Error(res.error || "bulk update failed");
  dirtySessions.clear();
  setMsg("topMsg", "已儲存所有修改。");
  await loadSessions();
}

function fillRsvpSessionOptions_() {
  const rsvpSel = el("rsvpSession");
  const cur = rsvpSel.value;
  rsvpSel.innerHTML = "";
  sessions
    .slice()
    .sort((a, b) => normalizeDateYYYYMMDD(a.date).localeCompare(normalizeDateYYYYMMDD(b.date)))
    .forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.sessionId;
      const date = normalizeDateYYYYMMDD(s.date);
      const start = normalizeTimeHHMM(s.start);
      opt.textContent = `${date} ${start} · ${s.venue}${s.isOpen ? " · OPEN" : ""}`;
      rsvpSel.appendChild(opt);
    });
  if (cur) rsvpSel.value = cur;
}

function fillAnnounceSessionOptions_() {
  const sel = el("announceSession");
  if (!sel) return;

  sel.innerHTML = "";

  const sorted = sessions.slice().sort((a,b)=> {
    const da = normalizeDateYYYYMMDD(a.date);
    const db = normalizeDateYYYYMMDD(b.date);
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    if (da !== db) return da.localeCompare(db);
    return normalizeTimeHHMM(a.start).localeCompare(normalizeTimeHHMM(b.start));
  });

  sorted.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.sessionId;
    const { date, start, end, venue } = fmtSessionLine_(s);
    opt.textContent = `${date} ${start}-${end} · ${venue}${s.isOpen ? " · OPEN" : ""}`;
    sel.appendChild(opt);
  });

  const pickId = pickClosestOpenSessionId_();
  if (pickId) sel.value = pickId;
  else if (sorted.length) sel.value = sorted[0].sessionId;
}

async function getYesCount_(adminKey, sessionId) {
  const data = await apiPost({ action: "admin_listRsvps", adminKey, sessionId });
  if (!data.ok) throw new Error(data.error || "admin_listRsvps failed");
  const rsvps = data.rsvps || [];

  const byName = new Map();
  for (const r of rsvps) {
    const key = String(r.name||"").trim().toLowerCase();
    if (!key) continue;
    byName.set(key, r);
  }
  const uniq = Array.from(byName.values());
  const yes = uniq.filter(x => String(x.status||"").toUpperCase() === "YES");
  return yes.reduce((sum, x) => sum + (Number(x.pax)||1), 0);
}

function buildAnnouncementText_(s, yesCount, link, lang) {
  const title = (s.title || "Badminton").trim() || "Badminton";
  const { date, start, end, venue } = fmtSessionLine_(s);

  const cap = Number(s.capacity || 0) || 0;
  const left = cap ? Math.max(0, cap - yesCount) : null;
  const note = String(s.note || "").trim();

  const linesZH = [
    "🏸 YR Badminton",
    "",
    `📅 ${date}（星期日）`,
    `⏰ ${start}–${end}`,
    `📍 ${venue}`,
    cap ? `👥 已報：${yesCount} / ${cap}${left !== null ? `（尚餘 ${left}）` : ""}` : `👥 已報：${yesCount}`,
    note ? `📝 備註：${note}` : null,
    link ? "" : null,
    link ? `🔗 登記：${link}` : null,
    "",
    "請大家盡早登記：出席 / 缺席",
  ].filter(Boolean);

  const linesEN = [
    "🏸 YR Badminton",
    "",
    `📅 ${date} (Sunday)`,
    `⏰ ${start}–${end}`,
    `📍 ${venue}`,
    cap ? `👥 RSVP: ${yesCount} / ${cap}${left !== null ? ` (Left ${left})` : ""}` : `👥 RSVP: ${yesCount}`,
    note ? `📝 Note: ${note}` : null,
    link ? "" : null,
    link ? `🔗 RSVP: ${link}` : null,
    "",
    "Please RSVP early: Yes / No",
  ].filter(Boolean);

  if (lang === "ZH") return linesZH.join("\n");
  if (lang === "EN") return linesEN.join("\n");
  return [linesZH.join("\n"), "", "--------------------", "", linesEN.join("\n")].join("\n");
}

async function generateAnnouncement_() {
  const msgEl = el("announceMsg");
  const outEl = el("announceText");
  msgEl.textContent = "";
  outEl.value = "";

  const adminKey = ensureKey();
  const sessionId = el("announceSession").value;
  const lang = el("announceLang").value;
  const link = String(el("announceLink").value || "").trim();

  const s = sessions.find(x => x.sessionId === sessionId);
  if (!s) {
    msgEl.textContent = "找不到場次。";
    return;
  }

  const yesCount = await getYesCount_(adminKey, sessionId);
  outEl.value = buildAnnouncementText_(s, yesCount, link, lang);
  msgEl.textContent = "已生成公告。";
}

async function copyAnnouncement_() {
  const txt = el("announceText").value || "";
  if (!txt.trim()) {
    el("announceMsg").textContent = "未有內容，請先生成公告。";
    return;
  }
  await navigator.clipboard.writeText(txt);
  el("announceMsg").textContent = "已複製到剪貼簿。";
}

function buildRsvpsTable(rows) {
  const filter = el("rsvpFilter").value;
  const view = (rows || [])
    .filter(r => filter === "ALL" ? true : String(r.status||"").toUpperCase() === filter)
    .sort((a,b)=> String(b.timestamp||"").localeCompare(String(a.timestamp||"")));

  if (view.length === 0) return `<div class="muted">暫時無預約</div>`;

  return `
  <div class="table">
    <div class="tr th small" style="grid-template-columns: 90px 190px 1fr 120px 80px 1fr 220px;">
      <div>Row</div><div>Timestamp</div><div>Name</div><div>Status</div><div>Players</div><div>Note</div><div>Actions</div>
    </div>

    ${view.map(r => `
      <div class="tr small" data-rsvp-row="${r.rowNumber}" style="grid-template-columns: 90px 190px 1fr 120px 80px 1fr 220px;">
        <div class="cell" data-label="Row"><span class="badge">#${r.rowNumber}</span></div>
        <div class="cell" data-label="Timestamp">${esc(r.timestamp||"")}</div>
        <div class="cell" data-label="Name"><input data-f="name" value="${esc(r.name||"")}"></div>
        <div class="cell" data-label="Status">
          <select data-f="status">
            <option value="YES" ${String(r.status).toUpperCase()==="YES"?"selected":""}>YES</option>
            <option value="NO" ${String(r.status).toUpperCase()==="NO"?"selected":""}>NO</option>
          </select>
        </div>
        <div class="cell" data-label="Players"><input data-f="pax" type="number" min="1" value="${Number(r.pax||1)||1}"></div>
        <div class="cell" data-label="Note"><input data-f="note" value="${esc(r.note||"")}"></div>
        <div class="cell" data-label="Actions">
          <div class="actions">
            <button data-act="save">儲存</button>
            <button class="danger" data-act="delete">刪除</button>
          </div>
        </div>
      </div>
    `).join("")}
  </div>`;
}

function readRsvpRow(rowEl) {
  const rowNumber = Number(rowEl.getAttribute("data-rsvp-row"));
  const get = (f) => rowEl.querySelector(`[data-f="${f}"]`).value;
  return {
    rowNumber,
    name: get("name").trim(),
    status: String(get("status")).trim().toUpperCase(),
    pax: Number(get("pax") || 1) || 1,
    note: get("note").trim(),
  };
}

function wireRsvpEdits(sessionId) {
  document.querySelectorAll("[data-rsvp-row]").forEach((rowEl) => {
    rowEl.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        const k = ensureKey();
        const r = readRsvpRow(rowEl);

        try {
          btn.disabled = true;

          if (act === "save") {
            const res = await apiPost({ action: "admin_updateRsvp", adminKey: k, sessionId, rsvp: r });
            if (!res.ok) throw new Error(res.error || "update rsvp failed");
            await loadRsvps();
          }

          if (act === "delete") {
            if (!confirm(`確定刪除 Row #${r.rowNumber}？`)) return;
            const res = await apiPost({ action: "admin_deleteRsvp", adminKey: k, sessionId, rowNumber: r.rowNumber });
            if (!res.ok) throw new Error(res.error || "delete rsvp failed");
            await loadRsvps();
          }
        } catch (e) {
          alert(e.message || String(e));
        } finally {
          btn.disabled = false;
        }
      });
    });
  });
}

async function loadSessions() {
  const data = await apiGet({ action: "sessions" });
  sessions = data.sessions || [];

  el("sessionsTable").innerHTML = buildSessionsTable(sessions);
  fillRsvpSessionOptions_();
  fillAnnounceSessionOptions_();

  wireSessionEdits();
}

async function loadRsvps() {
  const k = ensureKey();
  const sessionId = el("rsvpSession").value;
  if (!sessionId) {
    el("rsvpsTable").innerHTML = `<div class="muted">未有場次</div>`;
    return;
  }
  const data = await apiPost({ action: "admin_listRsvps", adminKey: k, sessionId });
  if (!data.ok) throw new Error(data.error || "list rsvps failed");
  el("rsvpsTable").innerHTML = buildRsvpsTable(data.rsvps || []);
  wireRsvpEdits(sessionId);
}

async function init() {
  // default RSVP link
  if (el("announceLink") && !el("announceLink").value.trim()) {
    el("announceLink").value = DEFAULT_RSVP_LINK;
  }

  el("btnLoad").addEventListener("click", async () => {
    try {
      ensureKey();
      await loadSessions();
      await loadRsvps();
      setMsg("topMsg", "已載入。");
    } catch (e) {
      setMsg("topMsg", e.message || String(e));
    }
  });

  el("btnSaveAll").addEventListener("click", async () => {
    try {
      await saveAllSessions();
    } catch (e) {
      setMsg("topMsg", e.message || String(e));
    }
  });

  el("showClosed").addEventListener("change", () => loadSessions().catch(()=>{}));
  el("rsvpSession").addEventListener("change", () => loadRsvps().catch(()=>{}));
  el("rsvpFilter").addEventListener("change", () => loadRsvps().catch(()=>{}));

  el("btnGenAnnouncement").addEventListener("click", () => {
    generateAnnouncement_().catch(e => { el("announceMsg").textContent = e.message || String(e); });
  });
  el("btnCopyAnnouncement").addEventListener("click", () => {
    copyAnnouncement_().catch(e => { el("announceMsg").textContent = e.message || String(e); });
  });

  setMsg("topMsg", "請輸入 Admin Key 後按「載入資料」。");
}

init();
