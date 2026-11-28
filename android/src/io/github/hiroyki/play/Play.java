package io.github.hiroyki.play;

import android.content.Context;
import android.webkit.CookieManager;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/** Server dan mesin bersama, dipakai jendela aplikasi dan Android Auto. */
final class Play {
    static Server server;
    static Engine engine;

    static synchronized void init(Context c) throws IOException {
        if (server != null) return;
        engine = new Engine(c.getApplicationContext());
        server = new Server(c.getApplicationContext(), engine);
    }
    /** Dipanggil di utas utama. Kunci server dipasang di WebView dulu, baru mesinnya dinyalakan. */
    static void ready(Context c, Runnable then) {
        CookieManager.getInstance().setCookie(server.origin(), server.cookie() + "; Path=/; HttpOnly; SameSite=Strict", ok -> {
            if (!engine.running()) engine.start(c.getApplicationContext(), server.origin());
            if (then != null) then.run();
        });
    }
    static Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        h.put("host", "127.0.0.1:" + server.port);
        h.put("content-type", "application/json");
        return h;
    }
    /** Memanggil server/index.js dari Java. Jangan di utas utama. */
    static Engine.Reply api(String method, String path, String body) {
        return engine.call(method, path, headers(), body);
    }
}
