# רישום חד-פעמי של הווטצ'ר המקומי ב-Task Scheduler (להריץ פעם אחת, בלי הרשאות מנהל).
# יוצר משימה 'MaccabiCheck Watcher' שעולה בכל כניסה ל-Windows ומריצה את הלולאה ברקע.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"' + (Join-Path $dir 'run-hidden.vbs') + '"') `
  -WorkingDirectory $dir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# AllowStartIfOnBatteries — בלי זה המשימה לא תעלה בלפטופ על סוללה
# ExecutionTimeLimit 0 — מבטל את מגבלת 72 השעות שהייתה הורגת את הלולאה
# RestartCount — אם node קורס, המתזמן מפעיל מחדש (עובד כי run-hidden.vbs ממתין ל-node)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'MaccabiCheck Watcher' `
  -Action $action -Trigger $trigger -Settings $settings -Force

Write-Host "Task registered. Starting it now..."
Start-ScheduledTask -TaskName 'MaccabiCheck Watcher'
Get-ScheduledTask -TaskName 'MaccabiCheck Watcher' | Format-List TaskName, State
