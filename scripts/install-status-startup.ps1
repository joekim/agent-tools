$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$main = Join-Path $root 'desktop\status\main.mjs'
if (-not (Test-Path -LiteralPath $electron)) { throw 'Run npm ci and npm run status:install first to install Electron.' }
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\MediaHubActivity.vbs'
$command = '"' + $electron + '" "' + $main + '"'
$content = 'CreateObject("WScript.Shell").Run "' + $command.Replace('"','""') + '", 0, False'
Set-Content -LiteralPath $startup -Value $content -Encoding Unicode
Start-Process wscript.exe -ArgumentList ('"' + $startup + '"') -WindowStyle Hidden
Write-Output 'Installed Media Hub activity login startup and launched the window.'
