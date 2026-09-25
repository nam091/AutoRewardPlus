using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace AutoRewardLauncher
{
    static class Program
    {
        private const string MutexId = "AutoRewardPlusTrayAppMutex";

        [STAThread]
        static void Main()
        {
            try
            {
                string exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
                string scriptPath = Path.Combine(exeDir, "tools", "windows-controller", "TrayApp.ps1");

                if (!File.Exists(scriptPath))
                {
                    MessageBox.Show("Script file not found:\n" + scriptPath, "AutoRewardPlus Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                try
                {
                    Mutex existing = Mutex.OpenExisting(MutexId);
                    if (existing != null)
                    {
                        existing.Close();
                        MessageBox.Show("AutoRewardPlus is already running in the System Tray (bottom-right corner).\n\nDouble-click the tray icon to open the control window.", "AutoRewardPlus", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return;
                    }
                }
                catch (WaitHandleCannotBeOpenedException)
                {
                    // Proceed to launch
                }
                catch (UnauthorizedAccessException)
                {
                    MessageBox.Show("AutoRewardPlus is already active on the system.", "AutoRewardPlus", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = string.Format("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{0}\"", scriptPath);
                psi.WorkingDirectory = exeDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Launch failed: " + ex.Message, "AutoRewardPlus Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
