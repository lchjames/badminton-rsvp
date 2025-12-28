// assets/app.js
// YR Badminton RSVP (user page)
// Requirements:
// 1) MAYBE must NEVER call API; only show warning.
// 2) Waitlist is automatic when YES exceeds capacity (limit 6).
// 3) Auto-select closest open session.

const API_BASE = "https://script.google.com/macros/s/AKfycby6BM-TP-4EnP7usmJigxuUrWtsTeWw83oRYPHQPXhfIsRmLjhbisIMeVNOngQkr9uG/exec";
const WAITLIST_LIMIT = 6;

const PSYCHO_LINES = [
  {
    zh: "😏『可能』其實等於冇答，大家會當你唔嚟。",
    en: "😏 'Maybe' usually means 'not coming'. Others will assume you are out."
  },
  {
    zh: "🤔 如果你真係想打，揀『出席』會比較實際。",
    en: "🤔 If you really want to play, choosing 'Yes' works much better."
  },
  {
    zh: "⏳ 名額有限，『可能』唔會幫你留位。",
    en: "⏳ Slots are limited. 'Maybe' does not reserve a spot."
  },
  {
    zh: "🫠 教練統計名單時，『可能』會被自動忽略。",
    en: "🫠 When attendance is counted, 'Maybe' is often ignored."
  }
];

const $ = (id) => document.getElementById(id);

let sessions = [];
let currentSessionId = "";
let psychoIdx = 0;

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

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

async function apiGet(params) {
  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
  if (!res.ok) throw new Error(data.error || "GET failed");
  return data;
}

async function apiPost(payload) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
  if (!res.ok) throw new Error(data.error || "POST failed");
  return data;
}

function setMsg(t = "") {
  const el = $("msg");
  if (el) el.textContent = t;
}

function setExisting(t = "") {
  const el = $("existingInfo");
  if (el) el.textContent = t;
}

function setWarning(t = "") {
  const w = $("statusWarning");
  if (!w) return;
  if (!t) {
    w.style.display = "none";
    w.textContent = "";
  } else {
    w.style.display = "block";
    w.textContent = t;
  }
}

function nextPsychoLine() {
  const line = PSYCHO_LINES[psychoIdx % PSYCHO_LINES.length];
  psychoIdx += 1;
  return `${line.zh}
${line.en}`;
}

function parseSessionStartMs(s) {
  const date = normYMD(s.date);
  const start = normHM(s.start);
  const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = start.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return NaN;
  return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0).getTime();
}

function pickClosestOpenSessionId() {
  const now = Date.now();
  const open = sessions.filter((s) => !!s.isOpen);
  if (!open.length) return "";
  const sortable = open
    .map((s) => ({ s, ms: parseSessionStartMs(s) }))
    .filter((x) => !isNaN(x.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!sortable.length) return open[0].sessionId;
  const upcoming = sortable.find((x) => x.ms >= now);
  return (upcoming ? upcoming.s.sessionId : sortable[sortable.length - 1].s.sessionId) || "";
}

function renderSessionInfo(s) {
  const date = normYMD(s.date);
  const start = normHM(s.start);
  const end = normHM(s.end);
  const cap = Number(s.capacity || 0) || 0;
  const venue = String(s.venue || "").trim();
  const note = String(s.note || "").trim();
  const info = $("sessionInfo");
  if (!info) return;
  info.innerHTML = `
    <div><b>${esc(s.title || "Badminton")}</b></div>
    <div>📅 ${esc(date)} (Sun)  ${esc(start)}-${esc(end)}</div>
    <div>📍 ${esc(venue)} ｜ CAP ${cap || "-"} ｜ 候補上限/Waitlist ${WAITLIST_LIMIT}${note ? ` ｜ ${esc(note)}` : ""}</div>
  `;
}

function itemCard(r, tag) {
  const name = esc(r.name || "");
  const pax = Number(r.pax || 1) || 1;
  const note = esc(r.note || "");
  const t = esc(r.timestamp || "");
  return `
    <div class="mini">
      <div class="mini-top">
        <div class="mini-name">${name} <span class="pill">${tag}</span></div>
        <div class="mini-pax">(${pax})</div>
      </div>
      ${note ? `<div class="mini-note">${note}</div>` : ""}
      ${t ? `<div class="mini-ts muted">${t}</div>` : ""}
    </div>
  `;
}

function dedupeLatestByName(rows) {
  // Latest by timestamp; fallback to last occurrence
  const by = new Map();
  const sorted = (rows || []).slice().sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  for (const r of sorted) {
    const k = String(r.name || "").trim().toLowerCase();
    if (!k) continue;
    by.set(k, r);
  }
  return Array.from(by.values());
}

function allocate(uniqRows, cap, waitLimit) {
  const yes = uniqRows
    .filter((r) => String(r.status || "").toUpperCase() === "YES")
    .slice()
    .sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  const no = uniqRows.filter((r) => String(r.status || "").toUpperCase() === "NO");

  let used = 0;
  let wused = 0;
  const confirmed = [];
  const waitlist = [];
  const overflow = [];

  for (const r of yes) {
    const pax = Math.max(1, Number(r.pax || 1) || 1);
    if (cap > 0 && used + pax <= cap) {
      used += pax;
      confirmed.push(r);
    } else if (wused + pax <= waitLimit) {
      wused += pax;
      waitlist.push(r);
    } else {
      overflow.push(r);
    }
  }
  return { confirmed, waitlist, overflow, totals: { confirmedPax: used, waitlistPax: wused }, no };
}

function renderLists(rawRows) {
  const list = $("list");
  const waitList = $("waitList");
  const summary = $("summary");
  const waitSummary = $("waitSummary");
  if (!list || !waitList || !summary || !waitSummary) return;

  const uniq = dedupeLatestByName(rawRows);

  const sess = sessions.find((x) => x.sessionId === currentSessionId) || {};
  const cap = Number(sess.capacity || 0) || 0;

  const buckets = allocate(uniq, cap, WAITLIST_LIMIT);

  const yesSum = buckets.totals.confirmedPax;
  const wlSum = buckets.totals.waitlistPax;

  summary.innerHTML = cap
    ? `名額：${yesSum}/${cap}（尚餘 ${Math.max(0, cap - yesSum)}）`
    : `名額：不限`;
  waitSummary.innerHTML = `候補：${wlSum}/${WAITLIST_LIMIT}（尚餘 ${Math.max(0, WAITLIST_LIMIT - wlSum)}）`;

  list.innerHTML = buckets.confirmed.length
    ? buckets.confirmed.slice().sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).map((r) => itemCard(r, "YES")).join("")
    : `<div class="muted">暫時無人報名</div>`;

  waitList.innerHTML = buckets.waitlist.length
    ? buckets.waitlist.slice().sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).map((r) => itemCard(r, "候補")).join("")
    : `<div class="muted">暫時無人候補</div>`;

  // hint for current user if exists
  const name = String($("name")?.value || "").trim().toLowerCase();
  if (name) {
    const me = uniq.find((r)=>String(r.name||"").trim().toLowerCase()===name);
    if (me) {
      const st = String(me.status||"").toUpperCase();
      if (st === "NO") setExisting("你目前狀態：缺席 / No");
      else {
        const isConfirmed = buckets.confirmed.some((r)=>String(r.name||"").trim().toLowerCase()===name);
        const isWait = buckets.waitlist.some((r)=>String(r.name||"").trim().toLowerCase()===name);
        if (isConfirmed) setExisting("你目前狀態：已成功報名 / Confirmed");
        else if (isWait) setExisting("你目前狀態：已進入候補 / Waitlist");
        else setExisting("你目前狀態：已登記（超出候補上限） / Registered (overflow)");
      }
    } else {
      setExisting("");
    }
  } else {
    setExisting("");
  }
}

async function loadSessions() {
  const data = await apiGet({ action: "sessions" });
  sessions = data.sessions || [];
  const open = sessions.filter((s) => !!s.isOpen);

  const sel = $("sessionSelect");
  const info = $("sessionInfo");
  if (!sel || !info) return;

  sel.innerHTML = "";
  if (!open.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "暫時無開放場次 / No open session";
    sel.appendChild(opt);
    currentSessionId = "";
    info.textContent = "";
    return;
  }

  open.sort(
    (a, b) =>
      normYMD(a.date).localeCompare(normYMD(b.date)) ||
      normHM(a.start).localeCompare(normHM(b.start))
  );

  for (const s of open) {
    const opt = document.createElement("option");
    opt.value = s.sessionId;
    opt.textContent = `${normYMD(s.date)} ${normHM(s.start)}-${normHM(s.end)} · ${s.venue}`;
    sel.appendChild(opt);
  }

  const picked = pickClosestOpenSessionId();
  if (picked) sel.value = picked;
  currentSessionId = sel.value;

  const s = sessions.find((x) => x.sessionId === currentSessionId);
  if (s) renderSessionInfo(s);
}

async function loadRsvps() {
  const list = $("list");
  const waitList = $("waitList");
  const summary = $("summary");
  const waitSummary = $("waitSummary");

  if (!currentSessionId) {
    if (list) list.innerHTML = `<div class="muted">未有開放場次</div>`;
    if (waitList) waitList.innerHTML = "";
    if (summary) summary.textContent = "";
    if (waitSummary) waitSummary.textContent = "";
    return;
  }

  const data = await apiGet({ action: "list", sessionId: currentSessionId });
  const rows = data.rsvps || data.current || [];
  renderLists(rows);
}

function getSelectedStatus() {
  return document.querySelector('input[name="status"]:checked')?.value || "YES";
}

function setStatus(value) {
  const el = document.querySelector(`input[name="status"][value="${value}"]`);
  if (el) el.checked = true;
}

function wireMaybeWarning() {
  document.querySelectorAll('input[name="status"]').forEach((r) =>
    r.addEventListener("change", () => {
      if (r.checked && r.value === "MAYBE") {
        setWarning(nextPsychoLine());
        setMsg("你揀咗「可能」：系統唔會記錄。請改揀「出席」或「缺席」。");
      } else if (r.checked) {
        setWarning("");
        setMsg("");
      }
    })
  );
}

async function submitRsvp(statusOverride) {
  const name = String($("name")?.value || "").trim();
  const pax = Math.max(1, Number($("pax")?.value || 1) || 1);
  const note = String($("note")?.value || "").trim();
  const status = statusOverride || getSelectedStatus();

  setMsg("");
  if (!currentSessionId) {
    setMsg("未有開放場次 / No open session");
    return;
  }
  if (!name) {
    setMsg("請輸入姓名 / Please enter your name");
    return;
  }

  // ✅ MAYBE must not call API
  if (status === "MAYBE") {
    setWarning(nextPsychoLine());
    setMsg("「可能」唔會被記錄。請揀「出席」或「缺席」。");
    return;
  }

  const btn = $("submitBtn");
  if (btn) btn.disabled = true;

  try {
    const payload = {
      action: "rsvp",
      sessionId: currentSessionId,
      name,
      status, // YES / NO
      pax,
      note,
    };
    const res = await apiPost(payload);

    if (!res || res.ok !== true) {
      throw new Error(res?.error || "提交失敗 / Submit failed");
    }

    // Refresh list, then decide message based on placement
    await loadRsvps();

    if (status === "NO") {
      setMsg("已更新為缺席 / Updated to NO");
      return;
    }

    const data = await apiGet({ action: "list", sessionId: currentSessionId });
    const rows = data.rsvps || data.current || [];
    const uniq = dedupeLatestByName(rows);
    const sess = sessions.find((x) => x.sessionId === currentSessionId) || {};
    const cap = Number(sess.capacity || 0) || 0;
    const buckets = allocate(uniq, cap, WAITLIST_LIMIT);

    const meKey = name.toLowerCase();
    const inConfirmed = buckets.confirmed.some((r) => String(r.name || "").trim().toLowerCase() === meKey);
    const inWait = buckets.waitlist.some((r) => String(r.name || "").trim().toLowerCase() === meKey);

    if (inConfirmed) setMsg("你已成功報名 / Confirmed");
    else if (inWait) setMsg("你已進入候補 / Added to waitlist");
    else setMsg("已記錄，但已超出候補上限 / Recorded but overflowed waitlist");

  } catch (e) {
    setMsg(String(e?.message || e || "提交失敗"));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function init() {
  try {
    await loadSessions();
    await loadRsvps();
  } catch (e) {
    setMsg(String(e?.message || e || "載入失敗"));
  }

  $("sessionSelect")?.addEventListener("change", async (e) => {
    currentSessionId = e.target.value;
    const s = sessions.find((x) => x.sessionId === currentSessionId);
    if (s) renderSessionInfo(s);
    setWarning("");
    setMsg("");
    await loadRsvps();
  });

  wireMaybeWarning();

  $("rsvpForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitRsvp();
  });

  $("cancelBtn")?.addEventListener("click", async () => {
    setStatus("NO");
    await submitRsvp("NO");
  });
}

init();
