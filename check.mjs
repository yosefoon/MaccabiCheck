// בודק את "תור פנוי קרוב" בדף רופא באתר מכבי ושולח התראה בטלגרם (ואופציונלית גם בוואטסאפ ושיחה קולית) כשהתאריך עומד בתנאי שבקונפיג.
// רץ בלולאת watch.mjs (בית + שרת), ידנית (node check.mjs), או ב-GitHub Actions (מושבת כרגע).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// טעינת .env מקומי אם קיים (בריצות מקומיות; ב-GitHub Actions הסודות מגיעים כ-env רגיל).
// תומך במוסכמות dotenv נפוצות: ערכים במרכאות, הערות inline, קידומת export.
try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const q = m[2].match(/^(["'])([\s\S]*)\1$/);
    const value = q ? q[2] : m[2].replace(/\s+#.*$/, '').trim();
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
} catch {}

const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
// state.json שייך ל-GitHub Actions (נשמר בקומיטים אוטומטיים); כל ריצה מקומית —
// כולל ידנית — כותבת ל-state.local.json כדי לא ללכלך את עץ העבודה ולשבור git pull
const statePath = join(
  root,
  process.env.STATE_FILE || (process.env.GITHUB_ACTIONS ? 'state.json' : 'state.local.json')
);

let state;
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  state = {};
}
state = {
  lastDate: null,
  lastAlertedAt: {},
  lastWhatsAppAt: {},
  lastCallAt: {},
  consecutiveFailures: 0,
  firstFailureAt: null,
  failureAlerted: false,
  lastCheck: null,
  ...state,
};

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(text) {
  if (!token || !chatId) {
    console.log('[dry-run] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set. Message would be:\n' + text);
    return false;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Telegram API ${res.status}: ${await res.text()}`);
  return true;
}

// ערוץ שני, אופציונלי: וואטסאפ דרך CallMeBot (חינמי לשימוש אישי — שליחה לעצמך בלבד).
// פעיל רק אם WHATSAPP_PHONE + CALLMEBOT_APIKEY מוגדרים ב-.env; אחרת מדלגים בשקט.
async function sendWhatsApp(text) {
  const phone = process.env.WHATSAPP_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) return false;
  const res = await fetch(
    `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`,
    { signal: AbortSignal.timeout(20_000) }
  );
  // CallMeBot מחזיר 200/201 גם על כישלון, עם ERROR בגוף התשובה — חייבים לבדוק את הגוף
  const body = (await res.text()).replace(/<[^>]*>/g, '');
  if (!res.ok || /error/i.test(body)) throw new Error(`CallMeBot ${res.status}: ${body.slice(0, 200)}`);
  return true;
}

// ערוץ שלישי, אופציונלי: שיחה קולית בטלגרם דרך CallMeBot — הטלפון מצלצל כמו שיחה נכנסת
// ומוקרא טקסט. פעיל רק אם TELEGRAM_CALL_USER מוגדר ב-.env (למשל @username), אחרת מדלגים.
// דורש הרשאה חד-פעמית: המשתמש שולח /start ל-@CallMeBot_txtbot בטלגרם.
async function sendTelegramCall(text) {
  const user = process.env.TELEGRAM_CALL_USER;
  if (!user) return false;
  const res = await fetch(
    `https://api.callmebot.com/start.php?user=${encodeURIComponent(user)}&text=${encodeURIComponent(text)}&lang=he-IL-Standard-A&rpt=2`,
    { signal: AbortSignal.timeout(30_000) }
  );
  // הצלחה מזוהה לפי הסמן החיובי בגוף התשובה; כישלון (למשל אין הרשאה) מוחזר גם הוא כ-200
  let body = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const at = body.indexOf('Checking'); // חיתוך זבל האנליטיקס שלפני החלק האינפורמטיבי
  if (at > 0) body = body.slice(at);
  if (!res.ok || !/Starting Telegram/i.test(body)) {
    throw new Error(`CallMeBot call ${res.status}: ${body.slice(0, 200)}`);
  }
  return true;
}

if (process.env.TEST_CALL === '1') {
  try {
    const ok = await sendTelegramCall('בדיקת מערכת: ערוץ השיחות של כלי מעקב התורים עובד.');
    console.log(ok ? 'Test call started.' : 'Test call skipped (TELEGRAM_CALL_USER not set).');
  } catch (e) {
    console.error('Test call failed: ' + e.message);
    process.exitCode = 1;
  }
  process.exit();
}

if (process.env.TEST_ALERT === '1') {
  const text = `✅ בדיקת מערכת: הכלי למעקב תורים של ${config.doctorName} מחובר ועובד.`;
  let tg = false;
  let wa = false;
  try { tg = await sendTelegram(text); } catch (e) { console.error('Telegram: ' + e.message); }
  try { wa = await sendWhatsApp(text); } catch (e) { console.error('WhatsApp: ' + e.message); }
  console.log(`Test alert: telegram=${tg ? 'sent' : 'skipped/failed'}, whatsapp=${wa ? 'sent' : 'skipped/failed'}`);
  process.exit(0);
}

async function fetchAppointmentDate() {
  const res = await fetch(config.url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'he,en;q=0.8',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching doctor page`);
  const html = await res.text();
  const anchor = html.indexOf('תור פנוי קרוב');
  if (anchor === -1) throw new Error('anchor text "תור פנוי קרוב" not found — page structure may have changed');
  // גבולות ספרה משני הצדדים — ש-04/08/2026 לא ייקרא בטעות כ-04/08/20; תומך גם בשנה בת 4 ספרות
  const m = html.slice(anchor, anchor + 3000).match(/(?<!\d)(\d{2})\/(\d{2})\/(\d{4}|\d{2})(?!\d)/);
  if (!m) throw new Error('no dd/mm/yy(yy) date found near the anchor — page structure may have changed');
  const [, dd, mm, y] = m;
  const yyyy = y.length === 4 ? y : `20${y}`;
  return { iso: `${yyyy}-${mm}-${dd}`, display: `${dd}/${mm}/${yyyy}` };
}

function qualifies(iso) {
  if (config.matchMode === 'onOrBefore') return iso <= config.targetDate;
  return iso === config.targetDate; // matchMode: "exact"
}

const now = new Date().toISOString();
try {
  const { iso, display } = await fetchAppointmentDate();
  console.log(`Nearest available appointment: ${display}`);
  state.consecutiveFailures = 0;
  state.firstFailureAt = null;
  state.failureAlerted = false;

  if (state.lastDate !== iso) {
    console.log(`Date changed: ${state.lastDate ?? '(first run)'} -> ${iso}`);
  }

  if (qualifies(iso)) {
    // התראה חוזרת כל עוד התנאי מתקיים — אין עצירה אחרי ההתראה הראשונה.
    // repeatAlertMinutes בקונפיג קובע מרווח מינימלי בין התראות (0 = בכל בדיקה)
    const repeatMs = (config.repeatAlertMinutes ?? 0) * 60_000;
    const lastAlertAt = Date.parse(state.lastAlertedAt[iso] ?? '') || 0;
    if (repeatMs > 0 && Date.now() - lastAlertAt < repeatMs) {
      console.log('Qualifying date, alert sent recently — spaced by repeatAlertMinutes.');
    } else {
      // כשל שליחה אינו כשל קריאת דף — כל ערוץ נלכד בנפרד ולא במונה הכשלים; הבדיקה הבאה תנסה שוב
      const msg =
        `🚨 תור פנוי אצל ${config.doctorName}!\n` +
        `התאריך הפנוי הקרוב: ${display}\n` +
        `מהרו לזמן תור:\n${config.url}`;
      let tgSent = false;
      let waSent = false;
      try {
        tgSent = await sendTelegram(msg);
      } catch (telegramErr) {
        console.error('Telegram send failed: ' + telegramErr.message);
      }
      try {
        // ריווח נפרד לוואטסאפ: ‏CallMeBot חינמי לשימוש אישי — שליחה כל 30 שנ' משתי מכונות
        // עלולה לגרום לחסימת המפתח. ברירת מחדל: וואטסאפ כל 5 דק', טלגרם ממשיך בכל בדיקה.
        // כשל שליחה לא מעדכן את החותמת — ולכן ננסה שוב כבר בבדיקה הבאה
        const waRepeatMs = (config.whatsappRepeatMinutes ?? 5) * 60_000;
        const lastWaAt = Date.parse(state.lastWhatsAppAt[iso] ?? '') || 0;
        if (Date.now() - lastWaAt >= waRepeatMs) {
          waSent = await sendWhatsApp(msg);
          if (waSent) {
            state.lastWhatsAppAt[iso] = now;
            console.log('WhatsApp alert sent!');
          }
        }
      } catch (waErr) {
        console.error('WhatsApp send failed: ' + waErr.message);
      }
      try {
        // שיחה מצלצלת: לא בכל בדיקה — שיחה אורכת עד ~30 שנ' ושיחה חדשה באמצע צלצול
        // מתנגשת בקודמת, לכן מרווח (ברירת מחדל 3 דק'). ההודעות ממשיכות בכל בדיקה.
        const callRepeatMs = (config.callRepeatMinutes ?? 3) * 60_000;
        const lastCallAt = Date.parse(state.lastCallAt[iso] ?? '') || 0;
        if (Date.now() - lastCallAt >= callRepeatMs) {
          const called = await sendTelegramCall(
            `תור פנוי אצל ${config.doctorName} בתאריך המבוקש ${display}. בדוק את ההודעות וקבע תור עכשיו.`
          );
          if (called) {
            state.lastCallAt[iso] = now;
            console.log('Telegram call started!');
          }
        }
      } catch (callErr) {
        console.error('Telegram call failed: ' + callErr.message);
      }
      if (tgSent || waSent) {
        state.lastAlertedAt[iso] = now;
        if (tgSent) console.log('Alert sent!');
      } else {
        console.log('Alert NOT sent — will retry next run.');
      }
    }
  } else {
    console.log(`No alert: target is ${config.targetDate} (matchMode: ${config.matchMode ?? 'exact'}).`);
  }
  state.lastDate = iso;
} catch (err) {
  state.consecutiveFailures += 1;
  if (!state.firstFailureAt) state.firstFailureAt = now;
  console.error(`Check failed (${state.consecutiveFailures} in a row): ${err.message}`);
  // התראת תקלה רק אחרי גם 3 כשלים רצופים וגם 10 דקות רצופות של כשל —
  // כדי שניתוק רשת רגעי (למשל התעוררות משינה בלולאה המקומית) לא יזעיק לשווא
  const failingMinutes = (Date.parse(now) - Date.parse(state.firstFailureAt)) / 60000;
  if (state.consecutiveFailures >= 3 && failingMinutes >= 10 && !state.failureAlerted) {
    const failMsg =
      `⚠️ הכלי למעקב תורים לא מצליח לקרוא את דף הרופא (${state.consecutiveFailures} כשלים רצופים).\n` +
      `סיבה אחרונה: ${err.message}\n${config.url}`;
    let alerted = false;
    try {
      alerted = await sendTelegram(failMsg);
    } catch (telegramErr) {
      console.error('Failure alert (Telegram) could not be sent: ' + telegramErr.message);
    }
    try {
      alerted = (await sendWhatsApp(failMsg)) || alerted;
    } catch (waErr) {
      console.error('Failure alert (WhatsApp) could not be sent: ' + waErr.message);
    }
    state.failureAlerted = alerted;
  }
  process.exitCode = 1;
}
state.lastCheck = now;
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
