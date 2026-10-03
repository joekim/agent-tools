# Background listener: registers every hotkey in hotkeys.json with RegisterHotKey (works while
# fullscreen games have focus) and runs the matching command hidden, reporting via notification.
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win32 -Name Hotkeys -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
[DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
[DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
// Blocks until a hotkey is pressed; returns its id (or -1 when the message loop ends).
public static int Wait() {
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { if (m.message == 0x0312) return (int)m.wParam; }
    return -1;
}
'@
Add-Type -AssemblyName System.Windows.Forms

$log = Join-Path $PSScriptRoot 'run-notify.log'
$mods = @{ alt = 1; ctrl = 2; control = 2; shift = 4; win = 8 }
# Extra parens: PS 5.1's ConvertFrom-Json emits the whole array as one object otherwise.
$entries = @((Get-Content (Join-Path $PSScriptRoot 'hotkeys.json') -Raw | ConvertFrom-Json) | ForEach-Object { $_ })
for ($i = 0; $i -lt $entries.Count; $i++) {
    $e = $entries[$i]
    $parts = $e.hotkey -split '\+'
    $m = 0x4000  # MOD_NOREPEAT: holding the keys fires once
    foreach ($p in $parts[0..($parts.Count - 2)]) { $m = $m -bor $mods[$p.Trim().ToLower()] }
    $vk = [int][System.Windows.Forms.Keys]$parts[-1].Trim()
    if ([Win32.Hotkeys]::RegisterHotKey([IntPtr]::Zero, $i + 1, $m, $vk)) { $status = 'registered' }
    else { $status = 'FAILED (already taken by another app?)' }
    Add-Content $log "[$(Get-Date -f s)] hotkeyd: $($e.hotkey) -> $($e.name) $status"
}

$vbs = Join-Path $PSScriptRoot 'run-hidden.vbs'
while (($id = [Win32.Hotkeys]::Wait()) -gt 0) {
    $e = $entries[$id - 1]
    $argList = @($vbs, $e.name) + @($e.command) | ForEach-Object { "`"$_`"" }
    Start-Process wscript.exe -ArgumentList $argList
}
