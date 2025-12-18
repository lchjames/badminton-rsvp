/*************************************
 * YR Badminton RSVP API (Apps Script)
 * v2: Capacity limiter (server-side)
 *************************************/
const SPREADSHEET_ID = "1WAAWlRoyyYoq6B_cKBDaJBO_WS-YKjpnAYWMKlnk98w";
const SHEET_SESSIONS = "sessions";
const SHEET_RSVPS = "rsvps";
const ADMIN_KEY = "YR-BADMINTON-ADMIN-2025";
const DEFAULT_TITLE = "Badminton";
const DEFAULT_START = "17:00";
const DEFAULT_END = "19:00";

function doGet(e) {
  try {
    const action = String(e.parameter.action || "").toLowerCase();
    if (action === "sessions") return json_({ ok:true, sessions:getSessions_() });
    if (action === "list") return json_(getRsvpsPublic_(e.parameter.sessionId));
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
    if (action === "admin_bulkupdatesessions") return json_(adminBulkUpdateSessions_(body));
    if (action === "admin_deletesession") return json_(adminDeleteSession_(body));
    if (action === "admin_setonlyopen") return json_(adminSetOnlyOpen_(body));

    if (action === "admin_listrsvps") return json_(adminListRsvps_(body));
    if (action === "admin_updatersvp") return json_(adminUpdateRsvp_(body));
    if (action === "admin_deletersvp") return json_(adminDeleteRsvp_(body));

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

  return rows.filter(r => r[idx.sessionId]).map(r => ({
    sessionId: String(r[idx.sessionId]),
    title: String(r[idx.title]||""),
    date: fmtDateCell_(r[idx.date]),
    start: fmtTimeCell_(r[idx.start]),
    end: fmtTimeCell_(r[idx.end]),
    venue: String(r[idx.venue]||""),
    capacity: Number(String(r[idx.capacity]||"0")) || 0,
    note: String(r[idx.note]||""),
    isOpen: asBool_(r[idx.isOpen]),
  }));
}

function getSessionById_(sessionId) {
  const list = getSessions_();
  return list.find(s => String(s.sessionId) === String(sessionId)) || null;
}

function getRsvpsPublic_(sessionId) {
  sessionId = String(sessionId||"").trim();
  if (!sessionId) return { ok:false, error:"missing sessionId" };

  const sh = openSheet_(SHEET_RSVPS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:true, rsvps: [] };

  const [header, ...rows] = values;
  const idx = index_(header);

  const out = rows
    .filter(r => String(r[idx.sessionId]) === sessionId)
    .map(r => ({
      timestamp: (r[idx.timestamp] instanceof Date) ? r[idx.timestamp].toISOString() : String(r[idx.timestamp]||""),
      sessionId: String(r[idx.sessionId]||""),
      name: String(r[idx.name]||""),
      status: String(r[idx.status]||""),
      pax: Number(String(r[idx.pax]||"1")) || 1,
      note: String(r[idx.note]||""),
    }));
  return { ok:true, rsvps: out };
}

// ---- Capacity limiter (server-side, authoritative) ----
function computeYesTotalWithOverride_(sessionId, nameOverride, statusOverride, paxOverride) {
  const sh = openSheet_(SHEET_RSVPS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { yesTotal: (statusOverride==="YES" ? paxOverride : 0), previousForName: null };

  const [header, ...rows] = values;
  const idx = index_(header);

  const byName = {};
  for (let i=0;i<rows.length;i++) {
    const row = rows[i];
    if (String(row[idx.sessionId]) !== String(sessionId)) continue;
    const nm = String(row[idx.name]||"").trim().toLowerCase();
    if (!nm) continue;

    // latest wins: compare timestamp string
    const ts = (row[idx.timestamp] instanceof Date) ? row[idx.timestamp].toISOString() : String(row[idx.timestamp]||"");
    const prev = byName[nm];
    if (!prev || String(ts).localeCompare(String(prev.ts)) > 0) {
      byName[nm] = {
        ts,
        status: String(row[idx.status]||"").toUpperCase(),
        pax: Number(String(row[idx.pax]||"1")) || 1
      };
    }
  }

  const key = String(nameOverride||"").trim().toLowerCase();
  const prevForName = key ? (byName[key] || null) : null;

  if (key) {
    byName[key] = {
      ts: new Date().toISOString(),
      status: String(statusOverride||"").toUpperCase(),
      pax: Number(paxOverride||1) || 1
    };
  }

  let total = 0;
  for (const k in byName) {
    const r = byName[k];
    if (r && r.status === "YES") total += (Number(r.pax)||1);
  }
  return { yesTotal: total, previousForName: prevForName };
}

function addRsvp_(p) {
  const sessionId = String(p.sessionId || "").trim();
  const name = String(p.name || "").trim();
  const statusRaw = String(p.status || "").trim().toUpperCase();
  const pax = Number(p.pax || 1) || 1;
  const note = String(p.note || "").trim();

  if (!sessionId || !name || !statusRaw) return { ok:false, error:"missing fields" };
  if (statusRaw === "MAYBE") return { ok:false, error:"MAYBE is not an option" };
  if (statusRaw !== "YES" && statusRaw !== "NO") return { ok:false, error:"invalid status" };

  const session = getSessionById_(sessionId);
  if (!session) return { ok:false, error:"session not found" };
  const cap = Number(session.capacity || 0) || 0;

  if (cap > 0 && statusRaw === "YES") {
    const computed = computeYesTotalWithOverride_(sessionId, name, statusRaw, pax);
    if (computed.yesTotal > cap) {
      const remaining = Math.max(0, cap - (computed.yesTotal - pax)); // rough remaining before this change
      return {
        ok:false,
        error:"capacity reached",
        capacity: cap,
        remaining: remaining
      };
    }
  }

  const sh = openSheet_(SHEET_RSVPS);
  appendRowAsText_(sh, [
    new Date().toISOString(),
    sessionId,
    name,
    statusRaw,
    String(pax),
    note
  ]);

  return { ok:true };
}

// --- Admin functions (same as your v1; keep for completeness) ---
function setAllOpen_(open) {
  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return;
  const [header, ...rows] = values;
  const idx = index_(header);
  for (let r=0;r<rows.length;r++) {
    sh.getRange(r+2, idx.isOpen+1).setValue(open ? "TRUE" : "FALSE");
  }
}

function adminCreateSession_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const s = p.session || {};
  const title = String(s.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE;
  const date = String(s.date || "").trim();
  const start = String(s.start || DEFAULT_START).trim() || DEFAULT_START;
  const end = String(s.end || DEFAULT_END).trim() || DEFAULT_END;
  const venue = String(s.venue || "").trim();
  const capacity = Number(s.capacity || 20) || 20;
  const note = String(s.note || "").trim();
  const isOpen = (s.isOpen === true) || asBool_(s.isOpen);

  if (!date) return { ok:false, error:"missing date" };
  if (!venue) return { ok:false, error:"missing venue" };

  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  const header = values[0];
  const idx = index_(header);

  const sessionId = String(s.sessionId || `${date}-${start.replace(":","")}`).trim();

  if (p.openOnly) setAllOpen_(false);

  appendRowAsText_(sh, [
    sessionId, title, date, start, end, venue, String(capacity), note, isOpen ? "TRUE" : "FALSE"
  ]);

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
    if (String(rows[i][idx.sessionId]) === targetId) {
      const rowNumber = i+2;
      sh.getRange(rowNumber, idx.title+1).setValue(String(s.title||""));
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

function adminBulkUpdateSessions_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const list = p.sessions || [];
  for (const s of list) {
    const r = adminUpdateSession_({ adminKey:p.adminKey, session:s });
    if (!r.ok) return r;
  }
  return { ok:true };
}

function adminDeleteRsvpsBySession_(sessionId) {
  const sh = openSheet_(SHEET_RSVPS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { deleted:0 };
  const [header, ...rows] = values;
  const idx = index_(header);
  let deleted = 0;
  for (let i=rows.length-1;i>=0;i--) {
    if (String(rows[i][idx.sessionId]) === String(sessionId)) {
      sh.deleteRow(i+2);
      deleted++;
    }
  }
  return { deleted };
}

function adminDeleteSession_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const sessionId = String(p.sessionId||"").trim();
  const cascade = (p.cascade === true);
  if (!sessionId) return { ok:false, error:"missing sessionId" };

  let deletedBookings = 0;
  if (cascade) {
    const r = adminDeleteRsvpsBySession_(sessionId);
    deletedBookings = r.deleted || 0;
  }

  const sh = openSheet_(SHEET_SESSIONS);
  const values = sh.getDataRange().getValues();
  const [header, ...rows] = values;
  const idx = index_(header);
  for (let i=0;i<rows.length;i++) {
    if (String(rows[i][idx.sessionId]) === sessionId) {
      sh.deleteRow(i+2);
      return { ok:true, deletedBookings };
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
    const isTarget = String(rows[i][idx.sessionId]) === targetId;
    sh.getRange(i+2, idx.isOpen+1).setValue(isTarget ? "TRUE" : "FALSE");
  }
  return { ok:true };
}

function adminListRsvps_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const sessionId = String(p.sessionId||"").trim();
  if (!sessionId) return { ok:false, error:"missing sessionId" };

  const sh = openSheet_(SHEET_RSVPS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:true, rsvps: [] };

  const [header, ...rows] = values;
  const idx = index_(header);

  const out = [];
  for (let i=0;i<rows.length;i++) {
    const row = rows[i];
    if (String(row[idx.sessionId]) !== sessionId) continue;
    out.push({
      rowNumber: i+2,
      timestamp: (row[idx.timestamp] instanceof Date) ? row[idx.timestamp].toISOString() : String(row[idx.timestamp]||""),
      sessionId: String(row[idx.sessionId]||""),
      name: String(row[idx.name]||""),
      status: String(row[idx.status]||"").toUpperCase(),
      pax: Number(String(row[idx.pax]||"1")) || 1,
      note: String(row[idx.note]||""),
    });
  }
  return { ok:true, rsvps: out };
}

function adminUpdateRsvp_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const r = p.rsvp || {};
  const rowNumber = Number(r.rowNumber || 0);
  if (!rowNumber || rowNumber < 2) return { ok:false, error:"missing rowNumber" };

  const name = String(r.name||"").trim();
  const status = String(r.status||"").trim().toUpperCase();
  const pax = String(Number(r.pax||1) || 1);
  const note = String(r.note||"").trim();

  const sh = openSheet_(SHEET_RSVPS);
  const values = sh.getDataRange().getValues();
  const header = values[0];
  const idx = index_(header);

  sh.getRange(rowNumber, idx.name+1).setValue(name);
  sh.getRange(rowNumber, idx.status+1).setValue(status);
  sh.getRange(rowNumber, idx.pax+1).setNumberFormat("@").setValue(pax);
  sh.getRange(rowNumber, idx.note+1).setValue(note);

  return { ok:true };
}

function adminDeleteRsvp_(p) {
  if (!isAdmin_(p.adminKey)) return { ok:false, error:"unauthorized" };
  const rowNumber = Number(p.rowNumber || 0);
  if (!rowNumber || rowNumber < 2) return { ok:false, error:"missing rowNumber" };
  const sh = openSheet_(SHEET_RSVPS);
  sh.deleteRow(rowNumber);
  return { ok:true };
}
