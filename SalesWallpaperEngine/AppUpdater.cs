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
        var packageUrl = RuntimeConfig.UpgradeLegacyPublicUrl(ReadString(root, "url"));
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

        VerifyFileSize(zipPath, update.Size);
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
        if (string.IsNullOrWhiteSpace(expected))
        {
            throw new InvalidOperationException("update manifest is missing sha256");
        }
        using var stream = File.OpenRead(filePath);
        var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (!actual.Equals(expected.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"update package sha256 mismatch: {actual}");
        }
    }

    private static void VerifyFileSize(string filePath, long expected)
    {
        if (expected <= 0) return;
        var actual = new FileInfo(filePath).Length;
        if (actual != expected)
        {
            throw new InvalidOperationException($"update package size mismatch: expected {expected}, got {actual}");
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

        $logDir = Join-Path $env:APPDATA "sales-wallpaper-engine\logs"
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        $logFile = Join-Path $logDir ("apply-update-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
        function Write-Log($msg) {
            ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $msg) | Out-File -FilePath $logFile -Append -Encoding utf8
        }

        Write-Log "start"
        Write-Log "waiting for parent"
        Wait-Process -Id $ParentPid -Timeout 30 -ErrorAction SilentlyContinue
        if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
            Write-Log "parent still running; abort"
            exit 1
        }

        try {
            Write-Log "staging/extract"
            $staging = Join-Path ([System.IO.Path]::GetDirectoryName($ZipPath)) "staging"
            if (Test-Path -LiteralPath $staging) {
                Remove-Item -LiteralPath $staging -Recurse -Force
            }
            New-Item -ItemType Directory -Force -Path $staging | Out-Null
            Expand-Archive -LiteralPath $ZipPath -DestinationPath $staging -Force

            Write-Log "copy"
            Copy-Item -Path (Join-Path $staging "*") -Destination $TargetDir -Recurse -Force

            Write-Log "deploy key to appdata"
            $keyDeployDir = Join-Path $env:APPDATA "sales-wallpaper-engine"
            $keyDeployed = $false
            $protectedKeySrc = Join-Path $staging "wallpaper-key.protected.json"
            if (Test-Path -LiteralPath $protectedKeySrc) {
                New-Item -ItemType Directory -Force -Path $keyDeployDir | Out-Null
                Copy-Item -LiteralPath $protectedKeySrc -Destination (Join-Path $keyDeployDir "wallpaper-key.protected.json") -Force
                $keyDeployed = $true
                Write-Log "deployed protected wallpaper key"
            }
            $plainKeySrc = Join-Path $staging "wallpaper-key.json"
            if (Test-Path -LiteralPath $plainKeySrc) {
                New-Item -ItemType Directory -Force -Path $keyDeployDir | Out-Null
                Copy-Item -LiteralPath $plainKeySrc -Destination (Join-Path $keyDeployDir "wallpaper-key.json") -Force
                $keyDeployed = $true
                Write-Log "deployed plain wallpaper key"
            }
            if (-not $keyDeployed) {
                Write-Log "no bundled wallpaper key in package; keeping existing appdata key"
            }
        } catch {
            Write-Log ("apply failed: " + $_.Exception.Message)
            exit 1
        }

        $exeBase = [System.IO.Path]::GetFileNameWithoutExtension($ExeName)
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            Write-Log ("restart attempt " + $attempt)
            Start-Process -FilePath (Join-Path $TargetDir $ExeName) -WorkingDirectory $TargetDir
            Start-Sleep 3
            if (Get-Process -Name $exeBase -ErrorAction SilentlyContinue) {
                Write-Log "restart ok"
                exit 0
            }
        }
        Write-Log "restart failed after 3 attempts"
        exit 1
        """;
}
