$wsh = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "AutoRewardPlus - Web Control.lnk"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Path.GetFullPath(Path.Combine($scriptDir, ".."))
$launcherPath = Join-Path $rootDir "AutoReward-WebControl.bat"
$iconPath = Join-Path $rootDir "tools\windows-controller\app.ico"

$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $rootDir
$shortcut.WindowStyle = 7
if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Description = "AutoRewardPlus - Web Control Center"
$shortcut.Save()
Write-Output "Shortcut created on Desktop: $shortcutPath"
