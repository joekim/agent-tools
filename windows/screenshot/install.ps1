# Creates a Start Menu shortcut bound to a global hotkey (default Ctrl+Alt+S).
param([string]$Hotkey = 'Ctrl+Alt+S')

$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Quick Screenshot.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = "$env:WINDIR\System32\wscript.exe"
$sc.Arguments = '"' + (Join-Path $PSScriptRoot 'screenshot.vbs') + '"'
$sc.WorkingDirectory = $PSScriptRoot
$sc.Hotkey = $Hotkey
$sc.Save()
Write-Host "Installed: press $Hotkey to take a screenshot."
