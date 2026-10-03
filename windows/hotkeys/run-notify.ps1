# Runs a command with no window and shows its output as a Windows notification,
# so a fullscreen game keeps focus. Output is also appended to run-notify.log.
param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory, ValueFromRemainingArguments)][string[]]$Command)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$exe = $Command[0]
$rest = @($Command | Select-Object -Skip 1)
$out = (& $exe @rest 2>&1 | Out-String).Trim()
$ok = $LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE
if (-not $out) { $out = if ($ok) { 'done' } else { "failed (exit $LASTEXITCODE)" } }
Add-Content (Join-Path $PSScriptRoot 'run-notify.log') "[$(Get-Date -f s)] $Title`n$out`n"

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.Visible = $true
$tip = if ($ok) { 'Info' } else { 'Error' }
$icon.ShowBalloonTip(5000, $Title, $out.Substring(0, [Math]::Min(250, $out.Length)), $tip)
Start-Sleep 6  # the balloon disappears with the icon, so keep it alive briefly
$icon.Dispose()
