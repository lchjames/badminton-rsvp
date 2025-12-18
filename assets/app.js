// assets/app.js
const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const DEFAULT_CAPACITY = 20;

const PSYCHO_LINES = [
  "「可能」唔係選項。請揀「出席」或「缺席」。",
  "你揀「可能」= 令我哋難分隊、難訂場。拜託揀 YES/NO。",
  "系統已偵測到猶豫（講笑）。請改返 YES / NO。",
  "「可能」會令統計崩潰。你肯定係好人，所以請揀 YES / NO。",
];
const MAYBE_COOLDOWN_MS = 900;

const el = (id) => document.getElementById(id);

let sessions = [];
let currentSessionId = null;
let psychoIdx = 0;
let maybeCooldownTimer = null;
let remainingSeats = null;

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
    const m = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
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
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    return `${hh}:${mm}`;
  }
  const m2 = s.match(/(\d{1,2}):(\d{2})/);
  if (m2) return `${m2[1].padStart(2,"0")}:${m2[2]}`;
  return s;
}

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

function showMsg(text) { el("msg").textContent = text || ""; }

function setWarning(text) {
  const w = el("statusWarning");
  if (!text) {
    w.style.display = "none";
    w.textContent = "";
    return;
  }
  w.style.display = "block";
  w.textContent = text;
}

function nextPsychoLine() {
  const line = PSYCHO_LINES[psychoIdx % PSYCHO_LINES.length];
  psychoIdx += 1;
  return line;
}

function setSubmitCooldown(ms) {
  const btn = el("submitBtn");
  btn.disabled = true;
  if (maybeCooldownTimer) window.clearTimeout(maybeCooldownTimer);
  maybeCooldownTimer = window.setTimeout(() => {
    btn.disabled = false;
  }, ms);
}

function disableYesIfFull() {
  const yesRadio = document.querySelector('input[name="status"][value="YES"]');
  if (!yesRadio) return;

  if (remainingSeats !== null && remainingSeats <= 0) {
    yesRadio.disabled = true;
    // if user currently checked YES, keep it (but submission might fail if pax increases)
    const checked = document.querySelector('input[name="status"]:checked');
    if (checked && checked.value !== "YES") {
      setWarning("已滿額 / Full. 如要出席請聯絡管理員。");
    }
  } else {
    yesRadio.disabled = false;
  }
}

function formatOptionText(s) {
  const date = normalizeDateYYYYMMDD(s.date);
  const start = normalizeTimeHHMM(s.start);
  const end = normalizeTimeHHMM(s.end);
  const venue = (s.venue || "").trim();
  return `${date} ${start}-${end} · ${venue}`;
}

function renderSessionInfo(s) {
  const date = normalizeDateYYYYMMDD(s.date);
  const start = normalizeTimeHHMM(s.start);
  const end = normalizeTimeHHMM(s.end);
  const cap = Number(s.capacity || DEFAULT_CAPACITY) || DEFAULT_CAPACITY;
  const venue = (s.venue || "").trim();
  const note = (s.note || "").trim();

  el("sessionInfo").innerHTML = `
    <div><b>${esc(s.title || "Badminton")}</b></div>
    <div>${esc(date)} ${esc(start)}-${esc(end)}</div>
    <div>${esc(venue)} ｜ 上限：${cap}${note ? ` ｜ ${esc(note)}` : ""}</div>
  `;
}

function renderList(rsvps) {
  const byName = new Map();
  for (const r of rsvps) {
    const key = (r.name || "").trim().toLowerCase();
    if (!key) continue;
    byName.set(key, r);
  }
  const rows = Array.from(byName.values());

  const yes = rows.filter((x) => String(x.status || "").toUpperCase() === "YES");
  const sumYes = yes.reduce((a, b) => a + (Number(b.pax) || 1), 0);

  const s = sessions.find((x) => x.sessionId === currentSessionId) || {};
  const cap = Number(s.capacity || DEFAULT_CAPACITY) || DEFAULT_CAPACITY;

  remainingSeats = Math.max(0, cap - sumYes);
  el("summary").innerHTML = `出席：<b>${sumYes}</b> / ${cap} ｜ 尚餘名額：<b>${remainingSeats}</b>`;
  disableYesIfFull();

  const items = yes
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
    .map((r) => {
      const name = esc(r.name || "");
      const pax = Number(r.pax) || 1;
      const note = String(r.note || "").trim();
      return `
        <div class="item">
          <b>${name}</b>（${pax}）
          ${note ? `<div class="muted">${esc(note)}</div>` : ""}
        </div>
      `;
    })
    .join("");

  el("list").innerHTML = items || `<div class="muted">暫時未有人出席</div>`;
}

async function loadSessions() {
  const data = await apiGet({ action: "sessions" });
  sessions = data.sessions || [];
  const openSessions = sessions.filter((x) => x.isOpen);

  const select = el("sessionSelect");
  select.innerHTML = "";

  if (openSessions.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "暫時無開放場次 / No open session";
    select.appendChild(opt);
    currentSessionId = null;
    el("sessionInfo").textContent = "";
    return;
  }

  openSessions.sort((a, b) => {
    const da = normalizeDateYYYYMMDD(a.date);
    const db = normalizeDateYYYYMMDD(b.date);
    if (da !== db) return da.localeCompare(db);
    const sa = normalizeTimeHHMM(a.start);
    const sb = normalizeTimeHHMM(b.start);
    return sa.localeCompare(sb);
  });

  for (const s of openSessions) {
    const opt = document.createElement("option");
    opt.value = s.sessionId;
    opt.textContent = formatOptionText(s);
    select.appendChild(opt);
  }

  currentSessionId = select.value;
  const s = sessions.find((x) => x.sessionId === currentSessionId);
  if (s) renderSessionInfo(s);
}

async function loadRsvps() {
  if (!currentSessionId) {
    el("summary").textContent = "";
    el("list").innerHTML = `<div class="muted">未有開放場次</div>`;
    return;
  }
  const data = await apiGet({ action: "list", sessionId: currentSessionId });
  renderList(data.rsvps || []);
}

function wireStatusPsychowar() {
  document.querySelectorAll('input[name="status"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "MAYBE") {
        setWarning(nextPsychoLine());
        showMsg("提示：你揀咗「可能」，請改為「出席」或「缺席」。");
        setSubmitCooldown(MAYBE_COOLDOWN_MS);
      } else {
        setWarning("");
      }
    });
  });
}

function findExistingByName_(rsvps, name) {
  const target = (name || "").trim().toLowerCase();
  if (!target) return null;
  const same = (rsvps || [])
    .filter(r => String(r.name||"").trim().toLowerCase() === target)
    .sort((a,b)=> String(b.timestamp||"").localeCompare(String(a.timestamp||"")));
  return same[0] || null;
}

async function loadExistingForUser_() {
  const name = el("name").value.trim();
  if (!currentSessionId || !name) {
    el("existingInfo").textContent = "";
    return;
  }
  const data = await apiGet({ action:"list", sessionId: currentSessionId });
  const existing = findExistingByName_(data.rsvps || [], name);

  if (!existing) {
    el("existingInfo").textContent = "未找到你之前嘅登記。 / No existing RSVP found.";
    return;
  }

  const st = String(existing.status||"").toUpperCase();
  const status = (st === "YES") ? "YES" : "NO";
  document.querySelectorAll('input[name="status"]').forEach(r => {
    r.checked = (r.value === status);
  });

  el("pax").value = Number(existing.pax || 1) || 1;
  el("note").value = String(existing.note || "");

  el("existingInfo").textContent =
    `已載入你上次登記：${existing.timestamp || ""}（${status}） / Loaded your last RSVP.`;
}

async function init() {
  await loadSessions();
  await loadRsvps();
  wireStatusPsychowar();

  el("sessionSelect").addEventListener("change", async (e) => {
    currentSessionId = e.target.value;
    const s = sessions.find((x) => x.sessionId === currentSessionId);
    if (s) renderSessionInfo(s);
    setWarning("");
    showMsg("");
    await loadRsvps();
    loadExistingForUser_().catch(()=>{});
  });

  el("name").addEventListener("blur", () => {
    loadExistingForUser_().catch(()=>{});
  });

  el("cancelBtn").addEventListener("click", async () => {
    try {
      showMsg("");
      if (!currentSessionId) { showMsg("暫時未有開放場次。"); return; }

      const name = el("name").value.trim();
      if (!name) { showMsg("請先填姓名 / 暱稱。"); return; }

      const res = await apiPost({
        action: "rsvp",
        sessionId: currentSessionId,
        name,
        status: "NO",
        pax: 1,
        note: (el("note").value || "").trim() || "Cancelled"
      });

      if (!res?.ok) { showMsg(`取消失敗：${res?.error || "未知錯誤"}`); return; }
      showMsg("已取消出席（已更新為 NO）。 / Cancelled (set to NO).");
      setWarning("");
      await loadRsvps();
      await loadExistingForUser_();
    } catch (e) {
      showMsg("取消失敗，請稍後再試。");
    }
  });

  el("rsvpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const btn = el("submitBtn");
    btn.disabled = true;

    try {
      if (!currentSessionId) {
        showMsg("暫時未有開放場次。");
        return;
      }

      const name = el("name").value.trim();
      const pax = Number(el("pax").value || 1) || 1;
      const note = el("note").value.trim();
      const status = document.querySelector('input[name="status"]:checked')?.value;

      if (!name) { showMsg("請填寫姓名 / 暱稱。"); return; }

      if (status === "MAYBE") {
        setWarning(nextPsychoLine());
        showMsg("「可能」唔係選項，請改為「出席」或「缺席」。");
        setSubmitCooldown(MAYBE_COOLDOWN_MS);
        return;
      }

      const res = await apiPost({
        action: "rsvp",
        sessionId: currentSessionId,
        name,
        status,
        pax,
        note,
      });

      if (!res?.ok) {
        // capacity limiter message
        if ((res.error||"").toLowerCase().includes("capacity")) {
          showMsg(`已滿額 / Full. 剩餘：${res.remaining ?? 0}。如確定要加人，請聯絡管理員。`);
          setWarning("已滿額 / Full.");
          await loadRsvps();
          return;
        }
        showMsg(`提交失敗：${res?.error || "未知錯誤"}`);
        return;
      }

      showMsg("已提交。");
      setWarning("");
      await loadRsvps();
      await loadExistingForUser_();
    } catch (err) {
      console.error(err);
      showMsg("提交失敗，請稍後再試。");
    } finally {
      btn.disabled = false;
    }
  });
}

init();
