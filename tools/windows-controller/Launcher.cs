using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AutoRewardLauncher
{
    public class TrayAppContext : ApplicationContext
    {
        private const string AppName = "AutoRewardPlus";
        private const string RunRegKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string LocalUrl = "http://127.0.0.1:4000";
        private const string VpsUrl = "http://100.126.196.30:3030";

        private NotifyIcon trayIcon;
        private ContextMenuStrip contextMenu;
        private ToolStripMenuItem autoStartItem;
        private string rootDir;
        private string controllerDir;
        private Process proxyProcess;
        private Process serverProcess;

        public TrayAppContext(bool isSilent)
        {
            InitializePaths();
            EnsureBackgroundServices();
            InitializeTray();

            if (!isSilent)
            {
                OpenAppWindow();
            }
            else
            {
                trayIcon.ShowBalloonTip(3000, AppName, "Hệ thống đang chạy ngầm trong System Tray. Residential Proxy :10808 đã sẵn sàng.", ToolTipIcon.Info);
            }
        }

        private void InitializePaths()
        {
            string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
            // Check if running from root or tools/windows-controller
            if (Directory.Exists(Path.Combine(exeDir, "tools", "windows-controller")))
            {
                rootDir = exeDir;
                controllerDir = Path.Combine(exeDir, "tools", "windows-controller");
            }
            else
            {
                controllerDir = exeDir;
                rootDir = Path.GetFullPath(Path.Combine(exeDir, "..", ".."));
            }
        }

        private void EnsureBackgroundServices()
        {
            try
            {
                string proxyScript = Path.Combine(controllerDir, "proxyServer.js");
                string serverScript = Path.Combine(controllerDir, "server.js");

                // Start Proxy Server (port 10808) if not already listening
                if (!IsPortListening(10808) && File.Exists(proxyScript))
                {
                    ProcessStartInfo psiProxy = new ProcessStartInfo
                    {
                        FileName = "node.exe",
                        Arguments = string.Format("\"{0}\"", proxyScript),
                        WorkingDirectory = controllerDir,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        UseShellExecute = false
                    };
                    proxyProcess = Process.Start(psiProxy);
                }

                // Start Controller Server (port 4000) if not already listening
                if (!IsPortListening(4000) && File.Exists(serverScript))
                {
                    ProcessStartInfo psiServer = new ProcessStartInfo
                    {
                        FileName = "node.exe",
                        Arguments = string.Format("\"{0}\"", serverScript),
                        WorkingDirectory = controllerDir,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        UseShellExecute = false
                    };
                    serverProcess = Process.Start(psiServer);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Lỗi khởi động dịch vụ nền: " + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private bool IsPortListening(int port)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}", port));
                req.Timeout = 800;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return true;
                }
            }
            catch (WebException)
            {
                return false;
            }
            catch
            {
                return false;
            }
        }

        private void InitializeTray()
        {
            contextMenu = new ContextMenuStrip();
            contextMenu.Font = new Font("Segoe UI", 9f);

            // Header (Disabled)
            ToolStripMenuItem titleItem = new ToolStripMenuItem("⚡ AutoRewardPlus - v7.2.2")
            {
                Enabled = false,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };
            contextMenu.Items.Add(titleItem);
            contextMenu.Items.Add(new ToolStripSeparator());

            // Open Window
            ToolStripMenuItem openItem = new ToolStripMenuItem("🌐 Mở Bảng Điều Khiển (App Window)", null, (s, e) => OpenAppWindow())
            {
                Font = new Font("Segoe UI", 9f, FontStyle.Bold)
            };
            contextMenu.Items.Add(openItem);

            // 1-Click Run on VPS
            ToolStripMenuItem runItem = new ToolStripMenuItem("🚀 Chạy Tất Cả Trên VPS", null, (s, e) => TriggerApiAction("start", "Đã gửi lệnh chạy bot trên VPS!"));
            contextMenu.Items.Add(runItem);

            // Stop Bot
            ToolStripMenuItem stopItem = new ToolStripMenuItem("🛑 Dừng Bot Khẩn Cấp", null, (s, e) => TriggerApiAction("stop", "Đã gửi lệnh dừng bot!"));
            contextMenu.Items.Add(stopItem);

            // Open VPS Dashboard
            ToolStripMenuItem dashItem = new ToolStripMenuItem("📊 Mở Web Dashboard VPS (:3030)", null, (s, e) => Process.Start(VpsUrl));
            contextMenu.Items.Add(dashItem);

            // Sync Sessions
            ToolStripMenuItem syncItem = new ToolStripMenuItem("🔄 Đồng Bộ Session Lên VPS", null, (s, e) => TriggerApiAction("sync", "Đang đồng bộ session sang VPS..."));
            contextMenu.Items.Add(syncItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // Auto-start with Windows (Checkable)
            autoStartItem = new ToolStripMenuItem("💻 Khởi Động Cùng Windows", null, OnToggleAutoStart)
            {
                CheckOnClick = true,
                Checked = IsAutoStartEnabled()
            };
            contextMenu.Items.Add(autoStartItem);

            contextMenu.Items.Add(new ToolStripSeparator());

            // Exit App
            ToolStripMenuItem exitItem = new ToolStripMenuItem("❌ Thoát Ứng Dụng", null, OnExit);
            contextMenu.Items.Add(exitItem);

            // Notify Icon
            trayIcon = new NotifyIcon
            {
                Text = "AutoRewardPlus - Windows Control Center",
                ContextMenuStrip = contextMenu,
                Visible = true
            };

            // Load Custom Icon if available
            string iconPath = Path.Combine(controllerDir, "app.ico");
            if (File.Exists(iconPath))
            {
                try
                {
                    trayIcon.Icon = new Icon(iconPath);
                }
                catch
                {
                    trayIcon.Icon = SystemIcons.Application;
                }
            }
            else
            {
                trayIcon.Icon = SystemIcons.Application;
            }

            trayIcon.DoubleClick += (s, e) => OpenAppWindow();
        }

        public void OpenAppWindow()
        {
            try
            {
                // Ensure server is up
                EnsureBackgroundServices();

                // Look for Microsoft Edge to launch as a native frameless app window
                string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
                if (!File.Exists(edgePath))
                {
                    edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
                }

                if (File.Exists(edgePath))
                {
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = edgePath,
                        Arguments = string.Format("--app=\"{0}\" --window-size=1180,820", LocalUrl),
                        UseShellExecute = true
                    };
                    Process.Start(psi);
                }
                else
                {
                    // Fallback to default browser
                    Process.Start(LocalUrl);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Không thể mở cửa sổ ứng dụng: " + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void TriggerApiAction(string action, string notifyMsg)
        {
            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("{0}/api/action/{1}", LocalUrl, action));
                    req.Timeout = 10000;
                    using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                    {
                        trayIcon.ShowBalloonTip(2500, AppName, notifyMsg, ToolTipIcon.Info);
                    }
                }
                catch (Exception ex)
                {
                    trayIcon.ShowBalloonTip(3000, AppName, "Lỗi thực hiện lệnh: " + ex.Message, ToolTipIcon.Warning);
                }
            });
        }

        private bool IsAutoStartEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunRegKey, false))
                {
                    if (key != null)
                    {
                        object val = key.GetValue(AppName);
                        return val != null;
                    }
                }
            }
            catch {}
            return false;
        }

        private void OnToggleAutoStart(object sender, EventArgs e)
        {
            try
            {
                bool enable = autoStartItem.Checked;
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunRegKey, true))
                {
                    if (key != null)
                    {
                        if (enable)
                        {
                            string exePath = Application.ExecutablePath;
                            key.SetValue(AppName, string.Format("\"{0}\" --silent", exePath));
                            trayIcon.ShowBalloonTip(2500, AppName, "Đã bật tự động khởi động cùng Windows!", ToolTipIcon.Info);
                        }
                        else
                        {
                            key.DeleteValue(AppName, false);
                            trayIcon.ShowBalloonTip(2500, AppName, "Đã tắt tự động khởi động cùng Windows.", ToolTipIcon.Info);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Lỗi thiết lập khởi động cùng Windows: " + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OnExit(object sender, EventArgs e)
        {
            trayIcon.Visible = false;
            try
            {
                if (proxyProcess != null && !proxyProcess.HasExited)
                {
                    proxyProcess.Kill();
                }
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                }
            }
            catch {}

            Application.Exit();
        }
    }

    static class Program
    {
        private const string MutexId = "AutoRewardPlus_Windows_App_Mutex_v2";

        [STAThread]
        static void Main(string[] args)
        {
            bool isNew = false;
            Mutex mutex = new Mutex(true, MutexId, out isNew);

            bool isSilent = false;
            foreach (string arg in args)
            {
                if (arg.Equals("--silent", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("-silent", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("--tray", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("-tray", StringComparison.OrdinalIgnoreCase))
                {
                    isSilent = true;
                    break;
                }
            }

            if (!isNew)
            {
                // Already running
                if (!isSilent)
                {
                    // Open existing control window
                    try
                    {
                        string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
                        if (!File.Exists(edgePath))
                        {
                            edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
                        }
                        if (File.Exists(edgePath))
                        {
                            Process.Start(edgePath, "--app=\"http://127.0.0.1:4000\" --window-size=1180,820");
                        }
                        else
                        {
                            Process.Start("http://127.0.0.1:4000");
                        }
                    }
                    catch {}
                }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayAppContext(isSilent));

            GC.KeepAlive(mutex);
        }
    }
}
