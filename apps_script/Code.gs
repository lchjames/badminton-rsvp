/**
 * YR Badminton RSVP - Apps Script backend
 *
 * Sheets:
 *   Sessions: sessionId | title | date | start | end | venue | capacity | note | isOpen | createdAt | updatedAt
 *   RSVPs:    rowId | sessionId | name | status | pax | note | timestamp
 *
 * Rules:
 * - "MAYBE" is NOT accepted by backend (front-end must block).
 * - Waitlist is NOT a selectable status; it is computed (placement) based on cap and WAITLIST_LIMIT.
 * - Sunday-only enforced for create/update session (backend).
 */

const WAITLIST_LIMIT = 6;

function getCfg_(){
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty("1WAAWlRoyyYoq6B_cKBDaJBO_WS-YKjpnAYWMKlnk98w");
  const adminKey = props.getProperty("JamesIsTheBest");
  if(!sheetId) throw new Error("SHEET_ID not set in Script Properties");
  if(!adminKey) throw new Error("ADMIN_KEY not set in Script Properties");
  return { sheetId, adminKey };
}

function doGet(e){
  try{
    const action = String((e.parameter||{}).action || "").trim();
    if(action === "sessions") return json_(listSessions_(true));
    if(action === "sessions_all") return json_(listSessions_(false));
    if(action === "list"){
      const sessionId = String((e.parameter||{}).sessionId||"").trim();
      return json_(listRsvpsPublic_(sessionId));
    }
    return json_({ ok:false, error:"unknown action" });
  }catch(err){
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

function doPost(e){
  try{
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
    const action = String(body.action||"").trim();

    if(action === "rsvp"){
      return json_(upsertRsvp_(body));
    }

    if(action.startsWith("admin_")){
      const cfg = getCfg_();
      const key = String(body.adminKey||"").trim();
      if(key !== cfg.adminKey) return json_({ ok:false, error:"unauthorized" });

      if(action === "admin_createSession") return json_(adminCreateSession_(body));
      if(action === "admin_updateSession") return json_(adminUpdateSession_(body));
      if(action === "admin_deleteSession") return json_(adminDeleteSession_(String(body.sessionId||"").trim()));
      if(action === "admin_listRsvps") return json_(adminListRsvps_(body));
      if(action === "admin_updateRsvp") return json_(adminUpdateRsvp_(body));
      if(action === "admin_deleteRsvp") return json_(adminDeleteRsvp_(body));
    }

    return json_({ ok:false, error:"unknown action" });
  }catch(err){
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function tz_(){ return Session.getScriptTimeZone() || "Australia/Brisbane"; }

function openSs_(){
  const cfg = getCfg_();
  return SpreadsheetApp.openById(cfg.sheetId);
}

function ensureSheets_(){
  const ss = openSs_();
  const sess = ensureSheet_(ss, "Sessions", ["sessionId","title","date","start","end","venue","capacity","note","isOpen","createdAt","updatedAt"]);
  const rsvps = ensureSheet_(ss, "RSVPs", ["rowId","sessionId","name","status","pax","note","timestamp"]);
  return { ss, sess, rsvps };
}

function ensureSheet_(ss, name, headers){
  let sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  }else{
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    if(sh.getLastColumn() > headers.length){
      sh.deleteColumns(headers.length+1, sh.getLastColumn()-headers.length);
    }
  }
  return sh;
}

function indexMap_(headers){
  const m = {};
  headers.forEach((h,i)=> m[String(h)] = i);
  return m;
}

function requireSunday_(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  const dow = Utilities.formatDate(d, tz_(), "u"); // 1-7, Sun=7
  if(String(dow) !== "7") throw new Error("date must be Sunday");
}

function listSessions_(openOnly){
  const { sess } = ensureSheets_();
  const values = sess.getDataRange().getValues();
  const headers = values.shift();
  const idx = indexMap_(headers);

  const out = values
    .filter(r=> String(r[idx.sessionId]||"").trim() !== "")
    .map(r=>({
      sessionId: String(r[idx.sessionId]),
      title: String(r[idx.title]||"YR Badminton"),
      date: Utilities.formatDate(new Date(r[idx.date]), tz_(), "yyyy-MM-dd"),
      start: String(r[idx.start]||"17:00"),
      end: String(r[idx.end]||"19:00"),
      venue: String(r[idx.venue]||"Goodminton"),
      capacity: Number(r[idx.capacity]||20),
      note: String(r[idx.note]||""),
      isOpen: String(r[idx.isOpen]).toUpperCase()==="TRUE",
      createdAt: String(r[idx.createdAt]||""),
      updatedAt: String(r[idx.updatedAt]||"")
    }))
    .filter(s=> openOnly ? s.isOpen : true)
    .sort((a,b)=> (a.date+a.start).localeCompare(b.date+b.start));

  return { ok:true, sessions: out };
}

function adminCreateSession_(p){
  const dateStr = String(p.date||"").trim();
  requireSunday_(dateStr);

  const { sess } = ensureSheets_();
  const sessionId = Utilities.getUuid();
  const now = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd HH:mm:ss");

  sess.appendRow([
    sessionId,
    String(p.title||"YR Badminton").trim(),
    dateStr,
    String(p.start||"17:00").trim(),
    String(p.end||"19:00").trim(),
    String(p.venue||"Goodminton").trim(),
    Math.max(1, Number(p.capacity||20)||20),
    String(p.note||"").trim(),
    !!p.isOpen,
    now,
    now
  ]);

  return { ok:true, sessionId };
}

function adminUpdateSession_(p){
  const session = p.session || {};
  const sessionId = String(session.sessionId||"").trim();
  if(!sessionId) return { ok:false, error:"missing sessionId" };

  const dateStr = String(session.date||"").trim();
  requireSunday_(dateStr);

  const { sess } = ensureSheets_();
  const values = sess.getDataRange().getValues();
  const headers = values.shift();
  const idx = indexMap_(headers);

  let targetRow = -1;
  for(let i=0;i<values.length;i++){
    if(String(values[i][idx.sessionId])===sessionId){ targetRow = i+2; break; }
  }
  if(targetRow<0) return { ok:false, error:"session not found" };

  const createdAt = String(values[targetRow-2][idx.createdAt]||"");
  const now = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd HH:mm:ss");

  sess.getRange(targetRow, 1, 1, 11).setValues([[
    sessionId,
    String(session.title||"YR Badminton").trim(),
    dateStr,
    String(session.start||"17:00").trim(),
    String(session.end||"19:00").trim(),
    String(session.venue||"Goodminton").trim(),
    Math.max(1, Number(session.capacity||20)||20),
    String(session.note||"").trim(),
    !!session.isOpen,
    createdAt,
    now
  ]]);

  return { ok:true };
}

function adminDeleteSession_(sessionId){
  const { sess, rsvps } = ensureSheets_();

  // delete session row
  const sessVals = sess.getDataRange().getValues();
  const sh = sessVals.shift();
  const si = indexMap_(sh);
  for(let i=sessVals.length-1;i>=0;i--){
    if(String(sessVals[i][si.sessionId])===sessionId){
      sess.deleteRow(i+2);
      break;
    }
  }

  // delete all rsvps for session
  const rVals = rsvps.getDataRange().getValues();
  const rh = rVals.shift();
  const ri = indexMap_(rh);
  for(let i=rVals.length-1;i>=0;i--){
    if(String(rVals[i][ri.sessionId])===sessionId){
      rsvps.deleteRow(i+2);
    }
  }
  return { ok:true };
}

function upsertRsvp_(p){
  const { rsvps } = ensureSheets_();

  const sessionId = String(p.sessionId||"").trim();
  const name = String(p.name||"").trim();
  const statusRaw = String(p.status||"").trim().toUpperCase();
  const pax = Math.max(1, Math.min(20, Number(p.pax||1)||1));
  const note = String(p.note||"").trim();

  if(!sessionId) return { ok:false, error:"missing sessionId" };
  if(!name) return { ok:false, error:"missing name" };
  if(statusRaw === "MAYBE") return { ok:false, error:"MAYBE is not an option" };
  if(statusRaw !== "YES" && statusRaw !== "NO") return { ok:false, error:"invalid status" };

  const sess = listSessions_(false).sessions;
  const s = sess.find(x=>x.sessionId===sessionId);
  if(!s) return { ok:false, error:"session not found" };
  if(!s.isOpen) return { ok:false, error:"session is closed" };

  const values = rsvps.getDataRange().getValues();
  const headers = values.shift();
  const idx = indexMap_(headers);

  // Update-in-place by (sessionId,name) - latest wins
  let rowNum = -1;
  for(let i=0;i<values.length;i++){
    if(String(values[i][idx.sessionId])===sessionId &&
       String(values[i][idx.name]).trim().toLowerCase()===name.toLowerCase()){
      rowNum = i+2;
    }
  }

  const ts = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd HH:mm:ss");
  const rowId = rowNum > 0 ? String(rsvps.getRange(rowNum, idx.rowId+1).getValue()) : Utilities.getUuid();
  const row = [rowId, sessionId, name, statusRaw, pax, note, ts];

  if(rowNum > 0) rsvps.getRange(rowNum, 1, 1, row.length).setValues([row]);
  else rsvps.appendRow(row);

  const alloc = allocate_(sessionId, s.capacity);
  const me = alloc.current.find(x=>x.name.toLowerCase()===name.toLowerCase());

  if(statusRaw === "YES"){
    if(!me) return { ok:false, error:"internal allocation error" };
    if(me.placement === "OVERFLOW"){
      // revert to NO to not block others
      const row2 = [rowId, sessionId, name, "NO", pax, "Auto-rejected: full", ts];
      if(rowNum > 0) rsvps.getRange(rowNum, 1, 1, row2.length).setValues([row2]);
      else rsvps.appendRow(row2);
      return { ok:false, error:"full (including waitlist)" };
    }
    return { ok:true, placement: me.placement };
  }

  return { ok:true, placement:"NO" };
}

function listRsvpsPublic_(sessionId){
  if(!sessionId) return { ok:false, error:"missing sessionId" };
  const sess = listSessions_(false).sessions;
  const s = sess.find(x=>x.sessionId===sessionId);
  if(!s) return { ok:false, error:"session not found" };

  const alloc = allocate_(sessionId, s.capacity);
  return { ok:true, current: alloc.current, summary: alloc.summary };
}

function adminListRsvps_(p){
  const sessionId = String(p.sessionId||"").trim();
  if(!sessionId) return { ok:false, error:"missing sessionId" };

  const sess = listSessions_(false).sessions;
  const s = sess.find(x=>x.sessionId===sessionId);
  if(!s) return { ok:false, error:"session not found" };

  const alloc = allocate_(sessionId, s.capacity);
  return { ok:true, current: alloc.current, summary: alloc.summary };
}

function adminUpdateRsvp_(p){
  const { rsvps } = ensureSheets_();
  const sessionId = String(p.sessionId||"").trim();
  const rowId = String(p.rowId||"").trim();
  const name = String(p.name||"").trim();
  const status = String(p.status||"").trim().toUpperCase();
  const pax = Math.max(1, Math.min(20, Number(p.pax||1)||1));
  const note = String(p.note||"").trim();

  if(!sessionId || !rowId) return { ok:false, error:"missing id" };
  if(!name) return { ok:false, error:"missing name" };
  if(status !== "YES" && status !== "NO") return { ok:false, error:"invalid status" };

  const values = rsvps.getDataRange().getValues();
  const headers = values.shift();
  const idx = indexMap_(headers);

  let targetRow = -1;
  for(let i=0;i<values.length;i++){
    if(String(values[i][idx.rowId])===rowId && String(values[i][idx.sessionId])===sessionId){
      targetRow = i+2; break;
    }
  }
  if(targetRow < 0) return { ok:false, error:"row not found" };

  const ts = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd HH:mm:ss");
  rsvps.getRange(targetRow, 1, 1, 7).setValues([[rowId, sessionId, name, status, pax, note, ts]]);

  // enforce overflow for YES
  const sess = listSessions_(false).sessions;
  const s = sess.find(x=>x.sessionId===sessionId);
  if(s){
    const alloc = allocate_(sessionId, s.capacity);
    const me = alloc.current.find(x=>x.rowId===rowId);
    if(status==="YES" && me && me.placement==="OVERFLOW"){
      return { ok:false, error:"full (including waitlist)" };
    }
  }
  return { ok:true };
}

function adminDeleteRsvp_(p){
  const { rsvps } = ensureSheets_();
  const sessionId = String(p.sessionId||"").trim();
  const rowId = String(p.rowId||"").trim();
  if(!sessionId || !rowId) return { ok:false, error:"missing id" };

  const values = rsvps.getDataRange().getValues();
  const headers = values.shift();
  const idx = indexMap_(headers);

  for(let i=values.length-1;i>=0;i--){
    if(String(values[i][idx.rowId])===rowId && String(values[i][idx.sessionId])===sessionId){
      rsvps.deleteRow(i+2);
      return { ok:true };
    }
  }
  return { ok:false, error:"row not found" };
}

function allocate_(sessionId, capacity){
  const { rsvps } = ensureSheets_();
  const values = rsvps.getDataRange().getValues();
  const headers = values.shift();
  const idx = indexMap_(headers);

  // latest row per name (case-insensitive)
  const map = {};
  for(const r of values){
    const sid = String(r[idx.sessionId]||"");
    if(sid !== sessionId) continue;
    const name = String(r[idx.name]||"").trim();
    if(!name) continue;
    const key = name.toLowerCase();
    const ts = String(r[idx.timestamp]||"");
    const existing = map[key];
    if(!existing || String(existing.timestamp) < ts){
      map[key] = {
        rowId: String(r[idx.rowId]||""),
        sessionId: sid,
        name,
        status: String(r[idx.status]||"").toUpperCase(),
        pax: Number(r[idx.pax]||1)||1,
        note: String(r[idx.note]||""),
        timestamp: ts
      };
    }
  }
  const current = Object.values(map);

  const yes = current.filter(x=>x.status==="YES")
    .sort((a,b)=> String(a.timestamp).localeCompare(String(b.timestamp)));
  const no = current.filter(x=>x.status!=="YES");

  let used = 0;
  let waitUsed = 0;

  for(const x of yes){
    const p = Math.max(1, Number(x.pax||1)||1);
    if(used + p <= capacity){
      x.placement = "CONFIRMED";
      used += p;
    }else if(waitUsed + p <= WAITLIST_LIMIT){
      x.placement = "WAITLIST";
      waitUsed += p;
    }else{
      x.placement = "OVERFLOW";
    }
  }
  no.forEach(x=>x.placement="NO");

  return {
    current: yes.concat(no),
    summary: { confirmedPax: used, waitlistPax: waitUsed }
  };
}

// Auto-close past sessions but keep history
function closePastSessions_(){
  const { sess } = ensureSheets_();
  const values = sess.getDataRange().getValues();
  const headers = values.shift();
  const idx = indexMap_(headers);

  const today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd");
  let changed = 0;

  for(let i=0;i<values.length;i++){
    const row = values[i];
    const sid = String(row[idx.sessionId]||"");
    if(!sid) continue;

    const dateStr = Utilities.formatDate(new Date(row[idx.date]), tz_(), "yyyy-MM-dd");
    const isOpen = String(row[idx.isOpen]).toUpperCase()==="TRUE";
    if(isOpen && dateStr < today){
      sess.getRange(i+2, idx.isOpen+1).setValue(false);
      sess.getRange(i+2, idx.updatedAt+1).setValue(Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd HH:mm:ss"));
      changed++;
    }
  }
  return changed;
}

function dailyCleanup(){
  closePastSessions_();
}
