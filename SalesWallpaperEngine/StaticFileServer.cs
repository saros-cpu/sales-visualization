using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Globalization;

namespace SalesWallpaperEngine;

internal sealed class StaticFileServer : IDisposable
{
    private RuntimeConfig _config;
    private readonly object _configLock = new();
    private readonly Dictionary<string, double?> _previewOverrides = new(StringComparer.OrdinalIgnoreCase);
    private readonly string _rootDir;
    private readonly string _localApiNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly HttpClient _httpClient = new();
    private readonly CancellationTokenSource _cts = new();
    private HttpListener? _listener;

    private static readonly HashSet<string> SettingsWhitelist = new(StringComparer.OrdinalIgnoreCase)
    {
        "language",
        "refreshAtLocalTime",
        "refreshSeconds",
        "autoUpdateEnabled",
        "autoInstallUpdates",
        "showSalesSummary",
        "showExchangeRates",
        "showYearVolume",
        "showYearTons",
        "showYearAmount",
        "showMonthVolume",
        "showMonthTons",
        "showMonthAmount",
        "showUsdKgs",
        "showCnyKgs",
        "showInventoryAlerts",
        "showActiveStations",
        "showClosedStations",
        "showDepotMarkers",
        "showInventoryAlertOnly",
        "mapCenterX",
        "mapCenterY",
        "mapCenterZ",
        "hudTopScale",
        "hudTopOffsetX",
        "hudTopOffsetY",
        "hudSalesScale",
        "hudSalesOffsetX",
        "hudSalesOffsetY",
    };

    private static readonly HashSet<string> HudLayoutKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "hudTopScale",
        "hudTopOffsetX",
        "hudTopOffsetY",
        "hudSalesScale",
        "hudSalesOffsetX",
        "hudSalesOffsetY",
    };

    public StaticFileServer(RuntimeConfig config)
    {
        _config = config;
        _rootDir = ResolveRootDir();
    }

    public int Port { get; private set; }

    public string BaseUrl => $"http://127.0.0.1:{Port}";

    public RuntimeConfig Config
    {
        get
        {
            lock (_configLock) return _config;
        }
    }

    public bool EditMode
    {
        get
        {
            lock (_configLock) return _editMode;
        }
    }

    private bool _editMode;

    public event Func<Dictionary<string, object?>, Task>? OnSettingsSave;

    public event Func<bool, bool, Task>? OnEditModeChange;

    public event Func<Task>? OnPreviewCommit;

    public event Action? OnRefreshRequested;

    public event Action? OnCheckUpdateRequested;

    public void UpdateConfig(RuntimeConfig config)
    {
        lock (_configLock)
        {
            _config = config;
        }
    }

    public void SetEditMode(bool on)
    {
        lock (_configLock)
        {
            _editMode = on;
        }
    }

    public void ClearPreview()
    {
        lock (_configLock)
        {
            _previewOverrides.Clear();
        }
    }

    public Dictionary<string, object?> GetPreviewSettings()
    {
        lock (_configLock)
        {
            return _previewOverrides
                .Where(item => item.Value.HasValue)
                .ToDictionary(
                    item => item.Key,
                    item => (object?)item.Value!.Value,
                    StringComparer.OrdinalIgnoreCase);
        }
    }

    public void Start()
    {
        Directory.CreateDirectory(AppPaths.DataDir);
        Port = FindFreePort();
        _listener = new HttpListener();
        _listener.Prefixes.Add($"{BaseUrl}/");
        _listener.Start();
        _ = Task.Run(ListenLoop);
        AppLogger.Info($"static server started {BaseUrl} root={_rootDir}");
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener?.Stop(); } catch {}
        try { _listener?.Close(); } catch {}
        _httpClient.Dispose();
        _cts.Dispose();
    }

    private async Task ListenLoop()
    {
        while (!_cts.IsCancellationRequested && _listener?.IsListening == true)
        {
            try
            {
                var context = await _listener.GetContextAsync();
                _ = Task.Run(() => HandleContext(context));
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (HttpListenerException)
            {
                return;
            }
            catch (Exception ex)
            {
                AppLogger.Error("static server loop failed", ex);
            }
        }
    }

    private async Task HandleContext(HttpListenerContext context)
    {
        try
        {
            var path = context.Request.Url?.AbsolutePath ?? "/";
            if (!IPAddress.IsLoopback(context.Request.RemoteEndPoint.Address))
            {
                await WriteText(context.Response, "forbidden", "text/plain", 403);
                return;
            }
            if (!await AuthorizeLocalMutation(context, path))
            {
                return;
            }

            if (path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Redirect("/wallpaper.html");
                context.Response.Close();
                return;
            }

            if (path.Equals("/config.js", StringComparison.OrdinalIgnoreCase))
            {
                RuntimeConfig config;
                Dictionary<string, double?> preview;
                lock (_configLock)
                {
                    config = _config;
                    preview = new Dictionary<string, double?>(_previewOverrides, StringComparer.OrdinalIgnoreCase);
                }
                await WriteText(context.Response, config.BuildClientConfigScript(Port, preview, _localApiNonce), "application/javascript; charset=utf-8");
                return;
            }

            if (path.Equals("/api/wallpaper/settings", StringComparison.OrdinalIgnoreCase))
            {
                if (context.Request.HttpMethod.Equals("GET", StringComparison.OrdinalIgnoreCase))
                {
                    await WriteJson(context.Response, BuildSettingsSnapshot());
                    return;
                }
                if (context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
                {
                    await HandleSettingsSave(context);
                    return;
                }
                else
                {
                    await WriteText(context.Response, "method not allowed", "text/plain", 405);
                    return;
                }
            }

            if (path.Equals("/api/wallpaper/settings/preview", StringComparison.OrdinalIgnoreCase))
            {
                await HandleSettingsPreview(context);
                return;
            }

            if (path.Equals("/api/wallpaper/settings/preview/commit", StringComparison.OrdinalIgnoreCase))
            {
                await HandleSettingsPreviewCommit(context);
                return;
            }

            if (path.Equals("/api/wallpaper/edit-mode", StringComparison.OrdinalIgnoreCase))
            {
                await HandleEditMode(context);
                return;
            }

            if (path.Equals("/api/wallpaper/refresh", StringComparison.OrdinalIgnoreCase))
            {
                if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
                {
                    await WriteText(context.Response, "method not allowed", "text/plain", 405);
                    return;
                }
                OnRefreshRequested?.Invoke();
                await WriteJson(context.Response, new { ok = true });
                return;
            }

            if (path.Equals("/api/wallpaper/check-update", StringComparison.OrdinalIgnoreCase))
            {
                if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
                {
                    await WriteText(context.Response, "method not allowed", "text/plain", 405);
                    return;
                }
                OnCheckUpdateRequested?.Invoke();
                await WriteJson(context.Response, new { ok = true });
                return;
            }

            if (path.Equals("/api/wallpaper/map", StringComparison.OrdinalIgnoreCase))
            {
                await ProxyWallpaperMap(context);
                return;
            }

            if (path.Equals("/download/wallpaper-engine/latest.json", StringComparison.OrdinalIgnoreCase))
            {
                await ProxyLatestManifest(context);
                return;
            }

            await ServeStatic(context, path);
        }
        catch (Exception ex)
        {
            AppLogger.Error("request failed", ex);
            if (context.Response.OutputStream.CanWrite)
            {
                await WriteText(context.Response, "internal server error", "text/plain", 500);
            }
        }
    }

    private async Task ProxyWallpaperMap(HttpListenerContext context)
    {
        var config = Config;
        var target = BuildProxyUri($"{config.ApiHost}/api/wallpaper/map", context.Request.Url?.Query ?? "");
        using var request = new HttpRequestMessage(HttpMethod.Get, target);
        if (config.HasWallpaperToken)
        {
            request.Headers.TryAddWithoutValidation("X-Wallpaper-Token", config.WallpaperToken);
        }

        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _cts.Token);
        await CopyProxyResponse(context.Response, response);
    }

    private async Task ProxyLatestManifest(HttpListenerContext context)
    {
        var config = Config;
        using var request = new HttpRequestMessage(HttpMethod.Get, AddCacheBust(config.UpdateManifestUrl));
        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _cts.Token);
        await CopyProxyResponse(context.Response, response);
    }

    private async Task<bool> AuthorizeLocalMutation(HttpListenerContext context, string path)
    {
        if (!IsLocalMutation(context.Request.HttpMethod, path)) return true;
        if (IsValidLocalApiNonce(context.Request.Headers["X-Sales-Wallpaper-Nonce"])) return true;
        await WriteText(context.Response, "forbidden", "text/plain", 403);
        return false;
    }

    private static bool IsLocalMutation(string method, string path)
    {
        if (!method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return false;
        return path.Equals("/api/wallpaper/settings", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/wallpaper/settings/preview", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/wallpaper/settings/preview/commit", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/wallpaper/edit-mode", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/wallpaper/refresh", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/wallpaper/check-update", StringComparison.OrdinalIgnoreCase);
    }

    private bool IsValidLocalApiNonce(string? provided)
    {
        if (string.IsNullOrWhiteSpace(provided)) return false;
        var expectedBytes = Encoding.UTF8.GetBytes(_localApiNonce);
        var actualBytes = Encoding.UTF8.GetBytes(provided.Trim());
        return expectedBytes.Length == actualBytes.Length
            && CryptographicOperations.FixedTimeEquals(actualBytes, expectedBytes);
    }

    private object BuildSettingsSnapshot()
    {
        lock (_configLock)
        {
            double HudValue(string key, double fallback) =>
                _previewOverrides.TryGetValue(key, out var value) && value.HasValue ? value.Value : fallback;

            return new
            {
                language = _config.LanguageMode,
                refreshAtLocalTime = _config.RefreshAtLocalTime,
                refreshSeconds = _config.RefreshSeconds,
                autoUpdateEnabled = _config.AutoUpdateEnabled,
                autoInstallUpdates = _config.AutoInstallUpdates,
                showSalesSummary = _config.ShowSalesSummary,
                showExchangeRates = _config.ShowExchangeRates,
                showYearVolume = _config.ShowYearVolume,
                showYearTons = _config.ShowYearTons,
                showYearAmount = _config.ShowYearAmount,
                showMonthVolume = _config.ShowMonthVolume,
                showMonthTons = _config.ShowMonthTons,
                showMonthAmount = _config.ShowMonthAmount,
                showUsdKgs = _config.ShowUsdKgs,
                showCnyKgs = _config.ShowCnyKgs,
                showInventoryAlerts = _config.ShowInventoryAlerts,
                showActiveStations = _config.ShowActiveStations,
                showClosedStations = _config.ShowClosedStations,
                showDepotMarkers = _config.ShowDepotMarkers,
                showInventoryAlertOnly = _config.ShowInventoryAlertOnly,
                mapCenterX = _config.MapCenterX,
                mapCenterY = _config.MapCenterY,
                mapCenterZ = _config.MapCenterZ,
                hudTopScale = HudValue("hudTopScale", _config.HudTopScale),
                hudTopOffsetX = HudValue("hudTopOffsetX", _config.HudTopOffsetX),
                hudTopOffsetY = HudValue("hudTopOffsetY", _config.HudTopOffsetY),
                hudSalesScale = HudValue("hudSalesScale", _config.HudSalesScale),
                hudSalesOffsetX = HudValue("hudSalesOffsetX", _config.HudSalesOffsetX),
                hudSalesOffsetY = HudValue("hudSalesOffsetY", _config.HudSalesOffsetY),
                editMode = _editMode,
                runtimeStatus = new
                {
                    version = AppVersion.Current,
                    apiHost = _config.ApiHost,
                    hasToken = _config.HasWallpaperToken,
                    keySource = string.IsNullOrWhiteSpace(_config.KeySource) ? "" : Path.GetFileName(_config.KeySource),
                    autoUpdateEnabled = _config.AutoUpdateEnabled,
                    autoInstallUpdates = _config.AutoInstallUpdates,
                    refreshAtLocalTime = _config.RefreshAtLocalTime,
                    refreshSeconds = _config.RefreshSeconds,
                    localPort = Port,
                    configDir = AppPaths.DataDir,
                    logDir = AppPaths.LogDir,
                },
            };
        }
    }

    private async Task HandleSettingsSave(HttpListenerContext context)
    {
        if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
        {
            await WriteText(context.Response, "method not allowed", "text/plain", 405);
            return;
        }
        var body = await ReadJsonBody(context);
        if (body == null) return;

        var filtered = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in body)
        {
            if (!SettingsWhitelist.Contains(key)) continue;
            var converted = ConvertSettingValue(key, value);
            if (converted.include)
            {
                filtered[key] = converted.value;
            }
        }

        if (OnSettingsSave != null)
        {
            await OnSettingsSave(filtered);
        }
        await WriteJson(context.Response, new { ok = true, saved = filtered.Count });
    }

    private async Task HandleSettingsPreview(HttpListenerContext context)
    {
        if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
        {
            await WriteText(context.Response, "method not allowed", "text/plain", 405);
            return;
        }
        var body = await ReadJsonBody(context);
        if (body == null) return;

        lock (_configLock)
        {
            foreach (var (key, value) in body)
            {
                if (!HudLayoutKeys.Contains(key)) continue;
                var number = ReadDouble(value);
                if (number.HasValue)
                {
                    _previewOverrides[key] = number.Value;
                }
            }
        }

        await WriteJson(context.Response, new { ok = true });
    }

    private async Task HandleSettingsPreviewCommit(HttpListenerContext context)
    {
        if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
        {
            await WriteText(context.Response, "method not allowed", "text/plain", 405);
            return;
        }

        var count = GetPreviewSettings().Count;
        if (OnPreviewCommit != null)
        {
            await OnPreviewCommit();
        }

        await WriteJson(context.Response, new { ok = true, saved = count });
    }

    private async Task HandleEditMode(HttpListenerContext context)
    {
        if (!context.Request.HttpMethod.Equals("POST", StringComparison.OrdinalIgnoreCase))
        {
            await WriteText(context.Response, "method not allowed", "text/plain", 405);
            return;
        }

        var body = await ReadJsonBody(context);
        if (body == null) return;

        var enabled = body.TryGetValue("enabled", out var enabledValue)
            && (ReadBool(enabledValue) ?? false);
        var clearPreview = body.TryGetValue("clearPreview", out var clearValue)
            && (ReadBool(clearValue) ?? false);

        if (OnEditModeChange != null)
        {
            await OnEditModeChange(enabled, clearPreview);
        }
        else
        {
            if (clearPreview) ClearPreview();
            SetEditMode(enabled);
        }

        await WriteJson(context.Response, new { ok = true, editMode = EditMode });
    }

    private async Task CopyProxyResponse(HttpListenerResponse localResponse, HttpResponseMessage upstream)
    {
        localResponse.StatusCode = (int)upstream.StatusCode;
        localResponse.ContentType = upstream.Content.Headers.ContentType?.ToString() ?? "application/json; charset=utf-8";
        localResponse.Headers["Cache-Control"] = "no-store";
        var bytes = await upstream.Content.ReadAsByteArrayAsync(_cts.Token);
        localResponse.ContentLength64 = bytes.Length;
        await localResponse.OutputStream.WriteAsync(bytes, _cts.Token);
        localResponse.Close();
    }

    private async Task ServeStatic(HttpListenerContext context, string path)
    {
        var relative = Uri.UnescapeDataString(path.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
        if (string.IsNullOrWhiteSpace(relative)) relative = "wallpaper.html";

        var filePath = Path.GetFullPath(Path.Combine(_rootDir, relative));
        var root = Path.GetFullPath(_rootDir);
        var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!filePath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(filePath))
        {
            await WriteText(context.Response, "not found", "text/plain", 404);
            return;
        }

        if (Path.GetFileName(filePath).Equals("wallpaper.html", StringComparison.OrdinalIgnoreCase))
        {
            var html = await File.ReadAllTextAsync(filePath, _cts.Token);
            if (!html.Contains("config.js", StringComparison.OrdinalIgnoreCase))
            {
                html = InjectConfigScript(html);
            }
            await WriteText(context.Response, html, "text/html; charset=utf-8");
            return;
        }

        var fileBytes = await File.ReadAllBytesAsync(filePath, _cts.Token);
        context.Response.ContentType = ResolveContentType(filePath);
        context.Response.Headers["Cache-Control"] = "no-store";
        context.Response.ContentLength64 = fileBytes.Length;
        await context.Response.OutputStream.WriteAsync(fileBytes, _cts.Token);
        context.Response.Close();
    }

    private static async Task WriteText(HttpListenerResponse response, string text, string contentType, int statusCode = 200)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        response.StatusCode = statusCode;
        response.ContentType = contentType;
        response.Headers["Cache-Control"] = "no-store";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
        response.Close();
    }

    private static Task WriteJson(HttpListenerResponse response, object value, int statusCode = 200)
    {
        var json = JsonSerializer.Serialize(value);
        return WriteText(response, json, "application/json; charset=utf-8", statusCode);
    }

    private static async Task<Dictionary<string, JsonElement>?> ReadJsonBody(HttpListenerContext context)
    {
        var body = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding ?? Encoding.UTF8);
            var text = await reader.ReadToEndAsync();
            if (string.IsNullOrWhiteSpace(text))
            {
                await WriteText(context.Response, "empty request body", "text/plain", 400);
                return null;
            }
            using var document = JsonDocument.Parse(text);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                await WriteText(context.Response, "json body must be an object", "text/plain", 400);
                return null;
            }
            foreach (var prop in document.RootElement.EnumerateObject())
            {
                body[prop.Name] = prop.Value.Clone();
            }
            return body;
        }
        catch (JsonException)
        {
            await WriteText(context.Response, "invalid json", "text/plain", 400);
            return null;
        }
    }

    private static (bool include, object? value) ConvertSettingValue(string key, JsonElement value)
    {
        if (key.Equals("language", StringComparison.OrdinalIgnoreCase)
            || key.Equals("refreshAtLocalTime", StringComparison.OrdinalIgnoreCase))
        {
            return value.ValueKind == JsonValueKind.String
                ? (true, value.GetString())
                : (false, null);
        }

        if (key.Equals("refreshSeconds", StringComparison.OrdinalIgnoreCase))
        {
            var number = ReadInt(value);
            return number.HasValue ? (true, number.Value) : (false, null);
        }

        if (key.StartsWith("show", StringComparison.OrdinalIgnoreCase)
            || key.Equals("autoUpdateEnabled", StringComparison.OrdinalIgnoreCase)
            || key.Equals("autoInstallUpdates", StringComparison.OrdinalIgnoreCase))
        {
            var boolean = ReadBool(value);
            return boolean.HasValue ? (true, boolean.Value) : (false, null);
        }

        var doubleValue = ReadDouble(value);
        return doubleValue.HasValue ? (true, doubleValue.Value) : (false, null);
    }

    private static bool? ReadBool(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        return value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed) ? parsed : null;
    }

    private static int? ReadInt(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed) ? parsed : null;
    }

    private static double? ReadDouble(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number;
        return value.ValueKind == JsonValueKind.String
            && double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static string ResolveRootDir()
    {
        var publishedRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        if (Directory.Exists(publishedRoot)) return publishedRoot;

        var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        var devRoot = Path.Combine(repoRoot, "SalesDesktop", "dist-wallpaper");
        return Directory.Exists(devRoot) ? devRoot : publishedRoot;
    }

    private static string InjectConfigScript(string html)
    {
        const string configTag = "    <script src=\"./config.js\"></script>\r\n";
        var moduleIndex = html.IndexOf("<script type=\"module\"", StringComparison.OrdinalIgnoreCase);
        if (moduleIndex >= 0)
        {
            return html.Insert(moduleIndex, configTag);
        }
        return html.Replace("</head>", $"{configTag}  </head>", StringComparison.OrdinalIgnoreCase);
    }

    private static int FindFreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private static string BuildProxyUri(string baseUrl, string currentQuery)
    {
        var query = RemoveQueryKey(currentQuery.TrimStart('?'), "token");
        var separator = baseUrl.Contains('?') ? "&" : "?";
        return string.IsNullOrWhiteSpace(query) ? baseUrl : $"{baseUrl}{separator}{query}";
    }

    private static string AddCacheBust(string url)
    {
        var separator = url.Contains('?') ? "&" : "?";
        return $"{url}{separator}t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
    }

    private static string RemoveQueryKey(string query, string key)
    {
        return string.Join("&", query
            .Split('&', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(part => !part.Split('=', 2)[0].Equals(key, StringComparison.OrdinalIgnoreCase)));
    }

    private static string ResolveContentType(string filePath) =>
        Path.GetExtension(filePath).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "application/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            ".ico" => "image/x-icon",
            ".woff2" => "font/woff2",
            ".wasm" => "application/wasm",
            _ => MediaTypeHeaderValue.Parse("application/octet-stream").ToString(),
        };
}
