# Windows screenshots

Windows-only PowerShell/WScript utilities using Windows Forms, System.Drawing, the Windows clipboard, and `user32.dll`. Captures all monitors to `Pictures\Screenshots`, copies the image to the clipboard, and plays a confirmation sound.

Run `powershell -NoProfile -STA -File .\windows\screenshot\screenshot.ps1` from the repository root to capture. `screenshot.vbs` starts the capture without a console window.

`install.ps1` creates a Start Menu shortcut, default Ctrl+Alt+S; it is optional when the shared hotkey listener already provides this binding. Do not install both with the same key combination.

These are source copies of the existing `~/projects/agent-tools/screenshot` installation. The running hub continues to use its configured `legacyToolsRoot`; committing these files does not move that installation. macOS uses the hub's separate native `screencapture` adapter, not these scripts.
