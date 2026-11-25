// Pemutar video. Satu elemen <video> dipakai terus supaya bisa pindah ke pemutar kecil tanpa putus.
import { api, h, icon, lib, pref, time, toast, warm } from './ui.js';
import { calm } from './fx.js';

const STEPS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
const GRADE = { 4320: '8K', 2160: '4K', 1440: '2K', 1080: 'Full HD', 720: 'HD' };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const btn = (name, label, fn, cls = '') => h('button', { type: 'button', class: 'pbtn ' + cls, 'aria-label': label, title: label, onclick: fn }, icon(name));
const setBtn = (b, name, label) => {
  b.replaceChildren(icon(name));
  b.setAttribute('aria-label', label);
  b.title = label;
};

export class Player {
  id = null; // video yang sedang dimuat
  meta = null;
  next = null; // video berikutnya
  onnext = () => {};
  onexpand = () => {};
  onclose = () => {};
  onglow = () => {};
  onready = () => {};
  #turn = 0;
  #shaka = null;
  #info = null;
  #retried = false;
  #menuShut = 0;
  #page = 'root';
  now = { quality: 'auto', captions: '' };
  #lastSave = 0;

  constructor() {
    const v = (this.video = h('video', { playsinline: true, preload: 'auto' }));
    this.poster = h('div', { class: 'poster' });
    this.cue = h('div', { class: 'cue' });
    this.overlay = h('div', { class: 'overlay', hidden: true });
    this.spin = h('div', { class: 'spin', role: 'status', 'aria-label': 'Memuat video' });

    this.bPlay = h('button', { type: 'button', class: 'pbtn pp', 'aria-label': 'Putar (k)', title: 'Putar (k)', onclick: () => this.toggle() }, h('i'), h('i'));
    this.flashBox = h('div', { class: 'flash', 'aria-hidden': 'true' });
    this.bNext = btn('next', 'Video berikutnya (Shift+N)', () => this.next && this.onnext(this.next), 'full-only');
    this.bMute = btn('volume', 'Bisukan (m)', () => (v.muted = !v.muted));
    this.vol = h('input', { type: 'range', class: 'vol', min: 0, max: 1, step: 0.02, 'aria-label': 'Volume' });
    this.clock = h('span', { class: 'clock' });
    this.bLive = h('button', { type: 'button', class: 'golive', hidden: true, onclick: () => (v.currentTime = this.range().end) }, 'Live');
    this.chapter = h('span', { class: 'chapter' });
    this.bCc = btn('cc', 'Subtitle (c)', () => this.toggleCaptions(), 'full-only');
    this.bGear = btn('gear', 'Pengaturan video', () => this.menu(this.settings.hidden), 'full-only');
    this.bGear.setAttribute('aria-expanded', 'false');
    const bPip = btn('pip', 'Gambar dalam gambar (i)', () => this.pip(), 'full-only');
    this.bWide = btn('wide', 'Mode lebar (t)', () => this.wide(), 'full-only wide-btn');
    const bFull = btn('full', 'Layar penuh (f)', () => this.full(), 'full-only');
    const bExpand = btn('expand', 'Buka halaman video', () => this.onexpand(), 'mini-only');
    const bClose = btn('close', 'Tutup pemutar', () => this.onclose(), 'mini-only');

    this.bar = h('input', { type: 'range', class: 'bar', min: 0, max: 1, step: 'any', value: 0, 'aria-label': 'Posisi video' });
    this.tipPic = h('span', { class: 'pic' });
    this.tipText = h('span', {});
    this.tip = h('div', { class: 'tip', hidden: true }, this.tipPic, this.tipText);
    this.heat = h('div', { class: 'heat', 'aria-hidden': 'true' });
    this.track = h('div', { class: 'track' }, this.heat, this.bar, this.tip);

    this.settings = h('div', { class: 'settings', hidden: true, role: 'menu', 'aria-label': 'Menu pengaturan video' });

    this.el = h('div', { class: 'player' }, v, this.poster, this.cue, this.spin, this.flashBox, this.overlay, this.settings,
      h('div', { class: 'controls' }, this.track,
        h('div', { class: 'buttons' }, this.bPlay, this.bNext, h('span', { class: 'volume full-only' }, this.bMute, this.vol), this.clock, this.bLive, this.chapter,
          h('span', { class: 'grow' }), this.bCc, this.bGear, bPip, this.bWide, bFull, bExpand, bClose)));
    this.#wire();
  }

  #wire() {
    const v = this.video;
    v.volume = pref.get('volume', 1);
    v.muted = pref.get('muted', false);
    const paintVol = () => {
      this.vol.value = v.muted ? 0 : v.volume;
      this.vol.style.setProperty('--p', this.vol.value);
      setBtn(this.bMute, v.muted || !v.volume ? 'mute' : 'volume', v.muted ? 'Bunyikan (m)' : 'Bisukan (m)');
    };
    paintVol();
    this.vol.addEventListener('input', () => {
      v.volume = Number(this.vol.value);
      v.muted = v.volume === 0;
    });
    v.addEventListener('volumechange', () => {
      paintVol();
      pref.set('volume', v.volume);
      pref.set('muted', v.muted);
    });
    v.addEventListener('click', () => {
      if (Date.now() - this.#menuShut < 400) return; // klik ini cuma menutup menu
      if (this.el.classList.contains('mini')) return this.onexpand();
      this.toggle();
    });
    v.addEventListener('dblclick', () => !this.el.classList.contains('mini') && this.full());
    const paintPlay = () => {
      this.bPlay.title = v.paused ? 'Putar (k)' : 'Jeda (k)';
      this.bPlay.setAttribute('aria-label', this.bPlay.title);
      this.el.classList.toggle('paused', v.paused);
    };
    v.addEventListener('play', paintPlay);
    v.addEventListener('pause', () => {
      paintPlay();
      this.#remember();
    });
    const busy = (on) => this.el.classList.toggle('busy', on);
    v.addEventListener('waiting', () => busy(true));
    v.addEventListener('seeking', () => busy(true));
    for (const e of ['playing', 'canplay', 'seeked']) v.addEventListener(e, () => busy(false));
    v.addEventListener('playing', () => this.el.classList.add('ready'));
    v.addEventListener('timeupdate', () => {
      this.#paint();
      if (!v.paused && Date.now() - this.#lastSave > 15_000) this.#remember();
      // Menjelang habis, siapkan video berikutnya.
      if (this.next && pref.get('autoplay', true) && v.duration - v.currentTime < Math.max(30, v.duration * 0.2)) warm(this.next.id);
    });
    v.addEventListener('progress', () => this.#paint());
    v.addEventListener('ended', () => this.#ended());

    let dragging = false;
    this.bar.addEventListener('pointerdown', () => (dragging = true));
    addEventListener('pointerup', () => (dragging = false));
    this.bar.addEventListener('input', () => {
      const r = this.range();
      v.currentTime = r.start + Number(this.bar.value) * (r.end - r.start);
      this.bar.style.setProperty('--p', this.bar.value);
    });
    this.dragging = () => dragging;
    this.track.addEventListener('pointermove', (e) => {
      const b = this.track.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
      const r = this.range();
      if (!(r.end > r.start)) return;
      const t = r.start + p * (r.end - r.start);
      const ch = this.#chapterAt(t);
      this.tipText.textContent = (this.#info?.live ? '-' + time(r.end - t) : time(t)) + (ch ? '  ' + ch.title : '');
      this.tipPic.hidden = !this.frame(this.tipPic, t, 176);
      const half = this.tipPic.hidden ? 60 : 94;
      this.tip.style.left = Math.min(b.width - half, Math.max(half, p * b.width)) + 'px';
      this.tip.hidden = false;
    });
    this.track.addEventListener('pointerleave', () => (this.tip.hidden = true));

    let idle;
    const wake = () => {
      this.el.classList.add('awake');
      clearTimeout(idle);
      idle = setTimeout(() => this.el.classList.remove('awake'), 2600);
    };
    for (const e of ['pointermove', 'pointerdown', 'focusin']) this.el.addEventListener(e, wake);
    this.el.addEventListener('pointerleave', () => this.el.classList.remove('awake'));
    document.addEventListener('pointerdown', (e) => {
      if (this.settings.hidden || this.settings.contains(e.target) || this.bGear.contains(e.target)) return;
      this.menu(false);
      this.#menuShut = Date.now();
    });
    this.settings.addEventListener('keydown', (e) => this.#menuKey(e));
    v.addEventListener('resize', () => this.#qualityArrived());
    addEventListener('pagehide', () => this.#remember(true));

    const ms = navigator.mediaSession;
    if (ms) {
      const on = (a, fn) => {
        try {
          ms.setActionHandler(a, fn);
        } catch {}
      };
      on('play', () => v.play());
      on('pause', () => v.pause());
      on('seekbackward', () => this.skip(-10));
      on('seekforward', () => this.skip(10));
      on('nexttrack', () => this.next && this.onnext(this.next));
    }
  }

  // ---------- muat ----------
  async load(id, { at, meta } = {}) {
    if (this.id === id) return;
    this.#remember();
    this.id = id;
    this.next = null;
    this.#retried = false;
    this.setMeta(meta ?? null);
    await this.#start(at);
  }
  setMeta(meta) {
    this.meta = meta;
    this.poster.style.backgroundImage = this.id ? `url("https://i.ytimg.com/vi/${this.id}/hqdefault.jpg")` : '';
    if (meta && navigator.mediaSession)
      navigator.mediaSession.metadata = new MediaMetadata({ title: meta.title, artist: meta.author, artwork: [{ src: meta.thumb, sizes: '480x360', type: 'image/jpeg' }] });
  }

  async #start(at, fresh = false) {
    const turn = ++this.#turn;
    const id = this.id;
    const v = this.video;
    const stale = () => turn !== this.#turn;
    this.failed = false;
    this.hideOverlay();
    this.menu(false);
    this.el.classList.remove('ready');
    this.el.classList.add('busy');
    this.cue.replaceChildren();
    v.pause();
    this.#info = null;
    this.#clearTracks();
    this.heat.replaceChildren();
    this.bLive.hidden = true;
    this.clock.textContent = '';
    this.chapter.textContent = '';
    try {
      await this.#unload();
      const info = await api(`/play/${id}${fresh ? '?fresh=1' : ''}`);
      if (stale()) return;
      this.#info = info;
      const seen = lib.seen(id);
      const from = at ?? (!info.live && seen?.position > 10 ? seen.position : undefined);
      let lastErr;
      for (const src of await this.#rank(info.sources)) {
        if (stale()) return;
        try {
          await this.#open(src, from);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await this.#unload();
        }
      }
      if (stale()) return;
      if (lastErr) throw lastErr;
      this.#afterLoad();
      await v.play().catch((e) => {
        if (e.name === 'NotAllowedError' && !stale()) this.showOverlay(h('button', { class: 'bigplay', type: 'button', 'aria-label': 'Putar', onclick: () => v.play().then(() => this.hideOverlay()) }, icon('play')));
      });
    } catch (e) {
      if (!stale()) this.#fail(e);
    } finally {
      if (!stale() && v.readyState > 2) this.el.classList.remove('busy');
    }
  }

  // AV1 dipakai (sampai 4K) hanya kalau perangkat kuat memutarnya; kalau tidak, H.264.
  async #rank(sources) {
    const avcMax = sources.find((s) => s.codec === 'avc')?.probe.height ?? 0;
    const score = async (s) => {
      if (s.kind === 'file') return 3;
      if (s.kind === 'hls') return 2;
      try {
        const c = await navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: s.probe });
        if (!c.supported) return 9;
        if (s.codec === 'av1') return c.smooth && c.powerEfficient && s.probe.height >= avcMax ? 0 : 1.5;
        return 1;
      } catch {
        return s.codec === 'avc' ? 1 : 1.5;
      }
    };
    const list = await Promise.all(sources.map(async (s) => ({ s, n: await score(s) })));
    return list.sort((a, b) => a.n - b.n).map((x) => x.s);
  }

  async #open(src, from) {
    const v = this.video;
    if (src.kind === 'file') {
      v.src = src.url;
      if (from) v.currentTime = from;
      await new Promise((ok, no) => {
        v.addEventListener('loadedmetadata', ok, { once: true });
        v.addEventListener('error', () => no(new Error('Video gagal dimuat.')), { once: true });
      });
      return;
    }
    if (!window.shaka) throw new Error('Pemutar gagal dimuat. Muat ulang halaman.');
    if (!this.#shaka) {
      shaka.polyfill.installAll();
      const p = (this.#shaka = new shaka.Player());
      await p.attach(v);
      p.configure({
        streaming: { bufferingGoal: 40, rebufferingGoal: 1.5, bufferBehind: 60 },
        abr: { defaultBandwidthEstimate: 6e6, restrictToElementSize: true },
      });
      p.addEventListener('error', (e) => e.detail?.severity === 2 && this.#recover(e.detail));
    }
    await this.#shaka.load(src.url, from ?? null, src.kind === 'dash' ? 'application/dash+xml' : 'application/x-mpegurl');
  }
  async #unload() {
    this.video.removeAttribute('src');
    if (this.#shaka) await this.#shaka.unload().catch(() => {});
  }

  #recover(err) {
    if (this.#retried) return this.#fail(err);
    this.#retried = true;
    this.#start(this.#info?.live ? undefined : this.video.currentTime || undefined, true);
  }
  #fail(e) {
    this.failed = true;
    this.el.classList.remove('busy');
    const msg = e?.code ? `Video berhenti (kode ${e.code}).` : e?.message || 'Video gagal diputar.';
    this.showOverlay(h('div', { class: 'fail', role: 'alert' }, h('p', {}, msg),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => this.#start(this.video.currentTime || undefined, true) }, 'Coba lagi'),
        h('a', { class: 'btn', href: 'https://www.youtube.com/watch?v=' + this.id, target: '_blank', rel: 'noreferrer' }, 'Buka di YouTube'))));
  }
  showOverlay(...kids) {
    this.overlay.replaceChildren(...kids);
    this.overlay.hidden = false;
  }
  hideOverlay() {
    clearInterval(this.countdown);
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }
  stop() {
    this.#remember();
    this.#turn++;
    this.id = this.meta = this.#info = null;
    this.video.pause();
    this.hideOverlay();
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    this.#unload();
  }

  #afterLoad() {
    const v = this.video;
    const info = this.#info;
    this.el.classList.toggle('live', info.live);
    this.bLive.hidden = !info.live;
    // kualitas
    this.quality(pref.get('quality', 'auto'), false);
    // kecepatan
    const sp = info.live ? 1 : pref.get('speed', 1);
    this.speed(sp, false);
    // subtitle
    const caps = [...info.captions].sort((a, b) => a.auto - b.auto);
    this.caps = caps;
    this.bCc.disabled = !caps.length;
    const want = pref.get('captions', '');
    const match = want && (caps.find((c) => c.lang === want) ?? caps.find((c) => c.lang.split('-')[0] === want.split('-')[0]));
    this.captions(match ? match.key : '', false);
    // bab
    for (const m of this.track.querySelectorAll('.mark')) m.remove();
    if (info.duration) for (const c of info.chapters.slice(1)) this.track.append(h('span', { class: 'mark', style: { left: (c.start / info.duration) * 100 + '%' } }));
    v.dispatchEvent(new Event('volumechange'));
    this.#drawHeat();
    this.onready(this.id);
    this.#lastSave = Date.now() - 10_000; // simpan pertama setelah 5 detik menonton
    this.#paint();
  }

  // ---------- kualitas, kecepatan, subtitle ----------
  #tracks() {
    return this.#shaka?.getVariantTracks?.().filter((t) => t.height) ?? [];
  }
  // Tinggi piksel ke nama yang lazim: video 1920x804 tetap "1080p", video tegak dihitung dari sisi pendeknya.
  #level(t) {
    const [long, short] = t.width >= t.height ? [t.width, t.height] : [t.height, t.width];
    const raw = Math.max(short, Math.round((long * 9) / 16));
    return STEPS.find((x) => Math.abs(x - raw) / x < 0.08) ?? short;
  }
  #levels() {
    const best = new Map();
    for (const t of this.#tracks()) {
      const k = this.#level(t);
      if (!best.has(k) || t.bandwidth > best.get(k).bandwidth) best.set(k, t);
    }
    return [...best].sort((a, b) => b[0] - a[0]);
  }
  #playing() {
    const v = this.video;
    return v.videoWidth ? this.#level({ width: v.videoWidth, height: v.videoHeight }) : 0;
  }
  quality(q, save = true) {
    if (save) pref.set('quality', String(q));
    const list = this.#levels();
    this.now.quality = 'auto';
    clearTimeout(this.slow);
    this.el.classList.remove('switching');
    if (!list.length) return;
    if (String(q) === 'auto') {
      this.#shaka.configure({ abr: { enabled: true } });
      return;
    }
    const [level, track] = list.find(([x]) => x <= Number(q)) ?? list.at(-1);
    this.now.quality = String(level);
    this.#shaka.configure({ abr: { enabled: false } });
    // Beberapa detik ke depan tetap dipakai dulu, jadi gambar tidak macet selama yang baru diunduh.
    this.#shaka.selectVariantTrack(track, true, 5);
    if (save && this.#playing() !== level) {
      this.el.classList.add('switching');
      this.slow = setTimeout(() => this.el.classList.remove('switching'), 12_000);
    }
  }
  #qualityArrived() {
    if (this.now.quality === 'auto' || String(this.#playing()) === this.now.quality) {
      clearTimeout(this.slow);
      this.el.classList.remove('switching');
    }
    if (!this.settings.hidden && this.#page === 'root') this.#draw('root');
  }
  speed(s, save = true) {
    this.video.defaultPlaybackRate = this.video.playbackRate = s;
    if (save) pref.set('speed', s);
  }
  #clearTracks() {
    for (const t of this.video.querySelectorAll('track')) {
      t.track.mode = 'disabled';
      t.remove();
    }
  }
  captions(key, save = true) {
    this.#clearTracks();
    this.cue.replaceChildren();
    const c = this.caps?.find((x) => x.key === key);
    this.now.captions = c ? key : '';
    this.bCc.setAttribute('aria-pressed', !!c);
    if (save) pref.set('captions', c?.lang ?? '');
    if (!c) return;
    const el = h('track', { kind: 'subtitles', srclang: c.lang, src: c.url });
    this.video.append(el);
    el.track.mode = 'hidden';
    el.track.addEventListener('cuechange', () => {
      const lines = [...(el.track.activeCues ?? [])].map((q) => h('span', {}, q.getCueAsHTML().textContent));
      this.cue.replaceChildren(...lines);
    });
    el.addEventListener('error', () => {
      if (this.now.captions !== key) return;
      this.captions('', false);
      toast(c.auto ? 'YouTube membatasi subtitle otomatis. Coba bahasa lain atau nanti lagi.' : 'Subtitle gagal dimuat. Coba lagi nanti.');
      if (!this.settings.hidden && this.#page === 'root') this.#draw('root');
    });
  }
  toggleCaptions() {
    if (!this.caps?.length) return toast('Video ini tidak punya subtitle');
    if (this.now.captions) return this.captions('');
    const c = this.caps.find((x) => x.lang.startsWith('id')) ?? this.caps[0];
    this.captions(c.key);
    toast('Subtitle: ' + c.name);
  }

  // ---------- kendali ----------
  range() {
    const r = this.#info?.live && this.#shaka ? this.#shaka.seekRange() : null;
    return r ?? { start: 0, end: this.video.duration || this.#info?.duration || 0 };
  }
  // Tanda kecil di tengah layar untuk putar, jeda, maju, dan mundur.
  flash(kind, label) {
    if (calm.matches) return;
    this.flashBox.className = 'flash ' + kind;
    this.flashBox.replaceChildren(h('div', {}, label ?? icon(kind === 'go' ? 'play' : 'pause')));
  }
  toggle() {
    if (!this.#info) return;
    this.flash(this.video.paused ? 'go' : 'stop');
    if (this.video.paused) {
      this.hideOverlay();
      this.video.play().catch(() => {});
    } else this.video.pause();
  }
  skip(s) {
    if (!this.#info) return;
    this.flash(s > 0 ? 'fwd' : 'rew', `${s > 0 ? '+' : '−'}${Math.abs(s)} detik`);
    const r = this.range();
    this.video.currentTime = Math.min(r.end, Math.max(r.start, this.video.currentTime + s));
  }
  seek(t) {
    this.video.currentTime = t;
    if (this.video.paused) this.toggle();
  }
  // ---------- menu pengaturan ----------
  menu(open) {
    if (open === !this.settings.hidden) return;
    this.bGear.setAttribute('aria-expanded', open);
    this.el.classList.toggle('menu', open);
    if (open) {
      this.#page = 'root';
      this.settings.hidden = false;
      this.#draw('root');
      this.settings.querySelector('button')?.focus({ preventScroll: true });
    } else {
      const inside = this.settings.contains(document.activeElement);
      this.settings.hidden = true;
      if (inside) this.bGear.focus({ preventScroll: true });
    }
  }
  #pages() {
    const levels = this.#levels();
    const caps = this.caps ?? [];
    const cap = caps.find((c) => c.key === this.now.captions);
    const capName = (c) => c.name + (c.auto ? ' (otomatis)' : '');
    const speedName = (x) => (x === 1 ? 'Normal' : `${String(x).replace('.', ',')}x`);
    const playing = this.#playing();
    const auto = this.now.quality === 'auto';
    return {
      quality: {
        title: 'Kualitas', off: levels.length < 2,
        value: auto ? (playing ? `Otomatis, ${playing}p` : 'Otomatis') : `${this.now.quality}p`,
        items: [
          { id: 'auto', name: 'Otomatis', note: auto && playing ? `sekarang ${playing}p` : 'ikut kecepatan internet', on: auto },
          ...levels.map(([x, t]) => ({ id: String(x), name: `${x}p${t.frameRate > 45 ? Math.round(t.frameRate) : ''}`, note: GRADE[x] ?? '', on: this.now.quality === String(x) })),
        ],
        pick: (id) => this.quality(id),
      },
      speed: {
        title: 'Kecepatan', off: !!this.#info?.live, value: speedName(this.video.playbackRate),
        items: SPEEDS.map((x) => ({ id: String(x), name: speedName(x), on: this.video.playbackRate === x })),
        pick: (id) => this.speed(Number(id)),
      },
      captions: {
        title: 'Subtitle', off: !caps.length, value: caps.length ? (cap ? capName(cap) : 'Mati') : 'Tidak ada',
        items: [{ id: '', name: 'Mati', on: !cap }, ...caps.map((c) => ({ id: c.key, name: capName(c), on: c === cap }))],
        pick: (id) => this.captions(id),
      },
    };
  }
  // Gambar satu halaman menu; tinggi panel dan isinya bergeser halus.
  #draw(page, dir = 0) {
    const box = this.settings;
    const before = box.offsetHeight;
    const changed = page !== this.#page || dir;
    this.#page = page;
    const all = this.#pages();
    const focused = !changed && box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    let list;
    if (page === 'root') {
      const glow = h('input', { type: 'checkbox', tabindex: -1, checked: pref.get('suasana', true) });
      const flip = (e) => {
        e.preventDefault();
        pref.set('suasana', !pref.get('suasana', true));
        glow.checked = pref.get('suasana', true);
        glow.closest('button').setAttribute('aria-checked', glow.checked);
        this.onglow();
      };
      list = h('div', { class: 'mlist' },
        Object.entries(all).map(([k, p]) => h('button', { type: 'button', role: 'menuitem', 'data-k': k, disabled: p.off, 'aria-haspopup': 'true', onclick: () => this.#draw(k, 1) },
          h('span', {}, p.title), h('span', { class: 'val' }, p.value), icon('right'))),
        h('button', { type: 'button', role: 'menuitemcheckbox', 'data-k': 'glow', 'aria-checked': String(glow.checked), onclick: flip }, h('span', {}, 'Cahaya suasana'), h('span', { class: 'switch' }, glow)));
    } else {
      const p = all[page];
      list = h('div', { class: 'mlist' },
        h('button', { type: 'button', class: 'mback', role: 'menuitem', 'data-k': 'back', 'aria-label': 'Kembali dari ' + p.title, onclick: () => this.#draw('root', -1) }, icon('left'), h('span', {}, p.title)),
        h('div', { class: 'mscroll', role: 'group', 'aria-label': p.title }, p.items.map((i) => h('button', { type: 'button', role: 'menuitemradio', 'data-k': 'o' + i.id, 'aria-checked': String(i.on), onclick: (e) => {
          p.pick(i.id);
          for (const b of list.querySelectorAll('[role=menuitemradio]')) b.setAttribute('aria-checked', b === e.currentTarget);
          setTimeout(() => !box.hidden && this.#page === page && this.#draw('root', -1), calm.matches ? 0 : 260);
        } }, icon('check'), h('span', {}, i.name), i.note && h('span', { class: 'val' }, i.note)))));
    }
    box.replaceChildren(list);
    if (page !== 'root') list.querySelector('[aria-checked=true]')?.scrollIntoView({ block: 'center' });
    if (changed) (list.querySelector('[aria-checked=true][role=menuitemradio]') ?? list.querySelector('button'))?.focus({ preventScroll: true });
    else if (focused) list.querySelector(`[data-k="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    if (!dir || calm.matches) return;
    const ease = 'cubic-bezier(.22,.8,.24,1)';
    box.animate([{ height: before + 'px' }, { height: box.offsetHeight + 'px' }], { duration: 320, easing: ease });
    list.animate([{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 320, easing: ease });
  }
  #menuKey(e) {
    const items = [...this.settings.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    const to = (n) => items[(n + items.length) % items.length]?.focus();
    const sub = this.#page !== 'root';
    if (e.key === 'ArrowDown') to(i + 1);
    else if (e.key === 'ArrowUp') to(i - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(-1);
    else if (e.key === 'ArrowRight' && !sub && document.activeElement?.ariaHasPopup) document.activeElement.click();
    else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && sub) this.#draw('root', -1);
    else if (e.key === 'Escape') this.menu(false);
    else if (e.key === 'Tab') return this.menu(false);
    else if (e.key !== 'Enter' && e.key !== ' ') return;
    else return e.stopPropagation();
    e.preventDefault();
    e.stopPropagation();
  }
  async full() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (this.el.requestFullscreen) await this.el.requestFullscreen();
      else this.video.webkitEnterFullscreen?.();
    } catch {}
  }
  async pip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch {
      toast('Gambar dalam gambar tidak tersedia');
    }
  }
  wide(on = !document.documentElement.classList.contains('wide')) {
    document.documentElement.classList.toggle('wide', on);
    pref.set('lebar', on);
  }
  dock(mini) {
    this.el.classList.toggle('mini', mini);
    this.menu(false);
  }

  key(e) {
    if (!this.id || this.el.classList.contains('mini')) return false;
    const v = this.video;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const step = (d) => {
      const i = SPEEDS.indexOf(v.playbackRate);
      const s = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + d))] ?? 1;
      this.speed(s);
      toast(`Kecepatan ${s}x`);
    };
    const volume = (d) => {
      v.muted = false;
      v.volume = Math.min(1, Math.max(0, v.volume + d));
      toast(`Volume ${Math.round(v.volume * 100)}%`);
    };
    const map = {
      k: () => this.toggle(), ' ': () => this.toggle(), j: () => this.skip(-10), l: () => this.skip(10),
      ArrowLeft: () => this.skip(-5), ArrowRight: () => this.skip(5), ArrowUp: () => volume(0.05), ArrowDown: () => volume(-0.05),
      m: () => (v.muted = !v.muted), f: () => this.full(), t: () => this.wide(), c: () => this.toggleCaptions(), i: () => this.pip(),
      '>': () => step(1), '<': () => step(-1), Escape: () => this.menu(false),
    };
    if (e.shiftKey && k === 'n') this.next && this.onnext(this.next);
    else if (/^\d$/.test(k)) {
      const r = this.range();
      v.currentTime = r.start + (Number(k) / 10) * (r.end - r.start);
    } else if (map[k]) map[k]();
    else return false;
    this.el.dispatchEvent(new Event('pointermove'));
    return true;
  }

  // ---------- tampilan ----------
  get chapters() {
    return this.#info?.chapters ?? [];
  }
  // Isi elemen dengan gambar kecil pada detik ke-t.
  frame(el, t, width) {
    const b = this.#info?.board;
    if (!b) return false;
    const per = b.cols * b.rows;
    const n = Math.max(0, Math.floor(t * b.fps));
    const sheet = Math.min(b.sheets.length - 1, Math.floor(n / per));
    const k = Math.min(per - 1, n - sheet * per);
    const scale = width / b.w;
    el.style.width = width + 'px';
    el.style.height = Math.round(b.h * scale) + 'px';
    el.style.backgroundImage = `url("${b.sheets[sheet]}")`;
    el.style.backgroundSize = `${b.cols * width}px auto`;
    el.style.backgroundPosition = `${-(k % b.cols) * width}px ${-Math.floor(k / b.cols) * b.h * scale}px`;
    return true;
  }
  // Kurva bagian yang paling sering diputar ulang.
  #drawHeat() {
    this.heat.replaceChildren();
    const v = this.#info.heat ?? [];
    if (v.length < 10) return;
    const pts = v.map((y, i) => [(i / (v.length - 1)) * 1000, 100 - y * 92]);
    let d = `M0 100L${pts[0].join(' ')}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      d += `C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d + 'L1000 100Z');
    svg.append(path);
    this.heat.append(svg);
  }
  #chapterAt(t) {
    return this.#info?.chapters.findLast((c) => c.start <= t);
  }
  #paint() {
    const v = this.video;
    const r = this.range();
    const len = r.end - r.start;
    if (!(len > 0)) return;
    const p = Math.min(1, Math.max(0, (v.currentTime - r.start) / len));
    if (!this.dragging()) this.bar.value = p;
    this.bar.style.setProperty('--p', p);
    let buf = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5) buf = v.buffered.end(i);
    this.bar.style.setProperty('--b', Math.min(1, Math.max(p, (buf - r.start) / len)));
    if (this.#info?.live) {
      const late = r.end - v.currentTime;
      this.bLive.classList.toggle('on', late < 15);
      this.clock.textContent = late < 15 ? '' : '-' + time(late);
      this.bar.setAttribute('aria-valuetext', late < 15 ? 'Langsung' : `${time(late)} di belakang siaran`);
    } else {
      this.clock.textContent = `${time(v.currentTime)} / ${time(r.end)}`;
      this.bar.setAttribute('aria-valuetext', `${time(v.currentTime)} dari ${time(r.end)}`);
      this.chapter.textContent = this.#chapterAt(v.currentTime)?.title ?? '';
    }
  }
  #remember(leaving = false) {
    const v = this.video;
    if (!this.id || !this.meta || !this.#info || !v.played.length || v.currentTime < 3) return;
    this.#lastSave = Date.now();
    const len = this.#info.live ? 0 : Math.floor(v.duration || this.#info.duration || 0);
    // posisi 0 = sudah selesai ditonton
    const pos = !len || v.currentTime > len - Math.max(10, len * 0.03) ? 0 : Math.floor(v.currentTime);
    lib.watched(this.meta, pos, len, leaving);
  }
  #ended() {
    this.#remember();
    const n = this.next;
    if (!n || !pref.get('autoplay', true)) return;
    let left = 6;
    const count = h('span', {}, String(left));
    this.showOverlay(h('div', { class: 'upnext' }, h('p', {}, 'Berikutnya dalam ', count), h('strong', {}, n.title), h('span', { class: 'timer' }, h('i')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => this.onnext(n) }, 'Putar sekarang'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.hideOverlay() }, 'Batal'))));
    this.countdown = setInterval(() => {
      count.textContent = String(--left);
      if (left <= 0) {
        this.hideOverlay();
        this.onnext(n);
      }
    }, 1000);
  }
}
