// Metadata YouTube: cari, video terkait, channel, playlist, komentar.
import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);

let clientPromise;
let clientAt = 0;
// Sesi lama lama-lama ditolak YouTube, jadi diperbarui tiap tiga jam.
function client() {
  if (Date.now() - clientAt > 3 * 3600e3) clientPromise = undefined;
  if (!clientPromise) clientAt = Date.now();
  return (clientPromise ??= Innertube.create({
    lang: 'id',
    location: 'ID',
    generate_session_locally: true,
    retrieve_player: false,
  }).catch((e) => {
    clientPromise = undefined;
    throw e;
  }));
}

// ---------- cache ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = fn();
  cache.set(key, { until: Date.now() + ttlMs, value });
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  try {
    return await value;
  } catch (e) {
    cache.delete(key);
    throw e;
  }
}

// Halaman lanjutan: token acak -> fungsi yang mengambil halaman berikutnya.
const pages = new Map();
function remember(next) {
  if (!next) return null;
  const token = crypto.randomUUID();
  pages.set(token, next);
  if (pages.size > 200) pages.delete(pages.keys().next().value);
  return token;
}
export async function more(token) {
  const next = pages.get(token);
  if (!next) throw Object.assign(new Error('Halaman ini sudah kedaluwarsa. Muat ulang dulu.'), { status: 410 });
  return next();
}

// ---------- normalisasi ----------
const txt = (t) => {
  const s = t == null ? '' : typeof t === 'string' ? t : (t.text ?? '');
  return s === 'N/A' ? '' : s;
};
const abs = (u) => (u?.startsWith('//') ? 'https:' + u : u || '');
const thumbOf = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const pick = (list, want = 360) => {
  if (!list?.length) return '';
  const sorted = [...list].sort((a, b) => a.width - b.width);
  return abs((sorted.find((t) => t.width >= want) ?? sorted.at(-1)).url);
};
// YouTube Indonesia menulis durasi "10.35"; ubah ke "10:35".
const clock = (s) => (/^\d+([.:]\d{2})+$/.test(s || '') ? s.replace(/\./g, ':') : '');

function badges(view) {
  const out = [];
  for (const o of view?.overlays ?? [])
    for (const b of o.badges ?? []) if (b.text) out.push({ text: b.text, style: b.badge_style ?? '' });
  return out;
}

function fromLockup(x) {
  const id = x.content_id;
  const meta = x.metadata;
  const title = txt(meta?.title);
  const rows = (meta?.metadata?.metadata_rows ?? [])
    .map((r) => (r.metadata_parts ?? []).filter((p) => txt(p.text)))
    .filter((r) => r.length);
  const parts = rows.flat();
  let channelId = meta?.image?.renderer_context?.command_context?.on_tap?.payload?.browseId ?? '';
  let author = '';
  for (const p of parts) {
    const run = p.text?.runs?.find((r) => r.endpoint?.payload?.browseId?.startsWith?.('UC'));
    if (run) {
      channelId ||= run.endpoint.payload.browseId;
      author ||= run.text;
    }
  }
  if (x.content_type === 'VIDEO') {
    const b = badges(x.content_image);
    // Kalau ada lebih dari satu baris, baris pertama adalah nama channel.
    if (!author && rows.length > 1) author = txt(rows[0][0].text);
    const info = (rows.length > 1 ? rows.slice(1).flat() : parts).map((p) => txt(p.text)).filter((t) => t !== author);
    return {
      type: 'video', id, title, author, channelId, info,
      avatar: pick(meta?.image?.avatar?.image, 68),
      duration: b.map((i) => clock(i.text)).find(Boolean) ?? '',
      live: b.some((i) => /LIVE/.test(i.style)),
      thumb: thumbOf(id),
    };
  }
  // Mix otomatis (RD...) tidak punya daftar tetap, jadi dilewati.
  if (x.content_type === 'PLAYLIST' && /^(PL|UU|OL|FL)/.test(id ?? '')) {
    const prim = x.content_image?.primary_thumbnail ?? x.content_image;
    return { type: 'playlist', id, title, author, channelId, count: badges(prim)[0]?.text ?? '', thumb: pick(prim?.image) };
  }
  return null;
}

function normalize(x) {
  if (x?.type === 'RichItem') x = x.content;
  switch (x?.type) {
    case 'LockupView':
      return fromLockup(x);
    case 'Video':
    case 'CompactVideo':
    case 'GridVideo':
    case 'PlaylistVideo': {
      const id = x.video_id ?? x.id;
      if (!id || x.upcoming || x.is_upcoming) return null;
      const overlay = x.thumbnail_overlays?.find((o) => o.type === 'ThumbnailOverlayTimeStatus');
      return {
        type: 'video', id, title: txt(x.title),
        author: txt(x.author?.name),
        channelId: txt(x.author?.id),
        avatar: pick(x.author?.thumbnails, 68),
        duration: clock(txt(overlay?.text) || txt(x.length_text) || txt(x.duration)),
        live: overlay?.style === 'LIVE' || x.is_live === true,
        info: [txt(x.short_view_count) || txt(x.view_count), txt(x.published)].filter(Boolean),
        thumb: thumbOf(id),
      };
    }
    case 'Channel':
      return {
        type: 'channel', id: x.id, title: txt(x.author?.name),
        avatar: pick(x.author?.thumbnails, 176),
        info: [txt(x.subscriber_count), txt(x.video_count)].filter(Boolean),
      };
    default:
      return null; // iklan, rak promo, dan Shorts dibuang di sini
  }
}
const clean = (list) => {
  const seen = new Set();
  return (list ?? []).map(normalize).filter((i) => i?.id && i.title && !seen.has(i.id) && seen.add(i.id));
};

// ---------- endpoint ----------
const TYPES = new Set(['video', 'channel', 'playlist']);
const DATES = new Set(['today', 'week', 'month', 'year']);
export async function search(q, { type, date, hot } = {}) {
  const f = {};
  if (TYPES.has(type)) f.type = type;
  if (DATES.has(date)) {
    f.upload_date = date;
    f.type ??= 'video';
  }
  if (hot) f.prioritize = 'popularity';
  const page = (r) => ({
    items: clean(r.results),
    next: remember(r.has_continuation && (async () => page(await r.getContinuation()))),
  });
  return page(await (await client()).search(q, f));
}

export async function suggest(q) {
  return (await (await client()).getSearchSuggestions(q)).slice(0, 8);
}

export function video(id) {
  return cached('v:' + id, 10 * 60e3, async () => {
    const i = await (await client()).getInfo(id);
    const p = i.primary_info;
    const o = i.secondary_info?.owner;
    const b = i.basic_info;
    if (!p && !b?.title) throw Object.assign(new Error('Video tidak ditemukan.'), { status: 404 });
    return {
      id,
      title: txt(p?.title) || b.title || '',
      author: o?.author?.name ?? b.author ?? '',
      channelId: o?.author?.id ?? b.channel_id ?? '',
      avatar: abs(o?.author?.best_thumbnail?.url),
      subscribers: txt(o?.subscriber_count),
      views: txt(p?.view_count?.view_count) || txt(p?.view_count?.short_view_count),
      published: txt(p?.published),
      likes: b.like_count ?? null,
      // short_description memuat link utuh; versi halaman memotongnya jadi "..."
      description: b?.short_description || txt(i.secondary_info?.description),
      related: clean(i.watch_next_feed).filter((r) => r.type === 'video'),
    };
  });
}

export async function comments(id) {
  const page = (r, count) => ({
    count,
    items: r.contents
      .map((t) => t.comment)
      .filter(Boolean)
      .map((c) => ({
        text: txt(c.content),
        author: txt(c.author?.name),
        avatar: abs(c.author?.thumbnails?.[0]?.url),
        channelId: txt(c.author?.id),
        when: c.published_time ?? '',
        likes: String(c.like_count ?? '').trim(),
        pinned: !!c.is_pinned,
      })),
    next: remember(r.has_continuation && (async () => page(await r.getContinuation(), count))),
  });
  let r;
  try {
    r = await (await client()).getComments(id);
  } catch (e) {
    if (/did not have any content/i.test(e.message)) return { count: '', items: [], next: null, off: true };
    throw e;
  }
  return page(r, txt(r.header?.count));
}

const OPEN_TAB = { videos: 'getVideos', live: 'getLiveStreams', playlists: 'getPlaylists' };
export async function channel(id, tab) {
  const c = await cached('c:' + id, 10 * 60e3, async () => (await client()).getChannel(id));
  const rows = c.header?.content?.metadata?.metadata_rows ?? [];
  const head = {
    id, tab,
    title: c.metadata.title ?? '',
    description: c.metadata.description ?? '',
    avatar: pick(c.metadata.avatar, 176),
    banner: pick(c.header?.content?.banner?.image, 1200),
    info: rows.flatMap((r) => r.metadata_parts ?? []).map((p) => txt(p.text)).filter(Boolean),
    tabs: [c.has_videos && 'videos', c.has_live_streams && 'live', c.has_playlists && 'playlists'].filter(Boolean),
  };
  if (!head.tabs.includes(tab)) return { ...head, items: [], next: null };
  const page = (p) => ({
    items: clean(tab === 'playlists' ? p.playlists : p.videos).map((v) => ({
      ...v, author: v.author || head.title, channelId: v.channelId || id, avatar: v.avatar || head.avatar,
    })),
    next: remember(p.has_continuation && (async () => page(await p.getContinuation()))),
  });
  return { ...head, ...page(await c[OPEN_TAB[tab]]()) };
}

export async function playlist(id) {
  const p = await (await client()).getPlaylist(id);
  const page = (r) => ({
    items: clean(r.videos),
    next: remember(r.has_continuation && (async () => page(await r.getContinuation()))),
  });
  return { id, title: txt(p.info.title), author: txt(p.info.author?.name), count: txt(p.info.total_items), ...page(p) };
}

// ---------- feed langganan ----------
const ENT = { lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", amp: '&' };
const unxml = (s = '') => s.replace(/&(lt|gt|quot|apos|#39|amp);/g, (_, e) => ENT[e]);
const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
function ago(ts) {
  const s = (ts - Date.now()) / 1000;
  for (const [unit, n] of [['year', 31536e3], ['month', 2592e3], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]])
    if (Math.abs(s) >= n) return rtf.format(Math.trunc(s / n), unit);
  return 'baru saja';
}
async function latest(ch) {
  const xml = await cached('rss:' + ch.id, 10 * 60e3, async () => {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + ch.id, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('rss ' + r.status);
    return r.text();
  });
  return xml
    .split('<entry>')
    .slice(1)
    .filter((e) => !e.includes('/shorts/'))
    .map((e) => {
      const g = (re) => unxml(e.match(re)?.[1]);
      const id = g(/<yt:videoId>([\w-]{11})</);
      const ts = Date.parse(g(/<published>([^<]+)</));
      return {
        type: 'video', id, title: g(/<title>([^<]*)</), author: ch.title, channelId: ch.id, avatar: ch.avatar,
        duration: '', live: false, info: [ago(ts)], ts, thumb: thumbOf(id),
      };
    })
    .filter((v) => v.id);
}
export async function feed(allSubs) {
  const subs = allSubs.slice(0, 100);
  const got = await Promise.allSettled(subs.map(latest));
  return {
    items: got.flatMap((g) => g.value ?? []).sort((a, b) => b.ts - a.ts).slice(0, 120),
    failed: subs.filter((_, i) => got[i].status === 'rejected').map((s) => s.title),
  };
}

// ---------- beranda ----------
export const TOPICS = {
  musik: 'musik terbaru', gaming: 'gameplay', teknologi: 'review gadget', berita: 'berita hari ini',
  olahraga: 'highlight pertandingan', masak: 'resep masakan', film: 'trailer film', komedi: 'stand up comedy',
  belajar: 'belajar sains',
};
export const topic = (name) => cached('t:' + name, 30 * 60e3, () => search(TOPICS[name], { date: 'month' }));

// Peringkat mingguan, diurutkan ulang dari angka penonton yang tertulis.
const HOT = {
  '': 'indonesia', musik: 'lagu indonesia', gaming: 'gameplay indonesia', teknologi: 'review indonesia', berita: 'berita indonesia',
  olahraga: 'timnas indonesia', masak: 'masak', film: 'trailer film', komedi: 'lucu', belajar: 'belajar',
};
const UNIT = { rb: 1e3, jt: 1e6, m: 1e9 };
function viewsOf(v) {
  const m = v.info.join(' ').match(/([\d.,]+)\s*(rb|jt|m)?\b\s*x ditonton/i);
  if (!m) return 0;
  const unit = UNIT[m[2]?.toLowerCase()];
  return unit ? parseFloat(m[1].replace(',', '.')) * unit : Number(m[1].replace(/\./g, ''));
}
export const hot = (name = '') =>
  cached('hot:' + name, 30 * 60e3, async () => {
    const r = await search(HOT[name], { date: 'week', hot: true });
    return { items: r.items.filter((v) => v.type === 'video' && !v.live && viewsOf(v)).sort((a, b) => viewsOf(b) - viewsOf(a)).slice(0, 10) };
  });

// Satu gambar per topik untuk sampul di beranda.
export const covers = () =>
  cached('covers', 2 * 3600e3, async () => {
    const names = Object.keys(TOPICS);
    const got = await Promise.allSettled(names.map(hot));
    const used = new Set();
    return names.map((name, i) => {
      const pick = (got[i].value?.items ?? []).find((v) => !used.has(v.id));
      if (pick) used.add(pick.id);
      return { name, id: pick?.id ?? null };
    });
  });

const MOODS = { pagi: 'musik pagi semangat', siang: 'podcast indonesia', sore: 'musik sore santai', malam: 'lofi malam tenang' };
export const isMood = (name) => Object.hasOwn(MOODS, name);
export const mood = (name) =>
  cached('mood:' + name, 3 * 3600e3, async () => {
    const r = await search(MOODS[name], { type: 'video', date: 'year' });
    return { items: r.items.filter((v) => v.type === 'video').slice(0, 10) };
  });

function interleave(lists) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++)
    for (const l of lists)
      if (l[i] && !seen.has(l[i].id)) {
        seen.add(l[i].id);
        out.push(l[i]);
      }
  return out;
}
export async function home(lib) {
  const recent = lib.history.slice(0, 5);
  const jobs = recent.map((h) => video(h.id).then((v) => v.related));
  if (lib.subs.length) jobs.push(feed(lib.subs).then((f) => f.items.slice(0, 20)));
  if (!jobs.length) for (const t of ['musik', 'teknologi', 'masak', 'komedi']) jobs.push(topic(t).then((r) => r.items));
  const got = await Promise.allSettled(jobs);
  if (got.every((g) => g.status === 'rejected')) throw got[0].reason;
  const watched = new Set(lib.history.map((h) => h.id));
  return {
    items: interleave(got.map((g) => g.value ?? [])).filter((v) => v.type === 'video' && !watched.has(v.id)).slice(0, 80),
    next: null,
  };
}
