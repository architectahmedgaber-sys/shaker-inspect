# Auto-refresh - setup (about 3 minutes)

What it does: the app asks the server every ~25 seconds "did the sheet or the Drive files change?" (a tiny answer, shared by everybody for 10 seconds). Only when something changed does it load the list again. It also checks the moment you come back to the app. The new Refresh button (Home, top right) always reads the latest from the sheet and Drive.

1. Apps Script (INSPECTION project): add a script file named **Live** and paste `Live.gs`.
2. Replace **Api.gs** with the new one (3 small changes: it knows `app_ping`, label api-9).
3. Deploy > Manage deployments > pencil > Version: New version > Deploy (same URL).
4. In the app: More > Check for updates (web) or install the new APK. Home now shows the ⟳ button and "Updated 10:32".

Check: open the app on two phones. Add or close a request on one: the other shows "1 new request" within ~30 seconds without touching it.

Notes
- Nothing to run in the editor, no new permission (it uses the Drive access the script already has).
- Edits typed by hand in the sheet are noticed too (the spreadsheet's last-edit time is part of the check). Google sometimes takes a few seconds to stamp that time, so allow up to ~30-40 seconds, or press Refresh.
- An open request card, the sign-in screen or the checklist editor is never redrawn under your hands: the update waits until it is closed.
- While the app is hidden or the phone is locked it does not poll. After 5 minutes without touching the screen it slows to every 90 seconds.
- Old server (before this paste): the app still works; only the Refresh button and "refresh when you return after a minute" are active.
