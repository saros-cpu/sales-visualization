using System.Globalization;
using System.Text.Json;
using System.Drawing;
using System.Windows.Forms;

namespace SalesWallpaperEngine;

internal sealed class RuntimeConfig
{
    private const string DefaultApiHost = "https://sales.example.com";

    public string ApiHost { get; init; } = DefaultApiHost;

    public string WallpaperToken { get; init; } = "";

    public string UpdateManifestUrl { get; init; } = "";

    public bool AutoUpdateEnabled { get; init; } = false;

    public bool AutoInstallUpdates { get; init; } = false;

    public int ReattachSeconds { get; init; } = 10;

    public int RefreshSeconds { get; init; } = 86400;

    public string Language { get; init; } = "zh";

    public string RefreshAtLocalTime { get; init; } = "09:00";

    public int PlayerStartupTimeoutSeconds { get; init; } = 15;

    public bool ShowSalesSummary { get; init; } = true;

    public bool ShowExchangeRates { get; init; } = true;

    public bool ShowYearVolume { get; init; } = true;

    public bool ShowYearTons { get; init; } = true;

    public bool ShowYearAmount { get; init; } = true;

    public bool ShowMonthVolume { get; init; } = true;

    public bool ShowMonthTons { get; init; } = true;

    public bool ShowMonthAmount { get; init; } = true;

    public bool ShowUsdKgs { get; init; } = true;

    public bool ShowCnyKgs { get; init; } = true;

    public bool ShowInventoryAlerts { get; init; } = true;

    public bool ShowActiveStations { get; init; } = true;

    public bool ShowClosedStations { get; init; } = true;

    public bool ShowDepotMarkers { get; init; } = true;

    public bool ShowInventoryAlertOnly { get; init; } = false;

    public string LanguageMode { get; init; } = "auto";

    public double MapCenterX { get; init; } = -1.16;

    public double MapCenterY { get; init; } = -0.45;

    public double MapCenterZ { get; init; } = 2.48;

    public double HudTopScale { get; init; } = 1.0;

    public double HudTopOffsetX { get; init; } = 0;

    public double HudTopOffsetY { get; init; } = 0;

    public double HudSalesScale { get; init; } = 1.0;

    public double HudSalesOffsetX { get; init; } = 0;

    public double HudSalesOffsetY { get; init; } = 0;

    public string KeySource { get; init; } = "";

    public bool HasWallpaperToken => !string.IsNullOrWhiteSpace(WallpaperToken);

    public static RuntimeConfig Load()
    {
        var fileConfig = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        MergeJson(fileConfig, Path.Combine(AppContext.BaseDirectory, "app-config.example.json"));
        MergeJson(fileConfig, AppPaths.AppConfigPath);
        MergeJson(fileConfig, AppPaths.UserConfigPath);
        var keySource = MergeJson(fileConfig, AppPaths.AppKeyPath);
        keySource = ProtectedWallpaperKey.MergeJson(fileConfig, AppPaths.AppProtectedKeyPath) ?? keySource;
        keySource = ProtectedWallpaperKey.MergeJson(fileConfig, AppPaths.UserProtectedKeyPath) ?? keySource;
        keySource = MergeJson(fileConfig, AppPaths.UserKeyPath) ?? keySource;

        var language = ResolveLanguage();

        var languageMode = (ReadString(fileConfig, "language") ?? "auto").Trim().ToLowerInvariant();
        if (languageMode is not ("auto" or "zh" or "ru")) languageMode = "auto";

        var envApiHost = Environment.GetEnvironmentVariable("SALES_API_HOST");
        var apiHost = string.IsNullOrWhiteSpace(envApiHost)
            ? UpgradeLegacyPublicUrl(ReadString(fileConfig, "apiHost") ?? DefaultApiHost)
            : NormalizeHost(envApiHost);

        var envUpdateManifestUrl = Environment.GetEnvironmentVariable("SALES_WALLPAPER_ENGINE_UPDATE_MANIFEST");
        var updateManifestUrl = string.IsNullOrWhiteSpace(envUpdateManifestUrl)
            ? UpgradeLegacyPublicUrl(ReadString(fileConfig, "updateManifestUrl") ?? $"{apiHost}/download/wallpaper-engine/latest.json")
            : NormalizeHost(envUpdateManifestUrl);

        return new RuntimeConfig
        {
            Language = language,
            LanguageMode = languageMode,
            MapCenterX = ReadDouble(fileConfig, "mapCenterX") ?? -1.16,
            MapCenterY = ReadDouble(fileConfig, "mapCenterY") ?? -0.45,
            MapCenterZ = ReadDouble(fileConfig, "mapCenterZ") ?? 2.48,
            HudTopScale = ReadDouble(fileConfig, "hudTopScale") ?? 1.0,
            HudTopOffsetX = ReadDouble(fileConfig, "hudTopOffsetX") ?? 0,
            HudTopOffsetY = ReadDouble(fileConfig, "hudTopOffsetY") ?? 0,
            HudSalesScale = ReadDouble(fileConfig, "hudSalesScale") ?? 1.0,
            HudSalesOffsetX = ReadDouble(fileConfig, "hudSalesOffsetX") ?? 0,
            HudSalesOffsetY = ReadDouble(fileConfig, "hudSalesOffsetY") ?? 0,
            ApiHost = apiHost,
            WallpaperToken = (Environment.GetEnvironmentVariable("SALES_WALLPAPER_TOKEN") ?? ReadString(fileConfig, "wallpaperToken") ?? "").Trim(),
            UpdateManifestUrl = updateManifestUrl,
            AutoUpdateEnabled = ReadBool(fileConfig, "autoUpdateEnabled") ?? true,
            AutoInstallUpdates = ReadBool(fileConfig, "autoInstallUpdates") ?? true,
            ReattachSeconds = Math.Clamp(ReadInt(fileConfig, "reattachSeconds") ?? 10, 5, 120),
            RefreshSeconds = Math.Clamp(
                ReadIntFromEnv("SALES_WALLPAPER_REFRESH_SECONDS")
                ?? ReadInt(fileConfig, "refreshSeconds")
                ?? 86400,
                300,
                86400),
            RefreshAtLocalTime = NormalizeRefreshTime(
                Environment.GetEnvironmentVariable("SALES_WALLPAPER_REFRESH_AT")
                ?? ReadString(fileConfig, "refreshAtLocalTime")
                ?? "09:00"),
            PlayerStartupTimeoutSeconds = Math.Clamp(ReadInt(fileConfig, "playerStartupTimeoutSeconds") ?? 15, 5, 60),
            ShowSalesSummary = ReadBool(fileConfig, "showSalesSummary") ?? true,
            ShowExchangeRates = ReadBool(fileConfig, "showExchangeRates") ?? true,
            ShowYearVolume = ReadBool(fileConfig, "showYearVolume") ?? true,
            ShowYearTons = ReadBool(fileConfig, "showYearTons") ?? true,
            ShowYearAmount = ReadBool(fileConfig, "showYearAmount") ?? true,
            ShowMonthVolume = ReadBool(fileConfig, "showMonthVolume") ?? true,
            ShowMonthTons = ReadBool(fileConfig, "showMonthTons") ?? true,
            ShowMonthAmount = ReadBool(fileConfig, "showMonthAmount") ?? true,
            ShowUsdKgs = ReadBool(fileConfig, "showUsdKgs") ?? true,
            ShowCnyKgs = ReadBool(fileConfig, "showCnyKgs") ?? true,
            ShowInventoryAlerts = ReadBool(fileConfig, "showInventoryAlerts") ?? true,
            ShowActiveStations = ReadBool(fileConfig, "showActiveStations") ?? true,
            ShowClosedStations = ReadBool(fileConfig, "showClosedStations") ?? true,
            ShowDepotMarkers = ReadBool(fileConfig, "showDepotMarkers") ?? true,
            ShowInventoryAlertOnly = ReadBool(fileConfig, "showInventoryAlertOnly") ?? false,
            KeySource = keySource ?? "",
        };
    }

    public string BuildClientConfigScript(int port, IReadOnlyDictionary<string, double?>? hudOverrides = null, string localApiNonce = "")
    {
        var localOrigin = $"http://127.0.0.1:{port}";
        var keyState = HasWallpaperToken ? "loaded" : "missing";
        var keyMessage = HasWallpaperToken
            ? "SalesWallpaperEngine proxy token loaded"
            : "wallpaper-key.json not configured";
        var keySource = HasWallpaperToken
            ? (string.IsNullOrWhiteSpace(KeySource) ? "app-config.json" : Path.GetFileName(KeySource))
            : "wallpaper-key.json / wallpaper-key.protected.json";

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
            localApiNonce,
            allowedHosts = new[] { "127.0.0.1", "localhost" },
            safeArea = ResolveDesktopSafeArea(),
            wallpaper = new
            {
                packageId = "kg.example.sales.wallpaper.engine",
                packageVersion = AppVersion.Current,
                updateManifestUrl = $"{localOrigin}/download/wallpaper-engine/latest.json",
                language = LanguageMode,
                refreshSeconds = RefreshSeconds,
                refreshAtLocalTime = RefreshAtLocalTime,
                vpnApiHost = "",
                map = new
                {
                    fitCenterX = MapCenterX,
                    fitCenterY = MapCenterY,
                    fitCenterZ = MapCenterZ,
                },
                hud = new
                {
                    showSalesSummary = ShowSalesSummary,
                    showExchangeRates = ShowExchangeRates,
                    showYearVolume = ShowYearVolume,
                    showYearTons = ShowYearTons,
                    showYearAmount = ShowYearAmount,
                    showMonthVolume = ShowMonthVolume,
                    showMonthTons = ShowMonthTons,
                    showMonthAmount = ShowMonthAmount,
                    showUsdKgs = ShowUsdKgs,
                    showCnyKgs = ShowCnyKgs,
                    showInventoryAlerts = ShowInventoryAlerts,
                    showActiveStations = ShowActiveStations,
                    showClosedStations = ShowClosedStations,
                    showDepotMarkers = ShowDepotMarkers,
                    showInventoryAlertOnly = ShowInventoryAlertOnly,
                    hudTopScale = hudOverrides != null && hudOverrides.TryGetValue("hudTopScale", out var topScale) && topScale.HasValue ? topScale.Value : HudTopScale,
                    hudTopOffsetX = hudOverrides != null && hudOverrides.TryGetValue("hudTopOffsetX", out var topOffsetX) && topOffsetX.HasValue ? topOffsetX.Value : HudTopOffsetX,
                    hudTopOffsetY = hudOverrides != null && hudOverrides.TryGetValue("hudTopOffsetY", out var topOffsetY) && topOffsetY.HasValue ? topOffsetY.Value : HudTopOffsetY,
                    hudSalesScale = hudOverrides != null && hudOverrides.TryGetValue("hudSalesScale", out var salesScale) && salesScale.HasValue ? salesScale.Value : HudSalesScale,
                    hudSalesOffsetX = hudOverrides != null && hudOverrides.TryGetValue("hudSalesOffsetX", out var salesOffsetX) && salesOffsetX.HasValue ? salesOffsetX.Value : HudSalesOffsetX,
                    hudSalesOffsetY = hudOverrides != null && hudOverrides.TryGetValue("hudSalesOffsetY", out var salesOffsetY) && salesOffsetY.HasValue ? salesOffsetY.Value : HudSalesOffsetY,
                },
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

    private static double? ReadDouble(Dictionary<string, JsonElement> config, string key)
    {
        if (!config.TryGetValue(key, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static int? ReadIntFromEnv(string key) =>
        int.TryParse(Environment.GetEnvironmentVariable(key), out var parsed) ? parsed : null;

    private static string ResolveLanguage()
    {
        try
        {
            var culture = CultureInfo.CurrentUICulture;
            var name = culture.TwoLetterISOLanguageName;
            if (name.Equals("ru", StringComparison.OrdinalIgnoreCase)) return "ru";
            return "zh";
        }
        catch
        {
            return "zh";
        }
    }

    private static string NormalizeHost(string value) => value.Trim().TrimEnd('/');

    internal static string UpgradeLegacyPublicUrl(string value)
    {
        var normalized = NormalizeHost(value);
        if (!Uri.TryCreate(normalized, UriKind.Absolute, out var uri)) return normalized;
        if (!uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            || !(uri.Host.Equals("sales.example.com", StringComparison.OrdinalIgnoreCase)
                || uri.Host.Equals("198.51.100.10", StringComparison.OrdinalIgnoreCase)))
        {
            return normalized;
        }
        var builder = new UriBuilder(uri)
        {
            Scheme = Uri.UriSchemeHttps,
            Host = "sales.example.com",
            Port = -1,
        };
        return NormalizeHost(builder.Uri.ToString());
    }

    private static string NormalizeRefreshTime(string value)
    {
        var text = value.Trim();
        if (string.IsNullOrWhiteSpace(text)) return "";
        var parts = text.Split(':', 2);
        if (parts.Length != 2) return "09:00";
        if (!int.TryParse(parts[0], out var hour) || !int.TryParse(parts[1], out var minute))
        {
            return "09:00";
        }
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "09:00";
        return $"{hour:00}:{minute:00}";
    }

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
