namespace SalesWallpaperEngine;

internal static class AppPaths
{
    public static string DataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "sales-wallpaper-engine");

    public static string LogDir { get; } = Path.Combine(DataDir, "logs");

    public static string WebViewUserDataDir { get; } = Path.Combine(DataDir, "webview2");

    public static string UserConfigPath { get; } = Path.Combine(DataDir, "app-config.json");

    public static string AppConfigPath { get; } = Path.Combine(AppContext.BaseDirectory, "app-config.json");

    public static string UserKeyPath { get; } = Path.Combine(DataDir, "wallpaper-key.json");

    public static string UserProtectedKeyPath { get; } = Path.Combine(DataDir, "wallpaper-key.protected.json");

    public static string AppKeyPath { get; } = Path.Combine(AppContext.BaseDirectory, "wallpaper-key.json");

    public static string AppProtectedKeyPath { get; } = Path.Combine(AppContext.BaseDirectory, "wallpaper-key.protected.json");
}
