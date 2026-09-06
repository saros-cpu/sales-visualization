using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SalesWallpaperEngine;

internal sealed class PlayerForm : Form
{
    private readonly string _url;
    private readonly string _userDataDir;
    private readonly WebView2 _webView = new();
    private readonly System.Windows.Forms.Timer _pointerTimer = new() { Interval = 50 };
    private Point _lastPointer = new(int.MinValue, int.MinValue);
    private bool _lastPointerInside;
    private bool _lastLeftDown;
    private bool _pointerScriptBusy;
    private bool _refreshScriptBusy;

    // Low-level mouse hook so wheel events reach the wallpaper (the OS does not
    // forward WM_MOUSEWHEEL to a window parked behind the desktop shell).
    private static PlayerForm? _instance;
    private static NativeMethods.HookProc? _mouseHookDelegate;
    private static IntPtr _mouseHookHandle;

    public PlayerForm(string url, string userDataDir)
    {
        _url = url;
        _userDataDir = userDataDir;
        _instance = this;

        Text = "SalesWallpaperEnginePlayer";
        Name = "SalesWallpaperEnginePlayer";
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;
        var screenBounds = Screen.PrimaryScreen?.Bounds;
        if (screenBounds.HasValue && screenBounds.Value.Width > 0 && screenBounds.Value.Height > 0)
        {
            Bounds = screenBounds.Value;
        }
        else
        {
            Bounds = new Rectangle(-32000, -32000, 1280, 720);
        }

        _webView.Dock = DockStyle.Fill;
        Controls.Add(_webView);
        _pointerTimer.Tick += ForwardPointerTick;
        SystemEvents.PowerModeChanged += SystemEvents_PowerModeChanged;
        SystemEvents.SessionSwitch += SystemEvents_SessionSwitch;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= (int)NativeMethods.WS_EX_TOOLWINDOW;
            return cp;
        }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await InitializeWebView();
    }

    private async Task InitializeWebView()
    {
        try
        {
            Directory.CreateDirectory(_userDataDir);
            var options = new CoreWebView2EnvironmentOptions(
                "--disable-features=msSmartScreenProtection --autoplay-policy=no-user-gesture-required");
            // Always use the system Evergreen/Edge WebView2 runtime (CreateAsync(null)).
            // Matches pre-0.2.11 behavior: Windows 10/11 ship WebView2, so no bundled
            // runtime folder is required. Hand-copied Fixed Version runtime folders are
            // not consulted at all — they caused side-by-side configuration errors and
            // a black player in 0.2.11/0.2.12.
            var environment = await CoreWebView2Environment.CreateAsync(null, _userDataDir, options);
            await _webView.EnsureCoreWebView2Async(environment);
            InstallWheelHook();

            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(SyntheticPointerScript);
            _webView.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                if (args.IsSuccess)
                {
                    _pointerTimer.Start();
                }
            };
            _webView.CoreWebView2.ProcessFailed += (_, args) =>
            {
                AppLogger.Warn($"webview process failed kind={args.ProcessFailedKind} reason={args.Reason}");
                try
                {
                    if (!IsDisposed && IsHandleCreated)
                    {
                        BeginInvoke(new Action(Close));
                    }
                    else
                    {
                        Close();
                    }
                }
                catch (Exception ex)
                {
                    AppLogger.Warn($"close player after webview failure failed: {ex.Message}");
                }
            };
            _webView.Source = new Uri(_url);
            AppLogger.Info($"player loaded {_url}");
        }
        catch (Exception ex)
        {
            AppLogger.Error("webview init failed", ex);
            var detail = ex.InnerException?.Message ?? ex.Message;
            MessageBox.Show(
                $"壁纸 WebView2 初始化失败：\n{detail}\n\n壁纸引擎使用系统 WebView2 运行时（Windows 10/11 一般自带）。如持续失败，请安装 WebView2 运行时后重试。",
                "Sales Wallpaper Engine",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    private void SystemEvents_PowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Resume)
        {
            BeginRefreshDispatch("power-resume");
        }
    }

    private void SystemEvents_SessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect or SessionSwitchReason.RemoteConnect)
        {
            BeginRefreshDispatch($"session-{e.Reason}");
        }
    }

    private void BeginRefreshDispatch(string reason)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try
        {
            BeginInvoke(new Action(async () => await DispatchRefreshEventAsync(reason)));
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"queue wallpaper refresh dispatch failed reason={reason}: {ex.Message}");
        }
    }

    private async Task DispatchRefreshEventAsync(string reason)
    {
        if (_refreshScriptBusy || _webView.CoreWebView2 == null || _webView.IsDisposed) return;
        _refreshScriptBusy = true;
        try
        {
            await _webView.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('sales-wallpaper-refresh'));");
            AppLogger.Info($"wallpaper refresh event dispatched reason={reason}");
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"wallpaper refresh dispatch failed reason={reason}: {ex.Message}");
        }
        finally
        {
            _refreshScriptBusy = false;
        }
    }

    private async void ForwardPointerTick(object? sender, EventArgs e)
    {
        if (_pointerScriptBusy || _webView.CoreWebView2 == null || _webView.IsDisposed) return;

        var point = _webView.PointToClient(Cursor.Position);
        var inside = _webView.ClientRectangle.Contains(point);
        var leftDown = (Control.MouseButtons & MouseButtons.Left) == MouseButtons.Left;
        if (inside == _lastPointerInside && point == _lastPointer && leftDown == _lastLeftDown) return;

        _lastPointer = point;
        _lastPointerInside = inside;
        _lastLeftDown = leftDown;
        _pointerScriptBusy = true;
        try
        {
            var script = inside
                ? $"window.__salesWallpaperPointer && window.__salesWallpaperPointer({point.X}, {point.Y}, {(leftDown ? "true" : "false")});"
                : "window.__salesWallpaperPointerLeave && window.__salesWallpaperPointerLeave();";
            await _webView.CoreWebView2.ExecuteScriptAsync(script);
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"pointer forward failed: {ex.Message}");
        }
        finally
        {
            _pointerScriptBusy = false;
        }
    }

    private void InstallWheelHook()
    {
        if (_mouseHookHandle != IntPtr.Zero) return;
        // Low-level hooks must be passed a NULL module handle.
        _mouseHookDelegate = MouseHookCallback;
        _mouseHookHandle = NativeMethods.SetWindowsHookEx(
            NativeMethods.WH_MOUSE_LL, _mouseHookDelegate, IntPtr.Zero, 0);
        if (_mouseHookHandle == IntPtr.Zero)
        {
            AppLogger.Warn($"wheel hook install failed err={Marshal.GetLastWin32Error()}");
        }
    }

    private void UninstallWheelHook()
    {
        if (_mouseHookHandle != IntPtr.Zero)
        {
            NativeMethods.UnhookWindowsHookEx(_mouseHookHandle);
            _mouseHookHandle = IntPtr.Zero;
        }
        _mouseHookDelegate = null;
    }

    // Called on the low-level hook thread; queue the real work on the UI thread.
    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && wParam == (IntPtr)NativeMethods.WM_MOUSEWHEEL)
        {
            var hook = Marshal.PtrToStructure<NativeMethods.MSLLHOOKSTRUCT>(lParam);
            int delta = (short)(hook.mouseData >> 16);
            var self = _instance;
            if (self != null)
            {
                self.BeginInvoke(new Action<int, int, int>(self.ForwardWheel), hook.pt.x, hook.pt.y, delta);
            }
        }
        return NativeMethods.CallNextHookEx(_mouseHookHandle, nCode, wParam, lParam);
    }

    // Forward a wheel gesture to the element actually under the cursor, but only
    // when it lands on the inventory panel (avoids hijacking the map or other apps).
    private void ForwardWheel(int x, int y, int delta)
    {
        if (_webView.CoreWebView2 == null || _webView.IsDisposed) return;
        var script =
            "(function(){" +
            "try{" +
            "var d=window.devicePixelRatio||1;" +
            "var cx=" + x + "/d, cy=" + y + "/d;" +
            "var el=document.elementFromPoint(cx,cy);" +
            "if(!el)return;" +
            "if(!el.closest('.wallpaper-inventory'))return;" +
            "el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:" + (-delta) + ",deltaX:0,clientX:cx,clientY:cy,deltaMode:0}));" +
            "}catch(e){}" +
            "})();";
        _ = _webView.CoreWebView2.ExecuteScriptAsync(script);
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        UninstallWheelHook();
        SystemEvents.PowerModeChanged -= SystemEvents_PowerModeChanged;
        SystemEvents.SessionSwitch -= SystemEvents_SessionSwitch;
        _pointerTimer.Stop();
        _pointerTimer.Dispose();
        _webView.Dispose();
        base.OnFormClosed(e);
    }

    private const string SyntheticPointerScript = """
        (() => {
          if (window.__salesWallpaperPointer) return;
          let activeTarget = null;
          let lastDown = false;

          function canvas() {
            return document.querySelector('.kgz-map-canvas canvas') || document.querySelector('canvas');
          }

          function targetAt(x, y) {
            const target = document.elementFromPoint(x, y);
            if (target && target !== document.documentElement && target !== document.body) return target;
            return canvas();
          }

          function applyOffsets(event, x, y, rect) {
            try {
              Object.defineProperty(event, 'offsetX', { get: () => x - rect.left });
              Object.defineProperty(event, 'offsetY', { get: () => y - rect.top });
            } catch {}
            return event;
          }

          function dispatch(target, type, x, y, rect, buttons) {
            const init = {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: x,
              clientY: y,
              screenX: x,
              screenY: y,
              pageX: x + window.scrollX,
              pageY: y + window.scrollY,
              button: 0,
              buttons: buttons || 0,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true
            };
            try {
              target.dispatchEvent(applyOffsets(new PointerEvent(type, init), x, y, rect));
            } catch {
              target.dispatchEvent(applyOffsets(new MouseEvent(type, init), x, y, rect));
            }
          }

          window.__salesWallpaperPointer = (x, y, leftDown) => {
            const dpr = window.devicePixelRatio || 1;
            const cssX = x / dpr;
            const cssY = y / dpr;
            const target = activeTarget || targetAt(cssX, cssY);
            if (!target) return false;
            const rect = target.getBoundingClientRect();
            if (!(activeTarget && lastDown) && (cssX < rect.left || cssY < rect.top || cssX > rect.right || cssY > rect.bottom)) {
              if (!lastDown) {
                activeTarget = null;
              }
              window.__salesWallpaperPointerLeave();
              return false;
            }
            const buttons = leftDown ? 1 : 0;
            if (leftDown && !lastDown) {
              activeTarget = targetAt(cssX, cssY) || target;
              const activeRect = activeTarget.getBoundingClientRect();
              dispatch(activeTarget, 'pointerdown', cssX, cssY, activeRect, 1);
              dispatch(activeTarget, 'mousedown', cssX, cssY, activeRect, 1);
            }
            dispatch(activeTarget || target, 'pointermove', cssX, cssY, rect, buttons);
            dispatch(activeTarget || target, 'mousemove', cssX, cssY, rect, buttons);
            if (!leftDown && lastDown) {
              const upTarget = activeTarget || target;
              const upRect = upTarget.getBoundingClientRect();
              dispatch(upTarget, 'pointerup', cssX, cssY, upRect, 0);
              dispatch(upTarget, 'mouseup', cssX, cssY, upRect, 0);
              dispatch(upTarget, 'click', cssX, cssY, upRect, 0);
              activeTarget = null;
            }
            lastDown = leftDown;
            return true;
          };

          window.__salesWallpaperPointerLeave = () => {
            const target = canvas();
            if (!target) return false;
            const rect = target.getBoundingClientRect();
            if (lastDown && activeTarget) {
              dispatch(activeTarget, 'pointerup', -1, -1, activeTarget.getBoundingClientRect(), 0);
              dispatch(activeTarget, 'mouseup', -1, -1, activeTarget.getBoundingClientRect(), 0);
            }
            activeTarget = null;
            lastDown = false;
            dispatch(target, 'pointerleave', -1, -1, rect, 0);
            dispatch(target, 'mouseleave', -1, -1, rect, 0);
            return true;
          };
        })();
        """;
}
