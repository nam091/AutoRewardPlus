$wsh = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "AutoReward Remote Control.lnk"
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"F:\Reward_Bing\AutoRewardPlus-v7.2.1\AutoReward-Tray.vbs`""
$shortcut.WorkingDirectory = "F:\Reward_Bing\AutoRewardPlus-v7.2.1"
$shortcut.IconLocation = "shell32.dll,14"
$shortcut.Description = "AutoRewardPlus Remote Control (Tray & GUI)"
$shortcut.Save()
Write-Output "Shortcut updated at $shortcutPath"
