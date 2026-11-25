package io.github.hiroyki.play;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** WebView tanpa tampilan yang menjalankan server/*.js. */
final class Engine {
    static final class Reply {
        int status, handle;
        String body;
        final Map<String, String> headers = new HashMap<>();
    }

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final File root;
    private final Map<Integer, CompletableFuture<Reply>> waiting = new ConcurrentHashMap<>();
    private final AtomicInteger ids = new AtomicInteger();
    private volatile CountDownLatch ready = new CountDownLatch(1);
    private WebView web;

    Engine(Context ctx) { root = new File(ctx.getFilesDir(), "data"); }

    /** Dipanggil dari utas utama, juga untuk menyalakan ulang setelah proses WebView mati. */
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    void start(Context ctx, String origin) {
        stop();
        ready = new CountDownLatch(1);
        web = new WebView(ctx);
        web.getSettings().setJavaScriptEnabled(true);
        web.addJavascriptInterface(new Native(), "Native");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.w(Server.TAG, "engine: " + m.message());
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                if (v == web) stop(); // MainActivity menyalakan ulang
                return true;
            }
        });
        web.loadUrl(origin + "/engine.html");
    }
    boolean running() { return web != null; }
    void stop() {
        if (web != null) web.destroy();
        web = null;
        for (Integer id : waiting.keySet()) {
            CompletableFuture<Reply> f = waiting.remove(id);
            if (f != null) f.complete(null);
        }
    }

    Reply call(String method, String url, Map<String, String> headers, String body) {
        int id = ids.incrementAndGet();
        CompletableFuture<Reply> f = new CompletableFuture<>();
        try {
            if (!ready.await(25, TimeUnit.SECONDS)) return null;
            String json = new JSONObject().put("id", id).put("method", method).put("url", url).put("headers", new JSONObject(headers)).put("body", body).toString();
            waiting.put(id, f);
            ui.post(() -> {
                if (web != null) web.evaluateJavascript("__play(" + json + ");0", null);
                else f.complete(null);
            });
            return f.get(90, TimeUnit.SECONDS);
        } catch (InterruptedException | java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException | JSONException e) {
            Log.w(Server.TAG, method + " " + url + ": " + e);
            return null;
        } finally {
            waiting.remove(id);
        }
    }

    /** Hanya dipasang di WebView ini, yang cuma membuka halaman milik aplikasi sendiri. */
    private final class Native {
        private File at(String name) throws IOException {
            File f = new File(root, name).getCanonicalFile();
            String base = root.getCanonicalPath();
            if (!f.getPath().equals(base) && !f.getPath().startsWith(base + "/")) throw new IOException("di luar folder data");
            return f;
        }
        @JavascriptInterface public void ready() { ready.countDown(); }
        @JavascriptInterface public void reply(int id, int status, String headers, String body, int handle) {
            CompletableFuture<Reply> f = waiting.get(id);
            if (f == null) return;
            Reply r = new Reply();
            r.status = status;
            r.body = body;
            r.handle = handle;
            try {
                JSONObject h = new JSONObject(headers);
                for (Iterator<String> i = h.keys(); i.hasNext(); ) {
                    String k = i.next();
                    r.headers.put(k, h.getString(k));
                }
            } catch (JSONException e) {
                r.status = 500;
            }
            f.complete(r);
        }
        @JavascriptInterface public String read(String name) {
            try (FileInputStream in = new FileInputStream(at(name))) {
                byte[] b = new byte[(int) in.getChannel().size()];
                for (int o = 0, n; o < b.length && (n = in.read(b, o, b.length - o)) > 0; ) o += n;
                return new String(b, StandardCharsets.UTF_8);
            } catch (IOException e) {
                return null;
            }
        }
        @JavascriptInterface public boolean write(String name, String text) {
            try (FileOutputStream out = new FileOutputStream(at(name))) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
                return true;
            } catch (IOException e) {
                Log.w(Server.TAG, "tulis: " + e);
                return false;
            }
        }
        @JavascriptInterface public boolean rename(String a, String b) {
            try { return at(a).renameTo(at(b)); } catch (IOException e) { return false; }
        }
        @JavascriptInterface public boolean copy(String a, String b) {
            String s = read(a);
            return s != null && write(b, s);
        }
        @JavascriptInterface public boolean unlink(String a) {
            try { return at(a).delete(); } catch (IOException e) { return false; }
        }
        @JavascriptInterface public void mkdir(String a) {
            try { at(a).mkdirs(); } catch (IOException e) { Log.w(Server.TAG, "mkdir: " + e); }
        }
        @JavascriptInterface public String list(String a) {
            try {
                String[] n = at(a).list();
                return n == null ? null : new JSONArray(java.util.Arrays.asList(n)).toString();
            } catch (IOException e) {
                return null;
            }
        }
        @JavascriptInterface public double mtime(String a) {
            try {
                File f = at(a);
                return f.exists() ? f.lastModified() : -1;
            } catch (IOException e) {
                return -1;
            }
        }
    }
}
