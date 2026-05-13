using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

internal static class WinCaptureHelper
{
    private const int DwmaExtendedFrameBounds = 9;
    private const int CapturePadding = 2;
    private const int MaxProcessingWidth = 1600;
    private const int BorderDiffThreshold = 12;
    private const int BorderVarianceThreshold = 10;

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0)
            {
                Console.Error.WriteLine("missing command");
                return 1;
            }

            var command = args[0].ToLowerInvariant();
            switch (command)
            {
                case "list":
                    Console.OutputEncoding = Encoding.UTF8;
                    Console.Write(SerializeWindows(ListVisibleWindows()));
                    return 0;

                case "capture":
                    long handle;
                    if (args.Length < 2 || !long.TryParse(args[1], out handle))
                    {
                        Console.Error.WriteLine("invalid handle");
                        return 1;
                    }

                    Console.Write(CaptureWindowBase64(new IntPtr(handle)));
                    return 0;

                case "preprocess":
                    if (args.Length < 5)
                    {
                        Console.Error.WriteLine("invalid preprocess arguments");
                        return 1;
                    }

                    Console.OutputEncoding = Encoding.UTF8;
                    Console.Write(RunPreprocess(args[1], args[2], args[3], args[4]));
                    return 0;

                default:
                    Console.Error.WriteLine("unknown command");
                    return 1;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private sealed class WindowEntry
    {
        public long Handle;
        public string Title = string.Empty;
        public int Width;
        public int Height;
    }

    private sealed class PreprocessResult
    {
        public string Color = string.Empty;
        public string Grayscale = string.Empty;
        public int Width;
        public int Height;
        public int CropLeft;
        public int CropTop;
        public int CropRight;
        public int CropBottom;
    }

    private static List<WindowEntry> ListVisibleWindows()
    {
        var list = new List<WindowEntry>();
        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd))
            {
                return true;
            }

            var titleBuilder = new StringBuilder(512);
            GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
            var title = titleBuilder.ToString().Trim();
            if (string.IsNullOrWhiteSpace(title))
            {
                return true;
            }

            RECT rect;
            if (!TryGetCaptureRect(hWnd, out rect))
            {
                return true;
            }

            var width = rect.Right - rect.Left;
            var height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0)
            {
                return true;
            }

            list.Add(new WindowEntry
            {
                Handle = hWnd.ToInt64(),
                Title = title,
                Width = width,
                Height = height,
            });
            return true;
        }, IntPtr.Zero);

        return list;
    }

    private static string CaptureWindowBase64(IntPtr hWnd)
    {
        RECT rect;
        if (!TryGetCaptureRect(hWnd, out rect))
        {
            return string.Empty;
        }

        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0)
        {
            return string.Empty;
        }

        Bitmap bitmap = TryPrintWindowCapture(hWnd, width, height);
        if (bitmap == null)
        {
            return string.Empty;
        }

        using (bitmap)
        using (var stream = new MemoryStream())
        {
            bitmap.Save(stream, ImageFormat.Png);
            return Convert.ToBase64String(stream.ToArray());
        }
    }

    private static Bitmap TryPrintWindowCapture(IntPtr hWnd, int width, int height)
    {
        try
        {
            var bitmap = new Bitmap(width, height);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                var hdc = graphics.GetHdc();
                try
                {
                    var ok = PrintWindow(hWnd, hdc, 2) || PrintWindow(hWnd, hdc, 0);
                    if (!ok)
                    {
                        bitmap.Dispose();
                        return null;
                    }
                }
                finally
                {
                    graphics.ReleaseHdc(hdc);
                }
            }

            return bitmap;
        }
        catch
        {
            return null;
        }
    }

    private static string RunPreprocess(string inputPath, string cropBorderArg, string maxWidthArg, string contrastArg)
    {
        if (!File.Exists(inputPath))
        {
            throw new FileNotFoundException("preprocess input not found", inputPath);
        }

        var cropBorderEnabled = !string.Equals(cropBorderArg, "off", StringComparison.OrdinalIgnoreCase);
        int maxWidth;
        if (!int.TryParse(maxWidthArg, out maxWidth))
        {
            maxWidth = MaxProcessingWidth;
        }
        maxWidth = Math.Max(640, Math.Min(2400, maxWidth));

        float contrast;
        if (!float.TryParse(contrastArg, out contrast))
        {
            contrast = 1.08f;
        }
        contrast = Math.Max(0.9f, Math.Min(1.4f, contrast));

        BorderCrop crop;
        using (var original = new Bitmap(inputPath))
        using (var cropped = cropBorderEnabled ? CropUniformBorder(original, out crop) : CloneWithZeroCrop(original, out crop))
        using (var resized = ResizeBitmap(cropped, maxWidth))
        using (var normalizedColor = NormalizeColorBitmap(resized, contrast))
        using (var grayscaleBitmap = BuildGrayscaleBitmap(normalizedColor))
        {
            var result = new PreprocessResult
            {
                Color = BitmapToBase64(normalizedColor),
                Grayscale = BitmapToBase64(grayscaleBitmap),
                Width = resized.Width,
                Height = resized.Height,
                CropLeft = crop.Left,
                CropTop = crop.Top,
                CropRight = crop.Right,
                CropBottom = crop.Bottom,
            };
            return SerializePreprocessResult(result);
        }
    }

    private struct BorderCrop
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private static Bitmap CloneWithZeroCrop(Bitmap source, out BorderCrop crop)
    {
        crop = new BorderCrop();
        return new Bitmap(source);
    }

    private static Bitmap CropUniformBorder(Bitmap source, out BorderCrop crop)
    {
        crop = new BorderCrop();
        if (source.Width < 24 || source.Height < 24)
        {
            return new Bitmap(source);
        }

        var reference = SampleCornerBrightness(source);
        var maxHorizontalTrim = Math.Min(80, source.Width / 8);
        var maxVerticalTrim = Math.Min(80, source.Height / 8);

        var left = 0;
        while (left < maxHorizontalTrim && IsUniformColumn(source, left, reference))
        {
            left += 1;
        }

        var right = 0;
        while (right < maxHorizontalTrim && IsUniformColumn(source, source.Width - 1 - right, reference))
        {
            right += 1;
        }

        var top = 0;
        while (top < maxVerticalTrim && IsUniformRow(source, top, reference))
        {
            top += 1;
        }

        var bottom = 0;
        while (bottom < maxVerticalTrim && IsUniformRow(source, source.Height - 1 - bottom, reference))
        {
            bottom += 1;
        }

        var width = source.Width - left - right;
        var height = source.Height - top - bottom;
        if (width < source.Width / 2 || height < source.Height / 2)
        {
            crop = new BorderCrop();
            return new Bitmap(source);
        }

        crop = new BorderCrop { Left = left, Top = top, Right = right, Bottom = bottom };
        var rect = new Rectangle(left, top, width, height);
        return source.Clone(rect, PixelFormat.Format24bppRgb);
    }

    private static Bitmap ResizeBitmap(Bitmap source, int maxWidth)
    {
        if (source.Width <= maxWidth)
        {
            return new Bitmap(source);
        }

        var scale = (float)maxWidth / source.Width;
        var width = maxWidth;
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));
        var resized = new Bitmap(width, height);
        using (var graphics = Graphics.FromImage(resized))
        {
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(source, 0, 0, width, height);
        }
        return resized;
    }

    private static Bitmap NormalizeColorBitmap(Bitmap source, float contrast)
    {
        var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format24bppRgb);
        for (var y = 0; y < source.Height; y += 1)
        {
            for (var x = 0; x < source.Width; x += 1)
            {
                var pixel = source.GetPixel(x, y);
                var r = ClampToByte(ApplyContrast(pixel.R, contrast));
                var g = ClampToByte(ApplyContrast(pixel.G, contrast));
                var b = ClampToByte(ApplyContrast(pixel.B, contrast));
                bitmap.SetPixel(x, y, Color.FromArgb(r, g, b));
            }
        }
        return bitmap;
    }

    private static Bitmap BuildGrayscaleBitmap(Bitmap source)
    {
        var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format24bppRgb);
        for (var y = 0; y < source.Height; y += 1)
        {
            for (var x = 0; x < source.Width; x += 1)
            {
                var pixel = source.GetPixel(x, y);
                var value = ClampToByte((int)Math.Round(pixel.R * 0.299 + pixel.G * 0.587 + pixel.B * 0.114));
                bitmap.SetPixel(x, y, Color.FromArgb(value, value, value));
            }
        }
        return bitmap;
    }

    private static int SampleCornerBrightness(Bitmap source)
    {
        var points = new[]
        {
            source.GetPixel(0, 0),
            source.GetPixel(source.Width - 1, 0),
            source.GetPixel(0, source.Height - 1),
            source.GetPixel(source.Width - 1, source.Height - 1),
        };
        var sum = 0;
        for (var i = 0; i < points.Length; i += 1)
        {
            sum += GetBrightness(points[i]);
        }
        return (int)Math.Round(sum / (double)points.Length);
    }

    private static bool IsUniformRow(Bitmap source, int row, int reference)
    {
        var min = 255;
        var max = 0;
        for (var x = 0; x < source.Width; x += Math.Max(1, source.Width / 64))
        {
            var value = GetBrightness(source.GetPixel(x, row));
            min = Math.Min(min, value);
            max = Math.Max(max, value);
        }
        return Math.Abs(((min + max) / 2) - reference) <= BorderDiffThreshold && (max - min) <= BorderVarianceThreshold;
    }

    private static bool IsUniformColumn(Bitmap source, int column, int reference)
    {
        var min = 255;
        var max = 0;
        for (var y = 0; y < source.Height; y += Math.Max(1, source.Height / 64))
        {
            var value = GetBrightness(source.GetPixel(column, y));
            min = Math.Min(min, value);
            max = Math.Max(max, value);
        }
        return Math.Abs(((min + max) / 2) - reference) <= BorderDiffThreshold && (max - min) <= BorderVarianceThreshold;
    }

    private static int GetBrightness(Color color)
    {
        return (int)Math.Round(color.R * 0.299 + color.G * 0.587 + color.B * 0.114);
    }

    private static int ApplyContrast(int value, float contrast)
    {
        var next = ((value - 128.0f) * contrast) + 128.0f;
        return (int)Math.Round(next);
    }

    private static byte ClampToByte(int value)
    {
        if (value < 0)
        {
            return 0;
        }
        if (value > 255)
        {
            return 255;
        }
        return (byte)value;
    }

    private static string BitmapToBase64(Bitmap bitmap)
    {
        using (var stream = new MemoryStream())
        {
            bitmap.Save(stream, ImageFormat.Png);
            return Convert.ToBase64String(stream.ToArray());
        }
    }

    private static bool TryGetCaptureRect(IntPtr hWnd, out RECT rect)
    {
        RECT nextRect;
        var hr = DwmGetWindowAttribute(
            hWnd,
            DwmaExtendedFrameBounds,
            out nextRect,
            Marshal.SizeOf(typeof(RECT)));

        if (hr != 0 && !GetWindowRect(hWnd, out nextRect))
        {
            rect = new RECT();
            return false;
        }

        if (nextRect.Right <= nextRect.Left || nextRect.Bottom <= nextRect.Top)
        {
            rect = new RECT();
            return false;
        }

        nextRect.Right += CapturePadding;
        nextRect.Bottom += CapturePadding;
        rect = nextRect;
        return true;
    }

    private static string SerializeWindows(List<WindowEntry> windows)
    {
        var builder = new StringBuilder();
        builder.Append('[');
        for (var index = 0; index < windows.Count; index += 1)
        {
            if (index > 0)
            {
                builder.Append(',');
            }

            var window = windows[index];
            builder.Append("{\"Handle\":");
            builder.Append(window.Handle);
            builder.Append(",\"Title\":\"");
            builder.Append(EscapeJson(window.Title));
            builder.Append("\",\"Width\":");
            builder.Append(window.Width);
            builder.Append(",\"Height\":");
            builder.Append(window.Height);
            builder.Append('}');
        }

        builder.Append(']');
        return builder.ToString();
    }

    private static string SerializePreprocessResult(PreprocessResult result)
    {
        var builder = new StringBuilder();
        builder.Append('{');
        builder.Append("\"color\":\"");
        builder.Append(result.Color);
        builder.Append("\",\"grayscale\":\"");
        builder.Append(result.Grayscale);
        builder.Append("\",\"width\":");
        builder.Append(result.Width);
        builder.Append(",\"height\":");
        builder.Append(result.Height);
        builder.Append(",\"cropLeft\":");
        builder.Append(result.CropLeft);
        builder.Append(",\"cropTop\":");
        builder.Append(result.CropTop);
        builder.Append(",\"cropRight\":");
        builder.Append(result.CropRight);
        builder.Append(",\"cropBottom\":");
        builder.Append(result.CropBottom);
        builder.Append('}');
        return builder.ToString();
    }

    private static string EscapeJson(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(value.Length + 16);
        foreach (var ch in value)
        {
            switch (ch)
            {
                case '\\':
                    builder.Append("\\\\");
                    break;
                case '"':
                    builder.Append("\\\"");
                    break;
                case '\b':
                    builder.Append("\\b");
                    break;
                case '\f':
                    builder.Append("\\f");
                    break;
                case '\n':
                    builder.Append("\\n");
                    break;
                case '\r':
                    builder.Append("\\r");
                    break;
                case '\t':
                    builder.Append("\\t");
                    break;
                default:
                    if (char.IsControl(ch))
                    {
                        builder.Append("\\u");
                        builder.Append(((int)ch).ToString("x4"));
                    }
                    else
                    {
                        builder.Append(ch);
                    }
                    break;
            }
        }

        return builder.ToString();
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
}
