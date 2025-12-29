/* YR Badminton – app.js (fixed)
 * Key rules:
 * 1) MAYBE only shows warning (NO API call).
 * 2) Submit result message is based ONLY on backend placement (CONFIRMED/WAITLIST/OVERFLOW).
 * 3) Basic UI contract guard to prevent silent breakage.
 */

const API_BASE = "https://script.google.com/macros/s/AKfycbwLCg1vLgzeXwheEBWKzCl4YnLlQTmRYZyU8G-FSLJl5MZK4s2uJHDQLnYdwegOvZ5T/exec";
const WAITLIST_LIMIT = 6;

/* ===== Psycho lines (bilingual) ===== */
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
let psychoIdx = 0;
function nextPsychoLine() {
  const line = PSYCHO_LINES[psychoIdx % PSYCHO_LINES.length];
  psychoIdx += 1;
  return `${line.zh}\n${line.en}`;
}

/* ===== DOM helpers ===== */
function el(id){ return document.getElementById(id); }
function setMsg(id, t){
  const n = el(id);
  if(!n) return;
  n.textContent = t || "";
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

/* ===== UI Contract Guard ===== */
const REQUIRED_STATUS_VALUES = ["YES","NO","MAYBE"];
function assertUiContract_(){
  const missing = [];
  const ids = ["sessionSelect","name","pax","statusMsg","submitMsg","summary","list","waitSummary","waitList"];
  ids.forEach(id => { if(!el(id)) missing.push("#"+id); });

  const radios = Array.from(document.querySelectorAll('input[name="status"][type="radio"]'));
  const values = radios.map(r => String(r.value||"").trim().toUpperCase());
  REQUIRED_STATUS_VALUES.forEach(v => { if(!values.includes(v)) missing.push("status:"+v); });

  if(!API_BASE) missing.push("API_BASE");

  if(missing.length){
    const msg = "頁面結構/設定錯誤：缺少必要元件或選項：" + missing.join(", ");
    setMsg("submitMsg", msg);
    throw new Error(msg);
  }
}

/* ===== API ===== */
async function apiGet(params){
  const url = new URL(API_BASE);
  Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k, String(v)));
  const r = await fetch(url.toString(), { method:"GET" });
  const t = await r.text();
  let j;
  try{ j = JSON.parse(t); }catch(_){ throw new Error("Bad JSON: "+t); }
  return j;
}

async function apiPost(body){
  const r = await fetch(API_BASE, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body||{})
  });
  const t = await r.text();
  let j;
  try{ j = JSON.parse(t); }catch(_){ throw new Error("Bad JSON: "+t); }
  return j;
}

/* ===== Data ===== */
let SESSIONS = [];
let CURRENT_SESSION_ID = "";

/* ===== Sessions ===== */
function dayShort_(ymd){
  const d = new Date(ymd + "T00:00:00");
  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return names[d.getDay()] || "";
}

function pickClosestOpenSessionId_(sessions){
  const open = (sessions||[]).filter(s => !!s.isOpen);
  if(!open.length) return "";
  open.sort((a,b)=>{
    const ad = `${a.date||""}T${a.start||"00:00"}`;
    const bd = `${b.date||""}T${b.start||"00:00"}`;
    return ad.localeCompare(bd);
  });
  return open[0].sessionId || "";
}

function renderSessionOptions_(sessions, selectedId){
  const sel = el("sessionSelect");
  sel.innerHTML = "";
  const open = (sessions||[]).filter(s => !!s.isOpen);
  if(!open.length){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "暫時無開放場次 / No open sessions";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;

  open.sort((a,b)=>{
    const ad = `${a.date||""}T${a.start||"00:00"}`;
    const bd = `${b.date||""}T${b.start||"00:00"}`;
    return ad.localeCompare(bd);
  });

  open.forEach(s=>{
    const opt = document.createElement("option");
    opt.value = s.sessionId;
    opt.textContent = `${s.date} (${dayShort_(s.date)}) ${s.start}-${s.end} · ${s.venue}`;
    sel.appendChild(opt);
  });

  sel.value = selectedId || open[0].sessionId;
}

async function loadSessions(){
  setMsg("submitMsg","");
  setMsg("statusMsg","");
  const data = await apiGet({ action:"sessions" });
  if(!data.ok) throw new Error(data.error || "load sessions failed");
  SESSIONS = data.sessions || [];
  CURRENT_SESSION_ID = pickClosestOpenSessionId_(SESSIONS);
  renderSessionOptions_(SESSIONS, CURRENT_SESSION_ID);
  if(CURRENT_SESSION_ID){
    await loadAndRenderRsvps_(CURRENT_SESSION_ID);
  }else{
    renderSummary_({cap:0, confirmed:0, remaining:0, wait:0, waitRemain:WAITLIST_LIMIT});
    renderLists_([], []);
  }
}

/* ===== RSVP list & allocation (display only) ===== */
function dedupeLatestByName_(rows){
  const m = new Map();
  (rows||[]).forEach(r=>{
    const name = String(r.name||"").trim().toLowerCase();
    if(!name) return;
    const ts = new Date(r.timestamp || 0).getTime() || 0;
    const prev = m.get(name);
    if(!prev || ts >= (prev._ts||0)){
      m.set(name, { ...r, _ts: ts });
    }
  });
  return Array.from(m.values()).sort((a,b)=> (b._ts||0) - (a._ts||0));
}

function allocateForDisplay_(rows, cap, waitLimit){
  const yes = (rows||[]).filter(r => String(r.status||"").toUpperCase()==="YES");
  yes.sort((a,b)=>(a._ts||0)-(b._ts||0));

  const confirmed = [];
  const waitlist = [];
  let used = 0;

  for(const r of yes){
    const pax = Math.max(1, Number(r.pax)||1);
    if(used + pax <= cap){
      confirmed.push(r);
      used += pax;
    }else if(waitlist.length < waitLimit){
      waitlist.push(r);
    }
  }
  return { confirmed, waitlist, used };
}

function renderSummary_(s){
  el("summary").innerHTML = `
    <div class="kpi">
      <div class="kpi-title">目前出席名單 / Current Attendees</div>
      <div class="kpi-value">名額：${escapeHtml(s.confirmed)}/${escapeHtml(s.cap)}（尚餘 ${escapeHtml(s.remaining)}）</div>
    </div>`;
  el("waitSummary").innerHTML = `
    <div class="kpi">
      <div class="kpi-title">候補名單 / Waitlist</div>
      <div class="kpi-value">候補：${escapeHtml(s.wait)}/${escapeHtml(WAITLIST_LIMIT)}（尚餘 ${escapeHtml(s.waitRemain)}）</div>
    </div>`;
}

function renderLists_(confirmed, waitlist){
  const list = el("list");
  const wlist = el("waitList");

  list.innerHTML = confirmed.length
    ? confirmed.map(r=>`<li>${escapeHtml(r.name)} <span class="muted">(${escapeHtml(r.pax||1)})</span></li>`).join("")
    : `<li class="muted">暫時無出席 / No confirmed attendees</li>`;

  wlist.innerHTML = waitlist.length
    ? waitlist.map(r=>`<li>${escapeHtml(r.name)} <span class="muted">(${escapeHtml(r.pax||1)})</span></li>`).join("")
    : `<li class="muted">暫時無候補 / No one on waitlist</li>`;
}

async function loadAndRenderRsvps_(sessionId){
  const data = await apiGet({ action:"list", sessionId });
  if(!data.ok) throw new Error(data.error || "load rsvps failed");
  const rows = dedupeLatestByName_(data.current || data.rows || []);
  const sess = (SESSIONS||[]).find(s=>s.sessionId===sessionId) || {};
  const cap = Math.max(0, Number(sess.capacity)||0);

  const buckets = allocateForDisplay_(rows, cap, WAITLIST_LIMIT);
  renderSummary_({
    cap,
    confirmed: buckets.used,
    remaining: Math.max(0, cap - buckets.used),
    wait: buckets.waitlist.length,
    waitRemain: Math.max(0, WAITLIST_LIMIT - buckets.waitlist.length)
  });
  renderLists_(buckets.confirmed, buckets.waitlist);
}

/* ===== Submit ===== */
function getSelectedStatus(){
  const sel = document.querySelector('input[name="status"]:checked');
  return sel ? String(sel.value||"").toUpperCase() : "";
}

async function submitRsvp_(ev){
  ev?.preventDefault?.();
  setMsg("submitMsg","");
  setMsg("statusMsg","");

  const sessionId = el("sessionSelect").value;
  const name = String(el("name").value||"").trim();
  const pax = Math.max(1, Number(el("pax").value)||1);
  const status = getSelectedStatus();

  if(!sessionId){ setMsg("submitMsg","請先選擇場次 / Please select a session."); return; }
  if(!name){ setMsg("submitMsg","請輸入姓名 / Please enter your name."); return; }
  if(!status){ setMsg("submitMsg","請選擇狀態 / Please select a status."); return; }

  if(status === "MAYBE"){
    setMsg("statusMsg", nextPsychoLine());
    setMsg("submitMsg", "「可能 / MAYBE」不會提交登記，請改選 YES 或 NO。\n'Maybe' will NOT submit. Please choose YES or NO.");
    return; // MUST NOT call API
  }

  const res = await apiPost({
    action: "rsvp",
    sessionId,
    name,
    status,
    pax,
    note: ""
  });

  if(!res.ok){
    setMsg("submitMsg", res.error || "提交失敗 / Submit failed.");
    return;
  }

  const placement = String(res.placement || "").toUpperCase();
  if(placement === "CONFIRMED"){
    setMsg("submitMsg","你已成功報名出席 / Successfully registered.");
  }else if(placement === "WAITLIST"){
    setMsg("submitMsg","你已進入候補名單 / You are on the waitlist.");
  }else if(placement === "OVERFLOW"){
    setMsg("submitMsg","已記錄，但已超出候補上限 / Recorded but overflowed waitlist.");
  }else{
    setMsg("submitMsg","已更新 / Updated.");
  }

  CURRENT_SESSION_ID = sessionId;
  await loadAndRenderRsvps_(sessionId);
}

/* ===== Init ===== */
async function init(){
  assertUiContract_();

  el("sessionSelect").addEventListener("change", async ()=>{
    const sid = el("sessionSelect").value;
    if(sid){
      CURRENT_SESSION_ID = sid;
      await loadAndRenderRsvps_(sid);
    }
  });

  const form = document.querySelector("form");
  if(form){
    form.addEventListener("submit", submitRsvp_);
  }else{
    const btn = el("btnSubmit");
    if(btn) btn.addEventListener("click", submitRsvp_);
  }

  await loadSessions().catch(e=>{
    setMsg("submitMsg", e.message || String(e));
  });
}

document.addEventListener("DOMContentLoaded", ()=>{ init(); });
