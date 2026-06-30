using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SalesWallpaperEngine;

internal static class ProtectedWallpaperKey
{
    private const string Algorithm = "A256CBC-HS256";
    private const string Purpose = "kg.example.sales.wallpaper.engine.protected-key.2026-08";
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("swpe1");

    public static string? MergeJson(Dictionary<string, JsonElement> target, string filePath)
    {
        try
        {
            if (!File.Exists(filePath)) return null;
            var json = DecryptJson(filePath);
            if (string.IsNullOrWhiteSpace(json)) return null;
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                target[prop.Name] = prop.Value.Clone();
            }
            return filePath;
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"failed to read protected wallpaper key {filePath}: {ex.Message}");
            return null;
        }
    }

    private static string DecryptJson(string filePath)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(filePath));
        var root = doc.RootElement;
        var version = root.TryGetProperty("version", out var versionProp) && versionProp.TryGetInt32(out var parsedVersion)
            ? parsedVersion
            : 0;
        var algorithm = root.TryGetProperty("alg", out var algProp) ? algProp.GetString() : "";
        if (version != 1 || !string.Equals(algorithm, Algorithm, StringComparison.Ordinal))
        {
            throw new InvalidDataException("unsupported protected key format");
        }

        var iv = Convert.FromBase64String(ReadRequiredString(root, "iv"));
        var ciphertext = Convert.FromBase64String(ReadRequiredString(root, "ciphertext"));
        var mac = Convert.FromBase64String(ReadRequiredString(root, "mac"));
        var expectedMac = ComputeMac(iv, ciphertext);
        if (!CryptographicOperations.FixedTimeEquals(mac, expectedMac))
        {
            throw new CryptographicException("protected key integrity check failed");
        }

        using var aes = Aes.Create();
        aes.Key = DeriveBytes("enc");
        aes.IV = iv;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        using var decryptor = aes.CreateDecryptor();
        var plain = decryptor.TransformFinalBlock(ciphertext, 0, ciphertext.Length);
        return Encoding.UTF8.GetString(plain);
    }

    private static string ReadRequiredString(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"protected key missing {propertyName}");
        }
        return value.GetString() ?? "";
    }

    private static byte[] ComputeMac(byte[] iv, byte[] ciphertext)
    {
        using var hmac = new HMACSHA256(DeriveBytes("mac"));
        return hmac.ComputeHash(Concat(Magic, iv, ciphertext));
    }

    private static byte[] DeriveBytes(string label)
    {
        using var sha = SHA256.Create();
        return sha.ComputeHash(Encoding.UTF8.GetBytes($"{Purpose}:{label}"));
    }

    private static byte[] Concat(params byte[][] parts)
    {
        var total = parts.Sum(part => part.Length);
        var result = new byte[total];
        var offset = 0;
        foreach (var part in parts)
        {
            Buffer.BlockCopy(part, 0, result, offset, part.Length);
            offset += part.Length;
        }
        return result;
    }
}
