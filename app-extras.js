/* Shaker Inspect · phase 3 (extras): villa board + private villa notes, QR per villa + scan, a request by link,
   close rules, before / after photos, draw on a photo, monthly leaderboard, Excel export, admin undo + trash,
   per-contractor performance, Arabic / English, sunlight theme, large text, push notifications (Android app). */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = (fn, args) => PtahApp.call(fn, args || []);
  const CFG = window.SHK_CONFIG || {};
  const NATIVE = !!(window.Capacitor && Capacitor.nativePromise && Capacitor.getPlatform && Capacitor.getPlatform() !== 'web');
  const nativeP = (plugin, method, opt) => Capacitor.nativePromise(plugin, method, opt || {});
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
               set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };
  const note = (m, ms) => window.showToast(m, null, null, ms || 3500);
  const canClose = () => ['Admin', 'Engineer'].indexOf(PtahApp.role()) >= 0;
  const isAdmin = () => PtahApp.role() === 'Admin';
  const SIGN = '<p class="shk-sign">architected by Ptah</p>';
  const dmy = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(iso || ''); };
  const fmtT = t => { const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const shortIr = ir => { const m = String(ir || '').match(/(\d+)\D*$/); return m ? m[1] : String(ir || ''); };
  const conOf = ir => { const m = String(ir || '').match(/-(SH|SQ|AT)-/i); return m ? m[1].toUpperCase() : ''; };
  const CON_NAME = { SH: 'El Shorouk', SQ: 'Square', AT: 'Alexandria' };
  const APP_LINK = /github\.io$/.test(location.hostname) ? location.origin + location.pathname.replace(/[^/]*$/, '') : 'https://architectahmedgaber-sys.github.io/shaker-inspect/';
  const LIB = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    qr: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
    jsqr: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    pdf: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
  };
  const loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => { delete loaded[src]; bad(new Error('Could not load a library. Check the connection.')); };
      document.head.appendChild(s);
    }));
  }
  let X = { rules: { allMarked: false, minPhotos: 0, minPhotosCD: 0, notesCD: false }, board: true, push: false };

  // =====================================================================
  // 1. LOOK: Arabic / English, sunlight theme, large text (per phone)
  // =====================================================================
  const prefs = () => ({ lang: ls.get('shkLang', 'en'), sun: ls.get('shkSun', false), big: ls.get('shkBig', false) });
  function applyLook() {
    const p = prefs(), h = document.documentElement;
    h.classList.toggle('shk-sun', !!p.sun);
    h.classList.toggle('shk-big', !!p.big);
    if (p.sun) h.setAttribute('data-theme', 'light');
    h.lang = p.lang === 'ar' ? 'ar' : 'en';
    h.dir = p.lang === 'ar' ? 'rtl' : 'ltr';
    if (p.lang === 'ar' && !$('shkArFont')) {
      const l = document.createElement('link'); l.id = 'shkArFont'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap'; document.head.appendChild(l);
    }
  }
  applyLook();
  const AR_ON = prefs().lang === 'ar';
  // the sun / moon button turns the sunlight theme off
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#themeBtn') && prefs().sun) { ls.set('shkSun', false); document.documentElement.classList.remove('shk-sun'); } }, true);

  // ---- Arabic: the app's own words are swapped on screen (checklists, names and request titles stay as written) ----
  const AR = Object.assign({
    // home, lists, top bar
    'Home': 'الرئيسية', 'Requests': 'الطلبات', 'Search by Villa or activity...': 'دوّر برقم الفيلا أو النشاط...', 'Refresh': 'تحديث',
    'Load the latest requests from the sheet': 'هات آخر الطلبات من الشيت', 'Account': 'الحساب', 'Me': 'أنا', 'More': 'المزيد', 'About': 'عن التطبيق', 'Main': 'الرئيسية', 'Sheets': 'الشيتات', 'Handover': 'التسليم',
    'All contractors': 'كل المقاولين', 'Late by contractor': 'المتأخر لكل مقاول', 'Waiting longest': 'الأقدم في الانتظار', 'requests closed today': 'طلبات اتقفلت النهارده',
    'Good morning,': 'صباح الخير،', 'Good afternoon,': 'مساء الخير،', 'Good evening,': 'مساء الخير،', 'Today': 'النهارده', 'Late': 'متأخر', 'Open': 'مفتوح', 'Closed': 'مقفول',
    'Pending': 'مستني', 'Pending · Late': 'مستني · متأخر', 'Open →': 'افتح ←', 'Daily Site Inspections': 'المرور اليومي على الموقع', 'Fetching pending inspections...': 'بنجيب الطلبات المفتوحة...',
    'Loading...': 'بيحمّل...', 'Loading engineers...': 'بيحمّل المهندسين...', 'No open requests.': 'مفيش طلبات مفتوحة.', 'Nothing found.': 'مفيش نتايج.',
    'El Shorouk': 'الشروق', 'EL-Shorouk': 'الشروق', 'Square': 'سكوير', 'Alexandria': 'الإسكندرية', 'Other': 'أخرى', 'Support': 'الدعم',
    // close screen
    'Close request': 'اقفل الطلب', 'Inspection date': 'تاريخ المرور', 'Inspector': 'المهندس', 'Action code': 'الكود', 'Field notes': 'ملاحظات الموقع',
    'Approved': 'موافق', 'As noted': 'موافق بملاحظات', 'Revise': 'تعديل وإعادة', 'Rejected': 'مرفوض', 'Checklist': 'الـ Checklist', 'Change section': 'غيّر القسم',
    'Key values': 'القيم الأساسية', 'All ✓': 'الكل ✓', 'Mark every unmarked item ✓': 'علّم كل البنود الفاضية ✓', 'Conforms': 'مطابق', 'Does not conform': 'غير مطابق', 'Not applicable': 'لا ينطبق',
    'Photos': 'الصور', 'Camera': 'الكاميرا', 'Gallery': 'المعرض', 'Signature': 'التوقيع', 'Draw your signature': 'ارسم توقيعك', 'Drawn once, printed on every record.': 'بيترسم مرة واحدة ويتطبع في كل تقرير.',
    'Change': 'تغيير', 'Comments': 'التعليقات', 'No comments yet.': 'مفيش تعليقات لسه.', 'Write a comment for the team...': 'اكتب تعليق للفريق...', 'Send': 'إرسال',
    'Speak': 'اتكلم', 'Speak (Arabic)': 'اتكلم (عربي)', 'E.g., Approved with minor comments, fiber mesh missing in joints...': 'مثلاً: موافق بملاحظات بسيطة، الشبك ناقص في الفواصل...',
    'Re-inspection.': 'إعادة مرور.', 'Waiting to upload': 'مستني الرفع', 'Waiting to upload.': 'مستني الرفع.', 'Upload now': 'ارفع دلوقتي', 'Cancel this close': 'الغي التقفيل ده',
    'Undo': 'تراجع', 'Close': 'إغلاق', 'Close (Esc)': 'إغلاق (Esc)', 'Cancel': 'إلغاء', 'Save': 'حفظ', 'Clear': 'امسح', 'Back': 'رجوع', 'back': 'رجوع', 'Remove': 'شيل',
    'Share link': 'شارك اللينك', 'Tap a photo to draw on it or mark it Before / After.': 'دوس على الصورة عشان ترسم عليها أو تعلّمها قبل / بعد.',
    'Before': 'قبل', 'After': 'بعد', 'Photo': 'صورة', 'arrow': 'سهم', 'circle': 'دايرة', 'pen': 'قلم', 'View only.': 'عرض بس.', 'Sheet Row Info': 'بيانات الصف في الشيت',
    'Before work': 'قبل الشغل', 'During work': 'أثناء الشغل', 'Materials & storage': 'المواد والتخزين', 'Submittals & approvals': 'التقديمات والاعتمادات', 'Tolerances': 'التفاوتات', 'Testing & acceptance': 'الاختبارات والاستلام', 'Fabrication': 'التصنيع', 'Treatment': 'المعالجة',
    // villa board, QR, leaderboard
    'Villas': 'الفلل', 'Scan': 'سكان', 'Leaderboard': 'لوحة الشرف', 'Villa board': 'لوحة الفلل', 'Villa number': 'رقم الفيلا', 'All': 'الكل', 'Waiting C/D': 'مستني C/D', 'Done': 'خلصان',
    'Team notes': 'ملاحظات الفريق', 'private · not in PDFs or reports': 'خاصة · مش بتطلع في الـ PDF ولا التقارير', 'A note for the team about this villa...': 'ملاحظة للفريق عن الفيلا دي...',
    'Add': 'إضافة', 'Delete': 'مسح', 'No notes yet.': 'مفيش ملاحظات لسه.', 'No villa found.': 'مفيش فيلا بالرقم ده.', 'No requests for this villa.': 'مفيش طلبات للفيلا دي.',
    'QR code': 'كود QR', 'Scan QR': 'سكان QR', 'Scan it with the app (⌗ Scan) or the phone camera: it opens this villa.': 'اعمله سكان من التطبيق (⌗ سكان) أو كاميرا الموبايل: هيفتح الفيلا دي.',
    'PDF to print': 'PDF للطباعة', 'QR sheet (PDF)': 'شيت QR (PDF)', 'Point the camera at the villa QR code': 'وجّه الكاميرا على كود QR بتاع الفيلا', 'Take a photo instead': 'صوّر بدل كده',
    'The live camera is not available here. Take a photo of the QR code instead.': 'الكاميرا المباشرة مش متاحة هنا. صوّر كود الـ QR بدلها.',
    'No QR code found in the photo. Try again closer.': 'مفيش كود QR في الصورة. قرّب وجرّب تاني.', 'All revisions': 'كل الـ Revs', 'Inspection record PDF ↗': 'تقرير المرور PDF ↗',
    'All closes in the sheet for the month, by the engineer who closed them.': 'كل التقفيلات في الشيت للشهر ده، باسم المهندس اللي قفلها.', 'No closes this month yet.': 'مفيش تقفيلات الشهر ده لسه.',
    'Engineers': 'المهندسين', 'Making the Excel file...': 'بيعمل ملف الإكسيل...', 'Making the QR sheet...': 'بيعمل شيت الـ QR...', 'Link copied. Paste it in WhatsApp.': 'اللينك اتنسخ. الزقه في واتساب.',
    // me sheet
    'Admin screen': 'شاشة الأدمن', 'Browse the sheet (view only)': 'تصفح الشيت (عرض بس)', 'Handover tracker': 'متابعة التسليم', 'Edit checklists': 'تعديل الـ Checklists', 'Light / dark': 'فاتح / غامق',
    'How to use the app': 'إزاي تستخدم التطبيق', 'Contact the developer': 'كلّم المطوّر', 'Sign out': 'خروج', 'Install the app': 'نزّل التطبيق', 'Calendar': 'التقويم', 'Re-inspection': 'إعادة المرور', 'Re-inspect': 'إعادة مرور',
    'Daily report': 'التقرير اليومي', 'My signature': 'توقيعي', 'Fingerprint lock': 'قفل بالبصمة', 'Morning email': 'إيميل الصبح', 'Late reminders on this phone': 'تنبيه المتأخر على الموبايل ده',
    'Daily jobs (backup, emails)': 'المهام اليومية (نسخة احتياطية، إيميلات)', 'Scan a villa QR': 'سكان QR فيلا', 'Open requests to Excel': 'الطلبات المفتوحة إكسيل',
    'Sunlight mode (strong contrast)': 'وضع الشمس (تباين عالي)', 'Large text': 'خط كبير', 'Push notifications': 'إشعارات', 'On': 'شغال', 'Off': 'مقفول', 'English': 'English', 'Draw': 'ارسم', 'Saved': 'محفوظ',
    'You are signed in on this device for 30 days. Everything you close is saved under this name.': 'إنت داخل على الجهاز ده لمدة 30 يوم. كل اللي بتقفله بيتسجل بالاسم ده.',
    'Found a problem or have an idea? Write to Ahmed directly.': 'لقيت مشكلة أو عندك فكرة؟ ابعت لأحمد على طول.', 'Email': 'إيميل',
    // sign in
    'Your email': 'الإيميل بتاعك', 'Send code': 'ابعت الكود', 'Code sent to': 'الكود اتبعت على', 'Sign in': 'دخول', 'Change email': 'غيّر الإيميل', 'Send a new code': 'ابعت كود جديد',
    'New here? Just enter your email. After the code you can ask to join.': 'جديد؟ اكتب الإيميل بس. بعد الكود تقدر تطلب الانضمام.', 'Request to join': 'طلب انضمام', 'Your full name': 'اسمك بالكامل',
    'Who are you?': 'إنت مين؟', 'Send request': 'ابعت الطلب', 'Use another email': 'استخدم إيميل تاني', 'Waiting for approval': 'مستني الموافقة', 'Check again': 'شوف تاني',
    'Requests you close are saved under your own name.': 'الطلبات اللي بتقفلها بتتسجل باسمك.', 'Site Inspections · SouthMed North Coast': 'المرور على الموقع · ساوث ميد الساحل الشمالي',
    'This name is the one your closed requests are saved under. An admin approves your request first.': 'ده الاسم اللي طلباتك بتتسجل بيه. الأدمن لازم يوافق الأول.',
    // calendar, report, uploads
    'Month': 'شهر', 'Week': 'أسبوع', 'Day': 'يوم', 'Nothing due': 'مفيش حاجة', 'Nothing due on this day.': 'مفيش طلبات في اليوم ده.', 'Mine': 'بتوعي', 'Everyone': 'الكل',
    'No resubmissions waiting.': 'مفيش إعادة تقديم مستنية.', 'All contractors, per engineer, PDF links': 'كل المقاولين، لكل مهندس، بلينكات الـ PDF', 'Contractor copies': 'نسخ المقاولين',
    'Making the report...': 'بيعمل التقرير...', 'Nothing closed on this day yet.': 'مفيش تقفيل في اليوم ده لسه.', 'Nothing waiting. Everything is uploaded.': 'مفيش حاجة مستنية. كله اترفع.',
    'Send / WhatsApp': 'إرسال / واتساب', 'Send without PDF': 'ابعت من غير PDF', 'To upload': 'للرفع', 'Your signature': 'توقيعك',
    'Sun': 'الحد', 'Mon': 'الاتنين', 'Tue': 'التلات', 'Wed': 'الأربع', 'Thu': 'الخميس', 'Fri': 'الجمعة', 'Sat': 'السبت',
    // admin
    'Admin': 'أدمن', 'Engineer': 'مهندس', 'Viewer': 'مشاهد', 'Users': 'المستخدمين', 'Performance': 'الأداء', 'Trash': 'سلة المحذوفات', 'Log': 'السجل', 'Settings': 'الإعدادات',
    'Closed today': 'اتقفل النهارده', 'By contractor': 'لكل مقاول', 'Closed today, per engineer': 'اتقفل النهارده لكل مهندس', 'Oldest late requests': 'أقدم الطلبات المتأخرة', 'Latest closes': 'آخر التقفيلات',
    'Waiting for approval ': 'مستني الموافقة', 'People': 'الناس', 'Add a person': 'ضيف شخص', 'Approve': 'موافقة', 'Reject': 'رفض', 'Role': 'الدور', 'Name in the sheet': 'الاسم في الشيت',
    'Closed per day': 'التقفيل في اليوم', 'Per engineer': 'لكل مهندس', 'Per contractor': 'لكل مقاول', 'Per day': 'في اليوم', 'Watch list': 'تحت الملاحظة', 'Download as CSV': 'نزّل CSV',
    'Open the inspection sheet': 'افتح شيت المرور', 'Open the inspection records folder': 'افتح فولدر تقارير المرور', 'Rules before a close': 'شروط قبل التقفيل', 'Save rules': 'احفظ الشروط',
    'Every checklist item must be marked (✓ ✗ —)': 'كل بنود الـ Checklist لازم تتعلّم (✓ ✗ —)', 'Photos needed for any close': 'عدد الصور المطلوب لأي تقفيل',
    'Photos needed for Code C / D': 'عدد الصور المطلوب لكود C / D', 'Notes needed for Code C / D': 'الملاحظات مطلوبة لكود C / D', 'Engineers see the monthly leaderboard': 'المهندسين يشوفوا لوحة الشرف الشهرية',
    'QR codes of all villas (PDF to print)': 'أكواد QR لكل الفلل (PDF للطباعة)', 'Send me a test notification': 'ابعتلي إشعار تجربة', 'Restore': 'رجّع', 'The trash is empty.': 'السلة فاضية.',
    'Undone closes and deleted notes stay here for 30 days. Restore puts them back as they were.': 'التقفيلات اللي اتلغت والملاحظات اللي اتمسحت بتفضل هنا 30 يوم. "رجّع" بيرجعها زي ما كانت.',
    'Every close made in the app in the last 30 days. Undo opens the request again (code, engineer tab row, PDF to the Drive trash). It goes to the Trash, so you can restore it.':
      'كل تقفيل اتعمل من التطبيق في آخر 30 يوم. التراجع بيفتح الطلب تاني (الكود وصف تاب المهندس والـ PDF يروح سلة الدرايف). وبيروح السلة عشان تقدر ترجّعه.',
    'No closes from the app in the last 30 days.': 'مفيش تقفيلات من التطبيق في آخر 30 يوم.', 'Engineer counts come from the closes made through the app.': 'أرقام المهندسين من التقفيلات اللي اتعملت من التطبيق.',
    'From all closes in the sheet (app and sheet). "Waits" = days from "Sent for review" to the inspection.': 'من كل التقفيلات في الشيت (التطبيق والشيت). "مستني" = الأيام من الإرسال للمراجعة لحد المرور.',
    'Rules saved. Every phone gets them on its next refresh.': 'الشروط اتحفظت. كل موبايل هياخدها مع أول تحديث.', 'Back up the sheet now': 'اعمل نسخة احتياطية دلوقتي',
    'Send me the morning email now': 'ابعتلي إيميل الصبح دلوقتي', 'Last backup': 'آخر نسخة احتياطية', 'Last morning email': 'آخر إيميل صبح', 'Emails left today': 'الإيميلات الباقية النهارده',
    'No closes recorded in this period yet.': 'مفيش تقفيلات في الفترة دي لسه.', 'No closes recorded yet.': 'مفيش تقفيلات لسه.', 'No late requests.': 'مفيش طلبات متأخرة.', 'Nothing closed yet today.': 'مفيش تقفيل النهارده لسه.',
    'No requests waiting.': 'مفيش طلبات مستنية.', 'Save role': 'احفظ الدور', 'Sign out of all devices': 'اخرج من كل الأجهزة', 'Skip': 'تخطي', 'connected': 'متوصل', 'Note': 'ملاحظة',
    'Contractors': 'المقاولين', 'Oldest first': 'الأقدم الأول', 'Due soonest': 'الأقرب في الميعاد', 'Activity': 'النشاط', 'Due': 'الميعاد', 'Waiting': 'مستني',
    'Project': 'المشروع', 'Consultant': 'الاستشاري', 'Sheet': 'الشيت', 'Date': 'التاريخ', 'App': 'التطبيق', 'on this device': 'على الجهاز ده', 'move': 'تنقّل', 'close': 'إغلاق',
    'code A–D': 'الكود A–D', 'Shaker Consultancy': 'شاكر للاستشارات', 'Closed today': 'اتقفل النهارده',
    '30 days': '30 يوم', '7 days': '7 أيام', '90 days': '90 يوم', 'Request': 'طلب', 'How to use Shaker Inspect': 'إزاي تستخدم Shaker Inspect'
  }, window.SHK_AR || {});
  const AR_RX = [
    [/^(\d+) days?$/, '$1 يوم'], [/^Overdue (\d+)d$/, 'متأخر $1 يوم'], [/^(\d+) late$/, '$1 متأخر'], [/^(\d+) open$/, '$1 مفتوح'],
    [/^(\d+) late · (\d+) open$/, '$1 متأخر · $2 مفتوح'], [/^Rev (\d+) was ([A-D])$/, 'Rev $1 كانت $2'], [/^(\d+) waiting to upload$/, '$1 مستني الرفع'],
    [/^(\d+) · go in the PDF$/, '$1 · هتطلع في الـ PDF'], [/^Villa (.+)$/, 'فيلا $1'], [/^(\d+) requests?$/, '$1 طلب'], [/^(\d+) closed$/, '$1 مقفول'],
    [/^Waiting (\d+) days$/, 'مستني من $1 يوم'], [/^Pending: (\d+)$/, 'مستني: $1'], [/^Sent (.+)$/, 'اتبعت $1'], [/^Matched by (.+)$/, 'اتحدد من $1'], [/^Late: (\d+)$/, 'متأخر: $1'], [/^Search in (.+?)\.\.\.$/, 'دوّر في $1...'], [/^(\d+) days left$/, 'فاضل $1 يوم'], [/^Closed (\d+)$/, 'اتقفل $1'], [/^Rev (\d+) photos as Before$/, 'صور Rev $1 كـ "قبل"']
  ];
  const AR_VALUES = new Set(Object.values(AR));
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
  const NO_TR = '.cl-tx,#clKv,.dx-cm-list,.vx-note p,.sc-sheet,.shk-sign,[data-noi18n],.modal-desc,#modalTitle,.ed-wrap,#acctName,#acctEmail,.r-villa,.villa-title';
  function tr1(s) {
    if (AR[s]) return AR[s];
    for (const [rx, to] of AR_RX) if (rx.test(s)) return s.replace(rx, to);
    return null;
  }
  // "🏘 Villa board" / "Email:" / "Loading..." : the symbols around the words stay
  function tr(s) {
    const d = tr1(s); if (d) return d;
    const m = s.match(/^([^A-Za-z]*?)([A-Za-z][\s\S]*?)([\s:.…]*)$/);
    if (!m || (!m[1] && !m[3])) return null;
    const w = tr1(m[2]); return w ? m[1] + w + m[3] : null;
  }
  function trNode(n) {
    const raw = n.nodeValue, t = raw.trim();
    if (!t || !/[A-Za-z]/.test(t) || AR_VALUES.has(t)) return;
    const p = n.parentElement;
    if (!p || SKIP.has(p.tagName) || p.closest(NO_TR)) return;
    const to = tr(t);
    if (to && to !== t) n.nodeValue = raw.replace(t, to);
  }
  function trAttrs(el) {
    ['placeholder', 'title', 'aria-label'].forEach(a => {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && /[A-Za-z]/.test(v)) { const to = tr(v.trim()); if (to) el.setAttribute(a, to); }
    });
  }
  function trTree(root) {
    if (!root) return;
    if (root.nodeType === 3) return trNode(root);
    if (root.nodeType !== 1 || SKIP.has(root.tagName)) return;
    trAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) trNode(n); else trAttrs(n); }
  }
  let trQ = new Set(), trT = 0;
  function startArabic() {
    if (prefs().lang !== 'ar') return;
    trTree(document.body);
    new MutationObserver(ms => {
      ms.forEach(m => { if (m.type === 'characterData') trQ.add(m.target); else if (m.type === 'attributes') trAttrs(m.target); else m.addedNodes.forEach(x => trQ.add(x)); });
      if (!trT) trT = requestAnimationFrame(() => { trT = 0; const q = trQ; trQ = new Set(); q.forEach(trTree); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
  }

  // =====================================================================
  // 2. FILES: Excel export, saving a file (Android app: share sheet)
  // =====================================================================
  function b64of(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  async function saveFile(bytes, name, type) {
    if (NATIVE) {
      try {
        const w = await nativeP('Filesystem', 'writeFile', { path: name, data: b64of(bytes), directory: 'CACHE' });
        await nativeP('Share', 'share', { title: name, files: [w.uri], dialogTitle: name });
        return;
      } catch (e) { if (/cancel/i.test(e && e.message || '')) return; console.warn('native share', e); }
    }
    const blob = new Blob([bytes], { type });
    if (navigator.canShare && window.File && /android|iphone|ipad/i.test(navigator.userAgent)) {
      try { const f = new File([blob], name, { type }); if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  /** sheets: [[sheetName, [[header...], [row...], ...]], ...] */
  async function toExcel(name, sheets) {
    note('Making the Excel file...', 2000);
    await loadScript(LIB.xlsx);
    const wb = XLSX.utils.book_new();
    sheets.forEach(([sn, rows]) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = (rows[0] || []).map((h, i) => ({ wch: Math.min(60, Math.max(8, ...rows.slice(0, 200).map(r => String(r[i] == null ? '' : r[i]).length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, String(sn).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    });
    const stamp = new Date().toISOString().slice(0, 10);
    await saveFile(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), `${name} ${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  const xlBtn = (id, label) => `<button type="button" class="b-line vx-xl" data-xl="${id}">⬇ ${label || 'Excel'}</button>`;
  const XL = {};          // id -> function that exports

  function exportOpen() {
    const rows = [['CIR No.', 'Rev', 'Villa', 'Activity', 'Contractor', 'Sent for review', 'Due', 'Age (days)', 'Late']];
    allItems.slice().sort(byAge).forEach(i => rows.push([i.irNumber, i.rev, villaOf(i), activityOf(i), i.contractor, i.sentDate, i.dueDate, i.ageDays, isLate(i) ? 'Yes' : '']));
    return toExcel('Shaker Inspect - open requests', [['Open requests', rows]]);
  }

  // =====================================================================
  // 3. FULL-SCREEN PAGES
  // =====================================================================
  function screen(title, html, name, right) {
    Shk.closeAll && Shk.closeAll();
    const s = $('shkScreen');
    s.innerHTML = `<header class="sc-head"><button type="button" class="sc-back" data-act="close" aria-label="Back">‹</button><h2>${esc(title)}</h2>${right || '<span></span>'}</header><main class="sc-body" id="scBody">${html}</main>`;
    s.classList.add('open'); document.body.classList.add('scr-open');
    Shk.dxScreen = name;
  }
  const body = () => $('scBody');
  const onScreen = n => Shk.dxScreen === n && !!$('scBody') && $('shkScreen').classList.contains('open');
  const loading = () => '<div class="sc-load"><i></i><i></i><i></i></div>';
  const failHtml = e => `<div class="sc-empty">${esc(e && e.message || e)}</div>`;
  const codeTag = c => c ? `<b class="vx-code c-${esc(c)}">${esc(c)}</b>` : '';

  // ---------------- villa board ----------------
  let villas = null, vFilter = 'all', vCon = '', vQ = '';
  const vState = v => v.late ? 'late' : v.cd ? 'cd' : v.open ? 'open' : v.closed ? 'done' : 'none';
  function openVillas() {
    screen('Villa board', loading(), 'villas', `<button type="button" class="sc-back" data-vx="scan" aria-label="Scan QR">⌗</button>`);
    api('extras_villas').then(v => { villas = v || []; if (onScreen('villas')) drawVillas(); }).catch(e => { if (onScreen('villas')) body().innerHTML = failHtml(e); });
  }
  function drawVillas() {
    const n = k => villas.filter(v => k === 'all' || vState(v) === k).length;
    const cons = [...new Set(villas.map(v => v.con).filter(Boolean))].sort();
    const list = villas.filter(v => (vFilter === 'all' || vState(v) === vFilter) && (!vCon || v.con === vCon) && (!vQ || String(v.v).indexOf(vQ) === 0));
    body().innerHTML = `
      <div class="vx-chips">${[['all', 'All'], ['late', 'Late'], ['cd', 'Waiting C/D'], ['open', 'Open'], ['done', 'Done']].map(([k, l]) =>
        `<button type="button" class="vx-chip s-${k}${vFilter === k ? ' on' : ''}" data-vf="${k}">${l}<b>${n(k)}</b></button>`).join('')}</div>
      <div class="vx-chips small">${cons.map(c => `<button type="button" class="vx-chip${vCon === c ? ' on' : ''}" data-vc="${esc(c)}">${esc(CON_NAME[c] || c)}</button>`).join('')}</div>
      <input id="vxQ" class="sc-in" type="search" inputmode="numeric" placeholder="Villa number" value="${esc(vQ)}">
      <div class="vx-grid">${list.map(v => `<button type="button" class="vx-v s-${vState(v)}" data-villa="${esc(v.v)}"><b>${esc(v.v)}</b><small>${esc(v.type || v.con || '')}</small>${v.open ? `<i>${v.open}</i>` : ''}${v.notes ? '<u>✎</u>' : ''}</button>`).join('') || '<div class="sc-empty">No villa found.</div>'}</div>
      <div class="vx-legend"><span class="s-late">Late</span><span class="s-cd">Waiting C/D</span><span class="s-open">Open</span><span class="s-done">Done</span></div>
      <div class="btnrow">${xlBtn('villas')}${isAdmin() ? '<button type="button" class="b-line" data-vx="qrsheet">⌗ QR sheet (PDF)</button>' : ''}</div>${SIGN}`;
    const q = $('vxQ'); let tm;
    q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { vQ = q.value.trim(); drawVillas(); const x = $('vxQ'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 300); });
    XL.villas = () => toExcel('Shaker Inspect - villa board', [['Villas', [['Villa', 'Type', 'Contractor', 'Status', 'Open', 'Late', 'Waiting C/D', 'Closed', 'A', 'B', 'C', 'D', 'Last close', 'Notes']]
      .concat(villas.map(v => [+v.v, v.type, CON_NAME[v.con] || v.con, ({ late: 'Late', cd: 'Waiting C/D', open: 'Open', done: 'Done', none: '' })[vState(v)], v.open, v.late, v.cd, v.closed, v.A, v.B, v.C, v.D, v.last, v.notes]))]]);
  }

  // ---------------- one villa ----------------
  let curVilla = '';
  function openVilla(n) {
    curVilla = String(n);
    screen('Villa ' + n, loading(), 'villa', `<button type="button" class="sc-back" data-vx="qr" aria-label="QR code">⌗</button>`);
    api('extras_villa', [curVilla]).then(d => { if (onScreen('villa') && curVilla === d.villa) drawVilla(d); }).catch(e => { if (onScreen('villa')) body().innerHTML = failHtml(e); });
  }
  function drawVilla(d) {
    const rows = d.rows, open = rows.filter(r => r.open), late = rows.filter(r => r.late), closed = rows.filter(r => r.code);
    const cnt = c => closed.filter(r => r.code === c).length, t = closed.length || 1;
    const item = r => allItems.find(i => i.irNumber === r.ir && String(i.rev) === String(r.rev));
    body().innerHTML = `
      <div class="kpis"><div class="kpi"><b>${open.length}</b><span>Open</span></div><div class="kpi ${late.length ? 'bad' : ''}"><b>${late.length}</b><span>Late</span></div><div class="kpi ok"><b>${closed.length}</b><span>Closed</span></div></div>
      ${closed.length ? `<div class="split big"><i class="a" style="width:${cnt('A') / t * 100}%"></i><i class="b" style="width:${cnt('B') / t * 100}%"></i><i class="c" style="width:${cnt('C') / t * 100}%"></i><i class="d" style="width:${cnt('D') / t * 100}%"></i></div>
        <small class="hint">A ${cnt('A')} · B ${cnt('B')} · C ${cnt('C')} · D ${cnt('D')}</small>` : ''}
      <h3 class="sc-h">Requests</h3>
      <div class="card-list">${rows.map((r, k) => `<button type="button" class="row col vx-req${r.late ? ' late' : ''}" data-vr="${k}">
          <div class="rowtop"><b class="mono">${esc(shortIr(r.ir))} · Rev ${esc(r.rev)}</b>${r.code ? codeTag(r.code) : `<em class="${r.late ? 'late' : 'okk'}">${r.late ? 'Late' : 'Open'}</em>`}</div>
          <span>${esc(activityOf({ description: r.title }))}</span>
          <small>${r.code ? esc(r.by) + ' · ' + esc(dmy(r.date)) : 'Sent ' + esc(dmy(r.sent))}${r.pdf ? ' · PDF ↗' : ''}${!r.code && item(r) && canClose() ? ' · tap to close' : ''}</small></button>`).join('') || '<div class="sc-empty">No requests for this villa.</div>'}</div>
      ${d.notes ? `<h3 class="sc-h">Team notes <small class="vx-priv">private · not in PDFs or reports</small></h3>
        ${canClose() ? `<div class="vx-note-new"><textarea id="vxNoteIn" dir="auto" rows="2" maxlength="1500" placeholder="A note for the team about this villa..."></textarea><button type="button" class="b-ok" data-vx="noteadd">Add</button></div>` : ''}
        <div class="card-list">${d.notes.map(nt => `<div class="row col vx-note"><div class="rowtop"><b>${esc(nt.engineer)}</b><small>${fmtT(nt.t)}</small></div><p dir="auto">${esc(nt.text)}</p>
          ${isAdmin() || nt.email === PtahApp.email() ? `<button type="button" class="mini" data-vx="notedel" data-id="${esc(nt.id)}">Delete</button>` : ''}</div>`).join('') || '<div class="sc-empty">No notes yet.</div>'}</div>` : ''}
      <div class="btnrow">${xlBtn('villa')}<button type="button" class="b-line" data-vx="sharevilla">🔗 Share link</button></div>${SIGN}`;
    body().dataset.rows = '';
    Shk._vxRows = rows;
    XL.villa = () => toExcel('Villa ' + d.villa, [['Villa ' + d.villa, [['CIR No.', 'Rev', 'Activity', 'Contractor', 'Code', 'By', 'Date', 'Sent', 'Status', 'PDF']]
      .concat(rows.map(r => [r.ir, r.rev, activityOf({ description: r.title }), r.contractor, r.code, r.by, r.date, r.sent, r.code ? 'Closed' : r.late ? 'Late' : r.open ? 'Open' : '', r.pdf]))]]);
  }
  function tapVillaRow(k) {
    const r = (Shk._vxRows || [])[k]; if (!r) return;
    const it = allItems.find(i => i.irNumber === r.ir && String(i.rev) === String(r.rev));
    if (it && !r.code) { Shk.closeScreen(); return setTimeout(() => openModal(it), 60); }
    if (r.pdf) return window.open(r.pdf, '_blank');
    openRequest(r.ir);
  }

  // ---------------- one request (shared link) ----------------
  function openRequest(ir) {
    screen('Request ' + shortIr(ir), loading(), 'req');
    api('extras_request', [ir]).then(d => {
      if (!onScreen('req')) return;
      const openIt = allItems.find(i => i.irNumber === ir);
      body().innerHTML = `
        <div class="card"><b class="mono">${esc(d.ir)}</b><p>${esc(activityOf({ description: d.revs[0].title }))}</p>
          <div class="vx-chips small">${d.villas.map(v => `<button type="button" class="vx-chip" data-villa="${esc(v)}">Villa ${esc(v)}</button>`).join('')}</div>
          ${openIt && canClose() ? `<button type="button" class="b-ok wide" data-vx="openreq" data-ir="${esc(ir)}">Open to close · Rev ${esc(openIt.rev)}</button>` : ''}</div>
        <h3 class="sc-h">All revisions</h3>
        <div class="card-list">${d.revs.map(r => `<div class="row col"><div class="rowtop"><b>Rev ${esc(r.rev)}</b>${r.code ? codeTag(r.code) : `<em class="okk">${r.open ? 'Open' : '—'}</em>`}</div>
          <small>${r.code ? esc(r.by) + ' · ' + esc(dmy(r.date)) : 'Sent ' + esc(dmy(r.sent))}</small>${r.notes ? `<span class="small" dir="auto">${esc(r.notes)}</span>` : ''}
          ${r.pdf ? `<a class="lk small" href="${esc(r.pdf)}" target="_blank" rel="noopener">Inspection record PDF ↗</a>` : ''}</div>`).join('')}</div>
        <div class="btnrow"><button type="button" class="b-line" data-vx="sharereq" data-ir="${esc(ir)}">🔗 Share link</button></div>${SIGN}`;
    }).catch(e => { if (onScreen('req')) body().innerHTML = failHtml(e); });
  }
  async function shareLink(url, title) {
    const text = title + '\n(Shaker Inspect account needed)';
    if (navigator.share && !NATIVE) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    if (NATIVE) { try { await nativeP('Share', 'share', { title, text, url, dialogTitle: title }); return; } catch (e) { if (/cancel/i.test(e && e.message || '')) return; } }
    try { await navigator.clipboard.writeText(url); note('Link copied. Paste it in WhatsApp.'); }
    catch (e) { window.open('https://wa.me/?text=' + encodeURIComponent(text + '\n' + url), '_blank'); }
  }
  const reqLink = ir => APP_LINK + '#req=' + encodeURIComponent(ir);
  const villaLink = v => APP_LINK + '#villa=' + encodeURIComponent(v);

  // ---------------- QR codes ----------------
  async function qrSvg(text, px) {
    await loadScript(LIB.qr);
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: Math.max(2, Math.floor(px / (q.getModuleCount() + 8))), margin: 4, scalable: true });
  }
  async function showQr(v) {
    const ov = document.createElement('div'); ov.className = 'acct-overlay open vx-qrbox';
    ov.innerHTML = `<div class="acct-box"><h3>Villa ${esc(v)}</h3><div class="vx-qr">${await qrSvg(villaLink(v), 260)}</div>
      <p class="acct-txt">Scan it with the app (⌗ Scan) or the phone camera: it opens this villa.</p>
      <div class="btnrow"><button type="button" class="b-line" data-vx="qrpdf" data-v="${esc(v)}">⬇ PDF to print</button><button type="button" class="acct-close" data-vx="qrclose">Close</button></div>${SIGN}</div>`;
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-vx="qrclose"]')) ov.remove(); });
    document.body.appendChild(ov);
  }
  /** A4 PDF, 12 QR codes per page (vector squares, sharp when printed). */
  async function qrSheet(list) {
    if (!list.length) return note('No villas to print.');
    note('Making the QR sheet...', 2500);
    await Promise.all([loadScript(LIB.qr), loadScript(LIB.pdf)]);
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create(), B = await doc.embedFont(StandardFonts.HelveticaBold), R = await doc.embedFont(StandardFonts.Helvetica);
    const W = 595.28, H = 841.89, M = 34, cols = 3, rows = 4, cw = (W - 2 * M) / cols, ch = (H - 2 * M - 20) / rows, navy = rgb(11 / 255, 42 / 255, 91 / 255);
    let page;
    list.forEach((v, i) => {
      if (i % (cols * rows) === 0) {
        page = doc.addPage([W, H]);
        page.drawText('Shaker Inspect · villa QR codes', { x: M, y: H - M + 6, size: 9, font: B, color: navy });
        page.drawText('architected by Ptah', { x: W - M - R.widthOfTextAtSize('architected by Ptah', 7), y: M - 18, size: 7, font: R, color: rgb(.5, .55, .6) });
      }
      const k = i % (cols * rows), cx = M + (k % cols) * cw, top = H - M - 20 - Math.floor(k / cols) * ch;
      const q = qrcode(0, 'M'); q.addData(villaLink(v.v)); q.make();
      const n = q.getModuleCount(), size = Math.min(cw, ch) - 70, cell = size / n, x0 = cx + (cw - size) / 2, y0 = top - 14 - size;
      page.drawRectangle({ x: cx + 6, y: top - ch + 8, width: cw - 12, height: ch - 12, borderColor: rgb(.82, .84, .88), borderWidth: .6, borderDashArray: [3, 3] });
      for (let r = 0; r < n; r++) {
        let c = 0;
        while (c < n) {
          if (!q.isDark(r, c)) { c++; continue; }
          let e = c; while (e < n && q.isDark(r, e)) e++;
          page.drawRectangle({ x: x0 + c * cell, y: y0 + (n - 1 - r) * cell, width: (e - c) * cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
          c = e;
        }
      }
      const label = 'Villa ' + v.v, sub = [v.type, CON_NAME[v.con] || v.con].filter(Boolean).join(' · ');
      page.drawText(label, { x: cx + (cw - B.widthOfTextAtSize(label, 15)) / 2, y: y0 - 20, size: 15, font: B, color: navy });
      if (sub) page.drawText(sub, { x: cx + (cw - R.widthOfTextAtSize(sub, 8.5)) / 2, y: y0 - 33, size: 8.5, font: R, color: rgb(.35, .4, .47) });
    });
    await saveFile(await doc.save(), list.length === 1 ? `QR - Villa ${list[0].v}.pdf` : `QR - ${list.length} villas.pdf`, 'application/pdf');
  }

  // ---------------- scan a villa QR ----------------
  let scanStream = null, scanOn = false;
  async function openScan() {
    const ov = document.createElement('div'); ov.id = 'vxScan'; ov.className = 'vx-scan';
    ov.innerHTML = `<video id="vxVid" playsinline muted></video><div class="vx-frame"></div>
      <p id="vxScanMsg">Point the camera at the villa QR code</p>
      <div class="vx-scan-btns"><button type="button" class="b-line" data-vx="scanphoto">📷 Take a photo instead</button><button type="button" class="b-no" data-vx="scanclose">Close</button></div>
      <input type="file" id="vxScanFile" accept="image/*" capture="environment" hidden>`;
    document.body.appendChild(ov);
    $('vxScanFile').onchange = e => scanFile(e.target.files[0]);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera api');
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const v = $('vxVid'); v.srcObject = scanStream; await v.play();
      scanOn = true; scanLoop();
    } catch (e) {
      const m = $('vxScanMsg'); if (m) m.textContent = 'The live camera is not available here. Take a photo of the QR code instead.';
    }
  }
  function closeScan() {
    scanOn = false;
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    const o = $('vxScan'); if (o) o.remove();
  }
  async function decodeFrom(src, w, h) {
    if ('BarcodeDetector' in window) {
      try { const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(src); if (r && r[0]) return r[0].rawValue; } catch (e) {}
    }
    await loadScript(LIB.jsqr);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0, w, h);
    const r = jsQR(g.getImageData(0, 0, w, h).data, w, h);
    return r ? r.data : '';
  }
  async function scanLoop() {
    const v = $('vxVid');
    while (scanOn && v) {
      if (v.readyState >= 2 && v.videoWidth) {
        const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        try { const t = await decodeFrom(v, Math.round(v.videoWidth * k), Math.round(v.videoHeight * k)); if (t) { closeScan(); return gotScan(t); } } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }
  function scanFile(f) {
    if (!f) return;
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = async () => {
      const k = Math.min(1, 1200 / Math.max(im.width, im.height));
      const t = await decodeFrom(im, Math.round(im.width * k), Math.round(im.height * k)).catch(() => '');
      URL.revokeObjectURL(url);
      if (t) { closeScan(); gotScan(t); } else { const m = $('vxScanMsg'); if (m) m.textContent = 'No QR code found in the photo. Try again closer.'; }
    };
    im.src = url;
  }
  function gotScan(t) {
    if (navigator.vibrate) navigator.vibrate(60);
    const m = String(t).match(/#villa=([\w-]+)/) || String(t).match(/^\s*villa\s*(\d+)\s*$/i);
    if (m) return openVilla(decodeURIComponent(m[1]));
    const r = String(t).match(/#req=([^&\s]+)/);
    if (r) return openRequest(decodeURIComponent(r[1]));
    note('This QR code is not a Shaker Inspect villa code.', 5000);
  }

  // ---------------- leaderboard ----------------
  let lbMonth = '';
  const monthOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthName = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
  function openBoard() {
    lbMonth = lbMonth || monthOf(new Date());
    screen('Leaderboard', loading(), 'board');
    drawBoard();
  }
  function drawBoard() {
    const m = lbMonth;
    api('extras_leaderboard', [m]).then(d => {
      if (!onScreen('board') || m !== lbMonth) return;
      const max = Math.max(1, ...d.rows.map(r => r.n)), me = (PtahApp.engineer() || '').toLowerCase();
      const medal = i => ['🥇', '🥈', '🥉'][i] || String(i + 1);
      const next = monthOf(new Date(+m.slice(0, 4), +m.slice(5) , 1)), now = monthOf(new Date());
      body().innerHTML = `
        <div class="vx-month"><button type="button" class="b-line" data-lb="-1">‹</button><b>${esc(monthName(m))}</b><button type="button" class="b-line" data-lb="1"${next > now ? ' disabled' : ''}>›</button></div>
        <div class="kpis"><div class="kpi"><b>${d.total}</b><span>Closed</span></div><div class="kpi"><b>${d.rows.length}</b><span>Engineers</span></div></div>
        <div class="card-list">${d.rows.map((r, i) => `<div class="row col vx-lb${r.engineer.toLowerCase() === me ? ' me' : ''}"><div class="rowtop"><span class="vx-rank">${medal(i)}</span><b>${esc(r.engineer)}</b><b class="mono">${r.n}</b></div>
          <div class="vx-bar"><i style="width:${r.n / max * 100}%"></i></div><small>A ${r.A} · B ${r.B} · C ${r.C} · D ${r.D} · ${r.activeDays} days on site</small></div>`).join('') || '<div class="sc-empty">No closes this month yet.</div>'}</div>
        <small class="hint">All closes in the sheet for the month, by the engineer who closed them.</small>
        <div class="btnrow">${xlBtn('board')}</div>${SIGN}`;
      XL.board = () => toExcel('Leaderboard ' + m, [[m, [['Rank', 'Engineer', 'Closed', 'A', 'B', 'C', 'D', 'Days on site']].concat(d.rows.map((r, i) => [i + 1, r.engineer, r.n, r.A, r.B, r.C, r.D, r.activeDays]))]]);
    }).catch(e => { if (onScreen('board')) body().innerHTML = failHtml(e); });
  }

  // =====================================================================
  // 4. CLOSE SCREEN: rules, before photos of the last Rev, share link, draw on a photo
  // =====================================================================
  function ruleProblems() {
    const r = X.rules || {}, out = [];
    const ph = Shk._dx.photos().length, cd = /^[CD]$/.test(selectedCode || '');
    if (r.allMarked && clCurrent) { const left = clCurrent.items.length - Object.keys(clMarks).length; if (left > 0) out.push(AR_ON ? `${left} بند في الـ Checklist مش متعلّم` : `${left} checklist item${left > 1 ? 's' : ''} not marked`); }
    const need = Math.max(+r.minPhotos || 0, cd ? +r.minPhotosCD || 0 : 0);
    if (ph < need) out.push(AR_ON ? `محتاج ${need} صور (متضاف ${ph})` : `${need} photo${need > 1 ? 's' : ''} needed (${ph} added)`);
    if (r.notesCD && cd && !$('modalNotes').value.trim()) out.push(AR_ON ? 'الملاحظات مطلوبة لكود ' + selectedCode : 'notes needed for Code ' + selectedCode);
    return out;
  }
  function ruleHint() {
    const r = X.rules || {}, h = $('vxRule'); if (!h) return;
    const parts = [];
    if (r.allMarked) parts.push(AR_ON ? 'كل بنود الـ Checklist متعلّمة' : 'every checklist item marked');
    if (+r.minPhotos) parts.push(AR_ON ? `${r.minPhotos} صور` : `${r.minPhotos} photo${r.minPhotos > 1 ? 's' : ''}`);
    if (+r.minPhotosCD) parts.push(AR_ON ? `${r.minPhotosCD} صور لكود C/D` : `${r.minPhotosCD} photo${r.minPhotosCD > 1 ? 's' : ''} for C/D`);
    if (r.notesCD) parts.push(AR_ON ? 'ملاحظات لكود C/D' : 'notes for C/D');
    h.hidden = !parts.length || !canClose();
    h.textContent = (AR_ON ? 'للتقفيل: ' : 'To close: ') + parts.join(' · ');
  }
  const baseSubmit = window.submitModalData;
  window.submitModalData = function () {
    if (currentItem && canClose()) {
      const why = ruleProblems();
      if (why.length) {
        const st = $('modalStatus'); st.style.color = 'var(--rej)'; st.innerText = (AR_ON ? '⚠ لسه: ' : '⚠ Not yet: ') + why.join(' · ') + '.';
        if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
        return;
      }
    }
    return baseSubmit.apply(this, arguments);
  };

  function injectModal() {
    if ($('vxReqBar')) return;
    $('modalDesc').insertAdjacentHTML('afterend', `<div class="vx-reqbar" id="vxReqBar"><button type="button" class="pill-btn" data-vx="sharecur">🔗 Share link</button><button type="button" class="pill-btn" id="vxVillaBtn" data-vx="villacur" hidden></button></div>`);
    const ph = document.querySelector('#dxExtras .dx-ph-btns');
    if (ph) ph.insertAdjacentHTML('beforeend', '<button type="button" class="pill-btn" id="vxPrevPh" data-vx="prevph" hidden></button>');
    const sv = $('modalSaveBtn'); if (sv) sv.insertAdjacentHTML('beforebegin', '<div class="vx-rule" id="vxRule" hidden></div>');
    const th = $('dxThumbs'); if (th) th.insertAdjacentHTML('afterend', '<small class="dx-hint vx-thhint">Tap a photo to draw on it or mark it Before / After.</small>');
    // the close screen stops clicks from reaching the page, so its buttons get their own handlers
    $('vxReqBar').addEventListener('click', vxClick);
    if ($('vxPrevPh')) $('vxPrevPh').addEventListener('click', vxClick);
    if (th) th.addEventListener('click', e => { const im = e.target.closest('img[data-ph]'); if (im) openDraw(+im.dataset.ph); });
  }
  const baseOpen = window.openModal;
  window.openModal = function (item) {
    const r = baseOpen.apply(this, arguments);
    try {
      injectModal(); ruleHint();
      const v = villaParts(item), vb = $('vxVillaBtn');
      vb.hidden = !v; if (v) { vb.textContent = '🏘 Villa ' + v.num.split(/[,\/&-]|and/)[0].trim(); vb.dataset.v = v.num.split(/[,\/&-]|and/)[0].trim(); }
      const p = Shk._dx.prevOf(item), pb = $('vxPrevPh');
      if (pb) { pb.hidden = !p || !canClose(); if (p) { pb.textContent = `⇆ Rev ${p.rev} photos as Before`; pb.dataset.rev = p.rev; pb.disabled = false; } }
    } catch (e) { console.warn('vx open', e); }
    return r;
  };
  async function addPrevPhotos(btn) {
    const it = currentItem; if (!it) return;
    btn.disabled = true; const t = btn.textContent; btn.textContent = 'Loading...';
    try {
      const list = await api('extras_prevPhotos', [it.irNumber, btn.dataset.rev]);
      if (currentItem !== it) return;
      const ph = Shk._dx.photos();
      let n = 0;
      list.forEach(x => { if (ph.length < Shk._dx.MAX_PHOTOS) { ph.push({ data: x.data, t: x.t, cap: 'Rev ' + btn.dataset.rev + ' · ' + new Date(x.t).toLocaleDateString('en-GB'), tag: 'before', fromRev: true }); n++; } });
      Shk._dx.paintPhotos();
      note(n ? `${n} photo${n > 1 ? 's' : ''} of Rev ${btn.dataset.rev} added as Before. Take the After photos now.` : `No photos were saved with Rev ${btn.dataset.rev}.`, 5000);
      btn.textContent = t; btn.disabled = !!n;
    } catch (e) { note(e.message); btn.textContent = t; btn.disabled = false; }
  }

  // ---------------- draw on a photo + Before / After ----------------
  let dr = null;
  function openDraw(i) {
    const ph = Shk._dx.photos()[i]; if (!ph) return;
    const img = new Image();
    img.onload = () => {
      dr = { i, img, shapes: (ph.shapes || []).slice(), tool: 'arrow', color: '#ff2d2d', tag: ph.tag || '', cur: null };
      const ov = document.createElement('div'); ov.id = 'vxDraw'; ov.className = 'vx-draw';
      ov.innerHTML = `<div class="vx-dtop"><div class="vx-seg" id="vxTag">${[['', 'Photo'], ['before', 'Before'], ['after', 'After']].map(([k, l]) => `<button type="button" data-tag="${k}">${l}</button>`).join('')}</div></div>
        <div class="vx-cwrap"><canvas id="vxCv"></canvas></div>
        <div class="vx-tools"><div class="vx-seg" id="vxTool">${[['arrow', '➚'], ['circle', '◯'], ['pen', '✎']].map(([k, l]) => `<button type="button" data-tool="${k}" title="${k}">${l}</button>`).join('')}</div>
          <div class="vx-seg" id="vxCol">${['#ff2d2d', '#ffc61a', '#ffffff'].map(c => `<button type="button" data-col="${c}" style="--c:${c}"><i></i></button>`).join('')}</div>
          <button type="button" class="b-line" data-dr="undo">↶</button></div>
        <div class="vx-scan-btns"><button type="button" class="b-no" data-dr="cancel">Cancel</button><button type="button" class="b-ok" data-dr="save">Save</button></div>`;
      document.body.appendChild(ov);
      const cv = $('vxCv'); cv.width = (ph.orig ? ph.origW : img.width) || img.width; cv.height = (ph.orig ? ph.origH : img.height) || img.height;
      if (ph.orig) { const o = new Image(); o.onload = () => { dr.img = o; redraw(); }; o.src = ph.orig; }
      paintDrawUi(); redraw();
      cv.addEventListener('pointerdown', drDown); cv.addEventListener('pointermove', drMove); cv.addEventListener('pointerup', drUp); cv.addEventListener('pointercancel', drUp);
      ov.addEventListener('click', drClick);
    };
    img.src = ph.orig || ph.data;
  }
  function paintDrawUi() {
    document.querySelectorAll('#vxTag button').forEach(b => b.classList.toggle('on', b.dataset.tag === dr.tag));
    document.querySelectorAll('#vxTool button').forEach(b => b.classList.toggle('on', b.dataset.tool === dr.tool));
    document.querySelectorAll('#vxCol button').forEach(b => b.classList.toggle('on', b.dataset.col === dr.color));
  }
  function ptOf(e) { const cv = $('vxCv'), r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; }
  function drDown(e) { e.preventDefault(); $('vxCv').setPointerCapture(e.pointerId); const p = ptOf(e); dr.cur = { tool: dr.tool, color: dr.color, pts: [p, p] }; }
  function drMove(e) { if (!dr || !dr.cur) return; const p = ptOf(e); if (dr.cur.tool === 'pen') dr.cur.pts.push(p); else dr.cur.pts[1] = p; redraw(); }
  function drUp() { if (!dr || !dr.cur) return; const [a, b] = [dr.cur.pts[0], dr.cur.pts[dr.cur.pts.length - 1]]; if (dr.cur.tool === 'pen' || Math.hypot(b[0] - a[0], b[1] - a[1]) > 8) dr.shapes.push(dr.cur); dr.cur = null; redraw(); }
  function redraw() {
    const cv = $('vxCv'); if (!cv) return;
    const g = cv.getContext('2d'), lw = Math.max(3, Math.round(Math.max(cv.width, cv.height) / 160));
    g.drawImage(dr.img, 0, 0, cv.width, cv.height);
    dr.shapes.concat(dr.cur ? [dr.cur] : []).forEach(s => {
      g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = lw;
      const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
      g.beginPath();
      if (s.tool === 'pen') { s.pts.forEach((p, k) => k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
      else if (s.tool === 'circle') { g.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 1, Math.abs(b[1] - a[1]) / 2 + 1, 0, 0, Math.PI * 2); g.stroke(); }
      else {
        g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = lw * 5;
        g.beginPath(); g.moveTo(b[0], b[1]);
        g.lineTo(b[0] - hl * Math.cos(ang - 0.45), b[1] - hl * Math.sin(ang - 0.45));
        g.lineTo(b[0] - hl * Math.cos(ang + 0.45), b[1] - hl * Math.sin(ang + 0.45)); g.closePath(); g.fill();
      }
      g.shadowBlur = 0;
    });
  }
  function drClick(e) {
    const t = e.target.closest('[data-tag],[data-tool],[data-col],[data-dr]'); if (!t) return;
    if (t.dataset.tag != null) dr.tag = t.dataset.tag;
    else if (t.dataset.tool) dr.tool = t.dataset.tool;
    else if (t.dataset.col) dr.color = t.dataset.col;
    else if (t.dataset.dr === 'undo') { dr.shapes.pop(); redraw(); }
    else if (t.dataset.dr === 'cancel') { $('vxDraw').remove(); dr = null; return; }
    else if (t.dataset.dr === 'save') {
      const ph = Shk._dx.photos()[dr.i], cv = $('vxCv');
      if (ph) {
        if (dr.shapes.length) { if (!ph.orig) { ph.orig = ph.data; ph.origW = cv.width; ph.origH = cv.height; } ph.data = cv.toDataURL('image/jpeg', 0.78); }
        else if (ph.orig) { ph.data = ph.orig; delete ph.orig; }
        ph.shapes = dr.shapes; ph.tag = dr.tag;
        if (ph.fromRev && dr.shapes.length) ph.fromRev = false;      // a marked-up old photo is a new photo of this Rev
        Shk._dx.paintPhotos();
      }
      $('vxDraw').remove(); dr = null; return;
    }
    paintDrawUi();
  }

  // =====================================================================
  // 5. ADMIN: per-contractor performance, undo of any close, trash, close rules, Excel
  // =====================================================================
  Shk.admPerfExtra = function (days, o) {
    XL.perf = null;
    const host = body(); if (!host) return;
    const box = document.createElement('div'); box.innerHTML = '<h3 class="sc-h">Per contractor</h3>' + loading(); host.insertBefore(box, host.querySelector('.shk-sign'));
    api('admin_perf2', [days]).then(c => {
      box.innerHTML = `<h3 class="sc-h">Per contractor</h3>
        <div class="card-list">${c.rows.map(r => { const t = r.n || 1; return `<div class="row col"><div class="rowtop"><b>${esc(r.name)}</b><b class="mono">${r.n}</b></div>
          <div class="split"><i class="a" style="width:${r.A / t * 100}%"></i><i class="b" style="width:${r.B / t * 100}%"></i><i class="c" style="width:${r.C / t * 100}%"></i><i class="d" style="width:${r.D / t * 100}%"></i></div>
          <small>A ${r.A} · B ${r.B} · C ${r.C} · D ${r.D} · <b class="${r.cdRate >= 25 ? 'late' : ''}">C/D ${r.cdRate}%</b>${r.wait != null ? ' · waits ' + r.wait + ' d' : ''} · ${r.open} open${r.late ? ` · <em class="late">${r.late} late</em>` : ''}</small></div>`; }).join('') || '<div class="sc-empty">No closes in this period.</div>'}</div>
        <small class="hint">From all closes in the sheet (app and sheet). "Waits" = days from "Sent for review" to the inspection.</small>
        <div class="btnrow">${xlBtn('perf')}</div>`;
      XL.perf = () => toExcel(`Performance ${days} days`, [
        ['Engineers', [['Engineer', 'Closed', 'A', 'B', 'C', 'D']].concat(o.engineers.map(e => [e.engineer, e.n, e.A, e.B, e.C, e.D]))],
        ['Contractors', [['Contractor', 'Closed', 'A', 'B', 'C', 'D', 'C/D %', 'Average wait (days)', 'Open now', 'Late now']].concat(c.rows.map(r => [r.name, r.n, r.A, r.B, r.C, r.D, r.cdRate, r.wait, r.open, r.late]))],
        ['Per day', [['Date', 'Closed']].concat(o.series.map(s => [s.d, s.n]))]]);
    }).catch(e => { box.innerHTML = '<h3 class="sc-h">Per contractor</h3>' + failHtml(e); });
    const hint = host.querySelector('.hint'); if (hint && /next stage/.test(hint.textContent)) hint.remove();
  };
  Shk.admLogExtra = function (rows) {
    const r = body().querySelector('.btnrow'); if (!r) return;
    r.insertAdjacentHTML('beforeend', xlBtn('log'));
    XL.log = () => toExcel('Shaker Inspect - log', [['Log', [['Time', 'Email', 'Engineer', 'Action', 'Detail']].concat(rows.map(l => [l.t, l.email, l.engineer, l.action, l.detail]))]]);
  };
  Shk.admUsersExtra = function (rows) {
    body().insertAdjacentHTML('beforeend', `<div class="btnrow">${xlBtn('users')}</div>`);
    XL.users = () => toExcel('Shaker Inspect - users', [['Users', [['Email', 'Name', 'Role', 'Status', 'Last sign-in', 'Message']].concat(rows.map(u => [u.email, u.engineer, u.role, u.status, u.last, u.message]))]]);
  };
  Shk.sheetExtra = function (name, d) {
    const host = body(); if (!host || !d || !d.rows) return;
    host.insertAdjacentHTML('beforeend', `<div class="btnrow">${xlBtn('sheet', 'Excel · ' + esc(name))}</div>`);
    XL.sheet = () => toExcel(name, [[name, [d.header || []].concat(d.rows)]]);
  };
  Shk.admCloses = function () {
    const host = body();
    api('admin_closes', ['']).then(rows => {
      host.innerHTML = `<small class="hint">Every close made in the app in the last 30 days. Undo opens the request again (code, engineer tab row, PDF to the Drive trash). It goes to the Trash, so you can restore it.</small>
        <div class="card-list">${rows.map(r => `<div class="row col" data-uid="${esc(r.id)}"><div class="rowtop"><b class="mono">${esc(shortIr(r.ir))} · Rev ${esc(r.rev)}</b>${codeTag(r.code)}</div>
          <span>${esc(r.engineer)}${r.villa ? ' · Villa ' + esc(r.villa) : ''}</span><div class="rowtop"><small>${fmtT(r.t)}</small><button type="button" class="mini b-no" data-vx="undo">Undo</button></div></div>`).join('') || '<div class="sc-empty">No closes from the app in the last 30 days.</div>'}</div>${SIGN}`;
    }).catch(e => { host.innerHTML = failHtml(e); });
  };
  Shk.admTrash = function () {
    const host = body();
    api('admin_trash').then(rows => {
      host.innerHTML = `<small class="hint">Undone closes and deleted notes stay here for 30 days. Restore puts them back as they were.</small>
        <div class="card-list">${rows.map(r => `<div class="row col" data-tid="${esc(r.id)}"><div class="rowtop"><b>${esc(r.type === 'close' ? 'Close' : 'Note')}</b><small>${r.left} days left</small></div>
          <span class="small">${esc(r.title)}</span><div class="rowtop"><small>${esc(r.by)} · ${fmtT(r.t)}</small><button type="button" class="mini b-ok" data-vx="restore">Restore</button></div></div>`).join('') || '<div class="sc-empty">The trash is empty.</div>'}</div>${SIGN}`;
    }).catch(e => { host.innerHTML = failHtml(e); });
  };
  Shk.admSettingsExtra = function () {
    const host = body(); if (!host) return;
    const box = document.createElement('div'); box.innerHTML = loading(); host.insertBefore(box, host.querySelector('.shk-sign'));
    api('admin_rules').then(o => {
      const r = o.rules, num = (id, v) => `<select id="${id}" class="sc-in sm">${[0, 1, 2, 3, 4].map(n => `<option${+v === n ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
      box.innerHTML = `<h3 class="sc-h">Rules before a close</h3>
        <div class="card vx-rules">
          <label class="vx-sw"><input type="checkbox" id="rAll"${r.allMarked ? ' checked' : ''}><span>Every checklist item must be marked (✓ ✗ —)</span></label>
          <label class="vx-sw"><span>Photos needed for any close</span>${num('rPh', r.minPhotos)}</label>
          <label class="vx-sw"><span>Photos needed for Code C / D</span>${num('rPhCD', r.minPhotosCD)}</label>
          <label class="vx-sw"><input type="checkbox" id="rNotes"${r.notesCD ? ' checked' : ''}><span>Notes needed for Code C / D</span></label>
          <label class="vx-sw"><input type="checkbox" id="rBoard"${o.board ? ' checked' : ''}><span>Engineers see the monthly leaderboard</span></label>
          <div class="btnrow"><button type="button" class="b-ok" data-vx="saverules">Save rules</button></div></div>
        <div class="card-list links">
          <button type="button" class="lk" data-vx="qrsheet"><span>QR codes of all villas (PDF to print)</span><i>⌗</i></button>
          <button type="button" class="lk" data-vx="pushtest"><span>Send me a test notification</span><i>🔔</i></button>
        </div>`;
    }).catch(e => { box.innerHTML = failHtml(e); });
  };

  // =====================================================================
  // 6. PUSH NOTIFICATIONS (Android app, Firebase)
  // =====================================================================
  const PUSH_OK = () => NATIVE && !!CFG.PUSH && window.Capacitor && Capacitor.isPluginAvailable && Capacitor.isPluginAvailable('PushNotifications');
  let pushListening = false;
  function pushListen() {
    if (pushListening) return; pushListening = true;
    Capacitor.addListener('PushNotifications', 'registration', t => {
      const v = t && t.value; if (!v) return;
      ls.set('shkPushToken', v);
      api('push_register', [v, 'android']).catch(e => console.warn('push register', e));
    });
    Capacitor.addListener('PushNotifications', 'registrationError', e => note('Notifications: ' + (e && e.error || 'could not register'), 5000));
    Capacitor.addListener('PushNotifications', 'pushNotificationReceived', n => note((n.title ? n.title + ' · ' : '') + (n.body || ''), 6000));
    Capacitor.addListener('PushNotifications', 'pushNotificationActionPerformed', a => {
      const u = a && a.notification && a.notification.data && a.notification.data.url;
      if (u && u !== '#') { location.hash = u.replace(/^#?/, '#'); route(); }
    });
  }
  async function pushOn() {
    let st = await nativeP('PushNotifications', 'checkPermissions');
    if (st.receive !== 'granted') st = await nativeP('PushNotifications', 'requestPermissions');
    if (st.receive !== 'granted') throw new Error('Notifications are blocked. Allow them in the phone settings > Apps > Shaker Inspect.');
    pushListen();
    await nativeP('PushNotifications', 'register');
    ls.set('shkPush', true);
  }
  async function pushOff() {
    ls.set('shkPush', false);
    const t = ls.get('shkPushToken', '');
    try { await nativeP('PushNotifications', 'unregister'); } catch (e) {}
    if (t) api('push_unregister', [t]).catch(() => {});
  }

  // =====================================================================
  // 7. HOME BUTTONS, ME SHEET, LINKS (#villa=..., #req=...)
  // =====================================================================
  const baseRender = window.render;
  window.render = function () {
    const r = baseRender.apply(this, arguments);
    try { homeButtons(); } catch (e) { console.warn(e); }
    return r;
  };
  function homeButtons() {
    const q = $('dxQuick'); if (!q || q.querySelector('[data-vx="villas"]')) return;
    q.insertAdjacentHTML('afterbegin', `<button type="button" data-vx="villas"><i>🏘</i>Villas</button><button type="button" data-vx="scan"><i>⌗</i>Scan</button>`);
    if (X.board) q.insertAdjacentHTML('beforeend', `<button type="button" data-vx="board"><i>🏆</i>Leaderboard</button>`);
  }
  function meEntries() {
    const list = document.querySelector('#acctOverlay .acct-list'); if (!list || $('vxMe')) return;
    const work = `<div id="vxMe" class="dx-me">
      <button type="button" data-vx="villas"><span>🏘 Villa board</span><i>›</i></button>
      <button type="button" data-vx="scan"><span>⌗ Scan a villa QR</span><i>›</i></button>
      <button type="button" data-vx="board" id="vxMeBoard"><span>🏆 Leaderboard</span><i>›</i></button>
      <button type="button" data-vx="xlopen"><span>⬇ Open requests to Excel</span><i>›</i></button></div>`;
    const look = `<div id="vxMe2" class="dx-me">
      <button type="button" data-vx="lang"><span>🌐 العربية / English</span><i id="vxMeLang"></i></button>
      <button type="button" data-vx="sun"><span>☀ Sunlight mode (strong contrast)</span><i id="vxMeSun"></i></button>
      <button type="button" data-vx="big"><span>🔠 Large text</span><i id="vxMeBig"></i></button>
      <button type="button" data-vx="push" id="vxMePushB" hidden><span>📲 Push notifications</span><i id="vxMePush"></i></button></div>`;
    const dx = $('dxMe'); dx ? dx.insertAdjacentHTML('afterend', work) : list.insertAdjacentHTML('afterbegin', work);
    const dx2 = $('dxMe2'); dx2 ? dx2.insertAdjacentHTML('afterend', look) : list.insertAdjacentHTML('beforeend', look);
  }
  function paintMe() {
    meEntries();
    const on = v => v ? '<em class="okk">On</em>' : '<em>Off</em>', p = prefs();
    $('vxMeLang').innerHTML = `<em class="okk">${p.lang === 'ar' ? 'عربي' : 'English'}</em>`;
    $('vxMeSun').innerHTML = on(p.sun); $('vxMeBig').innerHTML = on(p.big);
    $('vxMeBoard').hidden = !X.board;
    $('vxMePushB').hidden = !PUSH_OK(); $('vxMePush').innerHTML = on(ls.get('shkPush', false));
  }
  const baseAcct = PtahApp.openAccount;
  PtahApp.openAccount = function () { try { paintMe(); } catch (e) { console.warn(e); } return baseAcct.apply(this, arguments); };

  // links: #villa=105 opens the villa, #req=CP2C-...-14688 opens the request (after sign-in and the list)
  let ready = false, xBooted = false;
  function route() {
    const h = decodeURIComponent(location.hash || '');
    const v = h.match(/^#villa=([\w-]+)/), q = h.match(/^#req=(.+)$/);
    if (!v && !q) return;
    if (!ready || !PtahApp.engineer()) return;      // waits for the list
    history.replaceState(null, '', location.pathname + location.search);
    if (v) return openVilla(v[1]);
    const it = allItems.find(i => i.irNumber === q[1]);
    if (it && canClose()) { Shk.closeAll && Shk.closeAll(); return setTimeout(() => openModal(it), 60); }
    openRequest(q[1]);
  }
  window.addEventListener('hashchange', route);
  const baseGrid = window.renderGrid;
  window.renderGrid = function () {
    const r = baseGrid.apply(this, arguments);
    if (!xBooted && navigator.onLine !== false) {      // rules + leaderboard switch (kept on the phone; asked again after no signal)
      xBooted = true;
      api('extras_bootstrap').then(b => { X = Object.assign(X, b || {}); ls.set('shkX', X); render(); }).catch(() => { xBooted = false; });
    }
    if (!ready) {
      ready = true;
      setTimeout(route, 300);
      if (PUSH_OK() && ls.get('shkPush', false)) { try { pushListen(); nativeP('PushNotifications', 'register').catch(() => {}); } catch (e) {} }
    }
    return r;
  };
  X = Object.assign(X, ls.get('shkX', {}));

  // =====================================================================
  // events
  // =====================================================================
  async function vxClick(ev) {
    const t = ev.target;
    const xl = t.closest && t.closest('[data-xl]');
    if (xl) { const f = XL[xl.dataset.xl]; if (f) { xl.disabled = true; try { await f(); } catch (e) { note(e.message, 5000); } xl.disabled = false; } return; }
    const vl = t.closest && t.closest('[data-villa]'); if (vl) return openVilla(vl.dataset.villa);
    const vr = t.closest && t.closest('[data-vr]'); if (vr) return tapVillaRow(+vr.dataset.vr);
    const f = t.closest && t.closest('[data-vf]'); if (f) { vFilter = f.dataset.vf; return drawVillas(); }
    const c = t.closest && t.closest('[data-vc]'); if (c) { vCon = vCon === c.dataset.vc ? '' : c.dataset.vc; return drawVillas(); }
    const lb = t.closest && t.closest('[data-lb]');
    if (lb) { const [y, m] = lbMonth.split('-').map(Number); lbMonth = monthOf(new Date(y, m - 1 + +lb.dataset.lb, 1)); return drawBoard(); }
    const a = t.closest && t.closest('[data-vx]'); if (!a) return;
    const k = a.dataset.vx;
    if (['villas', 'scan', 'board', 'xlopen'].indexOf(k) >= 0) PtahApp.closeAccount();
    if (k === 'villas') return openVillas();
    if (k === 'scan') { if ($('modalOverlay') && window.closeModal && document.querySelector('.modal-overlay.open')) closeModal(); return openScan(); }
    if (k === 'scanclose') return closeScan();
    if (k === 'scanphoto') return $('vxScanFile').click();
    if (k === 'board') return openBoard();
    if (k === 'xlopen') return exportOpen().catch(e => note(e.message));
    if (k === 'qr') return showQr(curVilla).catch(e => note(e.message));
    if (k === 'qrpdf') { const v = (villas || []).find(x => x.v === a.dataset.v) || { v: a.dataset.v }; return qrSheet([v]).catch(e => note(e.message)); }
    if (k === 'qrsheet') {
      try { const list = (vFilter === 'all' && !vCon && !vQ && villas) ? villas : (onScreen('villas') && villas ? villas.filter(v => (vFilter === 'all' || vState(v) === vFilter) && (!vCon || v.con === vCon) && (!vQ || String(v.v).indexOf(vQ) === 0)) : await api('extras_villas'));
        await qrSheet(list); } catch (e) { note(e.message); }
      return;
    }
    if (k === 'sharevilla') return shareLink(villaLink(curVilla), 'Villa ' + curVilla);
    if (k === 'sharereq') return shareLink(reqLink(a.dataset.ir), 'Request ' + a.dataset.ir);
    if (k === 'sharecur' && currentItem) return shareLink(reqLink(currentItem.irNumber), `${currentItem.irNumber} · Rev ${currentItem.rev}\n${activityOf(currentItem)} · ${villaOf(currentItem)}`);
    if (k === 'villacur') { closeModal(); return openVilla(a.dataset.v); }
    if (k === 'openreq') { const it = allItems.find(i => i.irNumber === a.dataset.ir); if (it) { Shk.closeScreen(); setTimeout(() => openModal(it), 60); } return; }
    if (k === 'prevph') return addPrevPhotos(a);
    if (k === 'noteadd') {
      const tx = $('vxNoteIn').value.trim(); if (!tx) return;
      a.disabled = true;
      try { await api('extras_noteAdd', [curVilla, tx]); openVilla(curVilla); } catch (e) { note(e.message); a.disabled = false; }
      return;
    }
    if (k === 'notedel') {
      if (!confirm('Delete this note? It stays in the Trash for 30 days.')) return;
      try { await api('extras_noteDel', [a.dataset.id]); openVilla(curVilla); } catch (e) { note(e.message); }
      return;
    }
    if (k === 'undo') {
      const row = a.closest('[data-uid]');
      if (!confirm('Undo this close? The request opens again and the close goes to the Trash (30 days).')) return;
      a.disabled = true;
      try { note(String(await api('admin_undoClose', [row.dataset.uid])), 5000); Shk.admCloses(); } catch (e) { note(e.message, 6000); a.disabled = false; }
      return;
    }
    if (k === 'restore') {
      const row = a.closest('[data-tid]'); a.disabled = true;
      try { note(String(await api('admin_restore', [row.dataset.tid])), 6000); Shk.admTrash(); } catch (e) { note(e.message, 7000); a.disabled = false; }
      return;
    }
    if (k === 'saverules') {
      a.disabled = true;
      try {
        const o = await api('admin_setRules', [{ allMarked: $('rAll').checked, minPhotos: +$('rPh').value, minPhotosCD: +$('rPhCD').value, notesCD: $('rNotes').checked }, $('rBoard').checked]);
        X.rules = o.rules; X.board = o.board || isAdmin(); ls.set('shkX', X); note('Rules saved. Every phone gets them on its next refresh.');
      } catch (e) { note(e.message); }
      a.disabled = false; return;
    }
    if (k === 'pushtest') { try { note(String(await api('admin_pushTest')), 6000); } catch (e) { note(e.message, 6000); } return; }
    if (k === 'lang') { ls.set('shkLang', prefs().lang === 'ar' ? 'en' : 'ar'); return location.reload(); }
    if (k === 'sun') {
      const v = !prefs().sun; ls.set('shkSun', v);
      if (!v) { let th = 'dark'; try { th = localStorage.getItem('ptahTheme') || 'dark'; } catch (e) {} document.documentElement.setAttribute('data-theme', th); }
      applyLook(); return paintMe();
    }
    if (k === 'big') { ls.set('shkBig', !prefs().big); applyLook(); return paintMe(); }
    if (k === 'push') {
      try { if (ls.get('shkPush', false)) { await pushOff(); note('Notifications off'); } else { await pushOn(); note('Notifications on: new requests, late requests and comments.', 5000); } }
      catch (e) { note(e.message || 'Could not turn notifications on.', 6000); }
      return paintMe();
    }
  }
  document.addEventListener('click', vxClick);
  // live checks while the close screen is open
  document.addEventListener('change', e => { if (e.target && /^(dxCam|dxGal)$/.test(e.target.id)) setTimeout(ruleHint, 50); });

  // ---- start ----
  const go = () => { meEntries(); startArabic(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  Object.assign(Shk, { openVillas, openVilla, openRequest, openScan, openBoard, toExcel, saveFile, qrSheet, route, _vx: { X: () => X, ruleProblems, openDraw, tr } });
})();
