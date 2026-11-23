# Admin speed: Apps Script paste (2 files)

In the inspection Apps Script project (not the tracker one):
1. Paste `1-inspection-project/Api.gs` over Api.gs (it says api-10 on ping).
2. Paste `1-inspection-project/IrFiles.gs` over IrFiles.gs.
3. Deploy > Manage deployments > pencil > New version (same URL).

What changes:
- Admin screens that only read no longer wipe the server cache, so Today does not re-read the whole DailyAction sheet every time, and phones stop reloading their list each time an admin opens a tab.
- Today overview is cached with the sheet cache; the Users screen no longer re-reads the log on every open.
- The IR file list is cached in pieces (before, a long list was too big for the cache and the whole Drive tree was scanned on every open). It stays for 10 minutes, and is forgotten at once when a file is uploaded, moved, deleted or closed in the app. Files put in Drive by hand show after at most 10 minutes.
- "Closed today" of Files today is cached for 2 minutes.
