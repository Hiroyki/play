package io.github.hiroyki.play;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Menjaga pemutaran tetap jalan di latar, dengan tombol di notifikasi, layar kunci, dan headset. */
public final class PlayService extends Service {
    private static final String CHANNEL = "main";
    private static final int ID = 1;
    private static final long IDLE = 10 * 60_000;
    private static PlayService self;
    private static Player state;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable idle = this::stopSelf;
    private MediaSession session;
    private String artUrl = "";
    private Bitmap art;

    static void update(Context ctx, Player p) {
        state = p;
        if (self != null) {
            if (p.on) self.show();
            else self.stopSelf();
        } else if (p.on && p.playing) {
            try {
                ctx.startForegroundService(new Intent(ctx, PlayService.class));
            } catch (RuntimeException e) {
                Log.w(Server.TAG, "layanan: " + e.getMessage()); // mulai dari latar tidak selalu diizinkan
            }
        }
    }
    static void stop(Context ctx) { ctx.stopService(new Intent(ctx, PlayService.class)); }

    @Override public void onCreate() {
        self = this;
        NotificationChannel c = new NotificationChannel(CHANNEL, "Pemutaran", NotificationManager.IMPORTANCE_LOW);
        c.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(c);
        session = new MediaSession(this, "Play");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.command("play"); }
            @Override public void onPause() { MainActivity.command("pause"); }
            @Override public void onSkipToNext() { MainActivity.command("next"); }
            @Override public void onSeekTo(long ms) { MainActivity.command("seek", ms / 1000.0); }
            @Override public void onRewind() { MainActivity.command("skip", -10); }
            @Override public void onFastForward() { MainActivity.command("skip", 10); }
            @Override public void onStop() { MainActivity.command("pause"); }
        });
        session.setActive(true);
        // Di sini, bukan di onStartCommand: kalau layanan keburu dihentikan di antaranya, Android mematikan aplikasi.
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, build());
    }
    @Override public int onStartCommand(Intent i, int flags, int id) {
        if (i != null && i.getAction() != null) {
            MainActivity.command(i.getAction());
            return START_NOT_STICKY;
        }
        if (state == null || !state.on) stopSelf();
        else show();
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        ui.removeCallbacks(idle);
        session.release();
        self = null;
    }
    @Override public IBinder onBind(Intent i) { return null; }

    private void show() {
        Player p = state;
        ui.removeCallbacks(idle);
        if (!p.playing) ui.postDelayed(idle, IDLE); // dijeda lama: lepaskan
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, p.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, p.author)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, p.live ? -1 : p.duration)
                .putBitmap(MediaMetadata.METADATA_KEY_ART, art).build());
        long can = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
        if (!p.live) can |= PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_REWIND | PlaybackState.ACTION_FAST_FORWARD;
        if (p.next) can |= PlaybackState.ACTION_SKIP_TO_NEXT;
        session.setPlaybackState(new PlaybackState.Builder().setActions(can)
                .setState(p.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, p.position, p.playing ? p.speed : 0).build());
        getSystemService(NotificationManager.class).notify(ID, build());
        if (!p.thumb.equals(artUrl)) load(p.thumb);
    }
    private PendingIntent action(String name) {
        return PendingIntent.getService(this, name.hashCode(), new Intent(this, PlayService.class).setAction(name), PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification build() {
        Player p = state == null ? new Player() : state;
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat).setContentTitle(p.title).setContentText(p.author).setLargeIcon(art)
                .setOngoing(p.playing).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_TRANSPORT)
                .setContentIntent(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE));
        b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, p.playing ? R.drawable.ic_pause : R.drawable.ic_stat), p.playing ? "Jeda" : "Putar", action(p.playing ? "pause" : "play")).build());
        Notification.MediaStyle style = new Notification.MediaStyle().setMediaSession(session.getSessionToken());
        if (p.next) {
            b.addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_next), "Berikutnya", action("next")).build());
            style.setShowActionsInCompactView(0, 1);
        } else {
            style.setShowActionsInCompactView(0);
        }
        return b.setStyle(style).build();
    }
    private void load(String url) {
        artUrl = url;
        art = null;
        if (!url.startsWith("https://i.ytimg.com/")) return;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                Bitmap b;
                try (InputStream in = c.getInputStream()) { b = BitmapFactory.decodeStream(in); }
                ui.post(() -> {
                    if (self != this || !url.equals(artUrl) || state == null || !state.on) return;
                    art = b;
                    show();
                });
            } catch (IOException e) {
                Log.w(Server.TAG, "gambar: " + e.getMessage());
            }
        }).start();
    }
}
