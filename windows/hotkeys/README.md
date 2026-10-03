# Windows hotkeys

Windows-only PowerShell/WScript utilities using `user32.dll` and Windows Forms. These are source copies of the existing `~/projects/agent-tools/hotkeys` tools; copying them into this repository does not change the running listener or login shortcuts.

`hotkeyd.ps1` reads `hotkeys.json`, registers the shortcuts, and runs commands hidden through `run-hidden.vbs` and `run-notify.ps1`. Command output appears in a Windows notification and a local ignored `run-notify.log`.

`hotkeys.json` preserves the current Windows machine's bindings and absolute paths. Review those paths before installation on another machine or from another checkout. The DOS2 binding depends on the separate RPG project; the screenshot binding points to the existing screenshot installation.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\hotkeys\install-hotkey.ps1` from the repository root to install login startup and restart the listener. The installer replaces the existing `hotkeyd.lnk` and stops matching PowerShell listeners. Optional `-Name`, `-Hotkey`, and `-Command` parameters add or replace a binding. Do not run it just to inspect the source.

The screenshot binding defaults to Ctrl+Alt+S. Avoid registering that same shortcut through both the listener and the standalone screenshot installer.
