# Polish button (owner only) - setup

Only the owner account (architectahmedgaber@gmail.com) sees the "✨ Polish the comment" button in the close screen. The server refuses anyone else.

1. Make an API key at console.anthropic.com (API keys). Do not paste it anywhere except step 2.
2. Apps Script (INSPECTION project) > Project Settings (gear) > Script Properties > Add: `ANTHROPIC_API_KEY` = the key. Save.
3. Editor: add a script file named **Polish** and paste `Polish.gs`. Replace **Api.gs** with the new one (one line added so the app can call Polish).
4. Pick `polishSelfTest` in the editor, Run, accept permissions (it needs "connect to an external service"), then View > Logs: you should see a JSON with an English sentence. It writes one line in the _Log tab.
5. Deploy > Manage deployments > pencil > Version: New version > Deploy (same URL).
6. In the app: More > Check for updates (web) or reinstall the APK. Open a request, write a short comment, pick a code, press the button, then "Use it" or "Keep mine".

Optional script properties: `POLISH_ENABLED=false` (switch off), `POLISH_MODEL` (default claude-haiku-5-5; use claude-sonnet-5-5 for stronger wording), `POLISH_DAILY_LIMIT` (default 150), `POLISH_EMAILS` (extra emails, comma separated).
The original and the polished text are both saved in the _Log tab (Action = polish). If anything fails the comment stays as typed.
