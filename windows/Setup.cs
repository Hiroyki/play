// Pemasang Play untuk Windows. Semua file ada di dalam exe ini (payload.zip).
// Memasang per pengguna tanpa hak admin. Argumen: /S diam, /D=folder, /NOSHORTCUT.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Play Setup")]
[assembly: AssemblyProduct("Play")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Setup
{
    public static string Target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Play");
    public static bool Shortcuts = true;
    static bool chosen; // folder ditentukan lewat /D
    public static readonly string Version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
    // Bagian yang selalu diganti saat memperbarui. Data pengguna tidak ada di sini.
    static readonly string[] Parts = { "server", "public", "node_modules", "windows", "runtime" };

    [STAThread]
    static int Main(string[] args)
    {
        bool silent = false;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            else if (a.Equals("/NOSHORTCUT", StringComparison.OrdinalIgnoreCase)) Shortcuts = false;
            else if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) { Target = Path.GetFullPath(a.Substring(3).Trim('"')); chosen = true; }
        }
        if (silent)
        {
            try { Previous(); Install(delegate { }, false); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
        return 0;
    }

    // Versi yang sudah terpasang, atau null. Sekalian memakai foldernya supaya tidak ada dua salinan.
    public static string Previous()
    {
        if (!chosen)
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Play"))
            {
                string at = k == null ? null : k.GetValue("InstallLocation") as string;
                if (!string.IsNullOrEmpty(at) && File.Exists(Path.Combine(at, "installed"))) Target = at;
            }
        string mark = Path.Combine(Target, "installed");
        if (!File.Exists(mark) || !File.Exists(Path.Combine(Target, "Play.exe"))) return null;
        try { return File.ReadAllText(mark).Trim(); }
        catch (IOException) { return "unknown"; }
    }
    // Alasan folder ini tidak bisa dipakai, atau null kalau bisa.
    public static string Check(string path)
    {
        try
        {
            path = path.Trim();
            if (path.Length < 4 || path[1] != ':' || path[2] != '\\') return "Enter a full folder path, such as D:\\Play.";
            path = Path.GetFullPath(path);
            if (Directory.Exists(path) && !File.Exists(Path.Combine(path, "installed")) && Directory.GetFileSystemEntries(path).Length > 0) return "This folder already contains other files. Choose an empty folder.";
            long free = Free(path);
            if (free >= 0 && free < Needed()) return "There is not enough space on this disk.";
            bool made = !Directory.Exists(path);
            Directory.CreateDirectory(path);
            using (File.Create(Path.Combine(path, Path.GetRandomFileName()), 1, FileOptions.DeleteOnClose)) { }
            if (made) Directory.Delete(path);
            return null;
        }
        catch (UnauthorizedAccessException) { return "Your account cannot write to that folder. Choose another one."; }
        catch (Exception e)
        {
            if (e is ArgumentException || e is IOException || e is NotSupportedException || e is System.Security.SecurityException) return "This folder path cannot be used.";
            throw;
        }
    }
    static long needed;
    public static long Needed()
    {
        if (needed == 0)
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
                foreach (ZipArchiveEntry e in zip.Entries) needed += e.Length;
        return needed;
    }
    public static long Free(string path)
    {
        try { return new DriveInfo(Path.GetPathRoot(Path.GetFullPath(path.Trim()))).AvailableFreeSpace; }
        catch (Exception e)
        {
            if (e is ArgumentException || e is IOException || e is NotSupportedException || e is UnauthorizedAccessException || e is System.Security.SecurityException) return -1;
            throw;
        }
    }
    public static string Megabytes(long n)
    {
        double mb = n / 1048576.0;
        return mb < 1024 ? Math.Ceiling(mb).ToString("0") + " MB" : (mb / 1024).ToString("0.#") + " GB";
    }
    // Penanda resmi Microsoft untuk WebView2 Runtime.
    public static bool HasWebView2()
    {
        const string id = @"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        return Runs(Registry.LocalMachine, @"SOFTWARE\WOW6432Node\" + id) || Runs(Registry.CurrentUser, @"Software\" + id);
    }
    static bool Runs(RegistryKey root, string path)
    {
        using (RegistryKey k = root.OpenSubKey(path))
        {
            string v = k == null ? null : k.GetValue("pv") as string;
            return !string.IsNullOrEmpty(v) && v != "0.0.0.0";
        }
    }

    public static void Install(Action<int, string> progress, bool desktop)
    {
        progress(0, "Closing Play if it is open…");
        CloseRunning();
        Directory.CreateDirectory(Target);
        string root = Path.GetFullPath(Target).TrimEnd('\\') + "\\";
        // Folder yang bukan milik Play tidak boleh ditimpa.
        bool ours = File.Exists(Path.Combine(root, "installed")) || Directory.GetFileSystemEntries(root).Length == 0;
        if (!ours) throw new IOException("The folder " + Target + " already contains other files. Choose an empty folder.");
        File.WriteAllText(Path.Combine(root, "installed"), Version);
        foreach (string p in Parts)
            if (Directory.Exists(root + p))
            {
                progress(0, "Removing the old version…");
                Remove(root + p);
            }

        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
        {
            int n = 0;
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                string to = Path.GetFullPath(root + e.FullName.Replace('/', '\\'));
                if (!to.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The installer is damaged. Download it again.");
                if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\")) Directory.CreateDirectory(to);
                else
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    e.ExtractToFile(to, true);
                }
                n++;
                progress(n * 100 / zip.Entries.Count, "Copying file " + n + " of " + zip.Entries.Count + "…");
            }
        }
        string exe = root + "Play.exe";
        if (Shortcuts)
        {
            progress(100, "Creating shortcuts…");
            Link(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Play.lnk"), exe, root);
            if (desktop) Link(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Play.lnk"), exe, root);
            Register(root, exe);
        }
    }

    static void CloseRunning()
    {
        string mine = Path.Combine(Target, "Play.exe");
        foreach (Process p in Process.GetProcessesByName("Play"))
        {
            try
            {
                if (!string.Equals(p.MainModule.FileName, mine, StringComparison.OrdinalIgnoreCase)) continue;
                p.CloseMainWindow();
                if (!p.WaitForExit(6000)) p.Kill();
                p.WaitForExit(3000);
            }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
        }
    }
    static void Remove(string dir)
    {
        for (int i = 0; ; i++)
        {
            try { Directory.Delete(dir, true); return; }
            catch (Exception e)
            {
                if (!(e is IOException || e is UnauthorizedAccessException)) throw;
                if (i == 10) throw new IOException("Play's files are in use. Close Play and try again.");
                System.Threading.Thread.Sleep(400);
            }
        }
    }
    static void Link(string file, string exe, string dir)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object sh = Activator.CreateInstance(t);
        object l = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { file });
        Type k = l.GetType();
        k.InvokeMember("TargetPath", BindingFlags.SetProperty, null, l, new object[] { exe });
        k.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, l, new object[] { dir.TrimEnd('\\') });
        k.InvokeMember("IconLocation", BindingFlags.SetProperty, null, l, new object[] { exe + ",0" });
        k.InvokeMember("Description", BindingFlags.SetProperty, null, l, new object[] { "Play" });
        k.InvokeMember("Save", BindingFlags.InvokeMethod, null, l, null);
        Marshal.ReleaseComObject(l);
        Marshal.ReleaseComObject(sh);
    }
    static void Register(string root, string exe)
    {
        long size = 0;
        foreach (FileInfo f in new DirectoryInfo(root).GetFiles("*", SearchOption.AllDirectories)) size += f.Length;
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Play"))
        {
            k.SetValue("DisplayName", "Play");
            k.SetValue("DisplayVersion", Version);
            k.SetValue("DisplayIcon", exe + ",0");
            k.SetValue("Publisher", "Play");
            k.SetValue("InstallLocation", root.TrimEnd('\\'));
            k.SetValue("UninstallString", "\"" + exe + "\" --uninstall");
            k.SetValue("QuietUninstallString", "\"" + exe + "\" --uninstall --quiet");
            k.SetValue("EstimatedSize", (int)(size / 1024), RegistryValueKind.DWord);
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }
}

static class Ui
{
    public static readonly Color Bg = Color.Black, Side = Color.FromArgb(10, 10, 10), Raise = Color.FromArgb(18, 18, 18), Line = Color.FromArgb(44, 44, 44);
    public static readonly Color Text = Color.FromArgb(244, 244, 244), Soft = Color.FromArgb(160, 160, 160), Warn = Color.FromArgb(224, 175, 104);

    public static GraphicsPath Round(RectangleF r, float d)
    {
        GraphicsPath p = new GraphicsPath();
        d = Math.Min(d, Math.Min(r.Width, r.Height));
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
    // Ikuti setelan Windows untuk efek animasi.
    public static bool Motion()
    {
        bool on = true;
        return !SystemParametersInfo(0x1042, 0, ref on, 0) || on;
    }
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint a, uint b, [MarshalAs(UnmanagedType.Bool)] ref bool v, uint f);
}

class PillButton : Button
{
    public bool Primary;
    bool over;
    public PillButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Cursor = Cursors.Hand;
    }
    protected override void OnMouseEnter(EventArgs e) { over = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { over = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.Clear(Parent.BackColor);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        RectangleF r = new RectangleF(1.5f, 1.5f, Width - 4, Height - 4);
        Color fill = Primary ? (over ? Color.FromArgb(215, 215, 215) : Color.White) : (over ? Color.FromArgb(34, 34, 34) : Ui.Raise);
        if (!Enabled) fill = Color.FromArgb(34, 34, 34);
        using (GraphicsPath p = Ui.Round(r, r.Height))
        {
            using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, p);
            if (!Primary) using (Pen n = new Pen(Ui.Line)) g.DrawPath(n, p);
        }
        if (Focused && ShowFocusCues)
            using (GraphicsPath p = Ui.Round(new RectangleF(4.5f, 4.5f, Width - 10, Height - 10), Height))
            using (Pen n = new Pen(Primary ? Color.Black : Color.White)) g.DrawPath(n, p);
        Color ink = !Enabled ? Color.FromArgb(110, 110, 110) : Primary ? Color.Black : Ui.Text;
        TextRenderer.DrawText(g, Text, Font, ClientRectangle, ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
    }
}

class DarkCheck : CheckBox
{
    public DarkCheck()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        AutoSize = false;
        Cursor = Cursors.Hand;
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.Clear(Parent.BackColor);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float s = Height * 0.68f, y = (Height - s) / 2f;
        using (GraphicsPath p = Ui.Round(new RectangleF(1, y, s, s), s * 0.5f))
        {
            using (SolidBrush b = new SolidBrush(Checked ? Color.White : Ui.Raise)) g.FillPath(b, p);
            using (Pen n = new Pen(Checked ? Color.White : Color.FromArgb(90, 90, 90))) g.DrawPath(n, p);
        }
        if (Checked)
            using (Pen n = new Pen(Color.Black, s * 0.12f))
                g.DrawLines(n, new PointF[] { new PointF(1 + s * 0.25f, y + s * 0.52f), new PointF(1 + s * 0.43f, y + s * 0.70f), new PointF(1 + s * 0.76f, y + s * 0.32f) });
        int left = (int)(s + s * 0.6f);
        Rectangle t = new Rectangle(left, 0, Width - left, Height);
        TextRenderer.DrawText(g, Text, Font, t, Ui.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.SingleLine);
        if (Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(g, t, Color.White, Color.Black);
    }
}

// Pemasang bertahap: selamat datang, lokasi, memasang, selesai.
class SetupForm : Form
{
    static readonly string[] Steps = { "Welcome", "Location", "Installing", "Finish" };
    readonly Panel[] pages = new Panel[4];
    readonly PillButton next = new PillButton(), back = new PillButton();
    readonly TextBox folder = new TextBox();
    readonly PillButton browse = new PillButton();
    readonly DarkCheck desk = new DarkCheck(), open = new DarkCheck();
    readonly Label where = new Label(), space = new Label(), stage = new Label(), welcome = new Label();
    readonly Label endTitle = new Label(), endText = new Label();
    readonly LinkLabel engine = new LinkLabel();
    readonly Timer clock = new Timer();
    readonly bool motion = Ui.Motion();
    readonly string old = Setup.Previous();
    readonly Font big = new Font("Segoe UI Semibold", 16f);
    int step;
    bool busy, failed;
    volatile int pct;
    volatile string doing = "";
    float shown, turn;
    float Scale1 { get { return ClientSize.Width / 660f; } }

    public SetupForm()
    {
        SuspendLayout();
        Text = "Play Setup";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(660, 400);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Ui.Bg;
        ForeColor = Ui.Text;
        DoubleBuffered = true;
        Font = new Font("Segoe UI", 9.75f);
        for (int i = 0; i < pages.Length; i++)
        {
            pages[i] = new Panel();
            pages[i].SetBounds(212, 0, 448, 322);
            pages[i].BackColor = Ui.Bg;
            pages[i].Visible = i == 0;
            Controls.Add(pages[i]);
        }

        // 1. Selamat datang
        Title(pages[0], old == null ? "Install Play" : "Update Play");
        Body(pages[0], welcome, 92, 80, old == null
            ? "A personal YouTube player for Windows, without the ads.\nVersion " + Setup.Version + "."
            : (old == Setup.Version ? "Version " + old + " is installed and will be installed again." : "Version " + old + " will be replaced with version " + Setup.Version + ".") + "\nYour subscriptions, saved videos, and history are kept.");
        Label about = new Label();
        Body(pages[0], about, 178, 110, "Installs for your account only, without administrator rights.\nPlay is for personal use. Fetching streams directly is against the YouTube Terms of Service.");

        // 2. Lokasi
        Title(pages[1], "Location");
        Body(pages[1], where, 92, 26, old == null ? "Play will be installed in this folder." : "Play is already in this folder and will be updated.");
        folder.SetBounds(32, 124, 284, 27);
        folder.BorderStyle = BorderStyle.FixedSingle;
        folder.BackColor = Ui.Raise;
        folder.ForeColor = Ui.Text;
        folder.Text = Setup.Target;
        folder.ReadOnly = old != null;
        folder.AccessibleName = "Install folder";
        folder.TextChanged += delegate { Space(); };
        browse.SetBounds(326, 119, 90, 34);
        browse.Text = "Change…";
        browse.Enabled = old == null;
        browse.Click += delegate { Browse(); };
        Body(pages[1], space, 160, 44, "");
        desk.SetBounds(32, 220, 384, 26);
        desk.Text = "Create a desktop shortcut";
        desk.Checked = old == null;
        pages[1].Controls.Add(folder);
        pages[1].Controls.Add(browse);
        pages[1].Controls.Add(desk);

        // 3. Memasang
        Title(pages[2], old == null ? "Installing" : "Updating");
        Body(pages[2], stage, 92, 90, "");
        pages[2].Paint += PaintBar;

        // 4. Selesai
        endTitle.SetBounds(27, 44, 400, 40);
        endTitle.Font = big;
        pages[3].Controls.Add(endTitle);
        Body(pages[3], endText, 92, 90, "");
        engine.SetBounds(29, 186, 390, 46);
        engine.LinkColor = engine.ActiveLinkColor = engine.VisitedLinkColor = Color.White;
        engine.ForeColor = Ui.Warn;
        engine.Visible = false;
        engine.LinkClicked += delegate { Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true }); };
        open.SetBounds(32, 240, 384, 26);
        open.Text = "Open Play now";
        open.Checked = true;
        pages[3].Controls.Add(engine);
        pages[3].Controls.Add(open);

        back.SetBounds(394, 340, 110, 40);
        back.Click += delegate { Back(); };
        next.SetBounds(514, 340, 124, 40);
        next.Primary = true;
        next.Click += delegate { Next(); };
        Controls.Add(next);
        Controls.Add(back);
        AcceptButton = next;
        clock.Interval = 16;
        clock.Tick += delegate { Tick(); };
        ResumeLayout(false);
        PerformLayout();
        Show(0);
    }

    void Title(Panel p, string text)
    {
        Label l = new Label();
        l.SetBounds(27, 44, 400, 40);
        l.Font = big;
        l.Text = text;
        p.Controls.Add(l);
    }
    static void Body(Panel p, Label l, int y, int h, string text)
    {
        l.SetBounds(29, y, 390, h);
        l.ForeColor = Ui.Soft;
        l.Text = text;
        p.Controls.Add(l);
    }

    void Show(int n)
    {
        step = n;
        for (int i = 0; i < pages.Length; i++) pages[i].Visible = i == n;
        next.Visible = n != 2 || failed;
        back.Visible = n < 2 || (n == 2 && failed);
        back.Text = n == 0 ? "Cancel" : "Back";
        next.Text = n == 0 ? "Next" : n == 1 ? (old == null ? "Install" : "Update") : n == 2 ? "Try again" : "Finish";
        CancelButton = n == 0 ? back : null;
        if (n == 1) Space();
        if (next.Visible) next.Select();
        Invalidate();
    }
    void Back()
    {
        if (step == 0) { Close(); return; }
        failed = false;
        Show(step - 1);
    }
    void Next()
    {
        if (step == 0) Show(1);
        else if (step == 1)
        {
            string bad = Setup.Check(folder.Text);
            if (bad != null) { space.ForeColor = Ui.Warn; space.Text = bad; return; }
            Setup.Target = Path.GetFullPath(folder.Text.Trim());
            Go();
        }
        else if (step == 2) Go();
        else
        {
            if (open.Checked) Process.Start(new ProcessStartInfo(Path.Combine(Setup.Target, "Play.exe")) { UseShellExecute = true });
            Close();
        }
    }

    void Space()
    {
        space.ForeColor = Ui.Soft;
        string s = "Needs " + Setup.Megabytes(Setup.Needed()) + ".";
        long free = Setup.Free(folder.Text);
        if (free >= 0) s += " " + Setup.Megabytes(free) + " available.";
        space.Text = s;
    }
    void Browse()
    {
        using (FolderBrowserDialog d = new FolderBrowserDialog())
        {
            d.Description = "Choose a folder for Play";
            if (d.ShowDialog(this) != DialogResult.OK) return;
            // Folder yang sudah berisi file lain mendapat subfolder sendiri.
            bool used = false;
            try { used = Directory.GetFileSystemEntries(d.SelectedPath).Length > 0 && !File.Exists(Path.Combine(d.SelectedPath, "installed")); }
            catch (UnauthorizedAccessException) { }
            folder.Text = used ? Path.Combine(d.SelectedPath, "Play") : d.SelectedPath;
        }
    }

    async void Go()
    {
        if (busy) return;
        busy = true;
        failed = false;
        pct = 0;
        shown = 0;
        doing = "Preparing…";
        stage.ForeColor = Ui.Soft;
        stage.Text = doing;
        Show(2);
        clock.Start();
        bool d = desk.Checked;
        string error = null;
        try { await Task.Run(delegate { Setup.Install(delegate(int p, string t) { pct = p; doing = t; }, d); }); }
        catch (Exception e) { error = e.Message; }
        clock.Stop();
        busy = false;
        turn = 0;
        if (error != null)
        {
            failed = true;
            stage.ForeColor = Ui.Warn;
            stage.Text = error;
            Show(2);
            return;
        }
        endTitle.Text = old == null ? "Play is ready" : "Play is up to date";
        endText.Text = "The first time it opens, Play downloads yt-dlp, about 23 MB, if this PC does not have it. Videos wait and then start by themselves.";
        if (!Setup.HasWebView2())
        {
            engine.Text = "Microsoft Edge WebView2 is missing on this PC. Install it from Microsoft first.";
            engine.LinkArea = new LinkArea(engine.Text.IndexOf("Install it"), "Install it from Microsoft first".Length);
            engine.Visible = true;
            open.Checked = false;
        }
        Show(3);
    }
    void Tick()
    {
        shown += (pct - shown) * (motion ? 0.16f : 1f);
        if (motion) turn = (turn + 4f) % 360f;
        if (stage.Text != doing) stage.Text = doing;
        pages[2].Invalidate(new Rectangle(0, (int)(190 * Scale1), pages[2].Width, (int)(50 * Scale1)));
        Invalidate(new Rectangle(0, 0, (int)(212 * Scale1), (int)(100 * Scale1)));
    }
    void PaintBar(object o, PaintEventArgs e)
    {
        float k = Scale1;
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        RectangleF r = new RectangleF(32 * k, 204 * k, 384 * k, 5 * k);
        using (GraphicsPath p = Ui.Round(r, r.Height)) using (SolidBrush b = new SolidBrush(Color.FromArgb(40, 40, 40))) g.FillPath(b, p);
        float w = r.Width * Math.Min(100f, shown) / 100f;
        if (w < r.Height) return;
        using (GraphicsPath p = Ui.Round(new RectangleF(r.X, r.Y, w, r.Height), r.Height)) g.FillPath(Brushes.White, p);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        float k = Scale1;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (SolidBrush b = new SolidBrush(Ui.Side)) g.FillRectangle(b, 0, 0, 212 * k, ClientSize.Height);
        using (Pen n = new Pen(Color.FromArgb(30, 30, 30))) g.DrawLine(n, 212 * k - 1, 0, 212 * k - 1, ClientSize.Height);
        using (Matrix m = new Matrix())
        {
            m.Translate(32 * k, 50 * k);
            m.Scale(132f / 422f * k, 132f / 422f * k);
            m.Translate(-14, -47);
            using (GraphicsPath logo = Logo())
            {
                logo.Transform(m);
                g.FillPath(Brushes.White, logo);
            }
            // Segitiga logo berputar selama memasang, seperti saat Play memuat halaman.
            using (GraphicsPath tri = new GraphicsPath())
            {
                tri.AddPolygon(new PointF[] { new PointF(235, 47), new PointF(311, 83), new PointF(235, 119) });
                m.RotateAt(turn, new PointF(261, 83));
                tri.Transform(m);
                g.FillPath(Brushes.White, tri);
            }
        }
        for (int i = 0; i < Steps.Length; i++)
        {
            float y = (130 + i * 36) * k;
            bool now = i == step, past = i < step;
            Color c = now ? Ui.Text : past ? Ui.Soft : Color.FromArgb(98, 98, 98);
            RectangleF dot = new RectangleF(32 * k, y + 6 * k, 8 * k, 8 * k);
            if (now || past) using (SolidBrush b = new SolidBrush(now ? Color.White : Color.FromArgb(120, 120, 120))) g.FillEllipse(b, dot);
            else using (Pen n = new Pen(c)) g.DrawEllipse(n, dot);
            TextRenderer.DrawText(g, Steps[i], Font, new Rectangle((int)(52 * k), (int)y, (int)(150 * k), (int)(20 * k)), c, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        }
        TextRenderer.DrawText(g, "Version " + Setup.Version, Font, new Rectangle((int)(32 * k), (int)(350 * k), (int)(150 * k), (int)(20 * k)), Color.FromArgb(120, 120, 120), TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPadding);
    }
    static GraphicsPath Logo()
    {
        GraphicsPath p = new GraphicsPath(FillMode.Alternate);
        p.StartFigure(); // P
        p.AddLine(14, 47, 101, 47);
        p.AddBezier(101, 47, 116, 47, 124, 57, 124, 71.5f);
        p.AddBezier(124, 71.5f, 124, 86, 116, 96, 101, 96);
        p.AddLine(101, 96, 36, 96);
        p.AddLine(36, 119, 14, 119);
        p.AddLine(14, 79, 96.5f, 79);
        p.AddArc(89, 64, 15, 15, 90, -180);
        p.AddLine(96.5f, 64, 33, 64);
        p.AddBezier(33, 64, 22, 64, 14, 57, 14, 47);
        p.CloseFigure();
        p.StartFigure(); // L
        p.AddLine(134, 47, 155, 47);
        p.AddLine(155, 47, 155, 93);
        p.AddArc(155, 85, 16, 16, 180, -90);
        p.AddLine(163, 101, 221, 101);
        p.AddLine(221, 119, 155, 119);
        p.AddArc(134, 77, 42, 42, 90, 90);
        p.CloseFigure();
        p.AddPolygon(new PointF[] { new PointF(314, 47), new PointF(343, 47), new PointF(374, 78), new PointF(405, 47), new PointF(436, 47), new PointF(364, 119), new PointF(334, 119), new PointF(360, 93) });
        return p;
    }
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int on = 1, black = 0;
        DwmSetWindowAttribute(Handle, 20, ref on, 4);
        DwmSetWindowAttribute(Handle, 35, ref black, 4);
    }
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (busy) e.Cancel = true; // jangan berhenti di tengah pemasangan
        base.OnFormClosing(e);
    }
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);
}
