' מפעיל את לולאת המעקב (watch.mjs) בלי חלון קונסולה.
' נרשם ב-Task Scheduler להרצה אוטומטית בכניסה ל-Windows.
' bWaitOnReturn=True + WScript.Quit — כדי שהמשימה במתזמן תעקוב אחרי חיי node עצמו:
' כך "End" באמת עוצר את הווטצ'ר, ו-RestartCount מפעיל אותו מחדש אם קרס.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "c:\Yosef\ClaudeCodeProjects\WebSiteChange"
WScript.Quit sh.Run("""C:\Program Files\nodejs\node.exe"" watch.mjs", 0, True)
