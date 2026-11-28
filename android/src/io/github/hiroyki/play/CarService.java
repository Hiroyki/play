package io.github.hiroyki.play;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaDescription;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.browse.MediaBrowser.MediaItem;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.service.media.MediaBrowserService;
import android.util.Log;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Play di Android Auto: daftar video dan pemutaran suaranya saja. Android Auto tidak mengizinkan video
 * dari HP tampil di layar mobil, jadi yang dipakai adalah jalur resmi untuk aplikasi media.
 */
public final class CarService extends MediaBrowserService {
    private static final String ROOT = "root", EMPTY = "empty", CHANNEL = "auto";
    private static final int ID = 2;
    private static final String[][] SHELVES = {{"history", "Lanjut nonton"}, {"saved", "Simpanan"}, {"subs", "Langganan"}, {"hot", "Ramai minggu ini"}};
    private static final Pattern AUDIO = Pattern.compile("contentType=\"audio\"[\\s\\S]*?</AdaptationSet>");
    private static final Pattern REP = Pattern.compile("bandwidth=\"(\\d+)\"[^>]*>\\s*<BaseURL>([^<]+)</BaseURL>");

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Map<String, List<JSONObject>> shelves = new ConcurrentHashMap<>();
    private MediaSession session;
    private MediaPlayer player;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private List<JSONObject> queue = new ArrayList<>();
    private int at = -1, turn;
    private JSONObject now;
    private Bitmap art;
    private boolean ready, resumeOnFocus, foreground;
    private long lastSave;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (player == null || !ready) return;
            if (player.isPlaying() && System.currentTimeMillis() - lastSave > 30_000) save();
            state(player.isPlaying() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED);
            ui.postDelayed(this, 5000);
        }
    };

    // ---------- menyala ----------
    @Override public void onCreate() {
        super.onCreate();
        audio = getSystemService(AudioManager.class);
        NotificationChannel c = new NotificationChannel(CHANNEL, "Android Auto", NotificationManager.IMPORTANCE_LOW);
        c.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(c);
        session = new MediaSession(this, "Play Auto");
        session.setCallback(new Controls());
        setSessionToken(session.getSessionToken());
        state(PlaybackState.STATE_NONE);
        try {
            Play.init(this);
            Play.ready(this, null);
        } catch (IOException e) {
            Log.w(Server.TAG, "auto: " + e.getMessage());
        }
    }
    @Override public int onStartCommand(Intent i, int flags, int id) {
        String a = i == null ? null : i.getAction();
        if ("pause".equals(a)) pause();
        else if ("play".equals(a)) resume();
        else if ("next".equals(a)) skip(1);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        stop();
        session.release();
        io.shutdown(); // posisi terakhir masih sempat disimpan
        super.onDestroy();
    }

    // ---------- daftar ----------
    @Override public BrowserRoot onGetRoot(String pkg, int uid, Bundle hints) {
        // Pemutaran ulang dari kartu media sistem butuh video terakhir; belum didukung.
        if (hints != null && hints.getBoolean(BrowserRoot.EXTRA_RECENT)) return null;
        boolean ok = Trusted.pkg(pkg, uid);
        Bundle extras = new Bundle();
        extras.putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true);
        extras.putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1); // daftar, bukan kisi
        return new BrowserRoot(ok ? ROOT : EMPTY, extras);
    }
    @Override public void onLoadChildren(String parent, Result<List<MediaItem>> result) {
        if (EMPTY.equals(parent)) { result.sendResult(Collections.emptyList()); return; }
        if (ROOT.equals(parent)) {
            List<MediaItem> out = new ArrayList<>();
            for (String[] s : SHELVES)
                out.add(new MediaItem(new MediaDescription.Builder().setMediaId(s[0]).setTitle(s[1]).build(), MediaItem.FLAG_BROWSABLE));
            result.sendResult(out);
            return;
        }
        result.detach();
        io.execute(() -> {
            List<MediaItem> out = items(parent, load(parent));
            ui.post(() -> result.sendResult(out));
        });
    }
    private List<MediaItem> items(String shelf, List<JSONObject> list) {
        shelves.put(shelf, list);
        List<MediaItem> out = new ArrayList<>();
        for (JSONObject v : list) {
            String sub = v.optString("author");
            String d = v.optBoolean("live") ? "Live" : v.optString("duration");
            if (!d.isEmpty()) sub = sub.isEmpty() ? d : sub + " · " + d;
            out.add(new MediaItem(new MediaDescription.Builder().setMediaId(shelf + "/" + v.optString("id"))
                    .setTitle(v.optString("title")).setSubtitle(sub).setIconUri(Art.of(v.optString("id"))).build(), MediaItem.FLAG_PLAYABLE));
        }
        return out;
    }
    private List<JSONObject> search(String q) {
        if (q == null || q.trim().isEmpty()) return Collections.emptyList();
        Engine.Reply r = Play.api("GET", "/api/search?q=" + Uri.encode(q.trim().substring(0, Math.min(200, q.trim().length()))), "");
        if (r == null || r.status != 200) return Collections.emptyList();
        try {
            return videos(new JSONObject(r.body).optJSONArray("items"));
        } catch (JSONException e) {
            return Collections.emptyList();
        }
    }
    private static List<JSONObject> videos(JSONArray a) {
        List<JSONObject> out = new ArrayList<>();
        for (int i = 0; a != null && i < a.length() && out.size() < 60; i++) {
            JSONObject v = a.optJSONObject(i);
            if (v != null && v.optString("id").matches("[\\w-]{11}") && (!v.has("type") || "video".equals(v.optString("type")))) out.add(v);
        }
        return out;
    }
    private List<JSONObject> load(String shelf) {
        boolean lib = shelf.equals("history") || shelf.equals("saved");
        Engine.Reply r = Play.api("GET", lib ? "/api/library" : shelf.equals("subs") ? "/api/feed" : "/api/hot", "");
        if (r == null || r.status != 200) return Collections.emptyList();
        try {
            JSONObject j = new JSONObject(r.body);
            return videos(j.optJSONArray(lib ? shelf : "items"));
        } catch (JSONException e) {
            return Collections.emptyList();
        }
    }

    // ---------- memutar ----------
    private final class Controls extends MediaSession.Callback {
        @Override public void onPlayFromMediaId(String mediaId, Bundle extras) {
            int slash = mediaId.indexOf('/');
            if (slash < 0) return;
            List<JSONObject> list = shelves.get(mediaId.substring(0, slash));
            String id = mediaId.substring(slash + 1);
            if (list == null) return;
            for (int i = 0; i < list.size(); i++)
                if (list.get(i).optString("id").equals(id)) {
                    queue = new ArrayList<>(list);
                    at = i;
                    start(queue.get(i));
                    return;
                }
        }
        // "Hey Google, putar ... di Play". Tanpa kata kunci: lanjutkan yang terakhir ditonton.
        @Override public void onPlayFromSearch(String query, Bundle extras) {
            boolean any = query == null || query.trim().isEmpty();
            state(PlaybackState.STATE_CONNECTING);
            io.execute(() -> {
                List<JSONObject> list = any ? load("history") : search(query);
                ui.post(() -> {
                    if (list.isEmpty()) { fail(any ? "Belum ada yang ditonton." : "Tidak ada hasil untuk \u201c" + query.trim() + "\u201d."); return; }
                    shelves.put("search", list);
                    queue = new ArrayList<>(list);
                    at = 0;
                    start(queue.get(0));
                });
            });
        }
        @Override public void onPlay() { resume(); }
        @Override public void onPause() { pause(); }
        @Override public void onStop() { stop(); }
        @Override public void onSkipToNext() { skip(1); }
        @Override public void onSkipToPrevious() { skip(-1); }
        @Override public void onSeekTo(long ms) { if (player != null && ready) player.seekTo((int) ms); state(PlaybackState.STATE_PLAYING); }
        @Override public void onFastForward() { jump(10_000); }
        @Override public void onRewind() { jump(-10_000); }
    }
    private void jump(int ms) {
        if (player == null || !ready) return;
        player.seekTo(Math.max(0, player.getCurrentPosition() + ms));
    }
    private void skip(int d) {
        if (at + d < 0 || at + d >= queue.size()) return;
        at += d;
        start(queue.get(at));
    }

    /** Alamat suara dari server lokal: trek audio DASH terbaik, atau HLS untuk siaran langsung. */
    private static String audioUrl(String id) throws JSONException {
        Engine.Reply r = Play.api("GET", "/api/play/" + id, "");
        if (r == null) throw new JSONException("Play belum siap.");
        JSONObject j = new JSONObject(r.body);
        if (r.status != 200) throw new JSONException(j.optString("error", "Video gagal diputar."));
        JSONArray s = j.getJSONArray("sources");
        String hls = null, file = null;
        for (int i = 0; i < s.length(); i++) {
            JSONObject x = s.getJSONObject(i);
            String kind = x.optString("kind");
            if (kind.equals("dash")) {
                Engine.Reply m = Play.api("GET", x.getString("url"), "");
                Matcher a = m == null ? null : AUDIO.matcher(m.body);
                if (a != null && a.find()) {
                    String best = null;
                    long most = -1;
                    for (Matcher p = REP.matcher(a.group()); p.find(); )
                        if (Long.parseLong(p.group(1)) > most) { most = Long.parseLong(p.group(1)); best = p.group(2); }
                    if (best != null) return best;
                }
            } else if (kind.equals("hls")) hls = x.getString("url");
            else if (kind.equals("file")) file = x.getString("url");
        }
        if (hls != null) return hls;
        if (file != null) return file;
        throw new JSONException("Tidak ada suara yang bisa diputar.");
    }

    private void start(JSONObject v) {
        int mine = ++turn;
        release();
        now = v;
        art = null;
        MainActivity.pauseHere();
        meta();
        state(PlaybackState.STATE_BUFFERING);
        goForeground();
        io.execute(() -> {
            String url;
            try {
                url = audioUrl(v.optString("id"));
            } catch (JSONException e) {
                ui.post(() -> { if (mine == turn) fail(e.getMessage()); });
                return;
            }
            ui.post(() -> { if (mine == turn) open(url, v); });
            Bitmap b = picture(v.optString("thumb"));
            ui.post(() -> { if (mine == turn && b != null) { art = b; meta(); } });
        });
    }
    private void open(String url, JSONObject v) {
        MediaPlayer p = new MediaPlayer();
        player = p;
        ready = false;
        p.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
        p.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
        Map<String, String> h = new HashMap<>();
        h.put("Cookie", Play.server.cookie());
        try {
            p.setDataSource(this, Uri.parse(Play.server.origin() + url), h);
        } catch (IOException | RuntimeException e) {
            fail("Video gagal diputar.");
            return;
        }
        p.setOnPreparedListener(x -> {
            if (player != x) return;
            ready = true;
            // Lanjut dari posisi terakhir, kecuali hampir habis.
            double pos = v.optDouble("position", 0), len = v.optDouble("length", 0);
            if (pos > 10 && (len <= 0 || pos < len - 15)) x.seekTo((int) (pos * 1000));
            meta();
            if (askFocus()) x.start();
            state(x.isPlaying() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED);
            ui.removeCallbacks(tick);
            ui.postDelayed(tick, 5000);
        });
        p.setOnCompletionListener(x -> {
            save();
            if (at + 1 < queue.size()) skip(1);
            else { state(PlaybackState.STATE_STOPPED); background(); }
        });
        p.setOnErrorListener((x, what, extra) -> {
            Log.w(Server.TAG, "auto: pemutar " + what + "/" + extra);
            fail("Video gagal diputar.");
            return true;
        });
        p.prepareAsync();
    }
    private void fail(String text) {
        release();
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions())
                .setState(PlaybackState.STATE_ERROR, 0, 0).setErrorMessage(text).build());
        background();
    }
    private void resume() {
        if (player == null || !ready) { if (now != null) start(now); return; }
        if (!askFocus()) return;
        MainActivity.pauseHere();
        player.start();
        goForeground();
        state(PlaybackState.STATE_PLAYING);
        ui.removeCallbacks(tick);
        ui.postDelayed(tick, 5000);
    }
    private void pause() {
        if (player != null && ready && player.isPlaying()) player.pause();
        save();
        state(PlaybackState.STATE_PAUSED);
        background();
    }
    private void stop() {
        save();
        turn++;
        release();
        if (focus != null) audio.abandonAudioFocusRequest(focus);
        state(PlaybackState.STATE_STOPPED);
        background();
        stopSelf();
    }
    private void release() {
        ui.removeCallbacks(tick);
        if (player != null) player.release();
        player = null;
        ready = false;
    }

    // Suara mobil, telepon, atau navigasi diberi tempat.
    private boolean askFocus() {
        if (focus == null)
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setOnAudioFocusChangeListener(change -> {
                        if (player == null || !ready) return;
                        if (change == AudioManager.AUDIOFOCUS_LOSS) pause();
                        else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                            if (player.isPlaying()) { resumeOnFocus = true; player.pause(); state(PlaybackState.STATE_PAUSED); }
                        } else if (change == AudioManager.AUDIOFOCUS_GAIN && resumeOnFocus) {
                            resumeOnFocus = false;
                            player.start();
                            state(PlaybackState.STATE_PLAYING);
                        }
                    }, ui).build();
        return audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    /** Posisi tonton ikut tersimpan, jadi "Lanjut nonton" di HP dan di mobil sama. */
    private void save() {
        if (player == null || !ready || now == null) return;
        lastSave = System.currentTimeMillis();
        try {
            String body = new JSONObject().put("op", "watched").put("video", now)
                    .put("position", player.getCurrentPosition() / 1000.0).put("length", Math.max(0, player.getDuration()) / 1000.0).toString();
            io.execute(() -> Play.api("POST", "/api/library", body));
        } catch (JSONException e) {
            Log.w(Server.TAG, "auto: simpan " + e);
        }
    }

    // ---------- tampilan di mobil ----------
    private long actions() {
        long a = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP
                | PlaybackState.ACTION_PLAY_FROM_MEDIA_ID | PlaybackState.ACTION_PLAY_FROM_SEARCH | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_REWIND;
        if (at + 1 < queue.size()) a |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (at > 0) a |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        return a;
    }
    private void state(int s) {
        long pos = player != null && ready ? player.getCurrentPosition() : 0;
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions()).setState(s, pos, s == PlaybackState.STATE_PLAYING ? 1f : 0f).build());
        session.setActive(s != PlaybackState.STATE_NONE && s != PlaybackState.STATE_STOPPED);
        if (foreground) getSystemService(NotificationManager.class).notify(ID, notification());
    }
    private void meta() {
        if (now == null) return;
        MediaMetadata.Builder b = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, now.optString("id"))
                .putString(MediaMetadata.METADATA_KEY_TITLE, now.optString("title"))
                .putString(MediaMetadata.METADATA_KEY_ARTIST, now.optString("author"))
                .putLong(MediaMetadata.METADATA_KEY_DURATION, player != null && ready ? player.getDuration() : -1);
        b.putString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI, Art.of(now.optString("id")).toString());
        if (art != null) b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(b.build());
    }
    private static Bitmap picture(String url) {
        if (!url.startsWith("https://i.ytimg.com/")) return null;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            try (InputStream in = c.getInputStream()) { return BitmapFactory.decodeStream(in); }
        } catch (IOException e) {
            return null;
        }
    }
    private PendingIntent action(String name) {
        return PendingIntent.getService(this, name.hashCode(), new Intent(this, CarService.class).setAction(name), PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification notification() {
        boolean on = player != null && ready && player.isPlaying();
        Notification.Builder b = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(now == null ? "Play" : now.optString("title")).setContentText(now == null ? "" : now.optString("author"))
                .setLargeIcon(art).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_TRANSPORT)
                .addAction(new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, on ? R.drawable.ic_pause : R.drawable.ic_stat), on ? "Jeda" : "Putar", action(on ? "pause" : "play")).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0));
        if (at + 1 < queue.size()) b.addAction(new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_next), "Berikutnya", action("next")).build());
        return b.build();
    }
    /** Supaya suara tetap jalan saat layar HP mati. */
    private void goForeground() {
        if (foreground) return;
        // startForeground dulu: kalau Android menolak, tidak ada janji layanan latar yang dilanggar (itu membuat aplikasi ditutup paksa).
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(ID, notification());
            foreground = true;
            startService(new Intent(this, CarService.class)); // tetap hidup walau Android Auto melepas sambungan
        } catch (RuntimeException e) {
            Log.w(Server.TAG, "auto: latar " + e.getMessage()); // tetap jalan selama Android Auto tersambung
        }
    }
    private void background() {
        if (!foreground) return;
        stopForeground(STOP_FOREGROUND_DETACH);
        foreground = false;
    }
}
