// בודק את "תור פנוי קרוב" בדף רופא באתר מכבי ושולח התראת טלגרם כשהתאריך עומד בתנאי שבקונפיג.
// מיועד לרוץ ב-GitHub Actions (ראו .github/workflows/check.yml) או ידנית: node check.mjs
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
  alertedDates: [],
  lastAlertedAt: {},
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

if (process.env.TEST_ALERT === '1') {
  const ok = await sendTelegram(`✅ בדיקת מערכת: הכלי למעקב תורים של ${config.doctorName} מחובר ועובד.`);
  console.log(ok ? 'Test alert sent.' : 'Test alert skipped (no credentials).');
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
    // צינון של שעה לכל תאריך: אם התאריך "מרצד" (תור נתפס ומשוחרר שוב ושוב),
    // לא מציפים בהתראה כל 30 שניות — לכל היותר אחת לשעה לאותו תאריך
    const COOLDOWN_MS = 60 * 60 * 1000;
    const lastAlertAt = Date.parse(state.lastAlertedAt[iso] ?? '') || 0;
    if (state.alertedDates.includes(iso) || Date.now() - lastAlertAt < COOLDOWN_MS) {
      console.log('Qualifying date, alert already sent recently — skipping.');
    } else {
      const sent = await sendTelegram(
        `🚨 תור פנוי אצל ${config.doctorName}!\n` +
          `התאריך הפנוי הקרוב: ${display}\n` +
          `מהרו לזמן תור:\n${config.url}`
      );
      if (sent) {
        state.alertedDates.push(iso);
        state.lastAlertedAt[iso] = now;
        console.log('Alert sent!');
      } else {
        console.log('Alert NOT sent (missing credentials) — will retry next run.');
      }
    }
  } else {
    // אם התאריך התרחק מהיעד — מאפסים את ההתראות כדי שחזרה אליו תפעיל התראה חדשה
    // (בכפוף לצינון של שעה דרך lastAlertedAt, שנשמר בכוונה)
    state.alertedDates = state.alertedDates.filter((d) => d === iso);
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
    try {
      const sent = await sendTelegram(
        `⚠️ הכלי למעקב תורים לא מצליח לקרוא את דף הרופא (${state.consecutiveFailures} כשלים רצופים).\n` +
          `סיבה אחרונה: ${err.message}\n${config.url}`
      );
      state.failureAlerted = sent;
    } catch (telegramErr) {
      console.error('Failure alert could not be sent: ' + telegramErr.message);
    }
  }
  process.exitCode = 1;
}
state.lastCheck = now;
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
