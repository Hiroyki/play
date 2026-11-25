import express from 'express';
import { fileURLToPath } from 'node:url';
import * as yt from './youtube.js';
import * as stream from './stream.js';
import * as library from './library.js';
import * as ytdlp from './ytdlp.js';

const PORT = Number(process.env.PORT) || 4321;
const dir = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
const app = express();
app.disable('x-powered-by');

// Aplikasi pribadi: hanya menerima permintaan dari PC ini.
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const foreign =
    !HOSTS.has(req.headers.host) ||
    (origin && !HOSTS.has(origin.replace(/^http:\/\//, ''))) ||
    (req.path.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site');
  if (foreign) return res.status(403).send('Forbidden');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; img-src 'self' data: https://*.ytimg.com https://*.ggpht.com https://*.googleusercontent.com; " +
      "media-src 'self' blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
  );
  next();
});

const VID = /^[\w-]{11}$/;
const bad = () => Object.assign(new Error('Alamat tidak valid.'), { status: 400 });
const need = (re, v) => {
  if (typeof v !== 'string' || !re.test(v)) throw bad();
  return v;
};
const id = (req) => need(VID, req.params.id);
const query = (req) => need(/^[\s\S]{1,200}$/, req.query.q);
const api = (path, fn) => app.get('/api' + path, async (req, res) => res.json(await fn(req)));

api('/ping', () => ({ app: 'play', id: library.id }));
api('/home', async () => yt.home(await library.load()));
api('/topic/:name', (req) => {
  if (!Object.hasOwn(yt.TOPICS, req.params.name)) throw bad();
  return yt.topic(req.params.name);
});
api('/hot', (req) => {
  const name = String(req.query.topic ?? '');
  if (name && !Object.hasOwn(yt.TOPICS, name)) throw bad();
  return yt.hot(name);
});
api('/covers', () => yt.covers());
api('/mood/:name', (req) => {
  if (!yt.isMood(req.params.name)) throw bad();
  return yt.mood(req.params.name);
});
api('/search', (req) => yt.search(query(req), req.query));
api('/suggest', (req) => yt.suggest(query(req)));
api('/more/:token', (req) => yt.more(req.params.token));
api('/video/:id', (req) => yt.video(id(req)));
api('/comments/:id', (req) => yt.comments(id(req)));
api('/channel/:id', (req) => yt.channel(need(/^UC[\w-]{22}$/, req.params.id), String(req.query.tab || 'videos')));
api('/playlist/:id', (req) => yt.playlist(need(/^[\w-]{10,64}$/, req.params.id)));
api('/feed', async () => yt.feed((await library.load()).subs));
api('/play/:id', (req) => stream.playback(id(req), { fresh: req.query.fresh === '1' }));
api('/library', () => library.load());
api('/backups', () => library.backups());
api('/version', () => ytdlp.version());
api('/ytdlp', () => ytdlp.progress());
api('/warm/:id', (req) => ({ state: stream.warm(id(req)) }));
app.get('/api/export', async (req, res) => {
  const d = new Date();
  res.attachment(`play-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`);
  res.type('application/json').send(JSON.stringify(await library.load(), null, 1));
});
app.post('/api/import', express.json({ limit: '8mb' }), async (req, res) => res.json(await library.merge(req.body)));
app.post('/api/ytdlp', (req, res) => res.json(ytdlp.install()));
app.post('/api/restore', express.json({ limit: '1kb' }), async (req, res) => res.json(await library.restore(String(req.body?.name ?? ''))));

app.post('/api/library', express.json({ limit: '50kb' }), async (req, res) => {
  await library.apply(req.body);
  res.json({ ok: true });
});
app.get('/api/dash/:id/:codec.mpd', async (req, res) =>
  res.type('application/dash+xml').send(await stream.dash(id(req), need(/^(avc|av1)$/, req.params.codec))),
);
app.get('/api/media/:id/:itag', (req, res) => stream.media(id(req), need(/^[\w-]{1,20}$/, req.params.itag), req, res));
app.get('/api/hls/:name', (req, res) => stream.hls(req.query.u, req, res));
app.get('/api/captions/:id/:key', async (req, res) =>
  res.type('text/vtt').send(await stream.captions(id(req), req.params.key.replace(/\.vtt$/, ''))),
);
app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ada.' }));

app.use('/vendor/shaka.js', express.static(dir('node_modules/shaka-player/dist/shaka-player.compiled.js')));
app.use('/vendor/instrument', express.static(dir('node_modules/@fontsource-variable/instrument-sans/files'), { maxAge: '30d' }));
app.use(express.static(dir('public')));
app.get('/{*path}', (req, res) => res.sendFile(dir('public/index.html')));

app.use((err, req, res, next) => {
  if (res.headersSent || err.name === 'AbortError') return res.destroy();
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'File ini bukan JSON yang benar.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Filenya terlalu besar.' });
  const status = err.status ?? 502;
  if (status >= 500) console.error(new Date().toLocaleTimeString(), req.path, err.message);
  res.status(status).json({ error: err.status ? err.message : 'YouTube tidak menjawab dengan benar. Coba lagi.' });
});

// Satu permintaan yang gagal tidak boleh mematikan seluruh aplikasi.
process.on('unhandledRejection', (e) => console.error(new Date().toLocaleTimeString(), 'unhandled', e?.message ?? e));

app.listen(PORT, '127.0.0.1', (err) => {
  if (err) {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} sudah dipakai. Mungkin Play sudah jalan.` : err.message);
    process.exit(1);
  }
  console.log(`Play jalan di http://localhost:${PORT}`);
  ytdlp.ready().catch(() => {}); // sudah dicatat saat gagal
});
