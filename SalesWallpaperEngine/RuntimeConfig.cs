using System.Text.Json;
using System.Drawing;
using System.Windows.Forms;

namespace SalesWallpaperEngine;

internal sealed class RuntimeConfig
{
    private const string DefaultApiHost = "http://198.51.100.10";

    public string ApiHost { get; init; } = DefaultApiHost;

    public string WallpaperToken { get; init; } = "";

    public string UpdateManifestUrl { get; init; } = "";

    public bool AutoUpdateEnabled { get; init; } = false;

    public bool AutoInstallUpdates { get; init; } = false;

    public int ReattachSeconds { get; init; } = 10;

    public int PlayerStartupTimeoutSeconds { get; init; } = 15;

    public string KeySource { get; init; } = "";

    public bool HasWallpaperToken => !string.IsNullOrWhiteSpace(WallpaperToken);

    public static RuntimeConfig Load()
    {
        var fileConfig = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        MergeJson(fileConfig, Path.Combine(AppContext.BaseDirectory, "app-config.example.json"));
        MergeJson(fileConfig, AppPaths.AppConfigPath);
        MergeJson(fileConfig, AppPaths.UserConfigPath);
        var keySource = MergeJson(fileConfig, AppPaths.AppKeyPath);
        keySource = MergeJson(fileConfig, AppPaths.UserKeyPath) ?? keySource;

        var apiHost = NormalizeHost(
            Environment.GetEnvironmentVariable("SALES_API_HOST")
            ?? ReadString(fileConfig, "apiHost")
            ?? DefaultApiHost);

        return new RuntimeConfig
        {
            ApiHost = apiHost,
            WallpaperToken = (Environment.GetEnvironmentVariable("SALES_WALLPAPER_TOKEN") ?? ReadString(fileConfig, "wallpaperToken") ?? "").Trim(),
            UpdateManifestUrl = NormalizeHost(Environment.GetEnvironmentVariable("SALES_WALLPAPER_ENGINE_UPDATE_MANIFEST") ?? ReadString(fileConfig, "updateManifestUrl") ?? $"{apiHost}/download/wallpaper-engine/latest.json"),
            AutoUpdateEnabled = ReadBool(fileConfig, "autoUpdateEnabled") ?? true,
            AutoInstallUpdates = ReadBool(fileConfig, "autoInstallUpdates") ?? false,
            ReattachSeconds = Math.Clamp(ReadInt(fileConfig, "reattachSeconds") ?? 10, 5, 120),
            PlayerStartupTimeoutSeconds = Math.Clamp(ReadInt(fileConfig, "playerStartupTimeoutSeconds") ?? 15, 5, 60),
            KeySource = keySource ?? "",
        };
    }

    public string BuildClientConfigScript(int port)
    {
        var localOrigin = $"http://127.0.0.1:{port}";
        var keyState = HasWallpaperToken ? "loaded" : "missing";
        var keyMessage = HasWallpaperToken
            ? "SalesWallpaperEngine proxy token loaded"
            : "wallpaper-key.json not configured";
        var keySource = HasWallpaperToken
            ? (string.IsNullOrWhiteSpace(KeySource) ? "app-config.json" : Path.GetFileName(KeySource))
            : "wallpaper-key.json";

        var keyStatus = new Dictionary<string, object?>
        {
            ["state"] = keyState,
            ["message"] = keyMessage,
            ["source"] = keySource,
            ["apiHost"] = ApiHost,
            ["loadedAt"] = DateTimeOffset.Now.ToString("O"),
        };
        if (HasWallpaperToken)
        {
            keyStatus["tokenLength"] = WallpaperToken.Length;
            keyStatus["tokenFingerprint"] = TokenFingerprint(WallpaperToken);
        }

        var runtimeConfig = new
        {
            apiHost = localOrigin,
            wallpaperToken = "",
            allowedHosts = new[] { "127.0.0.1", "localhost" },
            safeArea = ResolveDesktopSafeArea(),
            lively = new
            {
                packageId = "kg.example.sales.wallpaper.engine",
                packageVersion = AppVersion.Current,
                updateManifestUrl = $"{localOrigin}/download/wallpaper-engine/latest.json",
                refreshSeconds = 1800,
                vpnApiHost = "",
            },
        };

        var runtimeJson = JsonSerializer.Serialize(runtimeConfig);
        var statusJson = JsonSerializer.Serialize(keyStatus);
        return $$"""
            (function () {
              const config = {{runtimeJson}};
              Object.defineProperty(window, "__SALES_API_HOST__", {
                value: config.apiHost,
                configurable: true
              });
              window.SALES_RUNTIME_CONFIG = config;
              window.SALES_WALLPAPER_KEY_STATUS = {{statusJson}};
              window.SALES_WALLPAPER_KEY_READY = Promise.resolve();
              window.wallpaperAPI = {
                setInteractive: () => Promise.resolve(true),
                reload: () => {
                  window.dispatchEvent(new Event("sales-wallpaper-refresh"));
                  return Promise.resolve(true);
                },
                ready: () => Promise.resolve(true)
              };
            })();
            """;
    }

    private static string TokenFingerprint(string token)
    {
        unchecked
        {
            uint hash = 2166136261;
            foreach (var ch in token.Trim())
            {
                hash ^= ch;
                hash *= 16777619;
            }
            return hash.ToString("x8");
        }
    }

    private static string? MergeJson(Dictionary<string, JsonElement> target, string filePath)
    {
        try
        {
            if (!File.Exists(filePath)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(filePath));
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                target[prop.Name] = prop.Value.Clone();
            }
            return filePath;
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"failed to read config {filePath}: {ex.Message}");
            return null;
        }
    }

    private static string? ReadString(Dictionary<string, JsonElement> config, string key) =>
        config.TryGetValue(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool? ReadBool(Dictionary<string, JsonElement> config, string key)
    {
        if (!config.TryGetValue(key, out var value)) return null;
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        return value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed) ? parsed : null;
    }

    private static int? ReadInt(Dictionary<string, JsonElement> config, string key)
    {
        if (!config.TryGetValue(key, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed) ? parsed : null;
    }

    private static string NormalizeHost(string value) => value.Trim().TrimEnd('/');

    private static object ResolveDesktopSafeArea()
    {
        try
        {
            var screens = Screen.AllScreens;
            return new
            {
                left = screens.Max(screen => Math.Max(0, screen.WorkingArea.Left - screen.Bounds.Left)),
                top = screens.Max(screen => Math.Max(0, screen.WorkingArea.Top - screen.Bounds.Top)),
                right = screens.Max(screen => Math.Max(0, screen.Bounds.Right - screen.WorkingArea.Right)),
                bottom = screens.Max(screen => Math.Max(0, screen.Bounds.Bottom - screen.WorkingArea.Bottom)),
            };
        }
        catch
        {
            return new { left = 0, top = 0, right = 0, bottom = 0 };
        }
    }
}
