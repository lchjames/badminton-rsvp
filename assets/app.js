const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const DEFAULT_CAPACITY = 20;
const PSYCHO_LINES = [
  "「可能」唔係選項。唔好做薛定諤出席，請揀「出席」或「缺席」。",
  "YR Badminton 規矩：要就要，唔要就唔要。「可能」會令我哋訂場/分隊崩潰。",
  "你啱啱揀咗「可能」。系統已記低你嘅猶豫（講笑）。請揀返 YES / NO。",
  "「可能」= 令全隊難做。你肯定係好人，所以請揀返「出席」或「缺席」。"
];
const MAYBE_COOLDOWN_MS = 900;

const el = (id) => document.getElementById(id);
let sessions = [];
let currentSessionId = null;
let psychoIdx = 0;
let maybeCooldownTimer = null;

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
function escapeHtml(s="") {
  return s.replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}
function showMsg(text) { el("msg").textContent = text || ""; }
function setWarning(text) {
  const w = el("statusWarning");
  if (!text) { w.style.display = "none"; w.textContent = ""; return; }
  w.style.display = "block"; w.textContent = text;
}
function nextPsychoLine() { const line = PSYCHO_LINES[psychoIdx % PSYCHO_LINES.length]; psychoIdx += 1; return line; }
function setSubmitCooldown(ms) {
  const btn = el("submitBtn");
  btn.disabled = true;
  if (maybeCooldownTimer) window.clearTimeout(maybeCooldownTimer);
  maybeCooldownTimer = window.setTimeout(() => { btn.disabled = false; }, ms);
}
function renderSessionInfo(s) {
  const cap = (Number(s.capacity) || DEFAULT_CAPACITY);
  el("sessionInfo").textContent = `${s.date} ${s.start}-${s.end} ｜ ${s.venue} ｜ 上限：${cap}` + (s.note ? ` ｜ ${s.note}` : "");
}
function renderList(rsvps) {
  const byName = new Map();
  for (const r of rsvps) byName.set((r.name || "").trim(), r);
  const rows = Array.from(byName.values());
  const yes = rows.filter(x => x.status === "YES");
  const sumYes = yes.reduce((a,b)=>a+(Number(b.pax)||1),0);
  const s = sessions.find(x => x.sessionId === currentSessionId) || {};
  const cap = (Number(s.capacity) || DEFAULT_CAPACITY);
  const remaining = Math.max(0, cap - sumYes);
  el("summary").innerHTML = `出席：<b>${sumYes}</b> / ${cap} ｜ 尚餘名額：<b>${remaining}</b>`;
  const items = yes
    .sort((a,b)=> (b.timestamp||"").localeCompare(a.timestamp||""))
    .map(r => `
      <div class="item">
        <b>${escapeHtml(r.name)}</b>（${Number(r.pax)||1}）
        ${r.note ? `<div class="muted">${escapeHtml(r.note)}</div>` : ""}
      </div>
    `).join("");
  el("list").innerHTML = items || `<div class="muted">暫時未有人出席</div>`;
}
async function loadSessions() {
  const data = await apiGet({ action: "sessions" });
  sessions = data.sessions || [];
  const openSessions = sessions.filter(x => x.isOpen);
  const select = el("sessionSelect");
  select.innerHTML = "";
  if (openSessions.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "暫時無開放場次";
    select.appendChild(opt);
    currentSessionId = null;
    el("sessionInfo").textContent = "";
    return;
  }
  for (const s of openSessions) {
    const opt = document.createElement("option");
    opt.value = s.sessionId;
    opt.textContent = `${s.title}（${s.date} ${s.start}）`;
    select.appendChild(opt);
  }
  currentSessionId = select.value;
  const s = sessions.find(x => x.sessionId === currentSessionId);
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
  document.querySelectorAll('input[name="status"]').forEach(radio => {
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
async function init() {
  await loadSessions();
  await loadRsvps();
  wireStatusPsychowar();
  el("sessionSelect").addEventListener("change", async (e) => {
    currentSessionId = e.target.value;
    const s = sessions.find(x => x.sessionId === currentSessionId);
    if (s) renderSessionInfo(s);
    setWarning("");
    showMsg("");
    await loadRsvps();
  });
  el("rsvpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const btn = el("submitBtn");
    btn.disabled = true;
    try {
      if (!currentSessionId) { showMsg("暫時未有開放場次。"); return; }
      const name = el("name").value.trim();
      const pax = Number(el("pax").value || 1);
      const note = el("note").value.trim();
      const status = document.querySelector('input[name="status"]:checked')?.value;
      if (!name) { showMsg("請填寫姓名 / 暱稱。"); return; }
      if (status === "MAYBE") {
        setWarning(nextPsychoLine());
        showMsg("「可能」唔係選項，請改為「出席」或「缺席」。");
        setSubmitCooldown(MAYBE_COOLDOWN_MS);
        return;
      }
      const res = await apiPost({ action: "rsvp", sessionId: currentSessionId, name, status, pax, note });
      if (!res?.ok) { showMsg(`提交失敗：${res?.error || "未知錯誤"}`); return; }
      showMsg("已提交。");
      setWarning("");
      await loadRsvps();
    } catch (err) {
      console.error(err);
      showMsg("提交失敗，請稍後再試。");
    } finally {
      btn.disabled = false;
    }
  });
}
init();
