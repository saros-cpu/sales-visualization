using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SalesWallpaperEngine;

internal sealed class StaticFileServer : IDisposable
{
    private readonly RuntimeConfig _config;
    private readonly string _rootDir;
    private readonly HttpClient _httpClient = new();
    private readonly CancellationTokenSource _cts = new();
    private HttpListener? _listener;

    public StaticFileServer(RuntimeConfig config)
    {
        _config = config;
        _rootDir = ResolveRootDir();
    }

    public int Port { get; private set; }

    public string BaseUrl => $"http://127.0.0.1:{Port}";

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

            if (path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Redirect("/wallpaper.html");
                context.Response.Close();
                return;
            }

            if (path.Equals("/config.js", StringComparison.OrdinalIgnoreCase))
            {
                await WriteText(context.Response, _config.BuildClientConfigScript(Port), "application/javascript; charset=utf-8");
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
        var target = BuildProxyUri($"{_config.ApiHost}/api/wallpaper/map", context.Request.Url?.Query ?? "", _config.WallpaperToken);
        using var request = new HttpRequestMessage(HttpMethod.Get, target);
        if (_config.HasWallpaperToken)
        {
            request.Headers.TryAddWithoutValidation("X-Wallpaper-Token", _config.WallpaperToken);
        }

        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _cts.Token);
        await CopyProxyResponse(context.Response, response);
    }

    private async Task ProxyLatestManifest(HttpListenerContext context)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, AddCacheBust(_config.UpdateManifestUrl));
        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _cts.Token);
        await CopyProxyResponse(context.Response, response);
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

    private static string BuildProxyUri(string baseUrl, string currentQuery, string token)
    {
        var query = currentQuery.TrimStart('?');
        if (!string.IsNullOrWhiteSpace(token) && !ContainsQueryKey(query, "token"))
        {
            query = string.IsNullOrWhiteSpace(query)
                ? $"token={Uri.EscapeDataString(token)}"
                : $"{query}&token={Uri.EscapeDataString(token)}";
        }
        var separator = baseUrl.Contains('?') ? "&" : "?";
        return string.IsNullOrWhiteSpace(query) ? baseUrl : $"{baseUrl}{separator}{query}";
    }

    private static string AddCacheBust(string url)
    {
        var separator = url.Contains('?') ? "&" : "?";
        return $"{url}{separator}t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
    }

    private static bool ContainsQueryKey(string query, string key)
    {
        return query
            .Split('&', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(part => part.Split('=', 2)[0].Equals(key, StringComparison.OrdinalIgnoreCase));
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
