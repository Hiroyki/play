package io.github.hiroyki.play;

import org.json.JSONException;
import org.json.JSONObject;

/** Keadaan pemutar yang dikabarkan halaman (lihat bridge.js). */
final class Player {
    boolean on, playing, next, live;
    String title = "", author = "", thumb = "";
    long position, duration;
    float speed = 1;
    int width, height;

    static Player parse(String json) throws JSONException {
        JSONObject j = new JSONObject(json);
        Player p = new Player();
        p.on = j.optBoolean("on");
        p.playing = j.optBoolean("playing");
        p.next = j.optBoolean("next");
        p.live = j.optBoolean("live");
        p.title = j.optString("title");
        p.author = j.optString("author");
        p.thumb = j.optString("thumb");
        p.position = (long) (j.optDouble("position", 0) * 1000);
        p.duration = (long) (j.optDouble("duration", 0) * 1000);
        p.speed = (float) j.optDouble("speed", 1);
        p.width = j.optInt("width");
        p.height = j.optInt("height");
        return p;
    }
}
