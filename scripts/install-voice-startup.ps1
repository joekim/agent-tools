$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'voice-watchdog.mjs'
if (-not (Test-Path -LiteralPath $runner)) { throw 'Voice watchdog is missing.' }
$node = (Get-Command node.exe).Source
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MediaHubVoice.vbs'
$command = '"' + $node + '" "' + $runner + '"'
$content = 'CreateObject("WScript.Shell").Run "' + $command.Replace('"','""') + '", 0, False'
Set-Content -LiteralPath $startup -Value $content -Encoding Unicode
Start-Process wscript.exe -ArgumentList ('"' + $startup + '"') -WindowStyle Hidden
Write-Output 'Installed Media Hub voice login startup and started its watchdog.'
