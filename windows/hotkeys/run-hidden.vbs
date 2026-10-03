' Starts run-notify.ps1 with the given arguments and no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "run-notify.ps1")
args = ""
For Each a In WScript.Arguments
    args = args & " """ & a & """"
Next
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & script & """" & args, 0, False
