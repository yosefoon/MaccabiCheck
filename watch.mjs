// לולאת מעקב מקומית: מריצה את check.mjs כל checkIntervalSeconds (ברירת מחדל 30 שנ').
// עולה אוטומטית בכניסה ל-Windows דרך Task Scheduler (ראו README).
// הסודות נטענים ע"י check.mjs מקובץ .env המקומי; המצב נשמר ב-state.local.json,
// בנפרד מ-state.json של GitHub Actions.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const logPath = join(root, 'watch.log');
const pidPath = join(root, 'watch.pid');

function log(msg) {
  try {
    try {
      if (statSync(logPath).size > 5 * 1024 * 1024) renameSync(logPath, logPath + '.old');
    } catch {}
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

// מניעת שני עותקים במקביל. בדיקת קיום PID בלבד לא מספיקה: Windows ממחזר מספרי
// תהליכים, וקובץ pid שנשאר אחרי ריסטארט עלול להצביע על תהליך זר — לכן מוודאים
// שהתהליך הישן הוא באמת watch.mjs לפני שמוותרים.
function pidIsWatcher(pid) {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
      { encoding: 'utf8', timeout: 15000 }
    );
    return /watch\.mjs/i.test(out);
  } catch {
    return false;
  }
}

try {
  const oldPid = Number(readFileSync(pidPath, 'utf8').trim());
  if (oldPid && oldPid !== process.pid && pidIsWatcher(oldPid)) {
    log(`another watcher is already running (pid ${oldPid}) — exiting`);
    process.exit(0);
  }
} catch {}
writeFileSync(pidPath, String(process.pid));
process.on('exit', () => {
  // מוחקים רק אם הקובץ עדיין שלנו — לא דורסים נעילה של עותק חדש יותר
  try {
    if (readFileSync(pidPath, 'utf8').trim() === String(process.pid)) unlinkSync(pidPath);
  } catch {}
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

let intervalSec = 30;
try {
  intervalSec = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).checkIntervalSeconds ?? 30;
} catch {}

log(`watcher started (pid ${process.pid}, interval ${intervalSec}s)`);

function runOnce() {
  return new Promise((resolve) => {
    let out = '';
    // timeout כרשת ביטחון אחרונה: ל-check.mjs יש timeouts משלו על הבקשות (20/15 שנ'),
    // אז 90 שנ' נחצה רק אם משהו אחר נתקע לגמרי
    const child = spawn(process.execPath, [join(root, 'check.mjs')], {
      cwd: root,
      env: { ...process.env, STATE_FILE: 'state.local.json' },
      timeout: 90_000,
      killSignal: 'SIGKILL',
    });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      log(`check exit=${code} :: ${out.trim().replace(/\r?\n/g, ' | ')}`);
      resolve();
    });
    child.on('error', (err) => {
      log(`spawn error: ${err.message}`);
      resolve();
    });
  });
}

while (true) {
  await runOnce();
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
