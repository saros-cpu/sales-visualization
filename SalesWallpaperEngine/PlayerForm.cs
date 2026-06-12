using System.Drawing;
using System.Windows.Forms;
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
    private bool _pointerScriptBusy;

    public PlayerForm(string url, string userDataDir)
    {
        _url = url;
        _userDataDir = userDataDir;

        Text = "SalesWallpaperEnginePlayer";
        Name = "SalesWallpaperEnginePlayer";
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(-32000, -32000, 1280, 720);
        BackColor = Color.Black;

        _webView.Dock = DockStyle.Fill;
        Controls.Add(_webView);
        _pointerTimer.Tick += ForwardPointerTick;
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
            var environment = await CoreWebView2Environment.CreateAsync(null, _userDataDir, options);
            await _webView.EnsureCoreWebView2Async(environment);

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
            };
            _webView.Source = new Uri(_url);
            AppLogger.Info($"player loaded {_url}");
        }
        catch (Exception ex)
        {
            AppLogger.Error("webview init failed", ex);
            Close();
        }
    }

    private async void ForwardPointerTick(object? sender, EventArgs e)
    {
        if (_pointerScriptBusy || _webView.CoreWebView2 == null || _webView.IsDisposed) return;

        var point = _webView.PointToClient(Cursor.Position);
        var inside = _webView.ClientRectangle.Contains(point);
        if (inside == _lastPointerInside && point == _lastPointer) return;

        _lastPointer = point;
        _lastPointerInside = inside;
        _pointerScriptBusy = true;
        try
        {
            var script = inside
                ? $"window.__salesWallpaperPointerMove && window.__salesWallpaperPointerMove({point.X}, {point.Y});"
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

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _pointerTimer.Stop();
        _pointerTimer.Dispose();
        _webView.Dispose();
        base.OnFormClosed(e);
    }

    private const string SyntheticPointerScript = """
        (() => {
          if (window.__salesWallpaperPointerMove) return;

          function canvas() {
            return document.querySelector('.kgz-map-canvas canvas') || document.querySelector('canvas');
          }

          function applyOffsets(event, x, y, rect) {
            try {
              Object.defineProperty(event, 'offsetX', { get: () => x - rect.left });
              Object.defineProperty(event, 'offsetY', { get: () => y - rect.top });
            } catch {}
            return event;
          }

          function dispatch(target, type, x, y, rect) {
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
              buttons: 0,
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

          window.__salesWallpaperPointerMove = (x, y) => {
            const target = canvas();
            if (!target) return false;
            const rect = target.getBoundingClientRect();
            if (x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) {
              window.__salesWallpaperPointerLeave();
              return false;
            }
            dispatch(target, 'pointermove', x, y, rect);
            dispatch(target, 'mousemove', x, y, rect);
            return true;
          };

          window.__salesWallpaperPointerLeave = () => {
            const target = canvas();
            if (!target) return false;
            const rect = target.getBoundingClientRect();
            dispatch(target, 'pointerleave', -1, -1, rect);
            dispatch(target, 'mouseleave', -1, -1, rect);
            return true;
          };
        })();
        """;
}
