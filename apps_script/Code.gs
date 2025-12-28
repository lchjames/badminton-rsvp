/**
 * YR Badminton RSVP (Scheme 2)
 * - Backend returns placement after RSVP: CONFIRMED / WAITLIST / OVERFLOW / NO
 * - Sunday-only session dates enforced on create/update
 * - Admin: create/update/delete session (cascade delete RSVPs); list RSVPs (dedup latest per name)
 *
 * Sheet tabs:
 *  Sessions: sessionId,title,date,start,end,venue,capacity,note,isOpen,createdAt,updatedAt
 *  RSVPs:    rowId,sessionId,name,status,pax,note,timestamp
 */

// ====== CONFIG (HARD-CODED) ======
const SPREADSHEET_ID = "1WAAWlRoyyYoq6B_cKBDaJBO_WS-YKjpnAYWMKlnk98w";
const ADMIN_KEY = "CHANGE_THIS_TO_YOUR_ADMIN_KEY";
const WAITLIST_LIMIT = 6;

// ====== ENTRY ======
function doGet(e){
  try{
    const action = String((e && e.parameter && e.parameter.action) || "").trim().toLowerCase();
    if(action === "sessions") return json_({ ok:true, sessions: listSessions_(true) });
    if(action === "sessions_all") return json_({ ok:true, sessions: listSessions_(false) });
    if(action === "list") {
      const sid = String((e.parameter||{}).sessionId || "").trim();
      return json_(listRsvpsPublic_(sid));
    }
    return json_({ ok:false, error:"unknown action" });
  }catch(err){
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

function doPost(e){
  try{
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(body.action || "").trim();

    if(action === "rsvp"){
      return json_(upsertRsvpWithPlacement_(body));
    }

    if(String(body.adminKey||"") !== ADMIN_KEY){
      return json_({ ok:false, error:"unauthorized" });
    }

    if(action === "admin_createSession") return json_(adminCreateSession_(body));
    if(action === "admin_updateSession") return json_(adminUpdateSession_(body));
    if(action === "admin_deleteSession") return json_(adminDeleteSession_(String(body.sessionId||"").trim()));
    if(action === "admin_listRsvps") return json_(adminListRsvps_(body));
    if(action === "admin_updateRsvp") return json_(adminUpdateRsvp_(body));
    if(action === "admin_deleteRsvp") return json_(adminDeleteRsvp_(body));

    return json_({ ok:false, error:"unknown action" });
  }catch(err){
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

// ====== JSON ======
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====== SHEET HELPERS ======
function ss_(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }

function ensureSheets_(){
  const ss = ss_();
  const sessions = ensureSheet_(ss, "Sessions", ["sessionId","title","date","start","end","venue","capacity","note","isOpen","createdAt","updatedAt"]);
  const rsvps = ensureSheet_(ss, "RSVPs", ["rowId","sessionId","name","status","pax","note","timestamp"]);
  return { ss, sessions, rsvps };
}

function ensureSheet_(ss, name, headers){
  let sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  } else {
    // Ensure header row has at least these headers (do not overwrite existing user data)
    const row1 = sh.getRange(1,1,1,Math.max(headers.length, sh.getLastColumn())).getValues()[0];
    const have = row1.map(v=>String(v||"").trim());
    const missing = headers.filter(h=>!have.includes(h));
    if(missing.length){
      sh.getRange(1, sh.getLastColumn()+1, 1, missing.length).setValues([missing]);
    }
  }
  return sh;
}

function nowIso_(){ return new Date().toISOString(); }

function isSunday_(yyyyMMdd){
  const d = new Date(String(yyyyMMdd).trim()+"T00:00:00");
  return d.getDay() === 0;
}

function norm_(s){ return String(s||"").trim().toLowerCase(); }

function parseTs_(v){
  if(v instanceof Date) return v.getTime();
  const s = String(v||"").trim();
  if(!s) return 0;
  // support "YYYY-MM-DD HH:mm:ss" or ISO
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
  return isNaN(t) ? 0 : t;
}

// ====== SESSIONS ======
function listSessions_(openOnly){
  const { sessions } = ensureSheets_();
  const data = sessions.getDataRange().getValues();
  const head = data.shift();
  const idx = indexMap_(head);
  const out = [];
  for(const r of data){
    const sid = String(r[idx.sessionid]||"").trim();
    if(!sid) continue;
    const isOpen = String(r[idx.isopen]||"").toUpperCase() === "TRUE";
    if(openOnly && !isOpen) continue;
    out.push({
      sessionId: sid,
      title: String(r[idx.title]||""),
      date: fmtDateCell_(r[idx.date]),
      start: String(r[idx.start]||""),
      end: String(r[idx.end]||""),
      venue: String(r[idx.venue]||""),
      capacity: Number(r[idx.capacity]||0) || 0,
      note: String(r[idx.note]||""),
      isOpen
    });
  }
  // sort by date/time
  out.sort((a,b)=> (a.date+a.start).localeCompare(b.date+b.start));
  return out;
}

function adminCreateSession_(b){
  const date = String(b.date||"").trim();
  if(!isSunday_(date)) return { ok:false, error:"date must be Sunday" };

  const { sessions } = ensureSheets_();
  const sid = String(b.sessionId||"").trim() || Utilities.getUuid();
  const title = String(b.title||"YR Badminton");
  const start = String(b.start||"17:00");
  const end = String(b.end||"19:00");
  const venue = String(b.venue||"Goodminton");
  const cap = Number(b.capacity||20) || 20;
  const note = String(b.note||"");
  const isOpen = !!b.isOpen;

  sessions.appendRow([sid,title,date,start,end,venue,cap,note,isOpen ? "TRUE":"FALSE", nowIso_(), nowIso_()]);
  return { ok:true, sessionId: sid };
}

function adminUpdateSession_(b){
  const s = b.session || {};
  const sid = String(s.sessionId||"").trim();
  if(!sid) return { ok:false, error:"missing sessionId" };
  if(!isSunday_(s.date)) return { ok:false, error:"date must be Sunday" };

  const { sessions } = ensureSheets_();
  const data = sessions.getDataRange().getValues();
  const head = data.shift();
  const idx = indexMap_(head);

  for(let r=0; r<data.length; r++){
    if(String(data[r][idx.sessionid]||"").trim() === sid){
      const createdAt = data[r][idx.createdat] || "";
      const row = [
        sid,
        String(s.title||"YR Badminton"),
        String(s.date||""),
        String(s.start||"17:00"),
        String(s.end||"19:00"),
        String(s.venue||"Goodminton"),
        Number(s.capacity||20) || 20,
        String(s.note||""),
        s.isOpen ? "TRUE":"FALSE",
        createdAt,
        nowIso_()
      ];
      sessions.getRange(r+2, 1, 1, row.length).setValues([row]);
      return { ok:true };
    }
  }
  return { ok:false, error:"session not found" };
}

function adminDeleteSession_(sid){
  if(!sid) return { ok:false, error:"missing sessionId" };
  const { sessions, rsvps } = ensureSheets_();

  // delete session rows
  const sData = sessions.getDataRange().getValues();
  const sHead = sData.shift();
  const sIdx = indexMap_(sHead);
  for(let r=sData.length-1; r>=0; r--){
    if(String(sData[r][sIdx.sessionid]||"").trim() === sid){
      sessions.deleteRow(r+2);
    }
  }

  // cascade delete RSVPs
  const rData = rsvps.getDataRange().getValues();
  const rHead = rData.shift();
  const rIdx = indexMap_(rHead);
  for(let r=rData.length-1; r>=0; r--){
    if(String(rData[r][rIdx.sessionid]||"").trim() === sid){
      rsvps.deleteRow(r+2);
    }
  }
  return { ok:true };
}

// ====== RSVP LIST / DEDUPE ======
function listRsvpsPublic_(sid){
  if(!sid) return { ok:true, current:[], summary:{} };
  const { rsvps } = ensureSheets_();
  const rows = getRsvpsBySession_(rsvps, sid);
  const current = dedupeLatestByName_(rows);

  // compute summary (confirmed/waitlist/overflow) for display
  const sess = findSession_(sid);
  const cap = Number(sess && sess.capacity || 0) || 0;
  const buckets = allocate_(current, cap, WAITLIST_LIMIT);

  return {
    ok:true,
    session: sess || null,
    current: current,
    summary: {
      capacity: cap,
      confirmedPax: buckets.confirmedPax,
      waitlistPax: buckets.waitlistPax,
      overflowPax: buckets.overflowPax,
      waitlistLimit: WAITLIST_LIMIT
    },
    buckets: buckets
  };
}

function adminListRsvps_(b){
  const sid = String(b.sessionId||"").trim();
  if(!sid) return { ok:true, current:[], summary:{} };
  const { rsvps } = ensureSheets_();
  const rows = getRsvpsBySession_(rsvps, sid);
  const current = dedupeLatestByName_(rows);
  const sess = findSession_(sid);
  const cap = Number(sess && sess.capacity || 0) || 0;
  const buckets = allocate_(current, cap, WAITLIST_LIMIT);

  return {
    ok:true,
    session: sess || null,
    current: current,
    summary: {
      capacity: cap,
      confirmedPax: buckets.confirmedPax,
      waitlistPax: buckets.waitlistPax,
      overflowPax: buckets.overflowPax,
      waitlistLimit: WAITLIST_LIMIT
    },
    buckets
  };
}

function getRsvpsBySession_(rsvpsSheet, sid){
  const data = rsvpsSheet.getDataRange().getValues();
  const head = data.shift();
  const idx = indexMap_(head);
  const out = [];
  for(const r of data){
    if(String(r[idx.sessionid]||"").trim() !== sid) continue;
    out.push({
      rowId: String(r[idx.rowid]||"").trim(),
      sessionId: String(r[idx.sessionid]||"").trim(),
      name: String(r[idx.name]||"").trim(),
      status: String(r[idx.status]||"").trim(),
      pax: Number(r[idx.pax]||1) || 1,
      note: String(r[idx.note]||""),
      timestamp: String(r[idx.timestamp]||"")
    });
  }
  return out;
}

function dedupeLatestByName_(rows){
  // keep latest record per name (case-insensitive), based on timestamp
  const map = {};
  for(const r of rows){
    const key = norm_(r.name);
    const ts = parseTs_(r.timestamp);
    const prev = map[key];
    if(!prev || ts >= parseTs_(prev.timestamp)){
      map[key] = r;
    }
  }
  return Object.values(map).sort((a,b)=>parseTs_(a.timestamp)-parseTs_(b.timestamp));
}

function allocate_(currentRows, capacity, waitLimit){
  const yes = currentRows.filter(r=>String(r.status||"").toUpperCase()==="YES");
  // order by timestamp ascending (earlier gets in)
  yes.sort((a,b)=>parseTs_(a.timestamp)-parseTs_(b.timestamp));

  const confirmed = [];
  const waitlist = [];
  const overflow = [];
  let used = 0;
  let waitUsed = 0;

  for(const r of yes){
    const p = Number(r.pax||1) || 1;
    if(used + p <= capacity){
      confirmed.push(r);
      used += p;
    } else if(waitUsed + p <= waitLimit){
      waitlist.push(r);
      waitUsed += p;
    } else {
      overflow.push(r);
    }
  }

  return {
    confirmed, waitlist, overflow,
    confirmedPax: used,
    waitlistPax: waitUsed,
    overflowPax: overflow.reduce((s,r)=>s+(Number(r.pax||1)||1),0)
  };
}

// ====== RSVP WRITE (RETURN PLACEMENT) ======
function upsertRsvpWithPlacement_(b){
  const sid = String(b.sessionId||"").trim();
  const name = String(b.name||"").trim();
  const status = String(b.status||"").trim().toUpperCase();
  const pax = Number(b.pax||1) || 1;
  const note = String(b.note||"");

  if(!sid) return { ok:false, error:"missing sessionId" };
  if(!name) return { ok:false, error:"missing name" };
  if(status === "MAYBE") return { ok:false, error:"maybe not allowed" };

  // ensure session exists and open
  const sess = findSession_(sid);
  if(!sess) return { ok:false, error:"session not found" };
  if(!sess.isOpen) return { ok:false, error:"session closed" };

  const { rsvps } = ensureSheets_();
  const data = rsvps.getDataRange().getValues();
  const head = data.shift();
  const idx = indexMap_(head);

  // find existing row by (sessionId + name case-insensitive)
  let targetRow = -1;
  for(let r=0; r<data.length; r++){
    if(String(data[r][idx.sessionid]||"").trim() === sid &&
       norm_(data[r][idx.name]) === norm_(name)){
      targetRow = r + 2;
    }
  }

  const ts = nowIso_();
  const rowId = targetRow>0 ? String(rsvps.getRange(targetRow, idx.rowid+1).getValue() || "").trim() : Utilities.getUuid();
  const row = [rowId, sid, name, status, String(pax), note, ts];

  if(targetRow>0){
    rsvps.getRange(targetRow, 1, 1, row.length).setValues([row]);
  } else {
    rsvps.appendRow(row);
  }

  // compute placement based on CURRENT state after write (dedupe latest)
  const allRows = getRsvpsBySession_(rsvps, sid);
  const current = dedupeLatestByName_(allRows);
  const cap = Number(sess.capacity||0) || 0;
  const buckets = allocate_(current, cap, WAITLIST_LIMIT);

  // determine placement for THIS name
  const who = norm_(name);
  if(status === "NO"){
    return {
      ok:true,
      placement:"NO",
      summary:{ capacity:cap, confirmedPax:buckets.confirmedPax, waitlistPax:buckets.waitlistPax, waitlistLimit:WAITLIST_LIMIT }
    };
  }

  const inConfirmed = buckets.confirmed.some(r=>norm_(r.name)===who);
  const inWait = buckets.waitlist.some(r=>norm_(r.name)===who);

  if(inConfirmed){
    return {
      ok:true,
      placement:"CONFIRMED",
      summary:{ capacity:cap, confirmedPax:buckets.confirmedPax, waitlistPax:buckets.waitlistPax, waitlistLimit:WAITLIST_LIMIT }
    };
  }
  if(inWait){
    return {
      ok:true,
      placement:"WAITLIST",
      summary:{ capacity:cap, confirmedPax:buckets.confirmedPax, waitlistPax:buckets.waitlistPax, waitlistLimit:WAITLIST_LIMIT }
    };
  }

  // overflow waitlist
  return {
    ok:true,
    placement:"OVERFLOW",
    summary:{ capacity:cap, confirmedPax:buckets.confirmedPax, waitlistPax:buckets.waitlistPax, waitlistLimit:WAITLIST_LIMIT },
    error:"waitlist full"
  };
}

function adminUpdateRsvp_(b){
  const rowId = String(b.rowId||"").trim();
  if(!rowId) return { ok:false, error:"missing rowId" };

  const { rsvps } = ensureSheets_();
  const data = rsvps.getDataRange().getValues();
  const head = data.shift();
  const idx = indexMap_(head);

  for(let r=0; r<data.length; r++){
    if(String(data[r][idx.rowid]||"").trim() === rowId){
      const sid = String(b.sessionId||data[r][idx.sessionid]||"").trim();
      const name = String(b.name||data[r][idx.name]||"").trim();
      const status = String(b.status||data[r][idx.status]||"").trim().toUpperCase();
      const pax = Number(b.pax||data[r][idx.pax]||1) || 1;
      const note = String(b.note||data[r][idx.note]||"");
      rsvps.getRange(r+2, 1, 1, 7).setValues([[rowId, sid, name, status, String(pax), note, nowIso_()]]);
      return { ok:true };
    }
  }
  return { ok:false, error:"row not found" };
}

function adminDeleteRsvp_(b){
  const rowId = String(b.rowId||"").trim();
  if(!rowId) return { ok:false, error:"missing rowId" };

  const { rsvps } = ensureSheets_();
  const data = rsvps.getDataRange().getValues();
  const head = data.shift();
  const idx = indexMap_(head);

  for(let r=data.length-1; r>=0; r--){
    if(String(data[r][idx.rowid]||"").trim() === rowId){
      rsvps.deleteRow(r+2);
      return { ok:true };
    }
  }
  return { ok:true };
}

// ====== SESSION LOOKUP ======
function findSession_(sid){
  const sessions = listSessions_(false);
  for(const s of sessions){
    if(String(s.sessionId||"").trim() === sid) return s;
  }
  return null;
}

function fmtDateCell_(v){
  if(v instanceof Date){
    return Utilities.formatDate(v, Session.getScriptTimeZone() || "Australia/Brisbane", "yyyy-MM-dd");
  }
  const s = String(v||"").trim();
  if(!s) return "";
  // if already yyyy-mm-dd
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if(!isNaN(t)){
    return Utilities.formatDate(new Date(t), Session.getScriptTimeZone() || "Australia/Brisbane", "yyyy-MM-dd");
  }
  return s;
}

// ====== HEADER MAP (case-insensitive, trimmed) ======
function indexMap_(headers){
  const m = {};
  for(let i=0;i<headers.length;i++){
    const key = String(headers[i]||"").trim().toLowerCase();
    if(key) m[key]=i;
  }
  return {
    sessionid: m["sessionid"],
    title: m["title"],
    date: m["date"],
    start: m["start"],
    end: m["end"],
    venue: m["venue"],
    capacity: m["capacity"],
    note: m["note"],
    isopen: m["isopen"],
    createdat: m["createdat"],
    updatedat: m["updatedat"],
    rowid: m["rowid"],
    name: m["name"],
    status: m["status"],
    pax: m["pax"],
    timestamp: m["timestamp"]
  };
}