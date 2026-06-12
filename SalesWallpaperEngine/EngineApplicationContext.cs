using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SalesWallpaperEngine;

internal sealed class EngineApplicationContext : ApplicationContext
{
    private readonly RuntimeConfig _config;
    private readonly DesktopHost _desktopHost = new();
    private readonly StaticFileServer _server;
    private readonly NotifyIcon _trayIcon;
    private readonly SynchronizationContext _uiContext;
    private readonly System.Windows.Forms.Timer _watchTimer;
    private readonly System.Windows.Forms.Timer _updateTimer;
    private readonly ToolStripMenuItem _statusItem = new();
    private readonly ToolStripMenuItem _downloadUpdateItem = new("下载新版本");
    private Process? _playerProcess;
    private IntPtr _playerHandle = IntPtr.Zero;
    private WallpaperUpdateInfo? _pendingUpdate;
    private bool _starting;
    private bool _installingUpdate;
    private bool _disposed;

    public EngineApplicationContext()
    {
        _uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _config = RuntimeConfig.Load();
        _server = new StaticFileServer(_config);
        _server.Start();

        _trayIcon = CreateTrayIcon();
        _trayIcon.Visible = true;

        _watchTimer = new System.Windows.Forms.Timer
        {
            Interval = _config.ReattachSeconds * 1000,
        };
        _watchTimer.Tick += async (_, _) => await EnsureWallpaperAsync();
        _watchTimer.Start();

        _updateTimer = new System.Windows.Forms.Timer
        {
            Interval = 30 * 60 * 1000,
        };
        _updateTimer.Tick += async (_, _) => await CheckForUpdatesAsync(false);
        if (_config.AutoUpdateEnabled)
        {
            _updateTimer.Start();
        }

        SystemEvents.DisplaySettingsChanged += SystemEvents_DisplaySettingsChanged;
        SystemEvents.SessionSwitch += SystemEvents_SessionSwitch;

        _ = StartWallpaperAsync();
        if (_config.AutoUpdateEnabled)
        {
            _ = CheckForUpdatesAsync(false);
        }
    }

    private NotifyIcon CreateTrayIcon()
    {
        _statusItem.Enabled = false;
        _statusItem.Text = $"Sales Wallpaper v{AppVersion.Current}";

        _downloadUpdateItem.Enabled = false;
        _downloadUpdateItem.Visible = false;
        _downloadUpdateItem.Click += async (_, _) =>
        {
            if (_pendingUpdate != null) await InstallUpdateAsync(_pendingUpdate);
        };

        var advancedMenu = new ToolStripMenuItem("高级");
        advancedMenu.DropDownItems.Add("重新贴到桌面", null, async (_, _) => await EnsureWallpaperAsync(forceAttach: true));
        advancedMenu.DropDownItems.Add("打开日志目录", null, (_, _) => OpenDirectory(AppPaths.LogDir));
        advancedMenu.DropDownItems.Add("写入桌面诊断", null, (_, _) => WriteDesktopDiagnostics());

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("重启壁纸", null, async (_, _) => await RestartWallpaperAsync());
        menu.Items.Add("检查更新", null, async (_, _) => await CheckForUpdatesAsync(true));
        menu.Items.Add(_downloadUpdateItem);
        menu.Items.Add("打开配置目录", null, (_, _) => OpenDirectory(AppPaths.DataDir));
        menu.Items.Add(advancedMenu);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, (_, _) => ExitThread());

        return new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "Sales Wallpaper Engine",
            ContextMenuStrip = menu,
        };
    }

    private async Task StartWallpaperAsync()
    {
        if (_starting || _disposed) return;
        _starting = true;
        try
        {
            StopPlayer();
            var exe = Application.ExecutablePath;
            var url = $"{_server.BaseUrl}/wallpaper.html";
            var args = $"--player --url \"{url}\" --user-data-dir \"{AppPaths.WebViewUserDataDir}\"";
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                UseShellExecute = false,
                WorkingDirectory = AppContext.BaseDirectory,
            });
            if (process == null)
            {
                AppLogger.Warn("player process did not start");
                return;
            }

            _playerProcess = process;
            _playerHandle = await WaitForPlayerHandle(process, TimeSpan.FromSeconds(_config.PlayerStartupTimeoutSeconds));
            if (_playerHandle == IntPtr.Zero)
            {
                AppLogger.Warn($"player handle not found pid={process.Id}");
                return;
            }

            _desktopHost.AttachWindow(_playerHandle);
            _statusItem.Text = $"Sales Wallpaper v{AppVersion.Current}";
        }
        catch (Exception ex)
        {
            AppLogger.Error("start wallpaper failed", ex);
            _statusItem.Text = "启动失败，查看日志";
        }
        finally
        {
            _starting = false;
        }
    }

    private async Task EnsureWallpaperAsync(bool forceAttach = false)
    {
        if (_disposed) return;
        try
        {
            if (_playerProcess == null || _playerProcess.HasExited)
            {
                await StartWallpaperAsync();
                return;
            }

            if (_playerHandle == IntPtr.Zero || !NativeMethods.IsWindow(_playerHandle))
            {
                _playerHandle = await WaitForPlayerHandle(_playerProcess, TimeSpan.FromSeconds(5));
            }

            if (_playerHandle != IntPtr.Zero)
            {
                _desktopHost.AttachWindow(_playerHandle);
                _statusItem.Text = $"Sales Wallpaper v{AppVersion.Current}";
            }
        }
        catch (Exception ex)
        {
            AppLogger.Error("ensure wallpaper failed", ex);
        }
    }

    private async Task RestartWallpaperAsync()
    {
        StopPlayer();
        await StartWallpaperAsync();
    }

    private async Task CheckForUpdatesAsync(bool notifyWhenCurrent)
    {
        try
        {
            var update = await AppUpdater.CheckAsync(_config, CancellationToken.None);
            _pendingUpdate = update;
            if (update == null)
            {
                _downloadUpdateItem.Enabled = false;
                _downloadUpdateItem.Visible = false;
                _downloadUpdateItem.Text = "下载新版本";
                if (notifyWhenCurrent)
                {
                    _trayIcon.ShowBalloonTip(2500, "壁纸引擎", "当前已是最新版本", ToolTipIcon.Info);
                }
                return;
            }

            _downloadUpdateItem.Enabled = true;
            _downloadUpdateItem.Visible = true;
            _downloadUpdateItem.Text = $"安装更新 {update.Version}";
            _trayIcon.ShowBalloonTip(4000, "壁纸引擎有更新", $"发现 {update.Version}，可在托盘菜单安装。", ToolTipIcon.Info);
            if (_config.AutoInstallUpdates)
            {
                await InstallUpdateAsync(update);
            }
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"update check failed: {ex.Message}");
            if (notifyWhenCurrent)
            {
                _trayIcon.ShowBalloonTip(3000, "壁纸引擎", "检查更新失败，查看日志。", ToolTipIcon.Warning);
            }
        }
    }

    private async Task InstallUpdateAsync(WallpaperUpdateInfo update)
    {
        if (_installingUpdate || _disposed) return;
        _installingUpdate = true;
        _downloadUpdateItem.Enabled = false;
        _downloadUpdateItem.Text = $"正在安装 {update.Version}";
        try
        {
            _trayIcon.ShowBalloonTip(2500, "壁纸引擎更新", $"正在下载并安装 {update.Version}，稍后会自动重启。", ToolTipIcon.Info);
            await AppUpdater.DownloadAndInstallAsync(update, CancellationToken.None);
            StopPlayer();
            ExitThread();
        }
        catch (Exception ex)
        {
            _installingUpdate = false;
            _downloadUpdateItem.Enabled = true;
            _downloadUpdateItem.Text = $"安装更新 {update.Version}";
            AppLogger.Error("install update failed", ex);
            _trayIcon.ShowBalloonTip(3500, "壁纸引擎更新失败", "请查看日志目录。", ToolTipIcon.Warning);
        }
    }

    private static async Task<IntPtr> WaitForPlayerHandle(Process process, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.Now + timeout;
        while (DateTimeOffset.Now < deadline)
        {
            if (process.HasExited) return IntPtr.Zero;
            process.Refresh();
            var handle = process.MainWindowHandle;
            if (handle == IntPtr.Zero)
            {
                handle = NativeMethods.FindTopLevelWindowByProcessId(process.Id);
            }
            if (handle != IntPtr.Zero && NativeMethods.IsWindow(handle))
            {
                return handle;
            }
            await Task.Delay(200);
        }
        return IntPtr.Zero;
    }

    private void WriteDesktopDiagnostics()
    {
        try
        {
            var filePath = _desktopHost.WriteDiagnostics();
            _trayIcon.ShowBalloonTip(3000, "桌面诊断已写入", filePath, ToolTipIcon.Info);
            OpenDirectory(Path.GetDirectoryName(filePath) ?? AppPaths.LogDir);
        }
        catch (Exception ex)
        {
            AppLogger.Error("write diagnostics failed", ex);
        }
    }

    private static void OpenDirectory(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }

    private void SystemEvents_DisplaySettingsChanged(object? sender, EventArgs e)
    {
        PostToUi(() => EnsureWallpaperAsync(forceAttach: true));
    }

    private void SystemEvents_SessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect or SessionSwitchReason.RemoteConnect)
        {
            PostToUi(() => EnsureWallpaperAsync(forceAttach: true));
        }
    }

    private void PostToUi(Func<Task> action)
    {
        _uiContext.Post(async _ =>
        {
            try
            {
                await action();
            }
            catch (Exception ex)
            {
                AppLogger.Error("ui callback failed", ex);
            }
        }, null);
    }

    private void StopPlayer()
    {
        try
        {
            if (_playerProcess is { HasExited: false })
            {
                _playerProcess.Kill(entireProcessTree: true);
                _playerProcess.WaitForExit(3000);
            }
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"stop player failed: {ex.Message}");
        }
        finally
        {
            _playerProcess?.Dispose();
            _playerProcess = null;
            _playerHandle = IntPtr.Zero;
        }
    }

    protected override void ExitThreadCore()
    {
        _disposed = true;
        SystemEvents.DisplaySettingsChanged -= SystemEvents_DisplaySettingsChanged;
        SystemEvents.SessionSwitch -= SystemEvents_SessionSwitch;
        _watchTimer.Stop();
        _updateTimer.Stop();
        StopPlayer();
        _server.Dispose();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        base.ExitThreadCore();
    }
}
