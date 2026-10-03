# Captures all monitors, saves a PNG to Pictures\Screenshots, and copies it to the clipboard.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Win32 -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[Win32.Dpi]::SetProcessDPIAware() | Out-Null  # capture at true resolution on scaled displays

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$dir = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Screenshots'
New-Item -ItemType Directory -Force $dir | Out-Null
$path = Join-Path $dir ("screenshot_{0:yyyy-MM-dd_HH-mm-ss}.png" -f (Get-Date))
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

[System.Windows.Forms.Clipboard]::SetImage($bmp)
$g.Dispose(); $bmp.Dispose()
[System.Media.SystemSounds]::Asterisk.Play()
"Saved and copied: $(Split-Path $path -Leaf)"
