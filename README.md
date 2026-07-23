# מעקב תור רופא — מכבי

כלי קטן שבודק כל 30 שניות את דף הרופא ד"ר וודוביץ דן (עור ומין, תל אביב) באתר מכבי,
ושולח התראה בטלגרם — ואופציונלית גם בוואטסאפ — כשהתאריך של "תור פנוי קרוב" עומד בתנאי שהוגדר.

## איך זה עובד — שתי מכונות בלתי-תלויות

`watch.mjs` רץ ברקע ומריץ את `check.mjs` כל 30 שניות, בשתי מכונות במקביל:

1. **שרת תמיד-דולק** (Hetzner): עולה באתחול המערכת דרך `register-task-server.ps1`. השכבה העיקרית.
2. **מחשב ביתי**: עולה בכניסה ל-Windows דרך `register-task.ps1`. תוספת כשהמחשב דולק.

כשהתאריך עומד בתנאי — נשלחת התראה **בכל בדיקה, משתי המכונות, כל עוד התנאי מתקיים** (אין עצירה אחרי ההתראה הראשונה; אפשר לרווח דרך `repeatAlertMinutes`).

**שכבת ענן (מושבתת)**: `.github/workflows/check.yml` יכול להריץ את אותה בדיקה ב-GitHub Actions (~פעם בשעה בפועל). הושבת ביוזמתנו כי שתי המכונות מספיקות; להפעלה מחדש: `gh workflow enable check.yml`.

קבצים:
- `check.mjs` — הבדיקה עצמה: מושך את דף הרופא, מחלץ את התאריך שליד "תור פנוי קרוב", משווה ליעד ושולח התראות (טלגרם, ווואטסאפ אם מוגדר).
- `watch.mjs` — הלולאה המקומית. לוג חי: `watch.log`.
- `run-hidden.vbs` — עטיפה שמריצה את הלולאה בלי חלון.
- `state.json` (ענן, בקומיטים אוטומטיים) / `state.local.json` (מקומי, לא בגיט) — זיכרון בין ריצות (רצף כשלים, מרווח בין התראות חוזרות).
- `.env` (מקומי בלבד, לא בגיט!) — סודות הערוצים: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, ואופציונלית גם וואטסאפ דרך CallMeBot: ‏`WHATSAPP_PHONE` (בפורמט ‎+972...) ו-`CALLMEBOT_APIKEY`. אם מפתחות הוואטסאפ מוגדרים — כל התראה נשלחת בשני הערוצים.
- `config.json` — כל ההגדרות.

## שינוי הגדרות (עריכת `config.json`)

| שדה | משמעות |
|---|---|
| `targetDate` | תאריך היעד בפורמט `YYYY-MM-DD` (כרגע `2026-08-04`) |
| `matchMode` | `"exact"` = התראה רק כשהתאריך המוצג הוא בדיוק תאריך היעד. `"onOrBefore"` = התראה גם על כל תאריך מוקדם יותר |
| `repeatAlertMinutes` | מרווח מינימלי בדקות בין התראות חוזרות כשהתנאי מתקיים. `0` = התראה בכל בדיקה |
| `whatsappRepeatMinutes` | מרווח נפרד לערוץ הוואטסאפ (ברירת מחדל 5 דק' — כדי לא להציף את CallMeBot החינמי). טלגרם לא מושפע |
| `url` | כתובת דף הרופא (אפשר להחליף לרופא אחר במכבי — אותו מבנה דף) |
| `doctorName` | שם לתצוגה בהודעות |
| `checkIntervalSeconds` | תדירות הבדיקה של הלולאה המקומית בשניות (30). לא משפיע על הענן |

איך שינוי נכנס לתוקף: **במחשב הביתי** — עריכת הקובץ המקומי מספיקה (נקלטת תוך ~30 שנ'); **בשרת** — לערוך ישירות את `C:\MaccabiCheck\config.json` (נקלט תוך ~30 שנ'). ‏commit+push לבדו **לא** מעדכן אף מכונה רצה — הוא רק שומר את הריפו כמקור אמת (חשוב: הרצה חוזרת של בלוק ה-ZIP בשרת דורסת את `config.json` בגרסת הריפו).

## פקודות שימושיות

```bash
node check.mjs                 # בדיקה ידנית מקומית (קורא סודות מ-.env אם קיים)
TEST_ALERT=1 node check.mjs    # שליחת הודעת בדיקה (טלגרם + וואטסאפ אם מוגדר)
gh workflow run check.yml      # הרצה ידנית בענן (השכבה מושבתת — דורש קודם enable)
gh run list --limit 5          # ריצות אחרונות
gh workflow disable check.yml  # השהיית שכבת הענן
gh workflow enable check.yml   # חידוש שכבת הענן
```

הקמה מחדש של הלולאה המקומית (מחשב חדש / אחרי מחיקה): ליצור `.env` עם הסודות (שניים של טלגרם, ואופציונלית שניים של וואטסאפ), ואז להריץ פעם אחת את `register-task.ps1` ב-PowerShell (במחשב אישי) או את `register-task-server.ps1` (בשרת תמיד-דולק).

שליטה בלולאה המקומית (PowerShell):

```powershell
Get-ScheduledTask 'MaccabiCheck Watcher'        # סטטוס המשימה
Stop-ScheduledTask 'MaccabiCheck Watcher'       # עצירה (עד הכניסה הבאה ל-Windows)
Disable-ScheduledTask 'MaccabiCheck Watcher'    # השבתה קבועה
Enable-ScheduledTask 'MaccabiCheck Watcher'; Start-ScheduledTask 'MaccabiCheck Watcher'  # חידוש
Get-Content watch.log -Tail 10                  # הצצה בלוג החי
```
הערה: `Stop-ScheduledTask` עוצר את המשימה אך תהליך node עשוי להישאר — אם צריך עצירה מיידית מלאה: `Stop-Process -Name node` (יסגור את כל תהליכי node!).

## התקנה על שרת Windows תמיד-דולק (למשל Hetzner)

בשרת משתמשים ב-`register-task-server.ps1` (ולא בסקריפט הביתי): המשימה עולה **באתחול המערכת** (גם בלי שאף אחד מתחבר ב-RDP), רצה כ-SYSTEM בלי חלון, ומריצה את node ישירות — כך ש-`Stop-ScheduledTask` בשרת באמת עוצר את הלולאה. יש גם טריגר יומי (04:17) כרשת ביטחון אם node קרס.

כל הבלוקים הבאים מודבקים ב-PowerShell בשרת, לפי הסדר:

**שלב 0 — בדיקת גישה (לפני שמתקינים כלום!).** שרתים בדטהסנטרים לפעמים חסומים ע"י אתרים. אם מתקבל `PREFLIGHT FAILED` — לעצור, השרת חסום:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$u = 'https://serguide.maccabi4u.co.il/heb/doctors/doctorssearchresults/doctorsinfopage/?ItemKeyIndex=EB747D8452028D32CAFC00BED049053AE41DA0E1DE3C064688F4970CC7188557'
$h = @{ 'User-Agent'='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'; 'Accept-Language'='he,en;q=0.8' }
try {
  $r = Invoke-WebRequest -Uri $u -Headers $h -UseBasicParsing -TimeoutSec 30
  $html = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
  $anchor = -join ([char]0x05EA,[char]0x05D5,[char]0x05E8,' ',[char]0x05E4,[char]0x05E0,[char]0x05D5,[char]0x05D9,' ',[char]0x05E7,[char]0x05E8,[char]0x05D5,[char]0x05D1)
  $i = $html.IndexOf($anchor)
  $seg = if ($i -ge 0) { $html.Substring($i, [Math]::Min(3000, $html.Length - $i)) } else { '' }
  if ($r.StatusCode -eq 200 -and $seg -match '\d{2}/\d{2}/(\d{4}|\d{2})') { "PREFLIGHT OK - date near anchor: $($Matches[0])" }
  else { "PREFLIGHT FAILED - status $($r.StatusCode), anchor found: $($i -ge 0)" }
} catch { "PREFLIGHT FAILED - $($_.Exception.Message)" }
```

**שלב 1 — התקנת Node LTS** (PowerShell **כמנהל**; אין צורך ב-Git):

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# שני שלבים בכוונה: ב-PowerShell 5.1 צינור ישיר מ-ConvertFrom-Json מחזיר null
$idx = (Invoke-WebRequest 'https://nodejs.org/dist/index.json' -UseBasicParsing).Content | ConvertFrom-Json
$v = ($idx | Where-Object { $_.lts } | Select-Object -First 1).version
"Installing Node $v ..."
# WebClient עם ניסיונות חוזרים — Invoke-WebRequest נוטה ליפול באמצע הורדות גדולות
$msi = "$env:TEMP\node.msi"
$ok = $false
foreach ($try in 1..4) {
  try {
    (New-Object Net.WebClient).DownloadFile("https://nodejs.org/dist/$v/node-$v-x64.msi", $msi)
    if ((Get-Item $msi).Length -gt 20MB) { $ok = $true; break }
  } catch { "Attempt $try failed"; Start-Sleep 5 }
}
if ($ok) {
  Start-Process msiexec -ArgumentList '/i',$msi,'/qn' -Wait
  & "$env:ProgramFiles\nodejs\node.exe" --version
} else { "DOWNLOAD FAILED - download the MSI in a browser instead" }
```

אחרי ההתקנה, באותו חלון — לרענן את ה-PATH (או לפתוח חלון PowerShell חדש):

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

חלופה בלי התקנה: להוריד `node.exe` בודד מ-`https://nodejs.org/dist/<version>/win-x64/node.exe` לתוך `C:\MaccabiCheck` — סקריפט הרישום ימצא אותו שם.

**שלב 2 — הורדת הקוד** (אותו בלוק משמש גם לעדכון גרסה בעתיד; `.env`, ‏state ולוגים שורדים — אבל `config.json` נדרס בגרסת הריפו, אז עריכות מקומיות בשרת יש לעשות מחדש או לשמור קודם בריפו):

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest 'https://github.com/yosefoon/MaccabiCheck/archive/refs/heads/main.zip' -OutFile "$env:TEMP\mc.zip" -UseBasicParsing
Expand-Archive "$env:TEMP\mc.zip" "$env:TEMP\mc" -Force
New-Item -ItemType Directory C:\MaccabiCheck -Force | Out-Null
Copy-Item "$env:TEMP\mc\MaccabiCheck-main\*" C:\MaccabiCheck\ -Recurse -Force
Remove-Item "$env:TEMP\mc.zip", "$env:TEMP\mc" -Recurse -Force
```

**שלב 3 — סודות** (הערכים אצלך, לא בריפו! לא דרך Notepad — הוא מוסיף `.txt` בשקט). שתי שורות הוואטסאפ אופציונליות — למחוק אם אין מפתח CallMeBot:

```powershell
@"
TELEGRAM_BOT_TOKEN=<הטוקן>
TELEGRAM_CHAT_ID=<המספר>
WHATSAPP_PHONE=<+972...>
CALLMEBOT_APIKEY=<המפתח מ-CallMeBot>
"@ | Set-Content -Path 'C:\MaccabiCheck\.env' -Encoding Ascii
```

(שדרוג שרת קיים להוספת וואטסאפ = להריץ שוב את בלוק שלב 2 בשביל הקוד החדש + להוסיף את שתי השורות ל-`.env`.)

**שלב 4 — אימות ידני לפני רישום**:

```powershell
cd C:\MaccabiCheck
node .\check.mjs                                                      # אמור להדפיס את התאריך שחולץ
$env:TEST_ALERT='1'; node .\check.mjs; Remove-Item Env:\TEST_ALERT    # הודעת בדיקה (טלגרם + וואטסאפ אם מוגדר)
```

**שלב 5 — רישום המשימה** (PowerShell **כמנהל**):

```powershell
powershell -ExecutionPolicy Bypass -File C:\MaccabiCheck\register-task-server.ps1
```

**שלב 6 — אימות**: ‏`Get-Content C:\MaccabiCheck\watch.log -Tail 5 -Wait` — שורה חדשה כל ~30 שניות. מומלץ גם `Restart-Computer` ולוודא אחרי ההתחברות מחדש שהלוג מראה `watcher started` מזמן שלפני הכניסה.

כללים חשובים בשרת:

- **לא מריצים `node watch.mjs` ידנית** — ריצה ידנית תופסת את הנעילה, וכשסוגרים את חלון ה-RDP לא נשאר שומר עד הטריגר הבא. תמיד: `Start-ScheduledTask 'MaccabiCheck Watcher'`. (הרצת `node check.mjs` חד-פעמית — בסדר גמור.)
- עריכת `config.json` בשרת נקלטת תוך 30 שניות, חוץ מ-`checkIntervalSeconds` שדורש `Stop-ScheduledTask` + `Start-ScheduledTask`.
- שים לב: בעריכת קבצים עם עברית ב-Notepad ישן — לשמור כ-UTF-8 (שינוי `targetDate` הוא ASCII ובטוח בכל מקרה).

## מגבלות ידועות

- המתזמן של GitHub Actions (רלוונטי רק אם שכבת הענן מופעלת מחדש) אינו מדויק: בפועל ~פעם בשעה, עם פערים גדולים יותר בלילה.
- במצב `exact`, תור שנפתח בתאריך אחר — גם מוקדם יותר מהיעד — לא יפעיל התראה.
- אם מכבי ישנו את מבנה הדף, תגיע התראת ⚠️ אחרי 3 כשלים רצופים (אין כשל שקט).
- ההתראה מבוססת על התאריך שהדף מציג תחת "תור פנוי קרוב" (במרפאה); הזמינות בזימון בפועל עשויה להשתנות לפי סוג התור.
- GitHub משבית תזמון בריפו ללא פעילות 60 יום (רלוונטי רק אם שכבת הענן מופעלת מחדש; הקומיט היומי של `state.json` שומר אז על הריפו פעיל).

## סודות (GitHub Secrets)

`TELEGRAM_BOT_TOKEN` ו-`TELEGRAM_CHAT_ID` מוגדרים ב-Settings → Secrets → Actions של הריפו.
הטוקן לא נמצא בקוד ולא בהיסטוריה.
