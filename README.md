# YR Badminton RSVP (From Scratch)

## Features
- **User page**: RSVP YES/NO with pax + note
- **MAYBE / 可能**: shows warning only (心理戰), **no API call**
- **Auto allocation** (waitlist is NOT a user option):
  - Confirmed up to capacity (by pax, earliest timestamp first)
  - Waitlist up to **6 pax**
- **Admin**
  - Create / edit / delete sessions (**delete cascades bookings**)
  - Bookings view always uses **current** (latest per name), with filters
  - Copy-paste announcement (Chinese + English)
  - **Sunday-only** enforced on BOTH front-end and back-end
- **Auto-close past sessions** (keep history) via `dailyCleanup` trigger

## Apps Script setup
1. Create/choose a Google Sheet.
2. Apps Script → paste `apps_script/Code.gs`
3. Project Settings → Script properties:
   - `SHEET_ID` = your Google Sheet ID
   - `ADMIN_KEY` = your secret admin key
4. Deploy → Web app
   - Execute as: Me
   - Access: Anyone
5. Copy the `/exec` URL

## GitHub Pages setup
1. Edit:
   - `assets/app.js` → `API_BASE`
   - `assets/admin.js` → `API_BASE`
2. Commit to GitHub.
3. Enable GitHub Pages (Settings → Pages).

## Optional: daily auto-close past sessions
Apps Script → Triggers → add time-driven trigger:
- function: `dailyCleanup`
- frequency: daily
