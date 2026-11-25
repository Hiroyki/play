// Play untuk Windows: jendela native (WinForms + WebView2) yang menjalankan server lokal tanpa jendela hitam.
// Dikompilasi dengan csc.exe bawaan Windows (C# 5), lihat build.ps1.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Play")]
[assembly: AssemblyProduct("Play")]
[assembly: AssemblyVersion("1.0.0.0")]

static class Program
{
    public const string AppId = "Play.Desktop";
    public static string Root;
    public static string Data;
    public static bool Installed;

    [STAThread]
    static void Main(string[] args)
    {
        Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        // Versi terpasang menyimpan data di luar folder program, jadi aman saat diperbarui atau dihapus.
        Installed = File.Exists(Path.Combine(Root, "installed"));
        Data = Installed ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Play") : Path.Combine(Root, "data");
        if (Array.IndexOf(args, "--uninstall") >= 0) { Uninstall.Run(Array.IndexOf(args, "--quiet") >= 0); return; }
        // DLL WebView2 ada di folder windows\lib, bukan di sebelah exe.
        AppDomain.CurrentDomain.AssemblyResolve += delegate(object s, ResolveEventArgs e)
        {
            string file = Path.Combine(Root, "windows", "lib", new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(file) ? Assembly.LoadFrom(file) : null;
        };
        Run(args);
    }

    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void Run(string[] args)
    {
        string link = args.Length > 0 ? args[0] : "";
        bool first;
        using (Mutex mutex = new Mutex(true, "Local\\" + AppId, out first))
        {
            if (!first)
            {
                Single.Send(link);
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e) { Log.Write("ui: " + e.Exception); };
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e) { Log.Write("fatal: " + e.ExceptionObject); };
            Application.Run(new MainForm(link));
            GC.KeepAlive(mutex);
        }
    }
}

static class Log
{
    static readonly object gate = new object();
    public static string File1 { get { return Path.Combine(Program.Data, "play.log"); } }
    public static void Write(string text)
    {
        try
        {
            lock (gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(File1));
                FileInfo f = new FileInfo(File1);
                if (f.Exists && f.Length > 512 * 1024) f.Delete();
                File.AppendAllText(File1, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + text + Environment.NewLine);
            }
        }
        catch { }
    }
}

// Cuma satu jendela; pembukaan kedua mengirim link ke jendela pertama.
static class Single
{
    const string Pipe = "Play.Desktop.Pipe";
    public static void Send(string link)
    {
        try
        {
            using (NamedPipeClientStream c = new NamedPipeClientStream(".", Pipe, PipeDirection.Out))
            {
                c.Connect(3000);
                byte[] b = Encoding.UTF8.GetBytes(link ?? "");
                c.Write(b, 0, Math.Min(b.Length, 2000));
            }
        }
        catch { }
    }
    public static void Listen(Action<string> got)
    {
        Thread t = new Thread(delegate()
        {
            while (true)
            {
                try
                {
                    using (NamedPipeServerStream s = new NamedPipeServerStream(Pipe, PipeDirection.In, 1))
                    {
                        s.WaitForConnection();
                        byte[] b = new byte[2000];
                        int n = s.Read(b, 0, b.Length);
                        got(Encoding.UTF8.GetString(b, 0, n));
                    }
                }
                catch { Thread.Sleep(500); }
            }
        });
        t.IsBackground = true;
        t.Start();
    }
}

// Server Node di latar. Ikut mati saat Play ditutup, termasuk yt-dlp yang sedang jalan.
class Backend
{
    Process proc;
    IntPtr job;
    public int Port;
    public bool Owned;
    public string Error = "";
    readonly StringBuilder tail = new StringBuilder();

    public string Url { get { return "http://localhost:" + Port; } }
    public bool Dead { get { return Owned && proc != null && proc.HasExited; } }

    static string Library
    {
        get
        {
            string own = Environment.GetEnvironmentVariable("PLAY_LIBRARY");
            return Path.GetFullPath(string.IsNullOrEmpty(own) ? Path.Combine(Program.Data, "library.json") : own);
        }
    }
    static string DataId()
    {
        using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Library.ToLowerInvariant()))).Replace("-", "").ToLowerInvariant().Substring(0, 16);
    }
    // Hanya server yang memakai data yang sama yang boleh dipakai bersama.
    public static bool IsPlay(int port)
    {
        try
        {
            HttpWebRequest r = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/ping"); // bukan localhost: IPv6 dicoba dulu dan lambat
            r.Timeout = 1500;
            r.Proxy = null;
            using (WebResponse w = r.GetResponse())
            using (StreamReader sr = new StreamReader(w.GetResponseStream()))
                return sr.ReadToEnd().Contains("\"id\":\"" + DataId() + "\"");
        }
        catch { return false; }
    }
    static bool Free(int port)
    {
        try
        {
            TcpListener l = new TcpListener(IPAddress.Loopback, port);
            l.Start();
            l.Stop();
            return true;
        }
        catch (SocketException) { return false; }
    }
    static string Find(string exe, params string[] extra)
    {
        List<string> dirs = new List<string>(extra);
        dirs.AddRange((Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'));
        foreach (string d in dirs)
        {
            try
            {
                if (d.Trim().Length == 0) continue;
                string f = Path.Combine(d.Trim().Trim('"'), exe);
                if (File.Exists(f)) return f;
            }
            catch (ArgumentException) { }
        }
        return null;
    }

    public bool Start()
    {
        Error = "";
        if (proc != null && !proc.HasExited)
        {
            if (Owned && IsPlay(Port)) return true;
            try { proc.Kill(); proc.WaitForExit(2000); } catch { }
        }
        lock (tail) tail.Length = 0;
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string node = Find("node.exe", Path.Combine(Program.Root, "runtime"), Path.Combine(pf, "nodejs"));
        if (node == null) { Error = "Node.js belum terpasang.\nAmbil versi LTS di nodejs.org, lalu buka Play lagi."; return false; }
        if (!File.Exists(Path.Combine(Program.Root, "server", "index.js"))) { Error = "Folder server tidak ditemukan.\nPlay.exe harus berada di folder Play."; return false; }
        if (!Directory.Exists(Path.Combine(Program.Root, "node_modules"))) { Error = "Komponen belum lengkap.\nJalankan 'npm install' di folder Play."; return false; }

        // Port tetap supaya pengaturan dan posisi tersimpan; geser hanya kalau dipakai program lain.
        Port = 0;
        for (int p = 4321; p < 4341; p++)
        {
            if (Free(p)) { Port = p; break; }
            if (IsPlay(p)) { Port = p; Owned = false; return true; }
        }
        if (Port == 0) { Error = "Tidak ada port yang kosong untuk Play."; return false; }

        ProcessStartInfo si = new ProcessStartInfo(node, "\"" + Path.Combine(Program.Root, "server", "index.js") + "\"");
        si.WorkingDirectory = Program.Root;
        si.UseShellExecute = false;
        si.CreateNoWindow = true;
        si.RedirectStandardError = true;
        si.RedirectStandardOutput = true;
        si.StandardErrorEncoding = Encoding.UTF8;
        si.StandardOutputEncoding = Encoding.UTF8;
        si.EnvironmentVariables["PORT"] = Port.ToString();
        si.EnvironmentVariables["PLAY_LIBRARY"] = Library;
        si.EnvironmentVariables["PLAY_BIN"] = Path.Combine(Program.Data, "bin");
        if (Program.Installed) si.EnvironmentVariables["PLAY_INSTALLED"] = "1";
        proc = new Process();
        proc.StartInfo = si;
        proc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            Log.Write("server: " + e.Data);
            lock (tail) { if (tail.Length < 600) tail.AppendLine(e.Data); }
        };
        proc.OutputDataReceived += delegate { };
        try { proc.Start(); }
        catch (Win32Exception e) { Error = "Server tidak bisa dijalankan.\n" + e.Message; return false; }
        Owned = true;
        Contain();
        proc.BeginErrorReadLine();
        proc.BeginOutputReadLine();

        Stopwatch w = Stopwatch.StartNew();
        while (w.ElapsedMilliseconds < 20000)
        {
            if (proc.HasExited) { lock (tail) { Error = "Server berhenti.\n" + tail; } return false; }
            if (IsPlay(Port)) return true;
            Thread.Sleep(80);
        }
        Error = "Server terlalu lama menyala.";
        return false;
    }

    public void Stop()
    {
        try { if (Owned && proc != null && !proc.HasExited) proc.Kill(); } catch { }
        if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
    }

    // Job object: semua proses anak ditutup Windows begitu Play mati, walaupun crash.
    void Contain()
    {
        if (job == IntPtr.Zero)
        {
            job = CreateJobObject(IntPtr.Zero, null);
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            int len = Marshal.SizeOf(info);
            IntPtr ptr = Marshal.AllocHGlobal(len);
            Marshal.StructureToPtr(info, ptr, false);
            SetInformationJobObject(job, 9, ptr, (uint)len);
            Marshal.FreeHGlobal(ptr);
        }
        AssignProcessToJobObject(job, proc.Handle);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION Basic;
        public IO_COUNTERS Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr p, uint l);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
}

// Menghapus program dan pintasan. Langganan, simpanan, dan riwayat dibiarkan.
static class Uninstall
{
    public static void Run(bool quiet)
    {
        if (!Program.Installed) return; // folder kerja pengembang tidak boleh ikut terhapus
        if (!quiet && MessageBox.Show("Hapus Play dari PC ini?\n\nLangganan, simpanan, dan riwayat tetap ada di\n" + Program.Data, "Play", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        int me = Process.GetCurrentProcess().Id;
        string exe = Application.ExecutablePath;
        foreach (Process p in Process.GetProcessesByName("Play"))
        {
            try
            {
                if (p.Id == me || !string.Equals(p.MainModule.FileName, exe, StringComparison.OrdinalIgnoreCase)) continue;
                p.CloseMainWindow();
                if (!p.WaitForExit(6000)) p.Kill();
            }
            catch (InvalidOperationException) { }
            catch (Win32Exception) { }
        }
        foreach (Environment.SpecialFolder f in new Environment.SpecialFolder[] { Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.Programs })
        {
            string lnk = Path.Combine(Environment.GetFolderPath(f), "Play.lnk");
            try { if (File.Exists(lnk) && Target(lnk).StartsWith(Program.Root + "\\", StringComparison.OrdinalIgnoreCase)) File.Delete(lnk); } catch (Exception e) { Log.Write("pintasan: " + e.Message); }
        }
        const string key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Play";
        using (Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(key))
            if (k != null && string.Equals(k.GetValue("InstallLocation") as string, Program.Root, StringComparison.OrdinalIgnoreCase))
                Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(key, false);
        // Hanya bagian milik Play yang dihapus; file lain di folder itu tidak disentuh.
        StringBuilder c = new StringBuilder("/d /c ping -n 3 127.0.0.1 >nul");
        foreach (string d in new string[] { "server", "public", "node_modules", "windows", "runtime" }) c.Append(" & rd /s /q \"" + Path.Combine(Program.Root, d) + "\"");
        foreach (string f in new string[] { "Play.exe", "package.json", "package-lock.json", "installed" }) c.Append(" & del /f /q \"" + Path.Combine(Program.Root, f) + "\"");
        c.Append(" & rd \"" + Program.Root + "\"");
        ProcessStartInfo si = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe"), c.ToString());
        si.CreateNoWindow = true;
        si.UseShellExecute = false;
        si.WorkingDirectory = Path.GetTempPath();
        Process.Start(si);
        if (!quiet) MessageBox.Show("Play sudah dihapus.", "Play", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
    static string Target(string lnk)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object sh = Activator.CreateInstance(t);
        object l = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
        return (string)l.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, l, null);
    }
}

class MainForm : Form
{
    readonly Backend backend = new Backend();
    readonly WebView2 web = new WebView2();
    readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();
    readonly Panel fail = new Panel();
    readonly Label failText = new Label();
    readonly TaskbarButtons bar = new TaskbarButtons();
    string pending;
    bool ready, full, playing, hasNext, closing;
    FormBorderStyle keepStyle;
    FormWindowState keepState;
    Rectangle keepBounds;

    static string StateFile { get { return Path.Combine(Program.Data, "jendela.txt"); } }

    public MainForm(string link)
    {
        pending = link;
        Text = "Play";
        BackColor = Color.Black;
        MinimumSize = new Size(420, 480);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleMode = AutoScaleMode.Dpi;
        KeyPreview = true;
        Place();

        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Black;
        web.AllowExternalDrop = false;
        Controls.Add(web);
        BuildFail();

        watch.Interval = 3000;
        watch.Tick += delegate { if (ready && !closing && backend.Dead) Boot(); };
        Single.Listen(delegate(string s)
        {
            try { BeginInvoke(new Action(delegate { Surface(); OpenLink(s); })); } catch (InvalidOperationException) { }
        });
        Shown += delegate { Boot(); };
    }

    // ---------- posisi jendela ----------
    void Place()
    {
        Rectangle work = Screen.PrimaryScreen.WorkingArea;
        Size = new Size(Math.Min(1360, work.Width * 9 / 10), Math.Min(860, work.Height * 9 / 10));
        StartPosition = FormStartPosition.CenterScreen;
        try
        {
            string[] p = File.ReadAllText(StateFile).Split(',');
            Rectangle r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            bool seen = false;
            foreach (Screen s in Screen.AllScreens)
            {
                Rectangle i = Rectangle.Intersect(s.WorkingArea, r);
                if (i.Width > 200 && i.Height > 120) seen = true;
            }
            if (seen && r.Width >= 420 && r.Height >= 400)
            {
                StartPosition = FormStartPosition.Manual;
                Bounds = r;
            }
            if (p[4].Trim() == "1") WindowState = FormWindowState.Maximized;
        }
        catch { }
    }
    void SavePlace()
    {
        try
        {
            if (full) ToggleFull(false);
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(Path.GetDirectoryName(StateFile));
            File.WriteAllText(StateFile, string.Join(",", r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized ? 1 : 0));
        }
        catch { }
    }
    void Surface()
    {
        if (WindowState == FormWindowState.Minimized) ShowWindow(Handle, 9);
        Activate();
        SetForegroundWindow(Handle);
    }

    // ---------- menyala ----------
    bool booting;
    async void Boot()
    {
        if (booting) return;
        booting = true;
        try
        {
            fail.Visible = false;
            bool ok = await Task.Run(new Func<bool>(backend.Start));
            if (closing) { backend.Stop(); return; }
            if (!ok) { ShowFail(backend.Error, null); return; }
            if (web.CoreWebView2 == null && !await Engine()) return;
            string path = PathOf(pending) ?? "/";
            pending = null;
            web.CoreWebView2.Navigate(backend.Url + path);
            web.Focus();
            ready = true;
            watch.Start();
        }
        catch (Exception e)
        {
            Log.Write("boot: " + e);
            ShowFail("Play gagal dibuka.\n" + e.Message, null);
        }
        finally { booting = false; }
    }

    async Task<bool> Engine()
    {
        try
        {
            CoreWebView2Environment.SetLoaderDllFolderPath(Path.Combine(Program.Root, "windows", "lib"));
            CoreWebView2EnvironmentOptions o = new CoreWebView2EnvironmentOptions();
            o.AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required";
            o.Language = "id";
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.Data, "webview"), o);
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowFail("Microsoft Edge WebView2 belum terpasang.\nPasang dari situs Microsoft, lalu buka Play lagi.", "https://developer.microsoft.com/microsoft-edge/webview2/");
            return false;
        }
        CoreWebView2 c = web.CoreWebView2;
        CoreWebView2Settings s = c.Settings;
        s.AreDevToolsEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = true;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.AreHostObjectsAllowed = false;
        c.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Dark;

        c.DocumentTitleChanged += delegate { string t = c.DocumentTitle; Text = string.IsNullOrEmpty(t) ? "Play" : t; };
        c.ContainsFullScreenElementChanged += delegate { ToggleFull(c.ContainsFullScreenElement); };
        c.NewWindowRequested += delegate(object a, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; External(e.Uri); };
        c.NavigationStarting += delegate(object a, CoreWebView2NavigationStartingEventArgs e)
        {
            if (Mine(e.Uri)) return;
            e.Cancel = true;
            if (e.IsUserInitiated) External(e.Uri);
        };
        c.PermissionRequested += delegate(object a, CoreWebView2PermissionRequestedEventArgs e)
        {
            bool ok = Mine(e.Uri) && (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead || e.PermissionKind == CoreWebView2PermissionKind.Autoplay);
            e.State = ok ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
        c.ContextMenuRequested += delegate(object a, CoreWebView2ContextMenuRequestedEventArgs e)
        {
            // Menu klik kanan cuma untuk kolom isian dan teks yang dipilih.
            if (!e.ContextMenuTarget.IsEditable && !e.ContextMenuTarget.HasSelection) { e.Handled = true; return; }
            for (int i = e.MenuItems.Count - 1; i >= 0; i--)
            {
                string n = e.MenuItems[i].Name;
                if (n != "cut" && n != "copy" && n != "paste" && n != "selectAll" && n != "undo" && n != "redo") e.MenuItems.RemoveAt(i);
            }
        };
        c.WebMessageReceived += delegate(object a, CoreWebView2WebMessageReceivedEventArgs e) { if (Mine(e.Source)) Message(e); };
        c.ProcessFailed += delegate(object a, CoreWebView2ProcessFailedEventArgs e)
        {
            Log.Write("webview: " + e.ProcessFailedKind);
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                BeginInvoke(new Action(delegate { try { c.Reload(); } catch { } }));
        };
        c.NavigationCompleted += delegate(object a, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess && e.WebErrorStatus == CoreWebView2WebErrorStatus.CannotConnect && !closing) Boot();
        };
        await c.AddScriptToExecuteOnDocumentCreatedAsync(Bridge);
        web.KeyDown += Keys_;
        return true;
    }

    // Kabar kecil dari halaman: sedang main atau tidak, dan ada video berikutnya atau tidak.
    const string Bridge = @"(() => {
  if (window.top !== window) return;
  const wv = window.chrome.webview;
  let last = '';
  const tell = () => {
    const v = document.querySelector('.player video');
    const s = JSON.stringify({ on: !!(v && v.readyState > 0), playing: !!(v && !v.paused && !v.ended), next: !!(window.playHasNext && window.playHasNext()) });
    if (s !== last) { last = s; wv.postMessage(s); }
  };
  for (const e of ['play', 'pause', 'ended', 'emptied', 'loadeddata']) document.addEventListener(e, tell, true);
  setInterval(tell, 2000);
})();";

    void Message(CoreWebView2WebMessageReceivedEventArgs e)
    {
        string s;
        try { s = e.TryGetWebMessageAsString(); } catch (ArgumentException) { return; }
        if (s == null || s.Length > 200) return;
        bool on = s.Contains("\"on\":true");
        playing = s.Contains("\"playing\":true");
        hasNext = s.Contains("\"next\":true");
        bar.Update(Handle, on, playing, hasNext);
        // Layar jangan mati selama menonton.
        SetThreadExecutionState(playing ? 0x80000003u : 0x80000000u);
    }

    bool Mine(string uri)
    {
        Uri u;
        return Uri.TryCreate(uri, UriKind.Absolute, out u) && (u.Scheme == "about" || (u.Scheme == "http" && u.Host == "localhost" && u.Port == backend.Port));
    }
    static void External(string uri)
    {
        Uri u;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out u) || (u.Scheme != "https" && u.Scheme != "http")) return;
        try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch (Win32Exception) { }
    }

    // Link YouTube yang dikirim lewat argumen menjadi alamat di dalam Play.
    static string PathOf(string link)
    {
        if (string.IsNullOrEmpty(link)) return null;
        Match m = Regex.Match(link, @"^(?:https?://)?(?:(?:www|m|music)\.)?(?:youtu\.be/|youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|live/|embed/))([\w-]{11})(?![\w-])", RegexOptions.IgnoreCase);
        if (m.Success) return "/watch?v=" + m.Groups[1].Value;
        m = Regex.Match(link, @"^(?:https?://)?(?:www\.)?youtube\.com/playlist\?(?:[^#]*&)?list=([\w-]{10,64})", RegexOptions.IgnoreCase);
        return m.Success ? "/playlist?list=" + m.Groups[1].Value : null;
    }
    void OpenLink(string link)
    {
        string p = PathOf(link);
        if (p == null) return;
        if (ready) web.CoreWebView2.Navigate(backend.Url + p);
        else pending = link;
    }

    // ---------- tombol ----------
    void Keys_(object sender, KeyEventArgs e)
    {
        if (!ready) return;
        if (e.KeyCode == Keys.F5) { web.CoreWebView2.Reload(); e.Handled = true; }
        else if (e.KeyCode == Keys.F11) { ToggleFull(!full); e.Handled = true; }
        else if (e.Alt && e.KeyCode == Keys.Left) { web.CoreWebView2.GoBack(); e.Handled = true; }
        else if (e.Alt && e.KeyCode == Keys.Right) { web.CoreWebView2.GoForward(); e.Handled = true; }
        else if (e.Control && (e.KeyCode == Keys.K || e.KeyCode == Keys.L)) { Js("document.querySelector('.find')?.click()"); e.Handled = true; }
    }
    async void Js(string code)
    {
        try { if (ready) await web.CoreWebView2.ExecuteScriptAsync(code); } catch (Exception e) { Log.Write("js: " + e.Message); }
    }

    void ToggleFull(bool on)
    {
        if (on == full) return;
        full = on;
        if (on)
        {
            keepStyle = FormBorderStyle;
            keepState = WindowState;
            keepBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Rectangle screen = Screen.FromControl(this).Bounds;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = screen;
        }
        else
        {
            FormBorderStyle = keepStyle;
            Bounds = keepBounds;
            WindowState = keepState;
        }
    }

    // ---------- layar gagal ----------
    string failUrl;
    readonly Button failOpen = new Button();
    void BuildFail()
    {
        fail.Dock = DockStyle.Fill;
        fail.BackColor = Color.Black;
        fail.Visible = false;
        failText.ForeColor = Color.Gainsboro;
        failText.Font = new Font("Segoe UI", 12f);
        failText.TextAlign = ContentAlignment.MiddleCenter;
        Button again = new Button();
        Style(again, "Coba lagi");
        again.Click += delegate { Boot(); };
        Style(failOpen, "Buka situs");
        failOpen.Click += delegate { External(failUrl); };
        fail.Controls.Add(failText);
        fail.Controls.Add(again);
        fail.Controls.Add(failOpen);
        failAgain = again;
        fail.Resize += delegate { ArrangeFail(); };
        Controls.Add(fail);
    }
    Button failAgain;
    void ArrangeFail()
    {
        int w = ClientSize.Width, h = ClientSize.Height;
        failText.SetBounds(24, h / 2 - 170, Math.Max(10, w - 48), 150);
        failAgain.SetBounds(failUrl != null ? w / 2 - 150 : w / 2 - 70, h / 2, 140, 42);
        failOpen.SetBounds(w / 2 + 10, h / 2, 140, 42);
    }
    static void Style(Button b, string text)
    {
        b.Text = text;
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderColor = Color.FromArgb(70, 70, 70);
        b.BackColor = Color.FromArgb(24, 24, 24);
        b.ForeColor = Color.White;
        b.Font = new Font("Segoe UI", 10f);
    }
    void ShowFail(string text, string url)
    {
        Log.Write("gagal: " + text.Replace("\n", " "));
        failText.Text = text;
        failUrl = url;
        failOpen.Visible = url != null;
        fail.Visible = true;
        fail.BringToFront();
        ArrangeFail();
    }

    // ---------- Windows ----------
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int on = 1;
        DwmSetWindowAttribute(Handle, 20, ref on, 4); // bilah judul gelap
        int black = 0;
        DwmSetWindowAttribute(Handle, 35, ref black, 4); // hitam, menyatu dengan halaman
        int edge = 0x222222;
        DwmSetWindowAttribute(Handle, 34, ref edge, 4);
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == TaskbarButtons.Created) bar.Attach(Handle, playing, hasNext);
        else if (m.Msg == 0x0111 && ((int)m.WParam >> 16 & 0xffff) == 0x1800)
        {
            int id = (int)m.WParam & 0xffff;
            if (id == 1) Js("document.querySelector('.player .pp')?.click()");
            if (id == 2) Js("window.playNext?.()");
            return;
        }
        base.WndProc(ref m);
    }
    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        closing = true;
        watch.Stop();
        SavePlace();
        SetThreadExecutionState(0x80000000u);
        base.OnFormClosing(e);
    }
    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        web.Dispose(); // beri kesempatan halaman menyimpan posisi tonton
        Thread.Sleep(250);
        backend.Stop();
        base.OnFormClosed(e);
    }

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint f);
}

// Tombol putar/jeda dan berikutnya di pratinjau taskbar.
class TaskbarButtons
{
    public static readonly int Created = RegisterWindowMessage("TaskbarButtonCreated");
    ITaskbarList3 list;
    bool added;
    Icon play, pause, next;
    string shown = "";

    public void Attach(IntPtr h, bool playing, bool hasNext)
    {
        try
        {
            list = (ITaskbarList3)new TaskbarInstance();
            list.HrInit();
            play = Draw(delegate(Graphics g) { g.FillPolygon(Brushes.White, new Point[] { new Point(9, 5), new Point(27, 16), new Point(9, 27) }); });
            pause = Draw(delegate(Graphics g) { g.FillRectangle(Brushes.White, 8, 6, 6, 20); g.FillRectangle(Brushes.White, 18, 6, 6, 20); });
            next = Draw(delegate(Graphics g) { g.FillPolygon(Brushes.White, new Point[] { new Point(6, 6), new Point(21, 16), new Point(6, 26) }); g.FillRectangle(Brushes.White, 22, 6, 4, 20); });
            added = false;
            shown = "";
            Update(h, false, playing, hasNext);
        }
        catch (Exception e) { Log.Write("taskbar: " + e.Message); list = null; }
    }
    public void Update(IntPtr h, bool on, bool playing, bool hasNext)
    {
        string key = on + "," + playing + "," + hasNext;
        if (list == null || key == shown) return;
        shown = key;
        try
        {
            THUMBBUTTON[] b = new THUMBBUTTON[2];
            b[0] = Make(1, playing ? pause : play, playing ? "Jeda" : "Putar", on);
            b[1] = Make(2, next, "Video berikutnya", on && hasNext);
            if (added) list.ThumbBarUpdateButtons(h, 2, b);
            else { list.ThumbBarAddButtons(h, 2, b); added = true; }
        }
        catch (Exception e) { Log.Write("taskbar: " + e.Message); }
    }
    static THUMBBUTTON Make(uint id, Icon i, string tip, bool enabled)
    {
        THUMBBUTTON t = new THUMBBUTTON();
        t.dwMask = 2 | 4 | 8; // ikon, tip, flags
        t.iId = id;
        t.hIcon = i.Handle;
        t.szTip = tip;
        t.dwFlags = enabled ? 0u : 1u;
        return t;
    }
    static Icon Draw(Action<Graphics> paint)
    {
        using (Bitmap bmp = new Bitmap(32, 32))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                paint(g);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int RegisterWindowMessage(string s);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct THUMBBUTTON
    {
        public uint dwMask, iId, iBitmap;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szTip;
        public uint dwFlags;
    }
    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090"), ClassInterface(ClassInterfaceType.None)]
    class TaskbarInstance { }
    [ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ITaskbarList3
    {
        void HrInit();
        void AddTab(IntPtr h);
        void DeleteTab(IntPtr h);
        void ActivateTab(IntPtr h);
        void SetActiveAlt(IntPtr h);
        void MarkFullscreenWindow(IntPtr h, bool f);
        void SetProgressValue(IntPtr h, ulong a, ulong b);
        void SetProgressState(IntPtr h, int s);
        void RegisterTab(IntPtr t, IntPtr m);
        void UnregisterTab(IntPtr t);
        void SetTabOrder(IntPtr t, IntPtr b);
        void SetTabActive(IntPtr t, IntPtr m, uint r);
        void ThumbBarAddButtons(IntPtr h, uint n, [MarshalAs(UnmanagedType.LPArray)] THUMBBUTTON[] b);
        void ThumbBarUpdateButtons(IntPtr h, uint n, [MarshalAs(UnmanagedType.LPArray)] THUMBBUTTON[] b);
    }
}
