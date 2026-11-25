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
            else if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) Target = Path.GetFullPath(a.Substring(3).Trim('"'));
        }
        if (silent)
        {
            try { Install(delegate { }, false); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
        return 0;
    }

    public static void Install(Action<int> progress, bool desktop)
    {
        CloseRunning();
        Directory.CreateDirectory(Target);
        string root = Path.GetFullPath(Target).TrimEnd('\\') + "\\";
        // Folder yang bukan milik Play tidak boleh ditimpa.
        bool ours = File.Exists(Path.Combine(root, "installed")) || Directory.GetFileSystemEntries(root).Length == 0;
        if (!ours) throw new IOException("Folder " + Target + " sudah berisi file lain. Pilih folder kosong.");
        File.WriteAllText(Path.Combine(root, "installed"), Version);
        foreach (string p in Parts) if (Directory.Exists(root + p)) Remove(root + p);

        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
        {
            int n = 0;
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                string to = Path.GetFullPath(root + e.FullName.Replace('/', '\\'));
                if (!to.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Isi pemasang rusak.");
                if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\")) Directory.CreateDirectory(to);
                else
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    e.ExtractToFile(to, true);
                }
                progress(++n * 100 / zip.Entries.Count);
            }
        }
        string exe = root + "Play.exe";
        if (Shortcuts)
        {
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
                if (i == 10) throw new IOException("File Play sedang dipakai. Tutup Play lalu coba lagi.");
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

class SetupForm : Form
{
    readonly Button go = new Button();
    readonly CheckBox desk = new CheckBox();
    readonly Label note = new Label();
    int pct = -1;
    bool busy, done;

    public SetupForm()
    {
        Text = "Pasang Play";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleDimensions = new SizeF(96f, 96f);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(520, 340);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.Black;
        ForeColor = Color.White;
        DoubleBuffered = true;
        Font = new Font("Segoe UI", 9.75f);

        note.SetBounds(40, 176, 440, 44);
        note.ForeColor = Color.FromArgb(155, 155, 155);
        note.TextAlign = ContentAlignment.MiddleCenter;
        note.Text = "Versi " + Setup.Version + ". Dipasang untuk akun ini saja, tanpa hak admin.";
        desk.SetBounds(186, 226, 200, 26);
        desk.Text = "Pintasan di Desktop";
        desk.Checked = true;
        go.SetBounds(190, 266, 140, 42);
        go.Text = "Pasang";
        go.FlatStyle = FlatStyle.Flat;
        go.FlatAppearance.BorderSize = 0;
        go.BackColor = Color.White;
        go.ForeColor = Color.Black;
        go.Click += delegate { Go(); };
        Controls.Add(note);
        Controls.Add(desk);
        Controls.Add(go);
        AcceptButton = go;
    }

    async void Go()
    {
        if (done)
        {
            Process.Start(new ProcessStartInfo(Path.Combine(Setup.Target, "Play.exe")) { UseShellExecute = true });
            Close();
            return;
        }
        if (busy) return;
        busy = true;
        go.Visible = desk.Visible = false;
        note.Text = "Memasang…";
        bool d = desk.Checked;
        try
        {
            await Task.Run(delegate
            {
                Setup.Install(delegate(int p)
                {
                    if (p == pct) return;
                    pct = p;
                    try { BeginInvoke(new Action(Invalidate)); } catch (InvalidOperationException) { }
                }, d);
            });
            done = true;
            note.Text = "Selesai. Play siap dipakai.";
            go.Text = "Buka Play";
        }
        catch (Exception e)
        {
            note.Text = e.Message;
            go.Text = "Coba lagi";
        }
        busy = false;
        pct = -1;
        go.Visible = true;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float k = ClientSize.Width / 520f;
        using (GraphicsPath logo = Logo())
        using (Matrix m = new Matrix())
        {
            m.Translate(140 * k, 78 * k);
            m.Scale(240f / 422f * k, 240f / 422f * k);
            m.Translate(-14, -47);
            logo.Transform(m);
            g.FillPath(Brushes.White, logo);
        }
        if (pct < 0) return;
        using (SolidBrush b = new SolidBrush(Color.FromArgb(40, 40, 40))) g.FillRectangle(b, 110 * k, 262 * k, 300 * k, 3 * k);
        g.FillRectangle(Brushes.White, 110 * k, 262 * k, 300 * k * pct / 100f, 3 * k);
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
        p.AddPolygon(new PointF[] { new PointF(235, 47), new PointF(311, 83), new PointF(235, 119) });
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
