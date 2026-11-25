// Pengganti yt-dlp di Android: mengambil alamat media lewat klien yang juga dipakai yt-dlp secara bawaan,
// lalu menyusunnya dalam bentuk keluaran `yt-dlp -J` yang dibaca server/stream.js.
import { Innertube } from 'youtubei.js';

const CLIENT = 'VISIONOS';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

let session;
let sessionAt = 0;
function yt() {
  if (Date.now() - sessionAt > 3 * 3600e3) session = undefined;
  if (!session) sessionAt = Date.now();
  return (session ??= Innertube.create({ lang: 'en', location: 'ID', retrieve_player: false, enable_session_cache: false }).catch((e) => {
    session = undefined;
    throw e;
  }));
}

const player = async (videoId) =>
  (await (await yt()).actions.execute('/player', { videoId, client: CLIENT, contentCheckOk: true, racyCheckOk: true, parse: false })).data;
// Video khusus anak tidak dilayani klien utama. Seperti yt-dlp, pakai klien ini: H.264 saja, sampai 1080p.
const PRODUCER = {
  clientName: 'IOS_PRODUCER', clientVersion: '0.147.945', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82',
  userAgent: 'com.google.ios.youtubeproducer/0.147.945 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
};
async function producer(videoId) {
  const { visitorData } = (await yt()).session.context.client;
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': PRODUCER.userAgent, 'x-youtube-client-name': '92', 'x-youtube-client-version': PRODUCER.clientVersion, 'x-goog-visitor-id': visitorData ?? '' },
    body: JSON.stringify({ context: { client: { ...PRODUCER, hl: 'en', gl: 'ID', visitorData } }, videoId, contentCheckOk: true, racyCheckOk: true }),
  });
  if (!r.ok) throw new Error('player ' + r.status);
  return r.json();
}
const playable = (d) => d?.playabilityStatus?.status === 'OK' && !!d.streamingData;
const within = (p, ms) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms, null))]).catch(() => null);
const text = (t) => t?.simpleText ?? t?.runs?.map((r) => r.text).join('') ?? '';
const codecs = (m) => m.match(/codecs="([^"]+)"/)?.[1].split(',').map((s) => s.trim()) ?? [];
const span = (r) => (r ? `${r.start}-${r.end}` : undefined);

function format(f, seen, ua) {
  const [, kind, ext] = f.mimeType.match(/^(\w+)\/(\w+)/) ?? [];
  const c = codecs(f.mimeType);
  const muxed = kind === 'video' && c.length > 1;
  // Beberapa trek suara memakai itag yang sama; beri nomor seperti yt-dlp.
  let id = String(f.itag) + (f.isDrc ? '-drc' : '');
  const n = seen.get(id) ?? 0;
  seen.set(id, n + 1);
  if (n) id += '-' + n;
  const original = /acont(=|%3D)original/i.test(f.url);
  return {
    format_id: id,
    url: f.url,
    protocol: 'https',
    ext: kind === 'audio' && ext === 'mp4' ? 'm4a' : ext,
    vcodec: kind === 'video' ? c[0] : 'none',
    acodec: kind === 'audio' ? c[0] : muxed ? c[1] : 'none',
    width: f.width,
    height: f.height,
    fps: f.fps,
    tbr: (f.averageBitrate ?? f.bitrate ?? 0) / 1000 || undefined,
    asr: Number(f.audioSampleRate) || undefined,
    has_drm: !!f.drmFamilies?.length,
    language_preference: !f.audioTrack ? -1 : original ? 10 : f.audioTrack.audioIsDefault ? 5 : -1,
    init: span(f.initRange),
    index: span(f.indexRange),
    http_headers: { 'user-agent': ua },
  };
}

function boards(spec, duration) {
  if (!spec || !duration) return [];
  const [base, ...levels] = spec.split('|');
  return levels.flatMap((l, i) => {
    const a = l.split('#');
    const [width, height, count, columns, rows] = a.slice(0, 5).map(Number);
    if (a.length !== 8 || !(width && height && count && columns && rows)) return [];
    const url = new URL(base.replace('$L', i).replace('$N', a[6]) + '&sigh=' + a[7], 'https://i.ytimg.com/').href;
    return { format_id: 'sb' + i, width, height, columns, rows, fps: count / duration, fragments: Array.from({ length: Math.ceil(count / (columns * rows)) }, (_, j) => ({ url: url.replace(/\$M|%24M/, j) })) };
  });
}

function captions(list) {
  const subtitles = {};
  const automatic_captions = {};
  const entry = (t, lang, name) => {
    const u = new URL(t.baseUrl, 'https://www.youtube.com');
    u.searchParams.set('fmt', 'json3');
    if (lang) u.searchParams.set('tlang', lang);
    return [{ ext: 'json3', name, url: u.href }];
  };
  for (const t of list?.captionTracks ?? []) {
    if (t.kind !== 'asr') {
      subtitles[t.languageCode] ??= entry(t, null, text(t.name));
      continue;
    }
    automatic_captions[t.languageCode + '-orig'] = entry(t, null, text(t.name));
    for (const l of list.translationLanguages ?? [])
      if ((l.languageCode === 'id' || l.languageCode === 'en') && l.languageCode !== t.languageCode) automatic_captions[l.languageCode] = entry(t, l.languageCode, text(l.languageName));
  }
  return { subtitles, automatic_captions };
}

// Bab dan bagian yang paling sering diputar ulang ada di halaman tontonan, bukan di data pemutar.
async function extras(videoId) {
  const d = (await (await yt()).actions.execute('/next', { videoId, parse: false })).data;
  const map = d.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap ?? [];
  const list = map.find((m) => m.key === 'DESCRIPTION_CHAPTERS') ?? map.find((m) => m.key === 'AUTO_CHAPTERS');
  const heat = d.frameworkUpdates?.entityBatchUpdate?.mutations?.map((m) => m.payload?.macroMarkersListEntity?.markersList).find((m) => m?.markerType === 'MARKER_TYPE_HEATMAP');
  return {
    chapters: (list?.value?.chapters ?? []).map(({ chapterRenderer: c }) => ({ start_time: c.timeRangeStartMillis / 1000, title: text(c.title) })),
    heatmap: (heat?.markers ?? []).map((m) => ({ value: m.intensityScoreNormalized ?? 0 })),
  };
}

// Seperti yt-dlp: alamat baru berlaku setelah jeda yang diminta YouTube.
function availableAt(d) {
  const ads = [
    ...(d.adPlacements ?? []).filter((a) => a.adPlacementRenderer?.config?.adPlacementConfig?.kind === 'AD_PLACEMENT_KIND_START').map((a) => a.adPlacementRenderer.renderer),
    ...(d.adSlots ?? []).filter((a) => a.adSlotRenderer?.adSlotMetadata?.triggerEvent === 'SLOT_TRIGGER_EVENT_BEFORE_CONTENT').flatMap((a) => {
      const r = a.adSlotRenderer.fulfillmentContent?.fulfilledLayout?.playerBytesAdLayoutRenderer?.renderingContent;
      return [r, ...(r?.playerBytesSequentialLayoutRenderer?.sequentialLayouts ?? []).map((l) => l.playerBytesAdLayoutRenderer?.renderingContent)];
    }),
  ].map((r) => r?.instreamVideoAdRenderer).filter(Boolean);
  const secs = ads.reduce((n, a) => n + (a.skipOffsetMilliseconds != null ? a.skipOffsetMilliseconds / 1000 : Number(new URLSearchParams(a.playerVars ?? '').getAll('length_seconds').at(-1)) || 0), 0);
  return Date.now() / 1000 + secs;
}

export async function extract(id) {
  const more = within(extras(id), 4000);
  let d = await player(id);
  if (d.playabilityStatus?.status === 'LOGIN_REQUIRED' && /bot/i.test(d.playabilityStatus.reason ?? '')) {
    session = undefined; // sesi yang sudah lama ditolak; minta yang baru sekali
    d = await player(id);
  }
  let ua = UA;
  if (['UNPLAYABLE', 'ERROR'].includes(d.playabilityStatus?.status)) {
    const spare = await producer(id).catch(() => null);
    if (playable(spare)) {
      ua = PRODUCER.userAgent;
      d = { ...spare, captions: spare.captions ?? d.captions, storyboards: spare.storyboards ?? d.storyboards };
    }
  }
  const p = d.playabilityStatus ?? {};
  if (p.status === 'LIVE_STREAM_OFFLINE') throw new Error('This live event will begin soon');
  const sd = d.streamingData;
  if (p.status !== 'OK' || !sd) throw new Error([p.reason, text(p.errorScreen?.playerErrorMessageRenderer?.subreason)].filter(Boolean).join('. ') || 'Video unavailable');
  const live = !!d.videoDetails?.isLive;
  const duration = Number(d.videoDetails?.lengthSeconds) || 0;
  const seen = new Map();
  const at = availableAt(d);
  const formats = [...(sd.adaptiveFormats ?? []), ...(sd.formats ?? [])].filter((f) => f.url && f.mimeType).map((f) => ({ ...format(f, seen, ua), available_at: at }));
  if (sd.hlsManifestUrl) formats.push({ format_id: 'hls', protocol: 'm3u8_native', manifest_url: sd.hlsManifestUrl });
  formats.push(...boards(d.storyboards?.playerStoryboardSpecRenderer?.spec, duration));
  return { is_live: live, duration, formats, ...captions(d.captions?.playerCaptionsTracklistRenderer), ...((await more) ?? {}) };
}
