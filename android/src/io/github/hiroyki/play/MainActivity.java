package io.github.hiroyki.play;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;

public final class MainActivity extends Activity {
    private static final int PICK = 1, SAVE = 2;
    private static final Pattern VIDEO = Pattern.compile("(?:https?://)?(?:(?:www|m|music)\\.)?(?:youtu\\.be/|youtube\\.com/(?:watch\\?(?:[^#\\s]*&)?v=|shorts/|live/|embed/))([\\w-]{11})(?![\\w-])", Pattern.CASE_INSENSITIVE);
    private static final Pattern LIST = Pattern.compile("(?:https?://)?(?:www\\.)?youtube\\.com/playlist\\?(?:[^#\\s]*&)?list=([\\w-]{10,64})", Pattern.CASE_INSENSITIVE);

    private static Server server;
    private static Engine engine;
    private static MainActivity current;

    private FrameLayout root;
    private WebView web;
    private View custom;
    private WebChromeClient.CustomViewCallback customDone;
    private ValueCallback<Uri[]> picking;
    private String exporting;
    private Player player = new Player();
    private boolean pipAsked;

    // ---------- menyala ----------
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        current = this;
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, in) -> {
                Insets i = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                if (custom != null || pip()) v.setPadding(0, 0, 0, 0);
                else v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::back);
        try {
            if (server == null) {
                engine = new Engine(getApplicationContext());
                server = new Server(getApplicationContext(), engine);
            }
        } catch (IOException e) {
            fail(e.getMessage());
            return;
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        try {
            build();
        } catch (RuntimeException e) { // WebView sedang diperbarui atau dimatikan
            Log.w(Server.TAG, "webview", e);
            fail("Android System WebView tidak bisa dibuka.\nAktifkan atau perbarui dari Play Store, lalu buka Play lagi.");
            return;
        }
        String p = pathOf(getIntent());
        boolean again = b != null && p == null;
        CookieManager.getInstance().setCookie(server.origin(), server.cookie() + "; Path=/; HttpOnly; SameSite=Strict", ok -> {
            if (web == null) return;
            if (!engine.running()) engine.start(getApplicationContext(), server.origin());
            web.loadUrl(server.origin() + (again ? b.getString("path", "/") : p != null ? p : "/"));
        });
    }
    private void fail(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.LTGRAY);
        t.setTextSize(16);
        t.setGravity(android.view.Gravity.CENTER);
        root.addView(t);
    }

    /** Pemutaran di latar: Chromium menjeda video begitu jendelanya tidak terlihat. */
    private static final class Web extends WebView {
        Web(Context c) { super(c); }
        @Override protected void onWindowVisibilityChanged(int v) { super.onWindowVisibilityChanged(View.VISIBLE); }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void build() {
        web = new Web(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        clearOldCache();
        web.addJavascriptInterface(new Bridge(), "PlayAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (mine(u)) return false;
                if (r.isForMainFrame() && "https".equals(u.getScheme())) external(u);
                return true;
            }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                Log.w(Server.TAG, "webview: proses halaman berhenti");
                engine.stop();
                if (v == web) {
                    root.removeView(web);
                    web.destroy();
                    web = null;
                    recreate();
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View v, CustomViewCallback done) { showFull(v, done); }
            @Override public void onHideCustomView() { hideFull(); }
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> done, FileChooserParams p) {
                if (picking != null) picking.onReceiveValue(null);
                picking = done;
                return open(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/json", "application/octet-stream", "text/plain"}), PICK);
            }
        });
        web.setDownloadListener((url, ua, disposition, mime, length) -> {
            Uri u = Uri.parse(url);
            if (!mine(u)) return;
            exporting = u.getEncodedPath();
            Matcher m = Pattern.compile("filename=\"([\\w.-]+)\"").matcher(disposition == null ? "" : disposition);
            open(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, m.find() ? m.group(1) : "play.json"), SAVE);
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
    }
    /** File vendor disimpan lama di cache; buang begitu aplikasinya diperbarui. */
    private void clearOldCache() {
        try {
            PackageInfo i = getPackageManager().getPackageInfo(getPackageName(), 0);
            SharedPreferences p = getPreferences(MODE_PRIVATE);
            if (p.getLong("installed", 0) == i.lastUpdateTime) return;
            web.clearCache(true);
            p.edit().putLong("installed", i.lastUpdateTime).apply();
        } catch (PackageManager.NameNotFoundException e) {
            Log.w(Server.TAG, "versi: " + e);
        }
    }

    private static boolean mine(Uri u) { return "http".equals(u.getScheme()) && "127.0.0.1".equals(u.getHost()) && u.getPort() == server.port; }
    private void external(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Log.w(Server.TAG, "buka: " + e.getMessage());
        }
    }
    private boolean open(Intent i, int code) {
        try {
            startActivityForResult(i, code);
            return true;
        } catch (ActivityNotFoundException e) {
            picking = null;
            return false;
        }
    }

    // ---------- link yang dibagikan dari aplikasi lain ----------
    private static String pathOf(Intent i) {
        String t = i == null || !Intent.ACTION_SEND.equals(i.getAction()) ? null : i.getStringExtra(Intent.EXTRA_TEXT);
        if (t == null) return null;
        Matcher m = VIDEO.matcher(t);
        if (m.find()) return "/watch?v=" + m.group(1);
        m = LIST.matcher(t);
        return m.find() ? "/playlist?list=" + m.group(1) : null;
    }
    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        String p = pathOf(i);
        if (p == null || web == null) return;
        leaveFull();
        web.loadUrl(server.origin() + p);
    }

    // ---------- kabar dari halaman ----------
    private final class Bridge {
        @JavascriptInterface public void state(String json) {
            Player p;
            try { p = Player.parse(json); } catch (JSONException e) { return; }
            runOnUiThread(() -> {
                if (current != MainActivity.this) return;
                player = p;
                if (p.playing) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                PlayService.update(MainActivity.this, p);
            });
        }
        @JavascriptInterface public void pip() { runOnUiThread(() -> { pipAsked = true; enterPip(); }); }
    }
    static void command(String name) { command(name, 0); }
    static void command(String name, double v) {
        MainActivity a = current;
        if (a != null && a.web != null) a.web.evaluateJavascript("window.playCommand?.('" + name + "'," + v + ");0", null);
    }

    // ---------- layar penuh dan gambar dalam gambar ----------
    private void showFull(View v, WebChromeClient.CustomViewCallback done) {
        if (custom != null) { done.onCustomViewHidden(); return; }
        custom = v;
        customDone = done;
        v.setBackgroundColor(Color.BLACK);
        root.setPadding(0, 0, 0, 0);
        root.addView(v, new FrameLayout.LayoutParams(-1, -1));
        if (!pipAsked && player.width > player.height) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        bars(false);
    }
    private void hideFull() {
        if (custom == null) return;
        root.removeView(custom);
        custom = null;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        bars(true);
        customDone.onCustomViewHidden();
        customDone = null;
        root.requestApplyInsets();
    }
    private void leaveFull() {
        if (custom != null) web.evaluateJavascript("document.exitFullscreen().catch(()=>{});0", null);
    }
    private void bars(boolean on) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (on) c.show(WindowInsets.Type.systemBars());
            else c.hide(WindowInsets.Type.systemBars());
        } else {
            getWindow().getDecorView().setSystemUiVisibility(on ? 0 : View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }
    private boolean pip() { return isInPictureInPictureMode(); }
    private void enterPip() {
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return;
        float r = player.height > 0 ? (float) player.width / player.height : 1.78f;
        r = Math.max(0.42f, Math.min(2.39f, r));
        try {
            enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new Rational(Math.round(r * 1000), 1000)).build());
        } catch (IllegalStateException | IllegalArgumentException e) {
            Log.w(Server.TAG, "pip: " + e.getMessage());
        }
    }
    @Override protected void onUserLeaveHint() {
        if (custom != null && player.playing) enterPip();
    }
    @Override public void onPictureInPictureModeChanged(boolean on, Configuration c) {
        super.onPictureInPictureModeChanged(on, c);
        if (on) return;
        if (pipAsked) leaveFull();
        pipAsked = false;
        root.requestApplyInsets();
    }

    // ---------- kembali ----------
    private void back() {
        if (custom != null) { leaveFull(); return; }
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');d?.close();return !!d})()", r -> {
            if ("true".equals(r) || web == null) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }
    @Override public void onBackPressed() { back(); }

    // ---------- impor dan ekspor ----------
    @Override protected void onActivityResult(int code, int result, Intent data) {
        Uri u = result == RESULT_OK && data != null ? data.getData() : null;
        if (code == PICK && picking != null) {
            picking.onReceiveValue(u == null ? null : new Uri[] {u});
            picking = null;
        } else if (code == SAVE && u != null && exporting != null) {
            String path = exporting;
            new Thread(() -> {
                Engine.Reply r = engine.call("GET", path, Collections.singletonMap("host", "127.0.0.1:" + server.port), "");
                if (r == null || r.status != 200) return;
                try (OutputStream out = getContentResolver().openOutputStream(u, "wt")) {
                    out.write(r.body.getBytes(StandardCharsets.UTF_8));
                } catch (IOException e) {
                    Log.w(Server.TAG, "ekspor: " + e);
                }
            }).start();
        }
    }

    // ---------- menutup ----------
    @Override protected void onPause() {
        super.onPause();
        command("save");
    }
    @Override protected void onSaveInstanceState(Bundle b) {
        super.onSaveInstanceState(b);
        Uri u = web == null || web.getUrl() == null ? null : Uri.parse(web.getUrl());
        if (u != null && u.getPath() != null) b.putString("path", u.getEncodedPath() + (u.getEncodedQuery() == null ? "" : "?" + u.getEncodedQuery()));
    }
    @Override protected void onDestroy() {
        if (current == this) current = null;
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        if (isFinishing()) PlayService.stop(this);
        super.onDestroy();
    }
}
