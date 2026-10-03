' Starts the hotkey listener with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "hotkeyd.ps1")
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & script & """", 0, False
