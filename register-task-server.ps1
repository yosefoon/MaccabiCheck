# רישום חד-פעמי של הווטצ'ר על שרת תמיד-דולק (להריץ פעם אחת מ-PowerShell מוגבה: Run as Administrator).
# שונה מ-register-task.ps1 הביתי: טריגר AtStartup (עולה אחרי ריסטארט גם בלי כניסת משתמש),
# רץ כ-SYSTEM ב-session 0 — אין חלון, ולכן node רץ ישירות בלי run-hidden.vbs,
# והמתזמן עוקב אחרי node עצמו (Stop-ScheduledTask באמת עוצר את הלולאה).
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# רישום principal של SYSTEM דורש הרצה מוגבהת
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Run from an elevated PowerShell (Run as Administrator).'
}

# נתיב node מוחלט ונאפה לתוך המשימה: ל-SYSTEM אין את ה-PATH של המשתמש,
# ושירות המתזמן ממילא לא רואה שינויי PATH עד ריסטארט. fallback: node.exe שהונח בתיקייה.
$node = @(
  (Get-Command node.exe -ErrorAction SilentlyContinue).Source,
  'C:\Program Files\nodejs\node.exe',
  (Join-Path $dir 'node.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $node) { Write-Error 'node.exe not found - install Node LTS or place node.exe in this folder.' }

$action = New-ScheduledTaskAction -Execute $node `
  -Argument ('"' + (Join-Path $dir 'watch.mjs') + '"') -WorkingDirectory $dir

# השהיה קצרה אחרי עלייה — לתת לרשת להתייצב לפני הבדיקה הראשונה
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = 'PT45S'
# טריגר יומי כרשת ביטחון: אם node קרס מעבר ל-RestartCount, ההפעלה היומית מרימה אותו מחדש;
# כשהלולאה כבר רצה — MultipleInstances IgnoreNew הופך זאת ללא-כלום
$daily = New-ScheduledTaskTrigger -Daily -At 04:17

# SYSTEM: בלי סיסמה שמורה, רץ לפני כניסת משתמש, session 0 = בלי חלון
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount

# ExecutionTimeLimit 0 — מבטל את מגבלת 72 השעות; StartWhenAvailable — משלים הפעלה יומית שפוספסה
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) `
  -StartWhenAvailable

Register-ScheduledTask -TaskName 'MaccabiCheck Watcher' `
  -Action $action -Trigger $boot, $daily -Principal $principal -Settings $settings -Force

Write-Host "Task registered (node: $node). Starting it now..."
Start-ScheduledTask -TaskName 'MaccabiCheck Watcher'
Get-ScheduledTask -TaskName 'MaccabiCheck Watcher' | Format-List TaskName, State
