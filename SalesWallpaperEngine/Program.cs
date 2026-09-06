using System.Security.Principal;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;

namespace SalesWallpaperEngine;

internal static class Program
{
    private static Mutex? _mutex;

        [STAThread]
        private static void Main(string[] args)
        {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (sender, e) =>
            {
                AppLogger.Error("unhandled UI exception", e.Exception);
                MessageBox.Show($"程序发生未处理错误：\n{e.Exception.Message}", "Sales Wallpaper Engine", MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
            {
                if (e.ExceptionObject is Exception ex)
                    AppLogger.Error("unhandled non-UI exception", ex);
            };

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (args.Any(arg => arg.Equals("--player", StringComparison.OrdinalIgnoreCase)))
        {
            RunPlayer(args);
            return;
        }

        var mutexName = $"SalesWallpaperEngine-{WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName}";
        _mutex = new Mutex(true, mutexName, out var createdNew);
        if (!createdNew)
        {
            MessageBox.Show("Sales Wallpaper Engine 已在运行。", "Sales Wallpaper Engine", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        Directory.CreateDirectory(AppPaths.DataDir);
        Directory.CreateDirectory(AppPaths.LogDir);
        AppLogger.Info($"engine start version={AppVersion.Current}");
        Application.Run(new EngineApplicationContext());
        _mutex.ReleaseMutex();
        _mutex.Dispose();
    }

    private static void RunPlayer(string[] args)
    {
        var url = ReadArg(args, "--url") ?? "about:blank";
        var userDataDir = ReadArg(args, "--user-data-dir") ?? AppPaths.WebViewUserDataDir;
        AppLogger.Info($"player start url={url}");
        Application.Run(new PlayerForm(url, userDataDir));
    }

    private static string? ReadArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        }
        return null;
    }
}
