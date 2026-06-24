using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SalesWallpaperEngine;

internal sealed class EngineApplicationContext : ApplicationContext
{
    private RuntimeConfig _config;
    private readonly DesktopHost _desktopHost = new();
    private readonly StaticFileServer _server;
    private readonly NotifyIcon _trayIcon;
    private readonly SynchronizationContext _uiContext;
    private readonly System.Windows.Forms.Timer _watchTimer;
    private readonly System.Windows.Forms.Timer _updateTimer;
    private readonly ToolStripMenuItem _statusItem = new();
    private readonly ToolStripMenuItem _checkUpdateItem = new("检查更新");
    private readonly ToolStripMenuItem _downloadUpdateItem = new("安装新版本");
    private readonly ToolStripMenuItem _hudEditItem = new("HUD 编辑模式");
    private readonly ToolStripMenuItem _saveHudLayoutItem = new("保存 HUD 布局");
    private readonly ToolStripMenuItem _cancelHudEditItem = new("取消 HUD 编辑");
    private Process? _playerProcess;
    private SettingsForm? _settingsForm;
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
        _server.OnSettingsSave += settings => PostToUiAsync(() => SaveSettingsAsync(settings));
        _server.OnEditModeChange += (enabled, clearPreview) => PostToUiAsync(() =>
        {
            SetHudEditMode(enabled, clearPreview, fromSettingsWindow: true);
            return Task.CompletedTask;
        });
        _server.OnPreviewCommit += () => PostToUiAsync(SaveHudLayoutPreviewAsync);
        _server.OnRefreshRequested += () => PostToUi(RestartWallpaperAsync);
        _server.OnCheckUpdateRequested += () => PostToUi(() => CheckForUpdatesAsync(true));
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

        _checkUpdateItem.Click += async (_, _) => await CheckForUpdatesAsync(true);

        _downloadUpdateItem.Enabled = false;
        _downloadUpdateItem.Visible = false;
        _downloadUpdateItem.Click += async (_, _) =>
        {
            if (_pendingUpdate != null) await InstallUpdateAsync(_pendingUpdate);
        };

        _hudEditItem.CheckOnClick = true;
        _hudEditItem.Click += (_, _) => SetHudEditMode(_hudEditItem.Checked);

        _saveHudLayoutItem.Enabled = false;
        _saveHudLayoutItem.Visible = false;
        _saveHudLayoutItem.Click += async (_, _) => await SaveHudLayoutPreviewAsync();

        _cancelHudEditItem.Enabled = false;
        _cancelHudEditItem.Visible = false;
        _cancelHudEditItem.Click += (_, _) => SetHudEditMode(false, clearPreview: true);

        var advancedMenu = new ToolStripMenuItem("高级");
        advancedMenu.DropDownItems.Add("打开配置目录", null, (_, _) => OpenDirectory(AppPaths.DataDir));
        advancedMenu.DropDownItems.Add("打开日志目录", null, (_, _) => OpenDirectory(AppPaths.LogDir));
        advancedMenu.DropDownItems.Add(new ToolStripSeparator());
        advancedMenu.DropDownItems.Add("重新贴到桌面", null, async (_, _) => await EnsureWallpaperAsync(forceAttach: true));
        advancedMenu.DropDownItems.Add("写入运行状态日志", null, (_, _) => WriteRuntimeSnapshot());
        advancedMenu.DropDownItems.Add("写入桌面诊断", null, (_, _) => WriteDesktopDiagnostics());

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("设置...", null, (_, _) => OpenSettingsWindow());
        menu.Items.Add(_hudEditItem);
        menu.Items.Add(_saveHudLayoutItem);
        menu.Items.Add(_cancelHudEditItem);
        menu.Items.Add("重启壁纸", null, async (_, _) => await RestartWallpaperAsync());
        menu.Items.Add(_checkUpdateItem);
        menu.Items.Add(_downloadUpdateItem);
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

    private void OpenSettingsWindow()
    {
        if (_settingsForm is { IsDisposed: false })
        {
            _settingsForm.WindowState = FormWindowState.Normal;
            _settingsForm.Activate();
            return;
        }

        SetHudEditMode(true, fromSettingsWindow: true);
        _settingsForm = new SettingsForm(_server);
        _settingsForm.FormClosed += (_, _) =>
        {
            _server.ClearPreview();
            SetHudEditMode(false, fromSettingsWindow: true);
            _settingsForm = null;
            AppLogger.Info("settings window closed");
        };
        _settingsForm.Show();
    }

    private void SetHudEditMode(bool enabled, bool clearPreview = false, bool fromSettingsWindow = false)
    {
        if (clearPreview)
        {
            _server.ClearPreview();
        }
        _server.SetEditMode(enabled);
        _hudEditItem.Checked = enabled;
        _saveHudLayoutItem.Enabled = enabled;
        _saveHudLayoutItem.Visible = enabled;
        _cancelHudEditItem.Enabled = enabled;
        _cancelHudEditItem.Visible = enabled;
        _statusItem.Text = enabled ? "HUD 编辑中，拖动后保存" : $"Sales Wallpaper v{AppVersion.Current}";
        if (enabled && !fromSettingsWindow)
        {
            _trayIcon.ShowBalloonTip(2600, "HUD 编辑模式", "可直接拖动顶部和右下角 HUD，完成后点“保存 HUD 布局”。", ToolTipIcon.Info);
        }
    }

    private async Task SaveHudLayoutPreviewAsync()
    {
        var preview = _server.GetPreviewSettings();
        if (preview.Count == 0)
        {
            _trayIcon.ShowBalloonTip(2200, "HUD 布局", "还没有检测到拖动调整。", ToolTipIcon.Info);
            return;
        }
        await SaveSettingsAsync(preview, keepEditModeWithSettingsWindow: false);
        SetHudEditMode(false);
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
            var playerPid = process.Id;
            process.EnableRaisingEvents = true;
            process.Exited += (_, _) =>
            {
                AppLogger.Warn($"player process exited pid={playerPid}");
                if (_disposed || _installingUpdate) return;
                PostToUi(async () =>
                {
                    await Task.Delay(1200);
                    await EnsureWallpaperAsync();
                });
            };
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

    private async Task SaveSettingsAsync(Dictionary<string, object?> settings, bool keepEditModeWithSettingsWindow = true)
    {
        try
        {
            WriteUserSettings(settings);
            _config = RuntimeConfig.Load();
            _server.UpdateConfig(_config);
            _server.ClearPreview();
            _server.SetEditMode(keepEditModeWithSettingsWindow && _settingsForm is { IsDisposed: false });
            _hudEditItem.Checked = _server.EditMode;
            _saveHudLayoutItem.Enabled = _server.EditMode;
            _saveHudLayoutItem.Visible = _server.EditMode;
            _cancelHudEditItem.Enabled = _server.EditMode;
            _cancelHudEditItem.Visible = _server.EditMode;
            _watchTimer.Interval = _config.ReattachSeconds * 1000;
            if (_config.AutoUpdateEnabled)
            {
                _updateTimer.Start();
            }
            else
            {
                _updateTimer.Stop();
            }
            await RestartWallpaperAsync();
            _trayIcon.ShowBalloonTip(2200, "壁纸设置", "设置已保存并应用。", ToolTipIcon.Info);
        }
        catch (Exception ex)
        {
            AppLogger.Error("save settings failed", ex);
            _trayIcon.ShowBalloonTip(3000, "壁纸设置保存失败", "请查看日志目录。", ToolTipIcon.Warning);
        }
    }

    private static void WriteUserSettings(Dictionary<string, object?> settings)
    {
        Directory.CreateDirectory(AppPaths.DataDir);
        var merged = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (File.Exists(AppPaths.UserConfigPath))
        {
            try
            {
                using var document = JsonDocument.Parse(File.ReadAllText(AppPaths.UserConfigPath));
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in document.RootElement.EnumerateObject())
                    {
                        merged[prop.Name] = prop.Value.Clone();
                    }
                }
            }
            catch (Exception ex)
            {
                AppLogger.Warn($"failed to merge existing user config: {ex.Message}");
            }
        }

        foreach (var (key, value) in settings)
        {
            merged[key] = value;
        }

        var json = JsonSerializer.Serialize(merged, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(AppPaths.UserConfigPath, json);
        AppLogger.Info($"settings saved path={AppPaths.UserConfigPath} keys={settings.Count}");
    }

    private async Task CheckForUpdatesAsync(bool notifyWhenCurrent)
    {
        if (notifyWhenCurrent)
        {
            _checkUpdateItem.Enabled = false;
            _checkUpdateItem.Text = "正在检查更新";
        }
        try
        {
            var update = await AppUpdater.CheckAsync(_config, CancellationToken.None);
            _pendingUpdate = update;
            if (update == null)
            {
                _downloadUpdateItem.Enabled = false;
                _downloadUpdateItem.Visible = false;
                _downloadUpdateItem.Text = "安装新版本";
                if (notifyWhenCurrent)
                {
                    _trayIcon.ShowBalloonTip(2500, "壁纸引擎", "当前已是最新版本", ToolTipIcon.Info);
                }
                return;
            }

            _downloadUpdateItem.Enabled = true;
            _downloadUpdateItem.Visible = true;
            _downloadUpdateItem.Text = $"安装更新 {update.Version}";
            var updateMessage = _config.AutoInstallUpdates
                ? $"发现 {update.Version}，将下载、校验并安装。"
                : $"发现 {update.Version}，可在托盘菜单安装。";
            _trayIcon.ShowBalloonTip(4000, "壁纸引擎有更新", updateMessage, ToolTipIcon.Info);
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
        finally
        {
            if (notifyWhenCurrent && !_disposed)
            {
                _checkUpdateItem.Enabled = true;
                _checkUpdateItem.Text = "检查更新";
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
            AppLogger.Info($"applying update {update.Version}");
            await AppUpdater.DownloadAndInstallAsync(update, CancellationToken.None);
            AppLogger.Info("update applied; exiting for restart");
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

    private void WriteRuntimeSnapshot()
    {
        try
        {
            var player = _playerProcess == null
                ? "none"
                : $"pid={_playerProcess.Id} exited={_playerProcess.HasExited}";
            AppLogger.Info(
                "runtime snapshot "
                + $"version={AppVersion.Current} "
                + $"apiHost={_config.ApiHost} "
                + $"hasToken={_config.HasWallpaperToken} "
                + $"language={_config.LanguageMode} "
                + $"refreshAt={_config.RefreshAtLocalTime} "
                + $"autoUpdate={_config.AutoUpdateEnabled} "
                + $"autoInstall={_config.AutoInstallUpdates} "
                + $"player={player} "
                + $"handle=0x{_playerHandle.ToInt64():x}");
            _trayIcon.ShowBalloonTip(2200, "运行状态已写入日志", AppPaths.LogDir, ToolTipIcon.Info);
        }
        catch (Exception ex)
        {
            AppLogger.Error("write runtime snapshot failed", ex);
            _trayIcon.ShowBalloonTip(3000, "写入运行状态失败", "请查看日志目录。", ToolTipIcon.Warning);
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
        _ = PostToUiAsync(action);
    }

    private Task PostToUiAsync(Func<Task> action)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _uiContext.Post(async _ =>
        {
            try
            {
                await action();
                tcs.SetResult();
            }
            catch (Exception ex)
            {
                AppLogger.Error("ui callback failed", ex);
                tcs.SetException(ex);
            }
        }, null);
        return tcs.Task;
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
        if (_settingsForm is { IsDisposed: false })
        {
            _settingsForm.Close();
        }
        StopPlayer();
        _server.Dispose();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        base.ExitThreadCore();
    }
}
