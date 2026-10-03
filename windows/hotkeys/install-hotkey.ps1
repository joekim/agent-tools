# Adds (or replaces) a hotkey in hotkeys.json, makes the listener start at login, and restarts it.
#   .\install-hotkey.ps1 -Name 'DOS2 reset' -Hotkey 'Ctrl+Alt+R' -Command 'C:\path\dos2.cmd','reset'
# With no arguments it just (re)starts the listener.
param([string]$Name, [string]$Hotkey, [string[]]$Command)

$json = Join-Path $PSScriptRoot 'hotkeys.json'
if ($Name) {
    # Extra parens: PS 5.1's ConvertFrom-Json emits the whole array as one object otherwise.
    $entries = @((Get-Content $json -Raw | ConvertFrom-Json) | Where-Object { $_.name -ne $Name -and $_.hotkey -ne $Hotkey })
    $entries += [pscustomobject]@{ name = $Name; hotkey = $Hotkey; command = $Command }
    ConvertTo-Json @($entries) -Depth 3 | Set-Content $json -Encoding utf8
}

# Start at login.
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'hotkeyd.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = "$env:WINDIR\System32\wscript.exe"
$sc.Arguments = '"' + (Join-Path $PSScriptRoot 'hotkeyd.vbs') + '"'
$sc.Save()

# Restart the listener so it picks up the new list.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*hotkeyd.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
& wscript.exe (Join-Path $PSScriptRoot 'hotkeyd.vbs')
(Get-Content $json -Raw | ConvertFrom-Json) | ForEach-Object { Write-Host "$($_.hotkey)  $($_.name)" }
