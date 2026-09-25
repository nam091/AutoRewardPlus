Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 1. Single instance mutex
$mutexName = "AutoRewardPlusTrayAppMutex"
$isNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$isNew)
if (-not $isNew) {
    [System.Windows.Forms.MessageBox]::Show("AutoRewardPlus is already running in the System Tray (bottom-right corner).`n`nDouble-click the tray icon to open the control window.", "AutoRewardPlus", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
    exit
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = (Get-Command node).Source

# 2. Start background residential proxy
Start-Process -FilePath $nodeExe -ArgumentList "`"$scriptDir\proxyServer.js`"" -WindowStyle Hidden

# Function check Tailscale status
function Get-RealTailscaleStatus {
    try {
        $out = tailscale status --json 2>$null
        if ($out) {
            $data = $out | ConvertFrom-Json
            if ($data.BackendState -eq "Running" -and $data.Self -and $data.Self.Online -eq $true) {
                $myIp = $data.Self.TailscaleIPs[0]
                return @{
                    Active = $true
                    IP = $myIp
                    Message = "[OK] Tailscale: $myIp (Connected)"
                }
            } else {
                $st = $data.BackendState
                return @{
                    Active = $false
                    IP = $null
                    Message = "[OFF] Tailscale: DISCONNECTED (State: $st)"
                }
            }
        }
    } catch {}
    return @{
        Active = $false
        IP = $null
        Message = "[OFF] Tailscale: DISCONNECTED (Please launch app)"
    }
}

# Function invoke CLI Runner with UTF8
function Invoke-BotAction($actionArg) {
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $nodeExe
        $psi.Arguments = "`"$scriptDir\cliRunner.js`" $actionArg"
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
        $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $proc = [System.Diagnostics.Process]::Start($psi)
        $out = $proc.StandardOutput.ReadToEnd()
        $err = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()
        if ($err -and -not $out) { return $err.Trim() }
        return $out.Trim()
    } catch {
        return $_.Exception.Message
    }
}

# Modern Flat Button Style Helper
function Set-ModernButtonStyle($btn, $bgColor, $hoverColor) {
    $btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $btn.FlatAppearance.BorderSize = 0
    $btn.BackColor = $bgColor
    $btn.FlatAppearance.MouseOverBackColor = $hoverColor
    $btn.ForeColor = [System.Drawing.Color]::White
    $btn.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)
    $btn.Cursor = [System.Windows.Forms.Cursors]::Hand
}

# 3. GUI Form
$form = New-Object System.Windows.Forms.Form
$form.Text = "AutoRewardPlus - Windows Control Center"
$form.Size = New-Object System.Drawing.Size(466, 505)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$form.ForeColor = [System.Drawing.Color]::White

$iconFile = Join-Path $scriptDir "app.ico"
if (Test-Path $iconFile) {
    $customIcon = New-Object System.Drawing.Icon($iconFile)
    $form.Icon = $customIcon
}

# Header Panel
$pnlHeader = New-Object System.Windows.Forms.Panel
$pnlHeader.Location = New-Object System.Drawing.Point(16, 14)
$pnlHeader.Size = New-Object System.Drawing.Size(418, 56)
$pnlHeader.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "AUTOREWARD CONTROL CENTER"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 11.5, [System.Drawing.FontStyle]::Bold)
$lblTitle.Location = New-Object System.Drawing.Point(14, 8)
$lblTitle.Size = New-Object System.Drawing.Size(390, 22)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
$pnlHeader.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "Oracle Cloud VPS & Windows Residential Proxy"
$lblSub.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$lblSub.Location = New-Object System.Drawing.Point(15, 31)
$lblSub.Size = New-Object System.Drawing.Size(390, 18)
$lblSub.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$pnlHeader.Controls.Add($lblSub)
$form.Controls.Add($pnlHeader)

# Status Panel
$pnlStatus = New-Object System.Windows.Forms.Panel
$pnlStatus.Location = New-Object System.Drawing.Point(16, 78)
$pnlStatus.Size = New-Object System.Drawing.Size(418, 64)
$pnlStatus.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)

$lblTs = New-Object System.Windows.Forms.Label
$lblTs.Text = "[...] Tailscale: Checking status..."
$lblTs.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$lblTs.Location = New-Object System.Drawing.Point(14, 10)
$lblTs.Size = New-Object System.Drawing.Size(390, 20)
$lblTs.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
$pnlStatus.Controls.Add($lblTs)

$lblProxy = New-Object System.Windows.Forms.Label
$lblProxy.Text = "[OK] Residential Proxy: Port 10808 (Ready)"
$lblProxy.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$lblProxy.Location = New-Object System.Drawing.Point(14, 34)
$lblProxy.Size = New-Object System.Drawing.Size(390, 18)
$lblProxy.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$pnlStatus.Controls.Add($lblProxy)
$form.Controls.Add($pnlStatus)

# Function refresh status UI
function Refresh-UI-Status {
    $ts = Get-RealTailscaleStatus
    if ($ts.Active) {
        $lblTs.Text = $ts.Message
        $lblTs.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        $mStatus.Text = "Tailscale: Connected (" + $ts.IP + ")"
    } else {
        $lblTs.Text = $ts.Message
        $lblTs.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
        $mStatus.Text = "Tailscale: DISCONNECTED (App stopped)"
    }
}

# Test Connection Button
$btnTestTs = New-Object System.Windows.Forms.Button
$btnTestTs.Text = "[?] Test Connection (Tailscale -> VPS)"
$btnTestTs.Location = New-Object System.Drawing.Point(16, 150)
$btnTestTs.Size = New-Object System.Drawing.Size(418, 38)
Set-ModernButtonStyle $btnTestTs ([System.Drawing.Color]::FromArgb(37, 99, 235)) ([System.Drawing.Color]::FromArgb(29, 78, 216))
$btnTestTs.Add_Click({
    Refresh-UI-Status
    $res = Invoke-BotAction "--test"
    [System.Windows.Forms.MessageBox]::Show($res, "Connection Test", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})
$form.Controls.Add($btnTestTs)

# Action Buttons
$btnRunAll = New-Object System.Windows.Forms.Button
$btnRunAll.Text = "[>] Run All Bots on VPS"
$btnRunAll.Location = New-Object System.Drawing.Point(16, 196)
$btnRunAll.Size = New-Object System.Drawing.Size(204, 44)
Set-ModernButtonStyle $btnRunAll ([System.Drawing.Color]::FromArgb(5, 150, 105)) ([System.Drawing.Color]::FromArgb(4, 120, 87))
$btnRunAll.Add_Click({
    Refresh-UI-Status
    $res = Invoke-BotAction "--run-all"
    [System.Windows.Forms.MessageBox]::Show($res, "AutoRewardPlus", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})
$form.Controls.Add($btnRunAll)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "[X] Stop Bot on VPS"
$btnStop.Location = New-Object System.Drawing.Point(230, 196)
$btnStop.Size = New-Object System.Drawing.Size(204, 44)
Set-ModernButtonStyle $btnStop ([System.Drawing.Color]::FromArgb(220, 38, 38)) ([System.Drawing.Color]::FromArgb(185, 28, 28))
$btnStop.Add_Click({
    Refresh-UI-Status
    $res = Invoke-BotAction "--stop"
    [System.Windows.Forms.MessageBox]::Show($res, "AutoRewardPlus", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})
$form.Controls.Add($btnStop)

$btnDashboard = New-Object System.Windows.Forms.Button
$btnDashboard.Text = "[#] Open VPS Dashboard"
$btnDashboard.Location = New-Object System.Drawing.Point(16, 248)
$btnDashboard.Size = New-Object System.Drawing.Size(204, 44)
Set-ModernButtonStyle $btnDashboard ([System.Drawing.Color]::FromArgb(79, 70, 229)) ([System.Drawing.Color]::FromArgb(67, 56, 202))
$btnDashboard.Add_Click({
    Start-Process "http://100.126.196.30:3030"
})
$form.Controls.Add($btnDashboard)

$btnSync = New-Object System.Windows.Forms.Button
$btnSync.Text = "[~] Sync Sessions to VPS"
$btnSync.Location = New-Object System.Drawing.Point(230, 248)
$btnSync.Size = New-Object System.Drawing.Size(204, 44)
Set-ModernButtonStyle $btnSync ([System.Drawing.Color]::FromArgb(217, 119, 6)) ([System.Drawing.Color]::FromArgb(180, 83, 9))
$btnSync.Add_Click({
    $res = Invoke-BotAction "--sync"
    [System.Windows.Forms.MessageBox]::Show($res, "AutoRewardPlus", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})
$form.Controls.Add($btnSync)

# Scheduler Panel
$pnlSched = New-Object System.Windows.Forms.Panel
$pnlSched.Location = New-Object System.Drawing.Point(16, 300)
$pnlSched.Size = New-Object System.Drawing.Size(418, 70)
$pnlSched.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)

$lblSched = New-Object System.Windows.Forms.Label
$lblSched.Text = "AUTOMATED SCHEDULER (WINDOWS TASK)"
$lblSched.Font = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)
$lblSched.Location = New-Object System.Drawing.Point(14, 8)
$lblSched.Size = New-Object System.Drawing.Size(390, 16)
$lblSched.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$pnlSched.Controls.Add($lblSched)

$timePicker = New-Object System.Windows.Forms.DateTimePicker
$timePicker.Format = [System.Windows.Forms.DateTimePickerFormat]::Time
$timePicker.ShowUpDown = $true
$timePicker.Location = New-Object System.Drawing.Point(14, 28)
$timePicker.Size = New-Object System.Drawing.Size(110, 24)
$timePicker.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$pnlSched.Controls.Add($timePicker)

$btnSchedule = New-Object System.Windows.Forms.Button
$btnSchedule.Text = "Set Daily Execution Time"
$btnSchedule.Location = New-Object System.Drawing.Point(134, 25)
$btnSchedule.Size = New-Object System.Drawing.Size(270, 32)
Set-ModernButtonStyle $btnSchedule ([System.Drawing.Color]::FromArgb(8, 145, 178)) ([System.Drawing.Color]::FromArgb(14, 116, 144))
$btnSchedule.Add_Click({
    $timeStr = $timePicker.Value.ToString("HH:mm")
    $res = Invoke-BotAction "--schedule=$timeStr"
    [System.Windows.Forms.MessageBox]::Show($res, "AutoRewardPlus", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})
$pnlSched.Controls.Add($btnSchedule)
$form.Controls.Add($pnlSched)

# Minimize to Tray Button (Silent - No Balloon)
$btnMin = New-Object System.Windows.Forms.Button
$btnMin.Text = "[-] Minimize to System Tray"
$btnMin.Location = New-Object System.Drawing.Point(16, 380)
$btnMin.Size = New-Object System.Drawing.Size(418, 38)
Set-ModernButtonStyle $btnMin ([System.Drawing.Color]::FromArgb(51, 65, 85)) ([System.Drawing.Color]::FromArgb(71, 85, 105))
$btnMin.Add_Click({
    $form.Hide()
})
$form.Controls.Add($btnMin)

# 4. System Tray (NotifyIcon)
$notify = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $iconFile) {
    $notify.Icon = New-Object System.Drawing.Icon($iconFile)
} else {
    $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Text = "AutoRewardPlus - VPS Control"
$notify.Visible = $true

# Context Menu
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$mStatus = $menu.Items.Add("Tailscale: Checking...")
$mStatus.Enabled = $false

$mSep1 = New-Object System.Windows.Forms.ToolStripSeparator
$menu.Items.Add($mSep1) | Out-Null

$mTest = $menu.Items.Add("[?] Test Tailscale Connection")
$mTest.Add_Click({
    Refresh-UI-Status
    $res = Invoke-BotAction "--test"
    $notify.ShowBalloonTip(2000, "Tailscale Status", $res, [System.Windows.Forms.ToolTipIcon]::Info)
})

$mRunAll = $menu.Items.Add("[>] Run All Bots on VPS")
$mRunAll.Add_Click({
    Refresh-UI-Status
    Invoke-BotAction "--run-all"
})

$mStop = $menu.Items.Add("[X] Stop Bot on VPS")
$mStop.Add_Click({
    Invoke-BotAction "--stop"
})

$mDash = $menu.Items.Add("[#] Open Web Dashboard")
$mDash.Add_Click({
    Start-Process "http://100.126.196.30:3030"
})

$mSync = $menu.Items.Add("[~] Sync Sessions to VPS")
$mSync.Add_Click({
    Invoke-BotAction "--sync"
})

$mSep2 = New-Object System.Windows.Forms.ToolStripSeparator
$menu.Items.Add($mSep2) | Out-Null

$mShow = $menu.Items.Add("[*] Open Control Center")
$mShow.Add_Click({
    Refresh-UI-Status
    $form.Show()
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.Activate()
})

$mExit = $menu.Items.Add("[!] Exit Application")
$mExit.Add_Click({
    $notify.Visible = $false
    $form.Close()
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu

$notify.Add_DoubleClick({
    Refresh-UI-Status
    $form.Show()
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.Activate()
})

# Close form: Silent minimize to tray
$form.Add_FormClosing({
    param($sender, $e)
    if ($e.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
        $e.Cancel = $true
        $form.Hide()
    }
})

$form.Add_Shown({
    Refresh-UI-Status
})

Refresh-UI-Status

[System.Windows.Forms.Application]::Run($form)
