package io.github.hiroyki.play;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.Comparator;

/**
 * Thumbnail untuk daftar video di Android Auto, yang hanya mau memuat gambar dari content://.
 * content://io.github.hiroyki.play.art/<id video> mengambil gambar YouTube sekali lalu menyimpannya di cache.
 */
public final class Art extends ContentProvider {
    static final String AUTHORITY = "io.github.hiroyki.play.art";
    private static final int KEEP = 300;

    static Uri of(String id) { return Uri.parse("content://" + AUTHORITY + "/" + id); }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri u) { return "image/jpeg"; }

    @Override public ParcelFileDescriptor openFile(Uri u, String mode) throws FileNotFoundException {
        String id = u.getLastPathSegment();
        if (id == null || !id.matches("[\\w-]{11}") || !"r".equals(mode)) throw new FileNotFoundException();
        if (!Trusted.uid(getContext(), Binder.getCallingUid())) throw new SecurityException("Hanya untuk Android Auto.");
        File dir = new File(getContext().getCacheDir(), "art");
        File f = new File(dir, id + ".jpg");
        if (!f.exists()) fetch(id, dir, f);
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }
    private static void fetch(String id, File dir, File f) throws FileNotFoundException {
        dir.mkdirs();
        File tmp = new File(dir, id + ".unduh");
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://i.ytimg.com/vi/" + id + "/mqdefault.jpg").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                byte[] b = new byte[16 * 1024];
                for (int n; (n = in.read(b)) >= 0; ) out.write(b, 0, n);
            }
            if (!tmp.renameTo(f)) throw new IOException("rename");
        } catch (IOException e) {
            tmp.delete();
            throw new FileNotFoundException(e.getMessage());
        }
        File[] all = dir.listFiles();
        if (all != null && all.length > KEEP) {
            Arrays.sort(all, Comparator.comparingLong(File::lastModified));
            for (int i = 0; i < all.length - KEEP; i++) all[i].delete();
        }
    }

    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
