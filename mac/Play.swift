// Play untuk Mac: jendela native (AppKit + WKWebView) yang menjalankan server lokal di latar.
// Dikompilasi dengan swiftc dari Command Line Tools, lihat build.sh.
import AppKit
import CryptoKit
import WebKit

enum Paths {
    static let app = Bundle.main.resourceURL!.appendingPathComponent("app")
    static let node = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/node")
    // Data di luar aplikasi, jadi aman saat Play diperbarui atau dihapus.
    static let data = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Play")
    static var library: String {
        let own = ProcessInfo.processInfo.environment["PLAY_LIBRARY"] ?? ""
        if own.isEmpty { return data.appendingPathComponent("library.json").path }
        // Dibiarkan apa adanya: standardizedFileURL kadang membuang /private, jadi pengenal datanya berubah-ubah.
        return own.hasPrefix("/") ? own : FileManager.default.currentDirectoryPath + "/" + own
    }
}

enum Log {
    private static let queue = DispatchQueue(label: "log")
    static func write(_ text: String) {
        queue.async {
            let fm = FileManager.default
            let file = Paths.data.appendingPathComponent("play.log")
            try? fm.createDirectory(at: Paths.data, withIntermediateDirectories: true)
            if let n = (try? fm.attributesOfItem(atPath: file.path))?[.size] as? Int, n > 512 * 1024 { try? fm.removeItem(at: file) }
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd HH:mm:ss "
            let line = Data((f.string(from: Date()) + text + "\n").utf8)
            if let h = try? FileHandle(forWritingTo: file) {
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: line)
                try? h.close()
            } else {
                try? line.write(to: file)
            }
        }
    }
}

// Server Node di latar. Ikut mati saat Play ditutup, termasuk yt-dlp yang sedang jalan (lihat guard.mjs).
final class Backend {
    private let lock = NSLock()
    private var proc: Process?
    private var leash: Pipe? // putus begitu Play mati
    private var tail = ""
    private var _port = 0
    private(set) var owned = false

    var port: Int { lock.withLock { _port } }
    var dead: Bool { lock.withLock { owned && proc.map { !$0.isRunning } ?? false } }
    // Bukan localhost: server hanya ada di IPv4, dan ::1 di port yang sama bisa milik program lain.
    var base: URL { URL(string: "http://127.0.0.1:\(port)")! }

    private static let dataId: String = SHA256.hash(data: Data(Paths.library.lowercased().utf8)).map { String(format: "%02x", $0) }.joined().prefix(16).description

    // Hanya server yang memakai data yang sama yang boleh dipakai bersama.
    private static func isPlay(_ port: Int) -> Bool {
        var r = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/ping")!)
        r.timeoutInterval = 1.5
        r.cachePolicy = .reloadIgnoringLocalCacheData
        let done = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: r) { d, _, _ in
            ok = d.flatMap { String(data: $0, encoding: .utf8) }?.contains("\"id\":\"\(dataId)\"") ?? false
            done.signal()
        }.resume()
        return done.wait(timeout: .now() + 2) == .success && ok
    }

    private static func free(_ port: Int) -> Bool {
        let s = socket(AF_INET, SOCK_STREAM, 0)
        guard s >= 0 else { return false }
        defer { close(s) }
        var yes: Int32 = 1 // seperti Node: koneksi lama yang belum tuntas tidak dihitung
        setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var a = sockaddr_in()
        a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        a.sin_family = sa_family_t(AF_INET)
        a.sin_port = in_port_t(port).bigEndian
        a.sin_addr.s_addr = inet_addr("127.0.0.1")
        let len = socklen_t(MemoryLayout<sockaddr_in>.size)
        return withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, len) } } == 0
    }

    // Dipanggil dari antrean latar. Mengembalikan pesan kesalahan, atau nil kalau menyala.
    func start() -> String? {
        if let p = lock.withLock({ proc }), p.isRunning {
            if Backend.isPlay(port) { return nil }
            stop()
        }
        let fm = FileManager.default
        let entry = Paths.app.appendingPathComponent("server/index.js")
        guard fm.isExecutableFile(atPath: Paths.node.path), fm.fileExists(atPath: entry.path) else {
            return "Isi aplikasi tidak lengkap.\nPasang ulang Play."
        }
        do { try fm.createDirectory(at: Paths.data, withIntermediateDirectories: true) } catch {
            return "Folder data tidak bisa dibuat.\n" + error.localizedDescription
        }

        // Port tetap supaya pengaturan tersimpan; geser hanya kalau dipakai program lain.
        var chosen = 0
        for n in 4321..<4341 {
            if Backend.free(n) { chosen = n; break }
            if Backend.isPlay(n) {
                lock.withLock { _port = n; owned = false; proc = nil }
                return nil
            }
        }
        if chosen == 0 { return "Tidak ada port yang kosong untuk Play." }

        let p = Process()
        p.executableURL = Paths.node
        p.arguments = ["--import", Paths.app.appendingPathComponent("guard.mjs").absoluteString, entry.path]
        p.currentDirectoryURL = Paths.app
        var env = ProcessInfo.processInfo.environment
        for k in env.keys where k.hasPrefix("NODE_") { env[k] = nil }
        env["PORT"] = String(chosen)
        env["PLAY_LIBRARY"] = Paths.library
        env["PLAY_BIN"] = Paths.data.appendingPathComponent("bin").path
        env["PLAY_INSTALLED"] = "1"
        // Aplikasi yang dibuka dari Finder tidak mendapat PATH dari terminal.
        let path = env["PATH"].map { $0.components(separatedBy: ":") } ?? []
        let extra = ["/opt/homebrew/bin", "/usr/local/bin", NSHomeDirectory() + "/.local/bin", "/usr/bin", "/bin"]
        env["PATH"] = (path + extra.filter { !path.contains($0) }).joined(separator: ":")
        p.environment = env
        let leash = Pipe(), err = Pipe()
        p.standardInput = leash
        p.standardOutput = FileHandle.nullDevice
        p.standardError = err
        err.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; return }
            let s = String(decoding: d, as: UTF8.self).trimmingCharacters(in: .newlines)
            Log.write("server: " + s)
            self?.lock.withLock { if let me = self, me.tail.count < 600 { me.tail += s + "\n" } }
        }
        lock.withLock { tail = "" }
        do { try p.run() } catch { return "Server tidak bisa dijalankan.\n" + error.localizedDescription }
        lock.withLock { proc = p; self.leash = leash; owned = true; _port = chosen }

        let until = Date().addingTimeInterval(20)
        while Date() < until {
            if !p.isRunning { return "Server berhenti.\n" + lock.withLock { tail } }
            if Backend.isPlay(chosen) { return nil }
            Thread.sleep(forTimeInterval: 0.08)
        }
        stop()
        return "Server terlalu lama menyala."
    }

    func stop() {
        let (p, l) = lock.withLock { () -> (Process?, Pipe?) in
            defer { proc = nil; leash = nil }
            return (proc, leash)
        }
        try? l?.fileHandleForWriting.close()
        guard let p, p.isRunning else { return }
        let until = Date().addingTimeInterval(1)
        while p.isRunning, Date() < until { Thread.sleep(forTimeInterval: 0.02) }
        if p.isRunning { kill(p.processIdentifier, SIGKILL) }
    }
}

// Menu klik kanan cuma untuk kolom isian dan teks yang dipilih.
final class PlayWebView: WKWebView {
    private static let hidden = ["Reload", "GoBack", "GoForward", "OpenLink", "OpenImage", "OpenMedia", "OpenFrame", "Download", "CopyImage", "CopyLink", "CopyMediaLink",
                                 "ShowHideMediaControls", "ShowHideMediaStats", "ToggleEnhancedFullScreen", "ToggleFullScreen", "ToggleVideoViewer", "ToggleVideoEnhancedFullScreen",
                                 "MediaPlayPause", "MediaMute", "PlayAllAnimations", "PauseAllAnimations", "RevealImage", "CopySubject", "AppHighlight", "ShareMenu"]
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        for i in menu.items {
            let id = i.identifier?.rawValue ?? ""
            if PlayWebView.hidden.contains(where: { id.hasPrefix("WKMenuItemIdentifier" + $0) }) { menu.removeItem(i) }
        }
        while let f = menu.items.first, f.isSeparatorItem { menu.removeItem(f) }
        while let l = menu.items.last, l.isSeparatorItem { menu.removeItem(l) }
    }
}

// Link YouTube menjadi alamat di dalam Play.
func pathOf(_ link: String) -> String? {
    func first(_ pattern: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let m = re.firstMatch(in: link, range: NSRange(link.startIndex..., in: link)),
              let r = Range(m.range(at: 1), in: link) else { return nil }
        return String(link[r])
    }
    if let v = first(#"^(?:https?://)?(?:(?:www|m|music)\.)?(?:youtu\.be/|youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|live/|embed/))([\w-]{11})(?![\w-])"#) { return "/watch?v=" + v }
    if let l = first(#"^(?:https?://)?(?:www\.)?youtube\.com/playlist\?(?:[^#]*&)?list=([\w-]{10,64})"#) { return "/playlist?list=" + l }
    return nil
}

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    let backend = Backend()
    let work = DispatchQueue(label: "boot")
    var window: NSWindow!
    var web: PlayWebView!
    let fail = NSView()
    let failText = NSTextField(wrappingLabelWithString: "")
    var pending: String?
    var ready = false, booting = false, closing = false
    var on = false, playing = false, hasNext = false
    var awake: NSObjectProtocol?
    var titleWatch: NSKeyValueObservation?
    var timer: Timer?
    var crashes: [Date] = []

    // ---------- menyala ----------
    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        buildMenu()
        buildWindow()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            guard let me = self, me.ready, !me.closing, me.backend.dead else { return }
            me.boot()
        }
        boot()
        NSApp.activate(ignoringOtherApps: true)
    }

    func buildWindow() {
        let area = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1360, area.width * 0.9), height: min(860, area.height * 0.9))
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Play"
        window.backgroundColor = .black
        window.titlebarAppearsTransparent = true // hitam, menyatu dengan halaman
        window.isReleasedWhenClosed = false
        window.contentMinSize = NSSize(width: 420, height: 480)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.tabbingMode = .disallowed
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("Play")

        let c = WKWebViewConfiguration()
        c.mediaTypesRequiringUserActionForPlayback = []
        c.preferences.isElementFullscreenEnabled = true
        // Gambar dalam gambar mati secara bawaan di WKWebView dan belum punya saklar publik.
        if c.preferences.responds(to: Selector(("_setAllowsPictureInPictureMediaPlayback:"))) {
            c.preferences.setValue(true, forKey: "allowsPictureInPictureMediaPlayback")
        }
        c.userContentController.add(self, name: "play")
        c.userContentController.addUserScript(WKUserScript(source: App.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = PlayWebView(frame: NSRect(origin: .zero, size: size), configuration: c)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.allowsMagnification = false
        web.underPageBackgroundColor = .black
        web.setValue(false, forKey: "drawsBackground") // tanpa kilatan putih sebelum halaman muncul
        web.pageZoom = UserDefaults.standard.object(forKey: "zoom") as? CGFloat ?? 1
        titleWatch = web.observe(\.title) { [weak self] w, _ in
            self?.window.title = w.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Play"
        }

        let content = NSView(frame: NSRect(origin: .zero, size: size))
        content.addSubview(web)
        buildFail(in: content)
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)
    }

    func boot() {
        if booting || closing { return }
        booting = true
        fail.isHidden = true
        work.async { [self] in
            let error = backend.start()
            DispatchQueue.main.async { [self] in
                booting = false
                if closing { return }
                if let error { return showFail(error) }
                // Setelah server mati mendadak, kembali ke halaman yang tadi.
                let here = ready ? web.url.map { $0.path + ($0.query.map { "?" + $0 } ?? "") } : nil
                let path = pending ?? here ?? "/"
                pending = nil
                ready = true
                load(path)
            }
        }
    }

    func load(_ path: String) {
        guard let u = URL(string: path, relativeTo: backend.base) else { return }
        web.load(URLRequest(url: u.absoluteURL))
    }

    // ---------- layar gagal ----------
    func buildFail(in parent: NSView) {
        fail.frame = parent.bounds
        fail.autoresizingMask = [.width, .height]
        fail.wantsLayer = true
        fail.layer?.backgroundColor = NSColor.black.cgColor
        fail.isHidden = true
        failText.alignment = .center
        failText.font = .systemFont(ofSize: 15)
        failText.textColor = .secondaryLabelColor
        let again = NSButton(title: "Coba lagi", target: self, action: #selector(retry))
        again.controlSize = .large
        again.keyEquivalent = "\r"
        let stack = NSStackView(views: [failText, again])
        stack.orientation = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        fail.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: fail.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: fail.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualTo: fail.widthAnchor, constant: -48),
            failText.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
        ])
        parent.addSubview(fail)
    }
    func showFail(_ text: String) {
        Log.write("gagal: " + text.replacingOccurrences(of: "\n", with: " "))
        failText.stringValue = text
        fail.isHidden = false
    }
    @objc func retry() { crashes = []; boot() }

    // ---------- halaman ----------
    // Kabar kecil dari halaman: sedang main atau tidak, dan ada video berikutnya atau tidak.
    static let bridge = """
    (() => {
      const port = window.webkit.messageHandlers.play;
      let last = '';
      const tell = () => {
        const v = document.querySelector('.player video');
        const s = { on: !!(v && v.readyState > 0), playing: !!(v && !v.paused && !v.ended), next: !!(window.playHasNext && window.playHasNext()) };
        const k = JSON.stringify(s);
        if (k !== last) { last = k; port.postMessage(s); }
      };
      for (const e of ['play', 'pause', 'ended', 'emptied', 'loadeddata']) document.addEventListener(e, tell, true);
      setInterval(tell, 2000);
    })();
    """

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        let o = m.frameInfo.securityOrigin
        guard m.frameInfo.isMainFrame, o.host == "127.0.0.1", o.port == backend.port, let b = m.body as? [String: Any] else { return }
        on = b["on"] as? Bool ?? false
        hasNext = b["next"] as? Bool ?? false
        keepAwake(b["playing"] as? Bool ?? false)
    }
    // Layar jangan mati selama menonton.
    func keepAwake(_ now: Bool) {
        playing = now
        if now, awake == nil {
            awake = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleDisplaySleepDisabled], reason: "Memutar video")
        } else if !now, let a = awake {
            ProcessInfo.processInfo.endActivity(a)
            awake = nil
        }
    }

    func mine(_ u: URL) -> Bool { u.scheme == "about" || (u.scheme == "http" && u.host == "127.0.0.1" && u.port == backend.port) }
    func external(_ u: URL?) {
        guard let u, u.scheme == "https" || u.scheme == "http" else { return }
        NSWorkspace.shared.open(u)
    }
    func js(_ code: String) { if ready { web.evaluateJavaScript(code + ";0") } }

    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler done: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = a.request.url else { return done(.cancel) }
        if mine(u) { return done(a.shouldPerformDownload ? .download : .allow) }
        if a.navigationType == .linkActivated { external(u) }
        done(.cancel)
    }
    func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler done: @escaping (WKNavigationResponsePolicy) -> Void) {
        done(r.canShowMIMEType ? .allow : .download)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url, !mine(u) { external(u) } else if let u = a.request.url { w.load(URLRequest(url: u)) }
        return nil
    }
    func webView(_ w: WKWebView, requestMediaCapturePermissionFor o: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo, type: WKMediaCaptureType, decisionHandler done: @escaping (WKPermissionDecision) -> Void) { done(.deny) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
        let code = (e as NSError).code
        if code == NSURLErrorCannotConnectToHost, !closing { boot() }
    }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) {
        Log.write("webview: proses halaman berhenti")
        keepAwake(false)
        crashes = crashes.filter { $0.timeIntervalSinceNow > -60 } + [Date()]
        if crashes.count > 3 { return showFail("Halaman terus berhenti.") }
        w.reload()
    }

    // ---------- impor dan ekspor ----------
    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler done: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = p.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { done($0 == .OK ? panel.urls : nil) }
    }
    func webView(_ w: WKWebView, navigationAction a: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
    func webView(_ w: WKWebView, navigationResponse r: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
    func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler done: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.beginSheetModal(for: window) {
            guard $0 == .OK, let u = panel.url else { return done(nil) }
            // Panel sudah menanyakan soal menimpa, sedangkan WebKit menolak menimpa.
            try? FileManager.default.removeItem(at: u)
            done(u)
        }
    }
    func download(_ d: WKDownload, didFailWithError e: Error, resumeData: Data?) {
        if (e as NSError).code != NSURLErrorCancelled { Log.write("ekspor: " + e.localizedDescription) }
    }

    // ---------- link dari luar: open -a Play https://youtu.be/... ----------
    func application(_ a: NSApplication, open urls: [URL]) {
        guard let p = urls.lazy.compactMap({ pathOf($0.absoluteString) }).first else { return }
        if ready, !booting { load(p) } else { pending = p }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // ---------- menu ----------
    func buildMenu() {
        let bar = NSMenu()
        func menu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            i.submenu = m
            bar.addItem(i)
            return m
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            return i
        }
        let line = NSMenuItem.separator
        let left = String(UnicodeScalar(NSLeftArrowFunctionKey)!), right = String(UnicodeScalar(NSRightArrowFunctionKey)!)
        _ = menu("Play", [
            item("Tentang Play", #selector(NSApplication.orderFrontStandardAboutPanel(_:))), line(),
            item("Pengaturan…", #selector(settings), ","), line(),
            item("Sembunyikan Play", #selector(NSApplication.hide(_:)), "h"),
            item("Sembunyikan Lainnya", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Tampilkan Semua", #selector(NSApplication.unhideAllApplications(_:))), line(),
            item("Keluar dari Play", #selector(NSApplication.terminate(_:)), "q"),
        ])
        _ = menu("File", [
            item("Cari…", #selector(search), "k"),
            item("Buka Link dari Papan Klip", #selector(openClipboard), "v", [.command, .shift]), line(),
            item("Tutup Jendela", #selector(NSWindow.performClose(_:)), "w"),
        ])
        _ = menu("Edit", [
            item("Urungkan", Selector(("undo:")), "z"), item("Ulangi", Selector(("redo:")), "z", [.command, .shift]), line(),
            item("Potong", #selector(NSText.cut(_:)), "x"), item("Salin", #selector(NSText.copy(_:)), "c"),
            item("Tempel", #selector(NSText.paste(_:)), "v"), item("Pilih Semua", #selector(NSText.selectAll(_:)), "a"),
        ])
        _ = menu("Tampilan", [
            item("Muat Ulang", #selector(reload), "r"), line(),
            item("Ukuran Asli", #selector(zoomReset), "0"), item("Perbesar", #selector(zoomIn), "+"), item("Perkecil", #selector(zoomOut), "-"), line(),
            item("Layar Penuh", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        _ = menu("Pemutaran", [
            item("Putar", #selector(playPause), "p"), item("Video Berikutnya", #selector(next), right, [.command, .shift]),
        ])
        _ = menu("Riwayat", [
            item("Mundur", #selector(back), "["), item("Maju", #selector(forward), "]"), line(),
            item("Beranda", #selector(home), "h", [.command, .shift]),
        ])
        // Pintasan yang sama dengan versi Windows.
        let alias = bar.items.last!.submenu!
        for i in [item("Mundur", #selector(back), left), item("Maju", #selector(forward), right), item("Cari…", #selector(search), "l")] {
            i.isHidden = true
            i.allowsKeyEquivalentWhenHidden = true
            alias.addItem(i)
        }
        NSApp.windowsMenu = menu("Jendela", [
            item("Kecilkan", #selector(NSWindow.performMiniaturize(_:)), "m"), item("Zum", #selector(NSWindow.performZoom(_:))),
        ])
        NSApp.mainMenu = bar
    }
    func validateMenuItem(_ i: NSMenuItem) -> Bool {
        switch i.action {
        case #selector(playPause):
            i.title = playing ? "Jeda" : "Putar"
            return on
        case #selector(next): return on && hasNext
        case #selector(back): return web.canGoBack
        case #selector(forward): return web.canGoForward
        case #selector(search), #selector(settings), #selector(reload), #selector(home): return ready
        case #selector(openClipboard): return ready && clipboardPath != nil
        default: return true
        }
    }
    // Tombol putar dan berikutnya di menu Dock, seperti pratinjau taskbar di Windows.
    func applicationDockMenu(_ a: NSApplication) -> NSMenu? {
        guard on else { return nil }
        let m = NSMenu()
        m.addItem(withTitle: "Putar", action: #selector(playPause), keyEquivalent: "").target = self
        m.addItem(withTitle: "Video Berikutnya", action: #selector(next), keyEquivalent: "").target = self
        return m
    }
    var clipboardPath: String? { NSPasteboard.general.string(forType: .string).flatMap { pathOf($0.trimmingCharacters(in: .whitespacesAndNewlines)) } }
    @objc func playPause() { js("document.querySelector('.player .pp')?.click()") }
    @objc func next() { js("window.playNext?.()") }
    @objc func search() { js("document.querySelector('.find')?.click()") }
    @objc func settings() { js("document.querySelector('.gear')?.click()") }
    @objc func home() { js("document.querySelector('.brand')?.click()") }
    @objc func openClipboard() { if let p = clipboardPath { load(p) } }
    @objc func reload() { web.reload() }
    @objc func back() { web.goBack() }
    @objc func forward() { web.goForward() }
    @objc func zoomIn() { zoom(web.pageZoom + 0.1) }
    @objc func zoomOut() { zoom(web.pageZoom - 0.1) }
    @objc func zoomReset() { zoom(1) }
    func zoom(_ z: CGFloat) {
        web.pageZoom = min(2, max(0.5, (z * 10).rounded() / 10))
        UserDefaults.standard.set(Double(web.pageZoom), forKey: "zoom")
    }

    // ---------- menutup ----------
    // false: jendela yang disembunyikan saat menutup akan memicu penutupan kedua, dan yang pertama menunggu selamanya.
    // Tombol tutup sudah memanggil terminate sendiri di windowShouldClose.
    func applicationShouldTerminateAfterLastWindowClosed(_ a: NSApplication) -> Bool { false }
    func applicationSupportsSecureRestorableState(_ a: NSApplication) -> Bool { true }
    func windowShouldClose(_ w: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return false
    }
    func applicationShouldTerminate(_ a: NSApplication) -> NSApplication.TerminateReply {
        if closing { return .terminateCancel } // yang pertama masih berjalan
        closing = true
        timer?.invalidate()
        keepAwake(false)
        window?.orderOut(nil)
        // Beri kesempatan halaman menyimpan posisi tonton.
        if ready { web.evaluateJavaScript("window.dispatchEvent(new Event('pagehide'));document.querySelectorAll('video').forEach(v => v.pause());0") }
        DispatchQueue.main.asyncAfter(deadline: .now() + (ready ? 0.4 : 0)) { [self] in
            backend.stop()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

setvbuf(stdout, nil, _IOLBF, 0)
signal(SIGPIPE, SIG_IGN)
let app = NSApplication.shared
let delegate = App()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
