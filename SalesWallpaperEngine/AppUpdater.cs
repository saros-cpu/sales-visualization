using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace SalesWallpaperEngine;

internal sealed record WallpaperUpdateInfo(string Version, string Url, long Size, string Sha256);

internal static class AppUpdater
{
    public static async Task<WallpaperUpdateInfo?> CheckAsync(RuntimeConfig config, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(config.UpdateManifestUrl)) return null;

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        var url = $"{config.UpdateManifestUrl}{(config.UpdateManifestUrl.Contains('?') ? "&" : "?")}t={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        var json = await client.GetStringAsync(url, cancellationToken);
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object
            ? data
            : document.RootElement;

        var version = ReadString(root, "version");
        var packageUrl = ReadString(root, "url");
        if (string.IsNullOrWhiteSpace(version) || string.IsNullOrWhiteSpace(packageUrl)) return null;
        if (CompareVersions(version, AppVersion.Current) <= 0) return null;

        var size = ReadInt64(root, "size") ?? 0;
        var sha256 = ReadString(root, "sha256");
        return new WallpaperUpdateInfo(version, packageUrl, size, sha256);
    }

    public static void OpenDownload(WallpaperUpdateInfo update)
    {
        Process.Start(new ProcessStartInfo(update.Url) { UseShellExecute = true });
    }

    public static async Task DownloadAndInstallAsync(WallpaperUpdateInfo update, CancellationToken cancellationToken)
    {
        var workDir = Path.Combine(Path.GetTempPath(), $"SalesWallpaperEngineUpdate-{update.Version}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}");
        Directory.CreateDirectory(workDir);
        var zipPath = Path.Combine(workDir, $"SalesWallpaperEngine-{update.Version}.zip");
        var scriptPath = Path.Combine(workDir, "apply-update.ps1");

        using (var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) })
        await using (var remote = await client.GetStreamAsync(update.Url, cancellationToken))
        await using (var local = File.Create(zipPath))
        {
            await remote.CopyToAsync(local, cancellationToken);
        }

        VerifySha256(zipPath, update.Sha256);
        await File.WriteAllTextAsync(scriptPath, BuildApplyScript(), cancellationToken);

        var targetDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var exeName = Path.GetFileName(Environment.ProcessPath ?? "SalesWallpaperEngine.exe");
        var args = string.Join(" ", new[]
        {
            "-NoProfile",
            "-ExecutionPolicy Bypass",
            "-File", Quote(scriptPath),
            "-ZipPath", Quote(zipPath),
            "-TargetDir", Quote(targetDir),
            "-ExeName", Quote(exeName),
            "-ParentPid", Environment.ProcessId.ToString(),
        });

        Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        });
    }

    private static string ReadString(JsonElement element, string key) =>
        element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static long? ReadInt64(JsonElement element, string key)
    {
        if (!element.TryGetProperty(key, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), out var parsed) ? parsed : null;
    }

    private static int CompareVersions(string left, string right)
    {
        var leftParts = left.Split('.', StringSplitOptions.RemoveEmptyEntries).Select(ParsePart).ToArray();
        var rightParts = right.Split('.', StringSplitOptions.RemoveEmptyEntries).Select(ParsePart).ToArray();
        var length = Math.Max(leftParts.Length, rightParts.Length);
        for (var i = 0; i < length; i++)
        {
            var diff = (i < leftParts.Length ? leftParts[i] : 0) - (i < rightParts.Length ? rightParts[i] : 0);
            if (diff != 0) return diff;
        }
        return 0;
    }

    private static int ParsePart(string value) => int.TryParse(value, out var number) ? number : 0;

    private static void VerifySha256(string filePath, string expected)
    {
        if (string.IsNullOrWhiteSpace(expected)) return;
        using var stream = File.OpenRead(filePath);
        var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (!actual.Equals(expected.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"update package sha256 mismatch: {actual}");
        }
    }

    private static string Quote(string value) => $"\"{value.Replace("\"", "\\\"")}\"";

    private static string BuildApplyScript() => """
        param(
            [Parameter(Mandatory=$true)][string]$ZipPath,
            [Parameter(Mandatory=$true)][string]$TargetDir,
            [Parameter(Mandatory=$true)][string]$ExeName,
            [Parameter(Mandatory=$true)][int]$ParentPid
        )

        $ErrorActionPreference = "Stop"
        try {
            Wait-Process -Id $ParentPid -Timeout 30
        } catch {
            Start-Sleep -Milliseconds 800
        }

        $staging = Join-Path ([System.IO.Path]::GetDirectoryName($ZipPath)) "staging"
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        Expand-Archive -LiteralPath $ZipPath -DestinationPath $staging -Force
        Copy-Item -Path (Join-Path $staging "*") -Destination $TargetDir -Recurse -Force
        Start-Process -FilePath (Join-Path $TargetDir $ExeName) -WorkingDirectory $TargetDir
        """;
}
