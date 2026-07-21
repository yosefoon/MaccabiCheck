// בודק את "תור פנוי קרוב" בדף רופא באתר מכבי ושולח התראת טלגרם כשהתאריך עומד בתנאי שבקונפיג.
// מיועד לרוץ ב-GitHub Actions (ראו .github/workflows/check.yml) או ידנית: node check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const statePath = join(root, 'state.json');

let state;
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  state = {};
}
state = {
  lastDate: null,
  alertedDates: [],
  consecutiveFailures: 0,
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
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching doctor page`);
  const html = await res.text();
  const anchor = html.indexOf('תור פנוי קרוב');
  if (anchor === -1) throw new Error('anchor text "תור פנוי קרוב" not found — page structure may have changed');
  const m = html.slice(anchor, anchor + 3000).match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (!m) throw new Error('no dd/mm/yy date found near the anchor — page structure may have changed');
  const [, dd, mm, yy] = m;
  return { iso: `20${yy}-${mm}-${dd}`, display: `${dd}/${mm}/20${yy}` };
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
  state.failureAlerted = false;

  if (state.lastDate !== iso) {
    console.log(`Date changed: ${state.lastDate ?? '(first run)'} -> ${iso}`);
  }

  if (qualifies(iso)) {
    if (state.alertedDates.includes(iso)) {
      console.log('Qualifying date, alert already sent for it — skipping.');
    } else {
      const sent = await sendTelegram(
        `🚨 תור פנוי אצל ${config.doctorName}!\n` +
          `התאריך הפנוי הקרוב: ${display}\n` +
          `מהרו לזמן תור:\n${config.url}`
      );
      if (sent) {
        state.alertedDates.push(iso);
        console.log('Alert sent!');
      } else {
        console.log('Alert NOT sent (missing credentials) — will retry next run.');
      }
    }
  } else {
    // אם התאריך התרחק מהיעד — מאפסים את ההתראות כדי שחזרה אליו תפעיל התראה חדשה
    state.alertedDates = state.alertedDates.filter((d) => d === iso);
    console.log(`No alert: target is ${config.targetDate} (matchMode: ${config.matchMode ?? 'exact'}).`);
  }
  state.lastDate = iso;
} catch (err) {
  state.consecutiveFailures += 1;
  console.error(`Check failed (${state.consecutiveFailures} in a row): ${err.message}`);
  if (state.consecutiveFailures >= 3 && !state.failureAlerted) {
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
