package io.github.hiroyki.play;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONException;
import org.json.JSONObject;

/** Server HTTP kecil di 127.0.0.1: file antarmuka, jembatan ke mesin JavaScript, dan penerus media. */
final class Server {
    static final String TAG = "Play";
    // Sama dengan server/index.js.
    private static final String CSP = "default-src 'self'; img-src 'self' data: https://*.ytimg.com https://*.ggpht.com https://*.googleusercontent.com; "
            + "media-src 'self' blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'";
    private static final String UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    private static final String[] HOSTS = {"youtube.com", "googlevideo.com", "youtubei.googleapis.com", "suggestqueries.google.com", "ytimg.com"};
    private static final int MAX_BODY = 9 * 1024 * 1024;

    /** Sambungan ke YouTube yang isinya belum dibaca. */
    private static final class Up implements Closeable {
        final HttpURLConnection c;
        final long at = System.currentTimeMillis();
        Up(HttpURLConnection c) { this.c = c; }
        InputStream body() throws IOException {
            InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
            return in == null ? new java.io.ByteArrayInputStream(new byte[0]) : in;
        }
        boolean done; // isinya habis dibaca, jadi sambungannya bisa dipakai lagi tanpa jabat tangan TLS baru
        @Override public void close() {
            if (done) {
                try { body().close(); return; } catch (IOException e) { /* putuskan saja */ }
            }
            c.disconnect();
        }
    }

    private static final class Request {
        String method, target, path;
        final Map<String, String> headers = new HashMap<>();
        byte[] body = new byte[0];
        String get(String k) { return headers.get(k); }
    }

    final int port;
    /** Aplikasi lain di HP yang sama bisa menghubungi 127.0.0.1, jadi setiap permintaan harus membawa kunci ini. */
    final String token;
    private final AssetManager assets;
    private final Engine engine;
    private final ServerSocket socket;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<Integer, Up> ups = new ConcurrentHashMap<>();
    private final AtomicInteger ids = new AtomicInteger();

    Server(Context ctx, Engine engine) throws IOException {
        this.engine = engine;
        assets = ctx.getAssets();
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        token = s.toString();
        ServerSocket found = null;
        // Port tetap supaya pengaturan tersimpan; geser hanya kalau dipakai aplikasi lain.
        for (int p = 4321; p < 4341 && found == null; p++) {
            ServerSocket t = new ServerSocket();
            try {
                t.setReuseAddress(true);
                t.bind(new InetSocketAddress(InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), p), 64);
                found = t;
            } catch (IOException e) {
                t.close();
            }
        }
        if (found == null) throw new IOException("Tidak ada port yang kosong untuk Play.");
        socket = found;
        port = found.getLocalPort();
        Thread t = new Thread(this::accept, "play-server");
        t.setDaemon(true);
        t.start();
    }

    String origin() { return "http://127.0.0.1:" + port; }
    String cookie() { return "play=" + token; }

    private void accept() {
        while (!socket.isClosed()) {
            try {
                Socket s = socket.accept();
                pool.execute(() -> serve(s));
            } catch (IOException e) {
                if (!socket.isClosed()) Log.w(TAG, "accept: " + e);
            }
        }
    }

    private void serve(Socket s) {
        try (Socket c = s) {
            c.setTcpNoDelay(true);
            c.setSoTimeout(60_000);
            BufferedInputStream in = new BufferedInputStream(c.getInputStream(), 8192);
            OutputStream out = new BufferedOutputStream(c.getOutputStream(), 16384);
            Request r;
            while ((r = read(in)) != null) {
                handle(r, out);
                out.flush();
                if ("close".equalsIgnoreCase(r.get("connection"))) break;
            }
        } catch (IOException e) {
            // penonton pindah posisi atau menutup halaman
        } catch (RuntimeException e) {
            Log.w(TAG, "serve", e);
        }
    }

    // ---------- HTTP ----------
    private static String line(InputStream in, int[] left) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream(128);
        for (int x; (x = in.read()) != '\n'; ) {
            if (x < 0) {
                if (b.size() == 0) return null;
                throw new IOException("putus");
            }
            if (--left[0] < 0) throw new IOException("header terlalu panjang");
            if (x != '\r') b.write(x);
        }
        return new String(b.toByteArray(), StandardCharsets.ISO_8859_1);
    }
    private static Request read(InputStream in) throws IOException {
        int[] left = {64 * 1024};
        String first = line(in, left);
        if (first == null) return null;
        String[] p = first.split(" ");
        if (p.length != 3 || !p[1].startsWith("/")) throw new IOException("permintaan rusak");
        Request r = new Request();
        r.method = p[0];
        r.target = p[1];
        int q = p[1].indexOf('?');
        r.path = q < 0 ? p[1] : p[1].substring(0, q);
        for (String l; (l = line(in, left)) != null && !l.isEmpty(); ) {
            int i = l.indexOf(':');
            if (i > 0) r.headers.put(l.substring(0, i).trim().toLowerCase(Locale.ROOT), l.substring(i + 1).trim());
        }
        if (r.get("transfer-encoding") != null) throw new IOException("tidak didukung");
        String n = r.get("content-length");
        if (n != null) {
            int len;
            try { len = Integer.parseInt(n); } catch (NumberFormatException e) { throw new IOException("panjang salah"); }
            if (len < 0 || len > MAX_BODY) throw new IOException("terlalu besar");
            r.body = new byte[len];
            for (int o = 0; o < len; ) {
                int k = in.read(r.body, o, len - o);
                if (k < 0) throw new IOException("putus");
                o += k;
            }
        }
        return r;
    }
    private static void head(OutputStream out, int status, Map<String, String> h) throws IOException {
        StringBuilder b = new StringBuilder("HTTP/1.1 ").append(status).append(" OK\r\n");
        for (Map.Entry<String, String> e : h.entrySet()) b.append(e.getKey()).append(": ").append(e.getValue().replaceAll("[\\r\\n]", " ")).append("\r\n");
        b.append("x-content-type-options: nosniff\r\nreferrer-policy: no-referrer\r\n\r\n");
        out.write(b.toString().getBytes(StandardCharsets.ISO_8859_1));
    }
    private static void send(OutputStream out, int status, Map<String, String> h, byte[] body, boolean headOnly) throws IOException {
        h.put("content-length", String.valueOf(body.length));
        head(out, status, h);
        if (!headOnly) out.write(body);
    }
    private static Map<String, String> type(String t) {
        Map<String, String> h = new HashMap<>();
        h.put("content-type", t);
        return h;
    }
    private static void error(OutputStream out, int status, String text) throws IOException {
        send(out, status, type("text/plain; charset=utf-8"), text.getBytes(StandardCharsets.UTF_8), false);
    }
    private static void copy(InputStream in, OutputStream out, Map<String, String> h, int status) throws IOException {
        boolean chunked = h.get("content-length") == null;
        if (chunked) h.put("transfer-encoding", "chunked");
        head(out, status, h);
        byte[] b = new byte[32 * 1024];
        long left = chunked ? Long.MAX_VALUE : Long.parseLong(h.get("content-length"));
        for (int n; left > 0 && (n = in.read(b, 0, (int) Math.min(b.length, left))) >= 0; ) {
            if (chunked) out.write((Integer.toHexString(n) + "\r\n").getBytes(StandardCharsets.ISO_8859_1));
            out.write(b, 0, n);
            if (chunked) out.write("\r\n".getBytes(StandardCharsets.ISO_8859_1));
            else left -= n;
            out.flush();
        }
        if (chunked) out.write("0\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
        else if (left > 0) throw new IOException("hulu putus"); // tutup soket supaya pemutar tahu isinya kurang
    }

    // ---------- rute ----------
    private boolean allowed(Request r) {
        String host = "127.0.0.1:" + port, origin = r.get("origin"), cookie = r.get("cookie");
        if (!host.equals(r.get("host")) || (origin != null && !origin.equals("http://" + host)) || cookie == null) return false;
        if ("cross-site".equals(r.get("sec-fetch-site")) && !r.path.equals("/")) return false;
        for (String p : cookie.split(";"))
            if (MessageDigest.isEqual(p.trim().getBytes(StandardCharsets.UTF_8), cookie().getBytes(StandardCharsets.UTF_8))) return true;
        return false;
    }
    private void handle(Request r, OutputStream out) throws IOException {
        if (!allowed(r)) { error(out, 403, "Forbidden"); return; }
        try {
            if (r.path.equals("/__fetch")) upstream(r, out);
            else if (r.path.startsWith("/__body/")) {
                try (Up u = take(r.path)) {
                    if (u == null) error(out, 404, "");
                    else {
                        copy(u.body(), out, type("application/octet-stream"), 200);
                        u.done = true;
                    }
                }
            } else if (r.path.startsWith("/__close/")) {
                Up u = take(r.path);
                if (u != null) u.close();
                error(out, 200, "");
            } else if (r.path.startsWith("/api/")) api(r, out);
            else file(r, out);
        } catch (JSONException e) {
            error(out, 400, "");
        }
    }
    private Up take(String path) {
        try {
            return ups.remove(Integer.parseInt(path.substring(path.lastIndexOf('/') + 1)));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private void api(Request r, OutputStream out) throws IOException, JSONException {
        Engine.Reply p = engine.call(r.method, r.target, r.headers, new String(r.body, StandardCharsets.UTF_8));
        if (p == null) { error(out, 504, "Play belum siap."); return; }
        Map<String, String> h = p.headers;
        Up u = p.handle >= 0 ? ups.remove(p.handle) : null;
        if (u == null) {
            send(out, p.status, h, p.body.getBytes(StandardCharsets.UTF_8), r.method.equals("HEAD"));
            return;
        }
        try (Up up = u) {
            copy(up.body(), out, h, p.status);
            up.done = true;
        }
    }

    private static boolean known(URL u) {
        if (!u.getProtocol().equals("https") || (u.getPort() != -1 && u.getPort() != 443) || u.getUserInfo() != null) return false;
        String h = u.getHost().toLowerCase(Locale.ROOT);
        for (String x : HOSTS) if (h.equals(x) || h.endsWith("." + x)) return true;
        return false;
    }
    private HttpURLConnection open(Request r) throws IOException, JSONException {
        URL url = new URL(r.get("x-play-url"));
        String method = r.get("x-play-method");
        JSONObject h = new JSONObject(URLDecoder.decode(r.get("x-play-headers"), "UTF-8"));
        for (int hop = 0; hop < 6; hop++) {
            if (!known(url)) throw new IOException("host tidak diizinkan: " + url.getHost());
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setConnectTimeout(15_000);
            c.setReadTimeout(30_000);
            c.setRequestMethod(method);
            c.setRequestProperty("user-agent", UA);
            for (java.util.Iterator<String> i = h.keys(); i.hasNext(); ) {
                String k = i.next();
                if (!k.equalsIgnoreCase("accept-encoding") && !k.equalsIgnoreCase("content-length") && !k.equalsIgnoreCase("host")) c.setRequestProperty(k, h.getString(k));
            }
            if (r.body.length > 0 && !method.equals("GET")) {
                c.setDoOutput(true);
                try (OutputStream o = c.getOutputStream()) { o.write(r.body); }
            }
            int s = c.getResponseCode();
            String to = c.getHeaderField("location");
            if (s < 300 || s >= 400 || s == 304 || to == null) return c;
            url = new URL(url, to);
            if (s != 307 && s != 308) method = "GET";
            c.disconnect();
        }
        throw new IOException("terlalu banyak pengalihan");
    }
    private void upstream(Request r, OutputStream out) throws IOException, JSONException {
        if (!r.method.equals("POST") || r.get("x-play-url") == null || r.get("x-play-headers") == null || r.get("x-play-method") == null) { error(out, 400, ""); return; }
        Up u;
        try {
            try {
                u = new Up(open(r));
            } catch (java.net.SocketTimeoutException e) {
                throw e;
            } catch (IOException e) {
                u = new Up(open(r)); // sambungan lama yang sudah ditutup YouTube: coba sekali lagi
            }
        } catch (IOException e) {
            Log.w(TAG, "fetch: " + e.getMessage());
            Map<String, String> h = type("text/plain");
            h.put("x-play-error", "1");
            send(out, 502, h, new byte[0], false);
            return;
        }
        if (r.get("x-play-defer") != null) {
            long now = System.currentTimeMillis();
            for (Map.Entry<Integer, Up> e : ups.entrySet()) if (now - e.getValue().at > 60_000 && ups.remove(e.getKey(), e.getValue())) e.getValue().close();
            JSONObject h = new JSONObject();
            for (Map.Entry<String, List<String>> e : u.c.getHeaderFields().entrySet()) if (e.getKey() != null) h.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue().get(0));
            // Sudah dibuka Java, jadi panjang aslinya tidak berlaku lagi.
            if (u.c.getContentEncoding() == null && u.c.getContentLengthLong() < 0) h.remove("content-length");
            int id = ids.incrementAndGet();
            JSONObject j = new JSONObject().put("status", u.c.getResponseCode()).put("url", u.c.getURL().toString()).put("headers", h).put("handle", id);
            ups.put(id, u);
            send(out, 200, type("application/json"), j.toString().getBytes(StandardCharsets.UTF_8), false);
            return;
        }
        try (Up up = u) {
            String t = up.c.getContentType();
            int s = up.c.getResponseCode();
            ByteArrayOutputStream b = new ByteArrayOutputStream(32 * 1024);
            try (InputStream in = up.body()) {
                byte[] x = new byte[32 * 1024];
                for (int n; (n = in.read(x)) >= 0; ) b.write(x, 0, n);
            }
            up.done = true;
            send(out, s, type(t == null ? "application/octet-stream" : t), b.toByteArray(), s == 204 || s == 304);
        }
    }

    private static String mime(String p) {
        switch (p.substring(p.lastIndexOf('.') + 1)) {
            case "html": return "text/html; charset=utf-8";
            case "js": return "text/javascript; charset=utf-8";
            case "css": return "text/css; charset=utf-8";
            case "svg": return "image/svg+xml";
            case "woff2": return "font/woff2";
            default: return "application/octet-stream";
        }
    }
    private byte[] asset(String p) {
        try (InputStream in = assets.open("web" + p)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream(64 * 1024);
            byte[] x = new byte[32 * 1024];
            for (int n; (n = in.read(x)) >= 0; ) b.write(x, 0, n);
            return b.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }
    private void file(Request r, OutputStream out) throws IOException {
        if (!r.method.equals("GET") && !r.method.equals("HEAD")) { error(out, 405, ""); return; }
        String p = r.path.contains("..") || r.path.contains("//") ? "/" : r.path;
        byte[] b = p.equals("/") ? null : asset(p);
        if (b == null) b = asset(p = "/index.html");
        Map<String, String> h = type(mime(p));
        h.put("cache-control", p.startsWith("/vendor/") ? "max-age=31536000, immutable" : "no-cache");
        if (!p.startsWith("/engine")) h.put("content-security-policy", CSP);
        send(out, 200, h, b, r.method.equals("HEAD"));
    }
}
