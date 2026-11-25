// Stream: yt-dlp mencari URL media, server ini menyusun manifest DASH/HLS dan meneruskan datanya.
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { command, runtimeArgs } from './ytdlp.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

const REASONS = [
  [/not a bot/i, 403, 'YouTube lagi minta verifikasi dari jaringan ini. Coba lagi beberapa menit lagi.'],
  [/confirm your age|age-restricted/i, 403, 'Video ini dibatasi umur dan butuh login YouTube.'],
  [/private video/i, 403, 'Video ini privat.'],
  [/members|join this channel/i, 403, 'Video ini khusus member channel.'],
  [/live event will begin|premieres in/i, 409, 'Siaran ini belum mulai.'],
  [/unavailable|removed|video is not available/i, 404, 'Video ini tidak tersedia.'],
];
function run(id) {
  const args = ['--ignore-config', ...runtimeArgs, '--no-playlist', '--encoding', 'utf-8', '-J', '--', `https://www.youtube.com/watch?v=${id}`];
  return new Promise((resolve, reject) => {
    execFile(command(), args, { maxBuffer: 64 * 1024 * 1024, timeout: 60_000, windowsHide: true }, (err, out, stderr) => {
      if (!err) {
        try {
          return resolve(JSON.parse(out));
        } catch {
          return reject(fail(502, 'Jawaban yt-dlp tidak terbaca.'));
        }
      }
      if (err.code === 'ENOENT') return reject(fail(500, 'yt-dlp belum terpasang. Buka Pengaturan untuk memasangnya.'));
      if (err.killed) return reject(fail(504, 'YouTube terlalu lama menjawab. Coba lagi.'));
      const msg = (stderr.match(/ERROR: (?:\[[^\]]+\] )?(?:[\w-]{11}: )?(.+)/)?.[1] ?? 'yt-dlp gagal mengambil video.').trim();
      // Pemecah tantangan yang ketinggalan zaman membuat video sehat terlihat "tidak tersedia".
      if (/n challenge solving failed/i.test(stderr) && /not available|format/i.test(msg))
        return reject(fail(502, 'yt-dlp ketinggalan dari sistem baru YouTube. Buka Pengaturan untuk memperbarui.'));
      const known = REASONS.find(([re]) => re.test(msg));
      reject(known ? fail(known[1], known[2]) : fail(502, msg.slice(0, 200)));
    });
  });
}

// ---------- antrean kecil + cache ----------
const store = new Map();
let active = 0;
const waiting = [];
async function slot(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
function resolve(id, fresh = false) {
  const hit = store.get(id);
  if (hit && hit.until > Date.now() && !(fresh && Date.now() - hit.at > 15_000)) return hit.promise;
  const entry = { at: Date.now(), until: Date.now() + 120_000 };
  entry.promise = slot(() => run(id)).then(prepare).then(
    (v) => {
      const s = split(v);
      const complete = s.audio.length && (s.avc.length || s.av1.length);
      // Hasil yang belum lengkap jangan dipakai berjam-jam.
      entry.until = v.live ? Date.now() + 5 * 60e3 : complete ? v.expires - 10 * 60e3 : Date.now() + 60_000;
      return v;
    },
    (e) => {
      if (store.get(id) === entry) store.delete(id);
      throw e;
    },
  );
  store.set(id, entry);
  if (store.size > 60) store.delete(store.keys().next().value);
  return entry.promise;
}

// Menyiapkan video sebelum diklik. Paling banyak satu sekaligus, dibatasi per sepuluh menit
// supaya YouTube tidak kebanjiran, dan tidak pernah mendahului video yang benar-benar diminta.
const WARM_MAX = 40;
const warmLog = [];
let warming = null;
let warmNext = null;
export function warm(id) {
  const hit = store.get(id);
  if (hit && hit.until > Date.now()) return 'siap';
  if (warming === id) return 'jalan';
  if (warming || active) {
    warmNext = id; // cuma yang terakhir yang menunggu
    return 'antre';
  }
  while (warmLog.length && warmLog[0] < Date.now() - 600_000) warmLog.shift();
  if (warmLog.length >= WARM_MAX) return 'penuh';
  warmLog.push(Date.now());
  warming = id;
  resolve(id).catch(() => {}).finally(() => {
    warming = null;
    const n = warmNext;
    warmNext = null;
    if (n) warm(n);
  });
  return 'jalan';
}

// ---------- indeks MP4 ----------
// Header MP4 cukup untuk tahu letak init dan sidx yang dibutuhkan DASH.
async function ranges(f) {
  const r = await fetch(f.url, { headers: { ...f.http_headers, Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw fail(502, 'media ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  for (let o = 0; o + 8 <= buf.length; ) {
    const size = buf.readUInt32BE(o);
    if (buf.toString('latin1', o + 4, o + 8) === 'sidx') return { init: `0-${o - 1}`, index: `${o}-${o + size - 1}` };
    if (size < 8) break;
    o += size;
  }
  return null;
}

// Lembar gambar kecil yang dipakai untuk cuplikan di garis waktu.
function storyboard(all) {
  const f = all.filter((x) => /^sb\d/.test(x.format_id) && x.width <= 320 && x.fps && x.fragments?.length).sort((a, b) => b.width - a.width)[0];
  if (!f) return null;
  const sheets = f.fragments.map((x) => new URL(x.url)).filter((u) => u.protocol === 'https:' && u.hostname.endsWith('.ytimg.com'));
  if (sheets.length !== f.fragments.length) return null;
  return { w: f.width, h: f.height, cols: f.columns, rows: f.rows, fps: f.fps, sheets: sheets.map((u) => u.href.replace(/["'()\\]/g, encodeURIComponent)) };
}

const isHttps = (f) => f.protocol === 'https' && f.url && !f.has_drm;
async function prepare(d) {
  const live = !!d.is_live;
  const all = d.formats ?? [];
  const out = {
    live,
    duration: d.duration ?? 0,
    hls: all.find((f) => f.protocol?.startsWith('m3u8') && f.manifest_url)?.manifest_url ?? null,
    formats: new Map(),
    captions: new Map(),
    chapters: d.chapters ?? [],
    heat: live ? [] : (d.heatmap ?? []).map((x) => Math.round(x.value * 1000) / 1000),
    board: live ? null : storyboard(all),
    expires: Date.now() + 5 * 3600e3,
  };
  const exp = Number(all.find(isHttps)?.url.match(/[?&]expire=(\d+)/)?.[1]);
  if (exp) out.expires = exp * 1000;

  // YouTube baru mengaktifkan link beberapa detik setelah diminta; sebelum itu jawabannya 403.
  const ready = Math.max(0, ...all.filter(isHttps).map((f) => f.available_at ?? 0)) * 1000;
  const wait = Math.min(20_000, ready - Date.now());
  if (!live && wait > 0) await new Promise((r) => setTimeout(r, wait + 300));

  if (!live) {
    const mp4 = all.filter((f) => isHttps(f) && (f.ext === 'mp4' || f.ext === 'm4a') && !/drc/.test(f.format_id));
    const video = mp4.filter((f) => f.acodec === 'none' && /^(avc1|av01)/.test(f.vcodec ?? '') && f.height);
    // Kalau ada sulih suara, pakai audio aslinya.
    const voices = mp4.filter((f) => f.vcodec === 'none' && /^mp4a/.test(f.acodec ?? ''));
    const original = Math.max(...voices.map((f) => f.language_preference ?? -1));
    const mine = voices.filter((f) => (f.language_preference ?? -1) === original);
    const hifi = mine.filter((f) => (f.asr ?? 0) >= 44100);
    await Promise.all(
      [...video, ...(hifi.length ? hifi : mine)].map(async (f) => {
        const r = await ranges(f).catch(() => null);
        if (r) out.formats.set(f.format_id, { ...f, ...r });
      }),
    );
    const whole = mp4.find((f) => f.acodec !== 'none' && f.vcodec !== 'none');
    if (whole) out.formats.set(whole.format_id, { ...whole, whole: true });
  }

  const addCap = (lang, list, auto) => {
    const src = list?.find((c) => c.ext === 'json3');
    if (src) out.captions.set((auto ? 'a.' : 'm.') + lang, { lang: lang.replace(/-orig$/, ''), name: src.name || lang, auto, url: src.url });
  };
  for (const [lang, list] of Object.entries(d.subtitles ?? {})) if (lang !== 'live_chat') addCap(lang, list, false);
  for (const [lang, list] of Object.entries(d.automatic_captions ?? {}))
    if (/-orig$/.test(lang) || ((lang === 'id' || lang === 'en') && !d.automatic_captions[lang + '-orig'])) addCap(lang, list, true);
  return out;
}

const split = (v) => {
  const list = [...v.formats.values()];
  const parts = list.filter((f) => !f.whole);
  return {
    avc: parts.filter((f) => f.vcodec?.startsWith('avc1')),
    av1: parts.filter((f) => f.vcodec?.startsWith('av01')),
    audio: parts.filter((f) => f.vcodec === 'none'),
    whole: list.find((f) => f.whole),
  };
};
const probe = (list) => {
  const f = list.reduce((a, b) => (b.height > a.height ? b : a));
  return {
    contentType: `video/mp4; codecs="${f.vcodec}"`,
    width: f.width, height: f.height,
    bitrate: Math.round((f.tbr || 2000) * 1000),
    framerate: f.fps || 30,
  };
};

export async function playback(id, { fresh } = {}) {
  const v = await resolve(id, fresh);
  const s = split(v);
  const sources = [];
  for (const codec of ['av1', 'avc'])
    if (s.audio.length && s[codec].length) sources.push({ kind: 'dash', codec, url: `/api/dash/${id}/${codec}.mpd`, probe: probe(s[codec]) });
  if (v.hls) sources.push({ kind: 'hls', url: hlsUrl(v.hls) });
  if (s.whole) sources.push({ kind: 'file', url: `/api/media/${id}/${s.whole.format_id}` });
  if (!sources.length) throw fail(502, 'Tidak ada format yang bisa diputar untuk video ini.');
  return {
    live: v.live,
    duration: v.duration,
    sources,
    heat: v.heat,
    board: v.board,
    chapters: v.chapters.map((c) => ({ start: c.start_time, title: c.title })),
    captions: [...v.captions].map(([key, c]) => ({
      key, lang: c.lang, name: c.name, auto: c.auto, url: `/api/captions/${id}/${encodeURIComponent(key)}.vtt`,
    })),
  };
}

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
export async function dash(id, codec) {
  const v = await resolve(id);
  const s = split(v);
  if (!s[codec].length || !s.audio.length) throw fail(404, 'Format tidak ada.');
  // Bitrate YouTube kadang terbalik (240p tertulis lebih kecil dari 144p); urutkan supaya mode otomatis tidak salah pilih.
  const rate = new Map();
  let floor = 0;
  for (const f of [...s[codec]].sort((a, b) => a.height - b.height || a.tbr - b.tbr)) {
    floor = Math.max(floor + 1, Math.round((f.tbr || 128) * 1000));
    rate.set(f, floor);
  }
  const rep = (f, extra) =>
    `<Representation id="${esc(f.format_id)}" codecs="${esc(f.vcodec === 'none' ? f.acodec : f.vcodec)}" bandwidth="${rate.get(f) ?? Math.round((f.tbr || 128) * 1000)}" ${extra}>` +
    `<BaseURL>/api/media/${id}/${esc(f.format_id)}</BaseURL>` +
    `<SegmentBase indexRange="${f.index}"><Initialization range="${f.init}"/></SegmentBase></Representation>`;
  const set = (n, type, body) =>
    `<AdaptationSet id="${n}" contentType="${type}" mimeType="${type}/mp4" subsegmentAlignment="true" subsegmentStartsWithSAP="1">${body}</AdaptationSet>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" ' +
    `profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" mediaPresentationDuration="PT${Number(v.duration)}S" minBufferTime="PT2S"><Period>` +
    set(0, 'video', s[codec].map((f) => rep(f, `width="${f.width}" height="${f.height}" frameRate="${Math.round(f.fps || 30)}"`)).join('')) +
    set(1, 'audio', s.audio.map((f) => rep(f, `audioSamplingRate="${f.asr || 44100}"`)).join('')) +
    '</Period></MPD>'
  );
}

// ---------- penerus media ----------
async function pipe(upstream, res, headers) {
  res.status(upstream.status);
  for (const h of headers) if (upstream.headers.get(h)) res.setHeader(h, upstream.headers.get(h));
  if (!upstream.body) return res.end();
  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch {
    // penonton pindah posisi atau menutup tab
  }
}
function aborter(res) {
  const a = new AbortController();
  res.on('close', () => a.abort());
  return a.signal;
}

export async function media(id, itag, req, res) {
  const range = /^bytes=\d+-\d*$/.test(req.headers.range ?? '') ? req.headers.range : 'bytes=0-';
  const signal = aborter(res);
  for (const fresh of [false, true]) {
    const f = (await resolve(id, fresh)).formats.get(itag);
    if (!f) throw fail(404, 'Format tidak ada.');
    const up = await fetch(f.url, { headers: { ...f.http_headers, Range: range }, signal });
    if ((up.status === 403 || up.status === 410) && !fresh) {
      await up.body?.cancel();
      continue; // URL kedaluwarsa: minta yang baru sekali
    }
    res.setHeader('cache-control', 'no-store');
    return pipe(up, res, ['content-type', 'content-length', 'content-range', 'accept-ranges']);
  }
}

// HLS hanya boleh menuju server media Google, bukan URL sembarang.
// Ekstensi ikut dibawa karena pemutar menebak format dari situ.
const TYPES = { m3u8: 'application/vnd.apple.mpegurl', ts: 'video/mp2t', aac: 'audio/aac', mp4: 'video/mp4', m4s: 'video/mp4', vtt: 'text/vtt' };
const extOf = (u) => new URL(u).pathname.match(/\.(m3u8|ts|aac|mp4|m4s|vtt)$/)?.[1];
const hlsUrl = (u) => `/api/hls/x.${extOf(u) ?? 'm3u8'}?u=${Buffer.from(u).toString('base64url')}`;
const allowed = (x) => x.protocol === 'https:' && !x.port && !x.username && x.hostname.endsWith('.googlevideo.com');
export async function hls(u, req, res) {
  let url;
  try {
    url = new URL(Buffer.from(String(u), 'base64url').toString());
  } catch {
    throw fail(400, 'Alamat tidak valid.');
  }
  if (!allowed(url)) throw fail(403, 'Host tidak diizinkan.');
  const ext = extOf(url.href);
  if (req.method === 'HEAD') return res.type(TYPES[ext] ?? TYPES.m3u8).end();
  const up = await fetch(url, { signal: aborter(res), headers: req.headers.range ? { Range: req.headers.range } : {} });
  res.setHeader('cache-control', 'no-store');
  if (!/mpegurl/i.test(up.headers.get('content-type') ?? '')) {
    if (TYPES[ext]) res.type(TYPES[ext]);
    return pipe(up, res, TYPES[ext] ? ['content-length', 'content-range'] : ['content-type', 'content-length', 'content-range']);
  }
  const wrap = (x) => {
    const abs = new URL(x, up.url);
    return allowed(abs) ? hlsUrl(abs.href) : '';
  };
  const body = (await up.text())
    .split('\n')
    .map((l) => (l.startsWith('#') ? l.replace(/URI="([^"]+)"/g, (_, x) => `URI="${wrap(x)}"`) : l.trim() ? wrap(l.trim()) : l))
    .join('\n');
  res.status(up.status).type('application/vnd.apple.mpegurl').send(body);
}

// ---------- subtitle ----------
const pad = (n, l = 2) => String(n).padStart(l, '0');
const stamp = (ms) =>
  `${pad(Math.floor(ms / 3600e3))}:${pad(Math.floor(ms / 60e3) % 60)}:${pad(Math.floor(ms / 1e3) % 60)}.${pad(Math.floor(ms % 1000), 3)}`;
export async function captions(id, key) {
  const c = (await resolve(id)).captions.get(key);
  if (!c) throw fail(404, 'Subtitle tidak ada.');
  const r = await fetch(c.url, { signal: AbortSignal.timeout(15_000) });
  if (r.status === 429) throw fail(429, 'YouTube membatasi subtitle sementara.');
  if (!r.ok) throw fail(502, 'Subtitle gagal dimuat.');
  const ev = ((await r.json()).events ?? [])
    .filter((e) => e.segs && !e.aAppend)
    .map((e) => ({ at: e.tStartMs ?? 0, end: (e.tStartMs ?? 0) + (e.dDurationMs ?? 3000), text: e.segs.map((s) => s.utf8 ?? '').join('').trim() }))
    .filter((e) => e.text);
  const cues = ev.map((e, i) => {
    // Subtitle otomatis saling tumpang tindih; potong di awal baris berikutnya.
    const end = c.auto && ev[i + 1] ? Math.min(e.end, ev[i + 1].at) : e.end;
    const text = e.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/-->/g, '→').replace(/\n{2,}/g, '\n');
    return `${stamp(e.at)} --> ${stamp(Math.max(end, e.at + 100))}\n${text}\n`;
  });
  return 'WEBVTT\n\n' + cues.join('\n');
}
