using System.Reflection;

namespace SalesWallpaperEngine;

internal static class AppVersion
{
    public static string Current
    {
        get
        {
            var assembly = Assembly.GetExecutingAssembly();
            var informational = assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion;
            var shortInformational = informational?.Split('+', 2)[0].Trim();
            var version = string.IsNullOrWhiteSpace(shortInformational)
                ? assembly.GetName().Version?.ToString(3)
                : shortInformational;
            return string.IsNullOrWhiteSpace(version) ? "0.1.0" : version;
        }
    }
}
