# YR Badminton Admin v2

This package is pre-filled with API_BASE:
https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec

Admin features:
- Sessions table: inline edit all fields, save, delete session, set-only-open, bulk save.
- RSVPs table: view bookings by session, filter YES/NO, edit name/status/pax/note, delete booking.

IMPORTANT:
You must update Apps Script to support the new admin actions listed in the chat message and redeploy as a new version.


## Timestamp & Sorting (Important)

This project relies on RSVP submission time to allocate CONFIRMED vs WAITLIST fairly.
To avoid incorrect ordering, the backend now writes timestamps in ISO 8601 (`new Date().toISOString()`)
and always sorts by real time (Date.parse), not string comparison.

## Cancel / Update Behavior

RSVP submissions are now **upserts**: for the same `(sessionId, name)`, submitting again updates the existing row
instead of appending a new row. This prevents having both YES and NO records for the same person.


## 2026-04 update

- Waiting list removed. Capacity defaults to 26.
- User page shows confirmed count only.
- Admin announcement uses simple RSVP format (no summary lines).
- To set a section open/closed: use **Open = TRUE/FALSE** in the sessions table, or set **Open = TRUE** when creating a new section.


## Domain Migration

User URL:
https://lchjames.com/badminton-rsvp/

The root domain can continue hosting other pages.
The badminton project should live under the /badminton-rsvp/ path.

## Performance

Google Sheet remains the data source.
Apps Script CacheService is used to reduce repeated spreadsheet reads.
