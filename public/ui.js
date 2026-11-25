// Alat bantu DOM, API, dan data pribadi.

import { flipbook } from './fx.js';

const P = {
  musik: 'M9 17.500V6l10-2v11.500M9 17.500a2.500 2.500 0 1 1-5 0 2.500 2.500 0 0 1 5 0zM19 15.500a2.500 2.500 0 1 1-5 0 2.500 2.500 0 0 1 5 0z',
  gaming: 'M7 8h10a4 4 0 0 1 4 4.500l-.6 3.500a2.500 2.500 0 0 1-4.400 1.200L14.500 15h-5L8 17.200A2.500 2.500 0 0 1 3.600 16L3 12.500A4 4 0 0 1 7 8zM8 10.500v3M6.500 12h3M16 11h.01M17.500 13h.01',
  teknologi: 'M7.500 3h9v18h-9zM11 18h2',
  berita: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2h-1M7 9h7M7 12.500h7M7 16h4',
  olahraga: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8l3.800 2.800-1.400 4.400H9.600l-1.400-4.400zM12 3v5M20.500 9.500l-4.700 1.300M17.300 19l-2.900-3.800M6.700 19l2.900-3.800M3.500 9.500l4.700 1.300',
  masak: 'M5 10h14v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM2.500 10h19M9 7c0-1.500 1.500-1.500 1.500-3M13.500 7c0-1.500 1.500-1.500 1.500-3',
  film: 'M4 10h16v10H4zM4 10l-.7-4 15.800-2.800.7 4zM8.500 5.100l2 3.800M13.500 4.200l2 3.800',
  komedi: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7.500 13.500h9a4.500 4.500 0 0 1-9 0zM8.500 9.500h.01M15.500 9.500h.01',
  belajar: 'M2.500 9 12 4.500 21.500 9 12 13.500zM6 11v5c3 2.700 9 2.700 12 0v-5M21.500 9v5.500',
  eye: 'M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12zM12 14.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z',
  heart: 'M12 20S4 15 4 9.500A4.200 4.200 0 0 1 12 7.500a4.200 4.200 0 0 1 8 2C20 15 12 20 12 20z',
  date: 'M4 6h16v14H4zM4 10.500h16M8.500 3.500V8M15.500 3.500V8',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  home: 'M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z',
  subs: 'M5 8h14v11H5zM8 4.5h8',
  saved: 'M7 4h10v16l-5-4-5 4z',
  history: 'M4 12a8 8 0 1 0 2.6-5.9L4 8.5M4 4v4.5h4.5M12 8v4.5l3 2',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  close: 'M6 6l12 12M18 6 6 18',
  play: 'M8 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  next: 'M6 5v14l9-7zM18 5v14',
  volume: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5',
  cc: 'M4 6h16v12H4zM10.5 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3',
  alert: 'M12 4 21 19.500H3zM12 10v4.500M12 17h.01',
  gear: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM9 19.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z',
  pip: 'M4 6h16v12H4zM12 12h5v3.500h-5z',
  wide: 'M3 7h18v10H3z',
  full: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  expand: 'M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8',
  check: 'M5 12.500l4.500 4.500L19 7.500',
  share: 'M9 15 20 4M14 4h6v6M18 14v6H4V6h6',
};
const FILLED = new Set(['play']);
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('i');
  if (FILLED.has(name)) s.classList.add('fill');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name]);
  s.append(p);
  return s;
}

// Semua teks dari YouTube masuk lewat textContent, bukan innerHTML.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') for (const [a, b] of Object.entries(v)) el.style.setProperty(a, b);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false && k !== ''));
  return el;
}

export async function api(path, opts) {
  let r;
  try {
    r = await fetch('/api' + path, opts);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Play terputus. Tutup lalu buka lagi Play.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Gagal memuat.'), { status: r.status });
  return data;
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}

// Siapkan video lebih dulu supaya langsung main saat diklik.
const warmed = new Map();
export function warm(id) {
  if (!pref.get('siap', true) || navigator.connection?.saveData || document.hidden) return;
  if (Date.now() - (warmed.get(id) ?? 0) < 60_000) return;
  warmed.set(id, Date.now());
  fetch('/api/warm/' + id, { priority: 'low' }).catch(() => {});
}
export const time = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
export const pref = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

// ---------- langganan, simpanan, riwayat ----------
export const lib = {
  subs: [], saved: [], history: [],
  async load() {
    Object.assign(this, await api('/library'));
  },
  async send(body, keepalive = false) {
    try {
      await api('/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive });
    } catch (e) {
      toast('Belum tersimpan: ' + e.message);
    }
  },
  isSub: (id) => lib.subs.some((s) => s.id === id),
  isSaved: (id) => lib.saved.some((s) => s.id === id),
  seen: (id) => lib.history.find((x) => x.id === id),
  toggleSub(c) {
    const on = !this.isSub(c.id);
    this.subs = this.subs.filter((s) => s.id !== c.id);
    if (on) this.subs.push(c);
    this.send(on ? { op: 'subscribe', channel: c } : { op: 'unsubscribe', id: c.id });
    document.dispatchEvent(new Event('subs'));
    toast(on ? `Langganan ${c.title}` : `Berhenti langganan ${c.title}`);
    return on;
  },
  toggleSave(v) {
    const on = !this.isSaved(v.id);
    this.saved = this.saved.filter((s) => s.id !== v.id);
    if (on) this.saved.unshift(v);
    this.send(on ? { op: 'save', video: v } : { op: 'unsave', id: v.id });
    toast(on ? 'Disimpan' : 'Dihapus dari simpanan');
    return on;
  },
  watched(video, position, length, leaving) {
    this.history = [{ ...video, position, length, at: Date.now() }, ...this.history.filter((x) => x.id !== video.id)];
    this.send({ op: 'watched', video, position, length }, leaving);
  },
  forget(id) {
    this.history = this.history.filter((x) => x.id !== id);
    this.send({ op: 'forget', id });
  },
  clear() {
    this.history = [];
    this.send({ op: 'clearHistory' });
  },
};

// ---------- kartu ----------
const img = (src, cls, alt = '') => (src ? h('img', { class: cls, src, alt, crossorigin: 'anonymous', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : h('span', { class: cls }));
export const avatar = (src, cls = 'avatar') => img(src, cls);

export function saveButton(v, label) {
  const b = h('button', { type: 'button', class: label ? 'btn' : 'icon-btn save' });
  const paint = () => {
    const on = lib.isSaved(v.id);
    b.replaceChildren(icon(on ? 'check' : 'saved'), ...(label ? [on ? 'Tersimpan' : 'Simpan'] : []));
    b.setAttribute('aria-pressed', on);
    if (!label) b.setAttribute('aria-label', (on ? 'Hapus dari simpanan: ' : 'Simpan: ') + v.title);
  };
  b.addEventListener('click', (e) => {
    e.preventDefault();
    lib.toggleSave(v);
    paint();
  });
  paint();
  return b;
}
export function subButton(c) {
  const b = h('button', { type: 'button', class: 'btn' });
  const paint = () => {
    const on = lib.isSub(c.id);
    b.textContent = on ? 'Berlangganan' : 'Langganan';
    b.classList.toggle('primary', !on);
    b.setAttribute('aria-pressed', on);
  };
  b.addEventListener('click', () => {
    lib.toggleSub(c);
    paint();
  });
  paint();
  return b;
}

export function card(v, { list, onRemove } = {}) {
  if (v.type === 'channel')
    return h('a', { class: 'card channel', href: '/channel/' + v.id }, avatar(v.avatar, 'avatar big'), h('span', { class: 'title' }, v.title), h('span', { class: 'meta' }, v.info.join(' · ')));
  if (v.type === 'playlist')
    return h('article', { class: 'card playlist' },
      h('a', { class: 'thumb', href: '/playlist?list=' + v.id, tabindex: -1, 'aria-hidden': 'true' }, img(v.thumb), h('span', { class: 'time' }, v.count || 'Playlist')),
      h('div', { class: 'text' }, h('a', { class: 'title', href: '/playlist?list=' + v.id }, v.title), h('span', { class: 'meta' }, v.author)));
  const href = `/watch?v=${v.id}${list ? '&list=' + list : ''}`;
  const seen = lib.seen(v.id);
  const part = seen?.length ? (seen.position || seen.length) / seen.length : 0;
  const el = h('article', { class: 'card' },
    h('a', { class: 'thumb', href, tabindex: -1, 'aria-hidden': 'true' },
      img(v.thumb),
      v.live ? h('span', { class: 'time live' }, 'Live') : v.duration && h('span', { class: 'time' }, v.duration),
      part > 0.02 && h('span', { class: 'part', style: { '--p': Math.min(1, part) } })),
    saveButton(v),
    onRemove && h('button', { class: 'icon-btn remove', type: 'button', 'aria-label': 'Hapus dari riwayat: ' + v.title, onclick: onRemove }, icon('close')),
    h('div', { class: 'text' },
      h('a', { class: 'title', href, title: v.title }, v.title),
      v.author && (v.channelId ? h('a', { class: 'meta by', href: '/channel/' + v.channelId }, v.author) : h('span', { class: 'meta by' }, v.author)),
      h('span', { class: 'meta' }, v.info.join(' · '))));
  if (!v.live) flipbook(el, el.querySelector('.thumb'), v.id);
  return el;
}
export const skeleton = (n = 12) => Array.from({ length: n }, () => h('div', { class: 'card ghost', 'aria-hidden': 'true' }, h('span', { class: 'thumb' }), h('span', { class: 'line' }), h('span', { class: 'line short' })));
export const notice = (title, body, ...actions) => h('div', { class: 'notice' }, h('h2', {}, title), body && h('p', {}, body), actions.length ? h('div', { class: 'row' }, ...actions) : null);
