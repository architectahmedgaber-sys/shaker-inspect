/**
 * Live.gs - "did anything change?" check for the app (auto-refresh).
 *
 * The app asks app_ping every ~25 seconds while it is open. The answer is two short strings:
 *   s = the sheet (requests, comments, closes ...): last edit time of the spreadsheet + the app's own write counter
 *   d = the Drive files (IR uploads): which PDF/photo files were added or changed in the last hour
 * The app reloads the list only when one of them is different from last time, so a quiet minute costs almost nothing.
 *
 * Cost: one cheap Drive lookup, shared by everybody for 10 seconds (script cache), so 20 phones do not mean 20 lookups.
 * Edits typed by hand in the sheet also drop the short server cache of the list, so they show in the app at once.
 */

const LIVE_FUNCS_ = {
  // a = [force]: true when someone presses the Refresh button (skips the 10 s sharing and the short cache of the list)
  app_ping: (me, a) => livePing_(!!(a && a[0]))
};

function livePing_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const hit = cache.get('live_tok');
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }
  // 1. the sheet
  let sUp = 0;
  try { sUp = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getLastUpdated().getTime(); } catch (e) {}
  const prevS = Number(cache.get('live_sup') || 0);
  if (force || (sUp && prevS && sUp !== prevS)) (typeof dcDrop_ === 'function') && dcDrop_();            // edited by hand, or Refresh pressed: forget the cached list
  if (sUp) cache.put('live_sup', String(sUp), 21600);

  // 2. Drive files added or changed in the last hour (IR uploads, closed copies, photos)
  let d = '0';
  try {
    const since = new Date(Date.now() - 3600e3).toISOString().slice(0, 19);
    const q = 'trashed = false and modifiedDate > "' + since + '" and (mimeType = "application/pdf" or mimeType = "image/jpeg" or mimeType = "image/png")';
    const it = DriveApp.searchFiles(q), ids = [];
    while (it.hasNext() && ids.length < 500) ids.push(it.next().getId());
    ids.sort();
    const h = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, ids.join(','));
    d = ids.length + ':' + h.slice(0, 4).map(b => ((b + 256) % 256).toString(16)).join('');
  } catch (e) {}
  const prevD = cache.get('live_d');
  if (force || (prevD !== null && prevD !== d)) cache.remove('ir_index2');   // the file list of the app must be read again
  cache.put('live_d', d, 21600);

  const out = { s: sUp + '.' + (typeof dcGen_ === 'function' ? dcGen_() : ''), d: d, t: Date.now() };
  try { cache.put('live_tok', JSON.stringify(out), 10); } catch (e) {}
  return out;
}
