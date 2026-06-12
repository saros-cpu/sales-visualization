using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace SalesWallpaperEngine;

internal sealed class DesktopHost
{
    private IntPtr _progman;
    private IntPtr _workerW;
    private IntPtr _shellView;
    private bool _raisedDesktop;

    public IntPtr CurrentParent => _raisedDesktop ? _progman : _workerW;

    public string LastMode => _raisedDesktop ? "raised-desktop-progman" : "workerw";

    public bool AttachWindow(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero || !NativeMethods.IsWindow(hWnd)) return false;

        SetupDesktopLayer();
        var parent = CurrentParent;
        if (parent == IntPtr.Zero)
        {
            AppLogger.Warn("desktop parent not found");
            return false;
        }

        PrepareWallpaperWindow(hWnd);
        if (NativeMethods.GetParent(hWnd) != parent)
        {
            var previous = NativeMethods.SetParent(hWnd, parent);
            if (previous == IntPtr.Zero && Marshal.GetLastWin32Error() != 0)
            {
                AppLogger.Warn($"SetParent failed hwnd={hWnd} parent={parent} error={Marshal.GetLastWin32Error()}");
                return false;
            }
        }

        if (_raisedDesktop && _shellView != IntPtr.Zero)
        {
            NativeMethods.SetWindowPos(
                hWnd,
                _shellView,
                0,
                0,
                0,
                0,
                NativeMethods.SetWindowPosFlags.NOMOVE
                | NativeMethods.SetWindowPosFlags.NOSIZE
                | NativeMethods.SetWindowPosFlags.NOACTIVATE);
            EnsureWorkerWZOrder();
        }

        var bounds = ResolveWallpaperBounds(parent);
        NativeMethods.MoveWindow(hWnd, bounds.X, bounds.Y, bounds.Width, bounds.Height, true);
        NativeMethods.SetWindowPos(
            hWnd,
            _raisedDesktop && _shellView != IntPtr.Zero ? _shellView : new IntPtr(1),
            bounds.X,
            bounds.Y,
            bounds.Width,
            bounds.Height,
            NativeMethods.SetWindowPosFlags.NOACTIVATE | NativeMethods.SetWindowPosFlags.SHOWWINDOW);
        NativeMethods.ShowWindow(hWnd, NativeMethods.SW_SHOW);

        AppLogger.Info($"attached hwnd={hWnd} parent={parent} mode={LastMode} bounds={bounds}");
        return true;
    }

    public string WriteDiagnostics()
    {
        SetupDesktopLayer();
        var lines = new List<string>
        {
            $"time={DateTimeOffset.Now:O}",
            $"progman={_progman}",
            $"workerW={_workerW}",
            $"shellView={_shellView}",
            $"mode={LastMode}",
            "",
            "top-level windows:",
        };

        NativeMethods.EnumWindows((hWnd, _) =>
        {
            var cls = NativeMethods.ClassName(hWnd);
            if (cls is "Progman" or "WorkerW")
            {
                NativeMethods.GetWindowThreadProcessId(hWnd, out var pid);
                lines.Add($"{hWnd} class={cls} pid={pid} text={NativeMethods.WindowText(hWnd)}");
                NativeMethods.EnumChildWindows(hWnd, (child, _) =>
                {
                    lines.Add($"  child {child} class={NativeMethods.ClassName(child)} text={NativeMethods.WindowText(child)}");
                    return true;
                }, IntPtr.Zero);
            }
            return true;
        }, IntPtr.Zero);

        Directory.CreateDirectory(AppPaths.LogDir);
        var filePath = Path.Combine(AppPaths.LogDir, $"desktop-diagnostics-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
        File.WriteAllLines(filePath, lines);
        return filePath;
    }

    private void SetupDesktopLayer()
    {
        _progman = NativeMethods.FindWindow("Progman", "Program Manager");
        if (_progman == IntPtr.Zero)
        {
            _progman = NativeMethods.FindWindow("Progman", null);
        }

        if (_progman != IntPtr.Zero)
        {
            NativeMethods.SendMessageTimeout(
                _progman,
                0x052C,
                new IntPtr(0xD),
                new IntPtr(0x1),
                NativeMethods.SMTO_NORMAL,
                1000,
                out _);
        }

        _raisedDesktop = HasExtendedStyle(_progman, NativeMethods.WS_EX_NOREDIRECTIONBITMAP);
        _shellView = IntPtr.Zero;
        _workerW = IntPtr.Zero;

        NativeMethods.EnumWindows((topHandle, _) =>
        {
            var shellView = NativeMethods.FindWindowEx(topHandle, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (shellView != IntPtr.Zero)
            {
                _shellView = shellView;
                _workerW = NativeMethods.FindWindowEx(IntPtr.Zero, topHandle, "WorkerW", null);
            }
            return true;
        }, IntPtr.Zero);

        if (_shellView == IntPtr.Zero && _progman != IntPtr.Zero)
        {
            _shellView = NativeMethods.FindWindowEx(_progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        }

        if (_raisedDesktop && _progman != IntPtr.Zero)
        {
            _workerW = NativeMethods.FindWindowEx(_progman, IntPtr.Zero, "WorkerW", null);
        }

        if (_workerW == IntPtr.Zero && _progman != IntPtr.Zero)
        {
            NativeMethods.SendMessageTimeout(
                _progman,
                0x052C,
                IntPtr.Zero,
                IntPtr.Zero,
                NativeMethods.SMTO_NORMAL,
                1000,
                out _);

            NativeMethods.EnumWindows((topHandle, _) =>
            {
                var shellView = NativeMethods.FindWindowEx(topHandle, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (shellView != IntPtr.Zero)
                {
                    _shellView = shellView;
                    _workerW = NativeMethods.FindWindowEx(IntPtr.Zero, topHandle, "WorkerW", null);
                }
                return true;
            }, IntPtr.Zero);
        }

        if (_workerW == IntPtr.Zero && !_raisedDesktop)
        {
            _workerW = _progman;
        }

        AppLogger.Info($"desktop layer progman={_progman} shell={_shellView} workerw={_workerW} raised={_raisedDesktop}");
    }

    private static void PrepareWallpaperWindow(IntPtr hWnd)
    {
        var style = NativeMethods.GetWindowLongPtr(hWnd, NativeMethods.GWL_STYLE).ToInt64();
        style &= ~(NativeMethods.WS_POPUP
                   | NativeMethods.WS_CAPTION
                   | NativeMethods.WS_THICKFRAME
                   | NativeMethods.WS_SYSMENU
                   | NativeMethods.WS_MINIMIZEBOX
                   | NativeMethods.WS_MAXIMIZEBOX);
        style |= NativeMethods.WS_CHILD | NativeMethods.WS_VISIBLE;
        NativeMethods.SetWindowLongPtr(hWnd, NativeMethods.GWL_STYLE, new IntPtr(style));

        var exStyle = NativeMethods.GetWindowLongPtr(hWnd, NativeMethods.GWL_EXSTYLE).ToInt64();
        exStyle |= NativeMethods.WS_EX_TOOLWINDOW | NativeMethods.WS_EX_LAYERED;
        exStyle &= ~NativeMethods.WS_EX_APPWINDOW;
        NativeMethods.SetWindowLongPtr(hWnd, NativeMethods.GWL_EXSTYLE, new IntPtr(exStyle));
        NativeMethods.SetLayeredWindowAttributes(hWnd, 0, 255, NativeMethods.LWA_ALPHA);

        NativeMethods.SetWindowPos(
            hWnd,
            IntPtr.Zero,
            0,
            0,
            0,
            0,
            NativeMethods.SetWindowPosFlags.NOMOVE
            | NativeMethods.SetWindowPosFlags.NOSIZE
            | NativeMethods.SetWindowPosFlags.NOZORDER
            | NativeMethods.SetWindowPosFlags.NOACTIVATE
            | NativeMethods.SetWindowPosFlags.FRAMECHANGED);
    }

    private static Rectangle ResolveWallpaperBounds(IntPtr parent)
    {
        var virtualBounds = SystemInformation.VirtualScreen;
        if (NativeMethods.GetWindowRect(parent, out var parentRect) && parentRect.Width > 0 && parentRect.Height > 0)
        {
            return new Rectangle(
                virtualBounds.Left - parentRect.Left,
                virtualBounds.Top - parentRect.Top,
                virtualBounds.Width,
                virtualBounds.Height);
        }
        return virtualBounds;
    }

    private void EnsureWorkerWZOrder()
    {
        if (!_raisedDesktop || _progman == IntPtr.Zero || _workerW == IntPtr.Zero) return;

        var lastChild = IntPtr.Zero;
        NativeMethods.EnumChildWindows(_progman, (hWnd, _) =>
        {
            lastChild = hWnd;
            return true;
        }, IntPtr.Zero);

        if (lastChild != _workerW)
        {
            NativeMethods.SetWindowPos(
                _workerW,
                NativeMethods.HWND_BOTTOM,
                0,
                0,
                0,
                0,
                NativeMethods.SetWindowPosFlags.NOMOVE
                | NativeMethods.SetWindowPosFlags.NOSIZE
                | NativeMethods.SetWindowPosFlags.NOACTIVATE);
        }
    }

    private static bool HasExtendedStyle(IntPtr hwnd, long style)
    {
        if (hwnd == IntPtr.Zero) return false;
        return (NativeMethods.GetWindowLongPtr(hwnd, NativeMethods.GWL_EXSTYLE).ToInt64() & style) != 0;
    }
}
