/* assets/app.js – fixed to match current index.html and new backend
   - Uses #statusWarning and #msg
   - MAYBE shows warning and DOES NOT call API
   - Placement message based ONLY on backend placement
   - Sessions only treat isOpen === true (boolean)
*/

const API_BASE = "https://script.google.com/macros/s/AKfycbwLCg1vLgzeXwheEBWKzCl4YnLlQTmRYZyU8G-FSLJl5MZK4s2uJHDQLnYdwegOvZ5T/exec";
const WAITLIST_LIMIT = 6;

const PSYCHO_LINES = [
  { zh:"「可能」唔會幫你留位；請揀「出席」或「缺席」。", en:"'Maybe' does not reserve a spot. Please choose YES or NO." },
  { zh:"你揀「可能」= 未決定；隊伍唔會為你預留位。", en:"'Maybe' = undecided; no spot will be reserved." },
  { zh:"名額有限，想打就直接揀「出席」。", en:"Slots are limited. If you want to play, choose YES." },
  { zh:"統計人數時，「可能」會被當成唔嚟。", en:"When counting players, 'Maybe' is often treated as NO." },
];
let psychoIdx = 0;
function nextPsycho() {
  const p = PSYCHO_LINES[psychoIdx % PSYCHO_LINES.length];
  psychoIdx++;
  return `${p.zh}\n${p.en}`;
}

function el(id){ return document.getElementById(id); }
function setText(id, t){ const n=el(id); if(n) n.textContent = t||""; }
function showWarn(t) {
  const box = el("statusWarning");
  if(!box) return;
  box.style.display = t ? "block" : "none";
  box.textContent = t || "";
}
function esc(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

async function apiGet(params) {
  const u = new URL(API_BASE);
  Object.entries(params||{}).forEach(([k,v])=>u.searchParams.set(k,String(v)));
  const r = await fetch(u.toString());
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch(e) { throw new Error("Bad JSON: "+t); }
  return j;
}
async function apiPost(body) {
  const r = await fetch(API_BASE, {
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body: JSON.stringify(body||{})
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch(e) { throw new Error("Bad JSON: "+t); }
  return j;
}

let SESSIONS = [];

function dayShort(ymd) {
  const d = new Date(ymd + "T00:00:00");
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()] || "";
}

function closestOpenId(sessions) {
  const open = (sessions||[]).filter(s => s.isOpen === true);
  open.sort((a,b)=>`${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  return open[0]?.sessionId || "";
}

function renderSessions(sessions, selectedId) {
  const sel = el("sessionSelect");
  sel.innerHTML = "";
  const open = (sessions||[]).filter(s => s.isOpen === true);
  if(!open.length) {
    const o=document.createElement("option");
    o.value=""; o.textContent="暫時無開放場次 / No open sessions";
    sel.appendChild(o);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;

  open.sort((a,b)=>`${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  for(const s of open) {
    const o=document.createElement("option");
    o.value=s.sessionId;
    o.textContent=`${s.date} (${dayShort(s.date)}) ${s.start}-${s.end} · ${s.venue}`;
    sel.appendChild(o);
  }
  sel.value = selectedId || open[0].sessionId;
  renderSessionInfo(sel.value);
}

function renderSessionInfo(sessionId) {
  const s = (SESSIONS||[]).find(x=>x.sessionId===sessionId);
  const box = el("sessionInfo");
  if(!box) return;
  if(!s) { box.textContent=""; return; }
  box.textContent = `📅 ${s.date} (${dayShort(s.date)}) ${s.start}-${s.end}  ·  📍 ${s.venue}  ·  CAP ${s.capacity}`;
}

function dedupeLatestByName(rows) {
  const m = new Map();
  for(const r of (rows||[])) {
    const name = String(r.name||"").trim().toLowerCase();
    if(!name) continue;
    const ts = new Date(r.timestamp||0).getTime() || 0;
    const prev = m.get(name);
    if(!prev || ts >= prev._ts) m.set(name, {...r, _ts: ts});
  }
  return Array.from(m.values());
}

function allocateDisplay(rows, cap) {
  const yes = rows.filter(r => String(r.status||"").toUpperCase()==="YES");
  yes.sort((a,b)=>(a._ts||0)-(b._ts||0));
  const confirmed=[]; const wait=[]; let used=0; let waitUsed=0;

  for(const r of yes) {
    const pax = Math.max(1, Number(r.pax)||1);
    if(used + pax <= cap) {
      confirmed.push(r); used += pax;
    } else if(waitUsed + pax <= WAITLIST_LIMIT) {
      wait.push(r); waitUsed += pax;
    }
  }
  return {confirmed, wait, used, waitUsed};
}

async function loadList(sessionId) {
  const data = await apiGet({ action:"list", sessionId });
  if(!data.ok) throw new Error(data.error || "load list failed");
  const rows = dedupeLatestByName(data.current || data.rows || []);
  const s = (SESSIONS||[]).find(x=>x.sessionId===sessionId) || {};
  const cap = Math.max(0, Number(s.capacity)||0);
  const b = allocateDisplay(rows, cap);

  el("summary").textContent = `名額：${b.used}/${cap}（尚餘 ${Math.max(0,cap-b.used)}）`;
  el("waitSummary").textContent = `候補：${b.waitUsed}/${WAITLIST_LIMIT}（尚餘 ${Math.max(0,WAITLIST_LIMIT-b.waitUsed)}）`;

  el("list").innerHTML = b.confirmed.length
    ? "<ul>"+b.confirmed.map(r=>`<li>${esc(r.name)} <span class="muted">(${esc(r.pax||1)})</span></li>`).join("")+"</ul>"
    : "<div class='muted'>暫時無出席 / No confirmed attendees</div>";

  el("waitList").innerHTML = b.wait.length
    ? "<ul>"+b.wait.map(r=>`<li>${esc(r.name)} <span class="muted">(${esc(r.pax||1)})</span></li>`).join("")+"</ul>"
    : "<div class='muted'>暫時無候補 / No one on waitlist</div>";
}

function selectedStatus() {
  const r = document.querySelector('input[name="status"]:checked');
  return r ? String(r.value||"").toUpperCase() : "";
}

async function onSubmit(ev) {
  ev.preventDefault();
  showWarn("");
  setText("msg","");

  const sessionId = el("sessionSelect").value;
  const name = String(el("name").value||"").trim();
  const pax = Math.max(1, Number(el("pax").value)||1);
  const note = String(el("note").value||"").trim();
  const status = selectedStatus();

  if(!sessionId) return setText("msg","請先選擇場次 / Please select a session.");
  if(!name) return setText("msg","請輸入姓名 / Please enter your name.");
  if(!status) return setText("msg","請選擇狀態 / Please select a status.");

  if(status === "MAYBE") {
    showWarn(nextPsycho());
    setText("msg","「可能 / MAYBE」只作提示，不會提交登記。\n'Maybe' will NOT submit. Please choose YES or NO.");
    return; // DO NOT call API
  }

  const res = await apiPost({
    action:"rsvp",
    sessionId, name, status, pax, note
  });

  if(!res.ok) {
    setText("msg", res.error || "提交失敗 / Submit failed.");
    return;
  }

  const placement = String(res.placement||"").toUpperCase();
  if(status === "NO") {
    setText("msg","已更新為缺席 / Updated as NO.");
  } else if(placement === "CONFIRMED") {
    setText("msg","你已成功報名出席 / Successfully registered.");
  } else if(placement === "WAITLIST") {
    setText("msg","你已進入候補名單 / You are on the waitlist.");
  } else if(placement === "OVERFLOW") {
    setText("msg","已記錄，但已超出候補上限 / Recorded but overflowed waitlist.");
  } else {
    setText("msg","已更新 / Updated.");
  }

  await loadList(sessionId);
}

async function onCancel() {
  const no = document.querySelector('input[name="status"][value="NO"]');
  if(no) no.checked = true;
  showWarn("");
  setText("msg","");
  await onSubmit(new Event("submit"));
}

async function init() {
  el("rsvpForm").addEventListener("submit", (e)=>onSubmit(e).catch(err=>setText("msg", err.message||String(err))));
  el("cancelBtn").addEventListener("click", ()=>onCancel().catch(err=>setText("msg", err.message||String(err))));
  el("sessionSelect").addEventListener("change", ()=>{ renderSessionInfo(el("sessionSelect").value); loadList(el("sessionSelect").value).catch(()=>{}); });

  const data = await apiGet({ action:"sessions" });
  if(!data.ok) throw new Error(data.error || "load sessions failed");
  SESSIONS = data.sessions || [];
  const sid = closestOpenId(SESSIONS);
  renderSessions(SESSIONS, sid);
  if(sid) await loadList(sid);
}

document.addEventListener("DOMContentLoaded", ()=>{ init().catch(err=>setText("msg", err.message||String(err))); });
