namespace SalesWallpaperEngine;

internal static class AppLogger
{
    public static void Info(string message) => Write("info", message);

    public static void Warn(string message) => Write("warn", message);

    public static void Error(string message, Exception? error = null) =>
        Write("error", error == null ? message : $"{message}: {error}");

    private static void Write(string level, string message)
    {
        try
        {
            Directory.CreateDirectory(AppPaths.LogDir);
            var line = $"[{DateTimeOffset.Now:O}] [{level}] {message}{Environment.NewLine}";
            File.AppendAllText(Path.Combine(AppPaths.LogDir, "engine.log"), line);
        }
        catch
        {
            // Logging must not make the desktop shell unstable.
        }
    }
}
