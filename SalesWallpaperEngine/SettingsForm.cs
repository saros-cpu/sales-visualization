using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SalesWallpaperEngine;

internal sealed class SettingsForm : Form
{
    private readonly StaticFileServer _server;
    private readonly WebView2 _webView = new();

    public SettingsForm(StaticFileServer server)
    {
        _server = server;

        Text = "壁纸设置";
        Name = "SalesWallpaperEngineSettings";
        ShowInTaskbar = true;
        FormBorderStyle = FormBorderStyle.Sizable;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(680, 560);
        ClientSize = new Size(820, 720);
        BackColor = Color.FromArgb(8, 18, 32);

        _webView.Dock = DockStyle.Fill;
        Controls.Add(_webView);
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
            var userDataDir = Path.Combine(AppPaths.DataDir, "webview-settings");
            Directory.CreateDirectory(userDataDir);
            var options = new CoreWebView2EnvironmentOptions(
                "--disable-features=msSmartScreenProtection --autoplay-policy=no-user-gesture-required");
            var environment = await CoreWebView2Environment.CreateAsync(null, userDataDir, options);
            await _webView.EnsureCoreWebView2Async(environment);

            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _webView.CoreWebView2.ProcessFailed += (_, args) =>
            {
                AppLogger.Warn($"settings webview process failed kind={args.ProcessFailedKind} reason={args.Reason}");
            };
            _webView.Source = new Uri($"{_server.BaseUrl}/settings.html");
            AppLogger.Info("settings window opened");
        }
        catch (Exception ex)
        {
            AppLogger.Error("settings webview init failed", ex);
            Close();
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _webView.Dispose();
        base.OnFormClosed(e);
    }
}
