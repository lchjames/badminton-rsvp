const SPREADSHEET_ID = "1WAAWlRoyyYoq6B_cKBDaJBO_WS-YKjpnAYWMKlnk98w";
const SHEET_SESSIONS = "sessions";
const SHEET_RSVPS = "rsvps";
const ADMIN_KEY = "JamesIsTheBest";
const WAITLIST_LIMIT = 6;

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || "").toLowerCase();
    if (action === "sessions") return json_({ ok:true, sessions:getSessions_() });
    if (action === "list") return json_(getRsvpsPublic_((e.parameter||{}).sessionId));
    return json_({ ok:false, error:"unknown action" });
  } catch (err) {
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) ? e.postData.contents : "{}");
    const action = String(body.action || "").toLowerCase();

    if (action === "rsvp") return json_(addRsvp_(body));

    if (action === "admin_createsession") return json_(adminCreateSession_(body));
    if (action === "admin_updatesession") return json_(adminUpdateSession_(body));
    if (action === "admin_setonlyopen") return json_(adminSetOnlyOpen_(body));
    if (action === "admin_listrsvps") return json_(adminListRsvps_(body));
    if (action === "admin_deletesession") return json_(adminDeleteSession_(body));

    return json_({ ok:false, error:"unknown action" });
  } catch (err) {
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function isAdmin_(k) { return String(k||"") === String(ADMIN_KEY); }
function openSheet_(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error("Sheet not found: " + name);
  return sh;
}
function index_(headerRow) {
  const map = {};
  headerRow.forEach((h,i)=> map[String(h).trim()] = i);
  return map;
}
function asBool_(v) {
  const s = String(v||"").toUpperCase().trim();
  return s === "TRUE" || s === "1" || s === "YES";
}
function fmtDateCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return String(v||"").trim();
}
function fmtTimeCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm");
  return String(v||"").trim();
}
function appendRowAsText_(sheet, rowValues) {
  const lastRow = sheet.getLastRow();
  const range = sheet.getRange(lastRow+1, 1, 1, rowValues.length);
  range.setNumberFormat("@");
  range.setValues([rowValues.map(v => String(v ?? ""))]);
}

function getSessions_() {
  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const [header, ...rows] = values;
  const idx = index_(header);
  return rows.filter(r=>r[idx.sessionId]).map(r=>({
    sessionId:String(r[idx.sessionId]),
    title:String(r[idx.title]||""),
    date:fmtDateCell_(r[idx.date]),
    start:fmtTimeCell_(r[idx.start]),
    end:fmtTimeCell_(r[idx.end]),
    venue:String(r[idx.venue]||""),
    capacity:Number(String(r[idx.capacity]||"0"))||0,
    note:String(r[idx.note]||""),
    isOpen:asBool_(r[idx.isOpen]),
  }));
}
function getSessionById_(sessionId) {
  const list = getSessions_();
  return list.find(s=>String(s.sessionId)===String(sessionId)) || null;
}
function getRsvpsPublic_(sessionId) {
  sessionId = String(sessionId||"").trim();
  if (!sessionId) return { ok:false, error:"missing sessionId" };
  const sh = openSheet_(SHEET_RSVPS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:true, rsvps: [] };
  const [header, ...rows] = values;
  const idx = index_(header);
  const out = rows.filter(r=>String(r[idx.sessionId])===sessionId).map(r=>({
    timestamp:(r[idx.timestamp] instanceof Date) ? r[idx.timestamp].toISOString() : String(r[idx.timestamp]||""),
    sessionId:String(r[idx.sessionId]||""),
    name:String(r[idx.name]||""),
    status:String(r[idx.status]||""),
    pax:Number(String(r[idx.pax]||"1"))||1,
    note:String(r[idx.note]||""),
  }));
  return { ok:true, rsvps: out };
}

function computeTotalsWithOverride_(sessionId, nameOverride, statusOverride, paxOverride) {
  const sh = openSheet_(SHEET_RSVPS);
  const values = sh.getDataRange().getValues();
  const map = {};
  if (values.length >= 2) {
    const [header, ...rows] = values;
    const idx = index_(header);
    for (let i=0;i<rows.length;i++) {
      const row = rows[i];
      if (String(row[idx.sessionId]) !== String(sessionId)) continue;
      const nm = String(row[idx.name]||"").trim().toLowerCase();
      if (!nm) continue;
      const ts = (row[idx.timestamp] instanceof Date) ? row[idx.timestamp].toISOString() : String(row[idx.timestamp]||"");
      const prev = map[nm];
      if (!prev || String(ts).localeCompare(String(prev.ts)) > 0) {
        map[nm] = { ts, status:String(row[idx.status]||"").toUpperCase(), pax:Number(String(row[idx.pax]||"1"))||1 };
      }
    }
  }
  const key = String(nameOverride||"").trim().toLowerCase();
  if (key) map[key] = { ts:new Date().toISOString(), status:String(statusOverride||"").toUpperCase(), pax:Number(paxOverride||1)||1 };

  let yesTotal=0, waitTotal=0;
  for (const k in map) {
    const r=map[k];
    if (r.status==="YES") yesTotal += (Number(r.pax)||1);
    if (r.status==="WAITLIST") waitTotal += (Number(r.pax)||1);
  }
  return { yesTotal, waitTotal };
}

function addRsvp_(p) {
  const sessionId = String(p.sessionId||"").trim();
  const name = String(p.name||"").trim();
  const statusRaw = String(p.status||"").trim().toUpperCase();
  const pax = Number(p.pax||1)||1;
  const note = String(p.note||"").trim();

  if (!sessionId || !name || !statusRaw) return { ok:false, error:"missing fields" };
  if (statusRaw === "MAYBE") return { ok:false, error:"MAYBE is not an option" };
  if (["YES","NO","WAITLIST"].indexOf(statusRaw) === -1) return { ok:false, error:"invalid status" };

  const session = getSessionById_(sessionId);
  if (!session) return { ok:false, error:"session not found" };
  const cap = Number(session.capacity||0)||0;

  if (cap>0 && statusRaw==="YES") {
    const totals = computeTotalsWithOverride_(sessionId, name, statusRaw, pax);
    if (totals.yesTotal > cap) return { ok:false, error:"capacity reached" };
  }
  if (statusRaw==="WAITLIST") {
    const totals = computeTotalsWithOverride_(sessionId, name, statusRaw, pax);
    if (totals.waitTotal > WAITLIST_LIMIT) return { ok:false, error:"waitlist full" };
  }

  const sh = openSheet_(SHEET_RSVPS);
  appendRowAsText_(sh, [new Date().toISOString(), sessionId, name, statusRaw, String(pax), note]);
  return { ok:true };
}

// --- Admin create session / court ---
function slug_(s) {
  return String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g,"");
}
function sessionIdExists_(id) {
  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return false;
  const [header, ...rows] = values;
  const idx = index_(header);
  for (let i=0;i<rows.length;i++) if (String(rows[i][idx.sessionId])===String(id)) return true;
  return false;
}
function generateUniqueSessionId_(date, start, venue) {
  const base = `${date}-${String(start).replace(":","")}-${slug_(venue).slice(0,20)}`;
  let id = base, n=2;
  while (sessionIdExists_(id)) { id = `${base}-${n}`; n++; }
  return id;
}
function setAllOpen_(open) {
  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return;
  const [header, ...rows] = values;
  const idx = index_(header);
  for (let r=0;r<rows.length;r++) sh.getRange(r+2, idx.isOpen+1).setValue(open ? "TRUE":"FALSE");
}

function adminCreateSession_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const s = p.session || {};
  const title = String(s.title||"YR Badminton").trim() || "YR Badminton";
  const date = String(s.date||"").trim();
  const start = String(s.start||"17:00").trim() || "17:00";
  const end = String(s.end||"19:00").trim() || "19:00";
  const venue = String(s.venue||"").trim();
  const capacity = Number(s.capacity||20)||20;
  const note = String(s.note||"").trim();
  const isOpen = (s.isOpen===true) || asBool_(s.isOpen);

  if (!date) return { ok:false, error:"missing date" };
  if (!venue) return { ok:false, error:"missing venue" };

  if (p.openOnly) setAllOpen_(false);

  const sh = openSheet_(SHEET_SESSIONS);
  const sessionId = generateUniqueSessionId_(date, start, venue);
  appendRowAsText_(sh, [sessionId, title, date, start, end, venue, String(capacity), note, isOpen ? "TRUE":"FALSE"]);
  return { ok:true, sessionId };
}

function adminUpdateSession_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const s = p.session || {};
  const targetId = String(s.sessionId||"").trim();
  if (!targetId) return { ok:false, error:"missing sessionId" };

  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  const [header, ...rows] = values;
  const idx = index_(header);

  for (let i=0;i<rows.length;i++) {
    if (String(rows[i][idx.sessionId])===targetId) {
      const rowNumber=i+2;
      sh.getRange(rowNumber, idx.date+1).setNumberFormat("@").setValue(String(s.date||""));
      sh.getRange(rowNumber, idx.start+1).setNumberFormat("@").setValue(String(s.start||""));
      sh.getRange(rowNumber, idx.end+1).setNumberFormat("@").setValue(String(s.end||""));
      sh.getRange(rowNumber, idx.venue+1).setValue(String(s.venue||""));
      sh.getRange(rowNumber, idx.capacity+1).setNumberFormat("@").setValue(String(Number(s.capacity||20)||20));
      sh.getRange(rowNumber, idx.note+1).setValue(String(s.note||""));
      sh.getRange(rowNumber, idx.isOpen+1).setValue(s.isOpen ? "TRUE":"FALSE");
      return { ok:true };
    }
  }
  return { ok:false, error:"session not found" };
}

function adminSetOnlyOpen_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const targetId = String(p.sessionId||"").trim();
  if (!targetId) return { ok:false, error:"missing sessionId" };
  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  const [header, ...rows] = values;
  const idx = index_(header);
  for (let i=0;i<rows.length;i++) {
    const isTarget = String(rows[i][idx.sessionId])===targetId;
    sh.getRange(i+2, idx.isOpen+1).setValue(isTarget ? "TRUE":"FALSE");
  }
  return { ok:true };
}

function adminListRsvps_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const sessionId = String(p.sessionId||"").trim();
  if (!sessionId) return { ok:false, error:"missing sessionId" };

  const sh=openSheet_(SHEET_RSVPS);
  const values=sh.getDataRange().getValues();
  if(values.length<2) return { ok:true, rsvps: [] };
  const [header, ...rows]=values;
  const idx=index_(header);

  const out=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(String(row[idx.sessionId])!==sessionId) continue;
    out.push({
      rowNumber:i+2,
      timestamp:(row[idx.timestamp] instanceof Date) ? row[idx.timestamp].toISOString() : String(row[idx.timestamp]||""),
      sessionId:String(row[idx.sessionId]||""),
      name:String(row[idx.name]||""),
      status:String(row[idx.status]||"").toUpperCase(),
      pax:Number(String(row[idx.pax]||"1"))||1,
      note:String(row[idx.note]||""),
    });
  }
  return { ok:true, rsvps: out };
}


function adminDeleteSession_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const sessionId = String(p.sessionId||"").trim();
  if (!sessionId) return { ok:false, error:"missing sessionId" };

  // delete session row
  const shS = openSheet_(SHEET_SESSIONS);
  const values = shS.getDataRange().getValues();
  if (values.length < 2) return { ok:false, error:"no sessions" };
  const [header, ...rows] = values;
  const idx = index_(header);

  let deleted = false;
  for (let i=rows.length-1; i>=0; i--) {
    if (String(rows[i][idx.sessionId]) === sessionId) {
      shS.deleteRow(i+2);
      deleted = true;
      break;
    }
  }
  if (!deleted) return { ok:false, error:"session not found" };

  // delete ALL rsvps for that session
  const shR = openSheet_(SHEET_RSVPS);
  const rValues = shR.getDataRange().getValues();
  if (rValues.length >= 2) {
    const [rHeader, ...rRows] = rValues;
    const rIdx = index_(rHeader);
    for (let i=rRows.length-1; i>=0; i--) {
      if (String(rRows[i][rIdx.sessionId]) === sessionId) {
        shR.deleteRow(i+2);
      }
    }
  }
  return { ok:true };
}


/**
 * Cleanup old sessions and related RSVPs.
 * Deletes sessions whose date is older than N days (default 14) and removes all RSVPs for them.
 * You can run this manually in Apps Script or attach it to a time-driven trigger (daily).
 */
function cleanupOldSessions_(days) {
  const KEEP_DAYS = (days === undefined || days === null) ? 14 : Number(days);
  const tz = Session.getScriptTimeZone();
  const today = new Date();
  const cutoff = new Date(today.getTime() - KEEP_DAYS*24*60*60*1000);

  const shS = openSheet_(SHEET_SESSIONS);
  const sValues = shS.getDataRange().getValues();
  if (sValues.length < 2) return { removedSessions:0, removedRsvps:0 };
  const [sHeader, ...sRows] = sValues;
  const sIdx = index_(sHeader);

  // Collect sessions to remove
  const toRemove = [];
  for (let i=0;i<sRows.length;i++){
    const sid = String(sRows[i][sIdx.sessionId]||"").trim();
    if(!sid) continue;
    const dCell = sRows[i][sIdx.date];
    let dStr = fmtDateCell_(dCell);
    // parse yyyy-MM-dd
    const m = String(dStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) continue;
    const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), 0,0,0,0);
    if (d.getTime() < cutoff.getTime()) {
      toRemove.push({ sid, rowNumber:i+2 });
    }
  }

  // Remove sessions from bottom to top (row numbers shift)
  toRemove.sort((a,b)=>b.rowNumber-a.rowNumber);
  for (const x of toRemove) shS.deleteRow(x.rowNumber);

  // Remove RSVPs for removed sessions
  let removedRsvps=0;
  if (toRemove.length){
    const removedSet = {};
    toRemove.forEach(x=>removedSet[x.sid]=true);
    const shR=openSheet_(SHEET_RSVPS);
    const rValues=shR.getDataRange().getValues();
    if(rValues.length>=2){
      const [rHeader, ...rRows]=rValues;
      const rIdx=index_(rHeader);
      for(let i=rRows.length-1;i>=0;i--){
        const sid=String(rRows[i][rIdx.sessionId]||"").trim();
        if(removedSet[sid]){
          shR.deleteRow(i+2);
          removedRsvps++;
        }
      }
    }
  }
  return { removedSessions: toRemove.length, removedRsvps };
}

/**
 * Entry point for Apps Script trigger (daily).
 * Set up a time-driven trigger to run this function automatically.
 */
function dailyCleanup() {
  cleanupOldSessions_(14);
}

