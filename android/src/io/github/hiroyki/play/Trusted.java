package io.github.hiroyki.play;

import android.content.Context;
import android.os.Process;
import java.util.Arrays;
import java.util.List;

/** Aplikasi yang boleh melihat daftar video dan thumbnail-nya: Android Auto, Asisten, dan sistem. Riwayat tontonan itu pribadi. */
final class Trusted {
    private static final List<String> PACKAGES = Arrays.asList("com.google.android.projection.gearhead", "com.google.android.carassistant",
            "com.google.android.googlequicksearchbox", "com.android.systemui", "com.google.android.apps.automotive.templates.host");

    static boolean pkg(String p, int uid) {
        return uid == Process.myUid() || uid == Process.SYSTEM_UID || PACKAGES.contains(p);
    }
    static boolean uid(Context c, int uid) {
        if (uid == Process.myUid() || uid == Process.SYSTEM_UID) return true;
        String[] all = c.getPackageManager().getPackagesForUid(uid);
        if (all != null) for (String p : all) if (PACKAGES.contains(p)) return true;
        return false;
    }
}
