# Professional wording button (Engineers + Admins, each with their own key)

No Apps Script change is needed. Polish.gs / the ANTHROPIC_API_KEY script property from the old version are no longer used (you can delete them; leaving them is harmless).

Each person who wants the button:
1. Make an API key at console.anthropic.com (own account, own billing).
2. In the app, open a request to close it, write a comment, pick the code, press "✨ صياغة احترافية". First time it asks for the key: paste it, Save.
3. Press the button again. Check the result, then "استخدمه" or "سيب كلامي".

The key is encrypted on that device only (AES-GCM, in the browser/app storage) and is never sent to the sheet, Apps Script or GitHub. "Remove my key" under the result deletes it. A rejected key is deleted automatically and asked again.
Without a key nothing changes. Viewers and DC do not see the button. The model is claude-haiku-5-5 (set in app-polish.js). Polishes are no longer written in the _Log tab.
