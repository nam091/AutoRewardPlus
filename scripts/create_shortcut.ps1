$wsh = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "AutoRewardPlus.lnk"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Path.GetFullPath(Path.Combine($scriptDir, ".."))
$exePath = Join-Path $rootDir "AutoRewardPlus.exe"
$iconPath = Join-Path $rootDir "tools\windows-controller\app.ico"

$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $rootDir
if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Description = "AutoRewardPlus - Windows Control Center"
$shortcut.Save()
Write-Output "Shortcut created on Desktop: $shortcutPath"
