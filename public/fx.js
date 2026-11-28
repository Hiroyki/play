// Gerak. Semua efek mati kalau sistem diset mengurangi animasi.

import { pref } from './ui.js';

export const calm = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

// ---------- gambar ----------
export function loadImage(src) {
  return new Promise((ok, no) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.referrerPolicy = 'no-referrer';
    i.alt = '';
    i.onload = () => ok(i);
    i.onerror = no;
    i.src = src;
  });
}
// Versi HD tidak selalu ada; YouTube membalas gambar abu-abu 120px kalau kosong.
export async function bigThumb(id) {
  const hd = await loadImage(`https://i.ytimg.com/vi/${id}/hq720.jpg`).catch(() => null);
  if (hd?.naturalWidth > 120) return hd;
  const im = await loadImage(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  im.dataset.bars = '';
  return im;
}

// ---------- pembuka ----------
// Logo tergambar di tengah, lalu terbang ke tempatnya di bilah atas.
export function intro() {
  const box = document.getElementById('ident');
  let over = false;
  const done = () => {
    if (over) return;
    over = true;
    box.remove();
    root.classList.remove('intro');
  };
  if (calm.matches) return done();
  // Logo di bilah atas tersembunyi sampai animasinya selesai. Kalau kabar selesainya tidak pernah datang
  // (WebView lama di head unit), tetap tampilkan.
  setTimeout(done, Math.max(0, 1500 - performance.now()) + 2500);
  setTimeout(() => {
    if (over || !box.firstElementChild?.animate) return done();
    const svg = box.firstElementChild;
    const a = svg.getBoundingClientRect();
    const b = document.querySelector('.brand .logo').getBoundingClientRect();
    svg.style.transformOrigin = '0 0';
    svg.animate([{ transform: 'none' }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})` }], { duration: 1000, easing: 'cubic-bezier(.7, 0, .15, 1)', fill: 'forwards' }).onfinish = done;
    box.animate([{ backgroundColor: '#000' }, { backgroundColor: '#0000' }], { duration: 900, delay: 100, easing: 'ease', fill: 'both' });
  }, Math.max(0, 1500 - performance.now()));
}

// ---------- pindah halaman ----------
// Halaman berganti dengan pudar halus, dan thumbnail yang diklik membesar jadi pemutar.
let live = 0;
export function transition(swap, { go, from, to }) {
  if (!document.startViewTransition || calm.matches || document.hidden) {
    swap();
    return Promise.resolve();
  }
  const my = ++live;
  const name = (el, v) => el && (el.style.viewTransitionName = v);
  const visible = (el) => {
    const b = el?.isConnected && el.getBoundingClientRect();
    return b && b.width && b.bottom > 0 && b.top < innerHeight ? el : null;
  };
  const a = visible(from);
  let b = null;
  root.dataset.go = go;
  name(a, 'screen');
  const vt = document.startViewTransition(() => {
    name(a, '');
    swap();
    b = visible(to());
    name(b, 'screen');
  });
  vt.ready.catch(() => {});
  vt.finished.catch(() => {}).then(() => {
    if (my !== live) return;
    name(b, '');
    delete root.dataset.go;
  });
  return vt.updateCallbackDone;
}

// ---------- geser dengan mouse, meluncur saat dilepas ----------
export function drag(el) {
  let down = false, moved = false, lastX = 0, v = 0, raf = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button) return;
    down = true;
    moved = false;
    lastX = e.clientX;
    v = 0;
    cancelAnimationFrame(raf);
  });
  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - lastX;
    if (!moved && Math.abs(dx) < 6) return;
    if (!moved) {
      moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    }
    lastX = e.clientX;
    v = v * 0.5 + dx * 0.5;
    el.scrollLeft -= dx;
  });
  const end = () => {
    if (!down) return;
    down = false;
    if (!moved) return;
    const glide = () => {
      v *= 0.94;
      el.scrollLeft -= v;
      if (Math.abs(v) > 0.4) raf = requestAnimationFrame(glide);
      else el.classList.remove('dragging');
    };
    if (calm.matches) el.classList.remove('dragging');
    else glide();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dragstart', (e) => e.preventDefault());
  // Geseran jangan dianggap klik.
  el.addEventListener('click', (e) => {
    if (!moved) return;
    moved = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// ---------- thumbnail bergerak ----------
export function flipbook(card, thumb, id) {
  let timer;
  card.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || calm.matches) return;
    let frames = [1, 2, 3].map((n) => loadImage(`https://i.ytimg.com/vi/${id}/hq${n}.jpg`).catch(() => null));
    let k = 0;
    clearInterval(timer);
    timer = setInterval(async () => {
      const im = await frames[k++ % 3];
      if (!im || im.naturalWidth <= 120 || !card.matches(':hover')) return;
      im.className = 'frame';
      thumb.append(im);
      im.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease' });
    }, 1300);
  });
  card.addEventListener('pointerleave', () => {
    clearInterval(timer);
    for (const f of thumb.querySelectorAll('.frame')) f.animate([{ opacity: 1 }, { opacity: 0 }], 200).onfinish = () => f.remove();
  });
}

// ---------- cuplikan bisu di layar utama ----------
export class Preview {
  #turn = 0;
  #shaka = null;
  constructor(api) {
    this.api = api;
    this.video = document.createElement('video');
    Object.assign(this.video, { muted: true, playsInline: true, loop: false });
    this.video.setAttribute('aria-hidden', 'true');
    this.video.tabIndex = -1;
    this.video.addEventListener('playing', () => this.video.classList.add('on'));
  }
  async start(id) {
    const my = ++this.#turn;
    const stale = () => my !== this.#turn;
    this.video.classList.remove('on');
    this.video.pause();
    if (calm.matches || navigator.connection?.saveData || !window.shaka || !pref.get('cuplikan', true)) return;
    await new Promise((r) => setTimeout(r, 1200));
    if (stale()) return;
    try {
      const info = await this.api('/play/' + id);
      const src = info.sources.find((s) => s.codec === 'avc');
      if (stale() || info.live || !src || info.duration < 40) return;
      if (!this.#shaka) {
        shaka.polyfill.installAll();
        this.#shaka = new shaka.Player();
        await this.#shaka.attach(this.video);
        this.#shaka.configure({ restrictions: { maxHeight: 720 }, streaming: { bufferingGoal: 8, bufferBehind: 5 } });
      }
      if (stale()) return;
      await this.#shaka.load(src.url, Math.floor(info.duration * 0.22));
      if (!stale()) await this.video.play();
    } catch {
      // cuplikan cuma pemanis; kalau gagal, gambarnya tetap tampil
    }
  }
  hush() {
    this.#turn++;
    this.video.classList.remove('on');
    this.video.pause();
  }
  pause(on) {
    if (!this.#shaka || !this.video.classList.contains('on')) return;
    if (on) this.video.pause();
    else this.video.play().catch(() => {});
  }
  stop() {
    this.#turn++;
    this.video.pause();
    this.#shaka?.destroy().catch(() => {});
    this.#shaka = null;
  }
}
