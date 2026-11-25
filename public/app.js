import { api, avatar, card, h, icon, lib, notice, pref, saveButton, skeleton, subButton, time, toast, warm } from './ui.js';
import { Player } from './player.js';
import { Preview, bigThumb, calm, drag, intro, loadImage, transition } from './fx.js';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const dock = $('#dock');
const player = new Player();
player.wide(pref.get('lebar', false));
for (const e of ['play', 'playing', 'pause', 'emptied'])
  player.video.addEventListener(e, () => document.documentElement.classList.toggle('playing', !player.video.paused));

// ---------- rute ----------
let turn = 0; // naik tiap pindah halaman; hasil lama dibuang
let here = '';
let lastPath = null;
let clicked = null; // thumbnail yang baru diklik, untuk animasi membesar
const scrolls = new Map();
let cleanup = []; // dijalankan saat halaman ditinggalkan

function go(href, replace = false) {
  scrolls.set(here, scrollY);
  history[replace ? 'replaceState' : 'pushState'](null, '', href);
  route();
}
addEventListener('popstate', () => {
  scrolls.set(here, scrollY);
  route(true);
});
history.scrollRestoration = 'manual';

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.hasAttribute('download') || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  const u = new URL(a.href);
  if (u.origin !== location.origin || a.getAttribute('href').startsWith('#')) return;
  e.preventDefault();
  if (a.dataset.t) {
    player.seek(Number(a.dataset.t));
    return scrollTo({ top: 0, behavior: 'smooth' });
  }
  clicked = a.closest('.card')?.querySelector('.thumb') ?? a.closest('.hero')?.querySelector('.pics') ?? null;
  go(u.pathname + u.search);
  clicked = null;
});

const VID = /^[\w-]{11}$/;
// Mouse berhenti sebentar di video, atau jari mulai menekan: siapkan videonya.
let rest;
let restOn = null;
const videoAt = (t) => {
  const a = t.closest?.('a[href^="/watch"]') ?? t.closest?.('.card')?.querySelector('a[href^="/watch"]');
  const v = a && new URL(a.href).searchParams.get('v');
  return v && VID.test(v) && v !== player.id ? v : null;
};
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const v = videoAt(e.target);
  if (v === restOn) return;
  restOn = v;
  clearTimeout(rest);
  if (v) rest = setTimeout(() => warm(v), 350);
}, { passive: true });
document.addEventListener('pointerdown', (e) => {
  const v = videoAt(e.target);
  if (v) warm(v);
}, { passive: true });

function fromLink(text) {
  let u;
  try {
    u = new URL(/^https?:/.test(text) ? text : 'https://' + text);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const t = parseInt(u.searchParams.get('t') ?? '', 10);
  const watch = (id) => VID.test(id ?? '') && `/watch?v=${id}${u.searchParams.get('list') ? '&list=' + encodeURIComponent(u.searchParams.get('list')) : ''}${t ? '&t=' + t : ''}`;
  if (host === 'youtu.be') return watch(seg[0]);
  if (host !== 'youtube.com') return null;
  if (seg[0] === 'watch') return watch(u.searchParams.get('v'));
  if (['shorts', 'live', 'embed', 'v'].includes(seg[0])) return watch(seg[1]);
  if (seg[0] === 'playlist') return '/playlist' + u.search;
  if (seg[0] === 'channel') return '/channel/' + seg[1];
  if (seg[0]?.startsWith('@')) return '/search?type=channel&q=' + encodeURIComponent(seg[0]);
  return null;
}

async function route(back = false) {
  const my = ++turn;
  const fresh = () => my === turn;
  const u = new URL(location.href);
  here = u.pathname + u.search;
  const seg = u.pathname.split('/').filter(Boolean);
  const id = u.searchParams.get('v');

  // alamat gaya YouTube ikut jalan
  if (['shorts', 'live', 'embed'].includes(seg[0]) && VID.test(seg[1] ?? '')) return go('/watch?v=' + seg[1], true);
  if (seg[0]?.startsWith('@')) return go('/search?type=channel&q=' + encodeURIComponent(seg[0]), true);

  const page = {
    '': () => homePage(u.searchParams.get('topik')), search: () => searchPage(u.searchParams), watch: () => watchPage(id, u.searchParams),
    channel: () => channelPage(seg[1], u.searchParams.get('tab') || 'videos'), playlist: () => playlistPage(u.searchParams.get('list')),
    subs: subsPage, saved: savedPage, history: historyPage, pengaturan: settingsPage,
  }[seg[0] ?? ''];

  const watching = seg[0] === 'watch';
  let p;
  const swap = () => {
    if (!fresh()) return;
    for (const fn of cleanup.splice(0)) fn();
    closeFinder();
    document.title = 'Play';
    p = page ? page() : { node: notice('Halaman ini tidak ada', null, h('a', { class: 'btn primary', href: '/' }, 'Ke beranda')) };
    document.body.classList.toggle('watching', watching);
    document.body.classList.toggle('flush', !!p.flush);
    paintLinks('/' + (seg[0] ?? ''));
    if (!watching) undock(); // sebelum halaman lama hilang, selamatkan pemutarnya
    view.replaceChildren(...[p.node].flat());
    p.enter?.();
    if (!back) scrollTo(0, 0);
  };
  const samePage = lastPath === u.pathname && !watching;
  const first = lastPath === null;
  lastPath = u.pathname;
  const from = watching && clicked?.isConnected ? clicked : player.id ? player.el : null;
  if (first) swap();
  else await transition(swap, { go: samePage ? 'soft' : 'page', from, to: () => (watching ? player.el : dock.classList.contains('on') ? player.el : null) });
  if (!fresh() || !p) return;

  // Segitiga logo berputar selama halaman memuat.
  const loading = (on) => document.documentElement.classList.toggle('loading', on);
  loading(!!p.fill);
  try {
    await p.fill?.(fresh);
    if (fresh()) loading(false);
  } catch (e) {
    if (!fresh()) return;
    loading(false);
    const spot = p.spot ?? view;
    spot.replaceChildren(notice('Gagal memuat', e.message, h('button', { class: 'btn primary', type: 'button', onclick: () => route() }, 'Coba lagi')));
  }
  // Kembali: tunggu semua rak terisi supaya posisi gulirnya pas.
  if (!back || !fresh()) return;
  const y = scrolls.get(here) ?? 0;
  scrollTo(0, y);
  await p.settled?.();
  if (fresh() && Math.abs(scrollY - y) > 4) scrollTo(0, y);
}

// Pindahkan pemutar tanpa memutus video (moveBefore ada di Chrome/Edge baru).
function place(parent) {
  if (player.el.parentNode === parent) return;
  const playing = !player.video.paused;
  if (parent.moveBefore && player.el.isConnected && parent.isConnected) parent.moveBefore(player.el, null);
  else {
    parent.append(player.el);
    if (playing) player.video.play().catch(() => {});
  }
}
function undock() {
  if (player.failed) player.stop();
  if (!player.id) return dock.classList.remove('on');
  place(dock);
  const pip = !!document.pictureInPictureElement;
  player.dock(!pip);
  dock.classList.toggle('on', !pip);
}
// Dipakai tombol taskbar di aplikasi Windows.
window.playHasNext = () => !!(player.id && player.next);
window.playNext = () => player.next && player.onnext(player.next);
player.onexpand = () => go(`/watch?v=${player.id}${player.list ? '&list=' + player.list : ''}`);
player.onclose = () => {
  player.stop();
  dock.classList.remove('on');
};
player.onnext = (n) => {
  const href = `/watch?v=${n.id}${player.list ? '&list=' + player.list : ''}`;
  if (location.pathname === '/watch') return go(href);
  // pemutar kecil: lanjut tanpa pindah halaman
  player.load(n.id, { meta: n });
  nextFor(n.id, player.list).catch(() => {});
};

// ---------- daftar + muat lagi ----------
function grid(cls = 'grid') {
  const el = h('div', { class: cls });
  const end = h('div', { class: 'end' });
  let io;
  const add = (res, opts, fresh) => {
    const cards = res.items.map((i) => card(i, opts));
    if (opts?.feature) cards.forEach((c, n) => (el.children.length + n) % 9 === 8 && res.items[n].type === 'video' && c.classList.add('feature'));
    el.append(...cards);
    // Kartu besar butuh gambar HD.
    requestAnimationFrame(() => cards.forEach((c, n) => {
      const im = c.querySelector('.thumb img');
      if (res.items[n].type !== 'video' || !(im?.clientWidth > 500)) return;
      bigThumb(res.items[n].id).then((hd) => {
        if ('bars' in hd.dataset) return;
        im.src = hd.src;
        im.classList.add('hd');
      }, () => {});
    }));
    end.replaceChildren();
    io?.disconnect();
    if (!res.next) return;
    const more = async () => {
      io.disconnect();
      end.replaceChildren(h('span', { class: 'spin inline', role: 'status', 'aria-label': 'Memuat lagi' }));
      try {
        const r = await api('/more/' + res.next);
        if (!fresh()) return;
        add(r, opts, fresh);
      } catch (e) {
        if (fresh()) end.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: () => (e.status === 410 ? route() : more()) }, 'Muat lagi'));
      }
    };
    io = new IntersectionObserver((x) => x[0].isIntersecting && more(), { rootMargin: '600px' });
    io.observe(end);
  };
  return {
    el, end,
    ghost(n) { el.replaceChildren(...skeleton(n)); },
    set(res, opts, fresh) {
      el.replaceChildren();
      add(res, opts, fresh);
    },
  };
}

// ---------- beranda ----------
const TOPICS = { musik: 'Musik', gaming: 'Gaming', teknologi: 'Teknologi', berita: 'Berita', olahraga: 'Olahraga', masak: 'Masak', film: 'Film', komedi: 'Komedi', belajar: 'Belajar' };
const chip = (href, label, on) => h('a', { class: 'chip', href, 'aria-current': on ? 'page' : null }, label);
const heading = (text, ...more) => h('header', { class: 'head' }, h('h2', {}, text), ...more);
const pageHead = (title, sub, ...more) => h('header', { class: 'pagehead' }, h('div', {}, h('h1', {}, title), sub && h('p', { class: 'meta' }, sub)), ...more);

const topicNav = (now) => h('nav', { class: 'topics', 'aria-label': 'Topik' },
  Object.entries(TOPICS).map(([k, n]) => h('a', { href: now === k ? '/' : '/?topik=' + k, 'aria-current': now === k ? 'page' : null }, n)));

function strip(title, items, cls = '') {
  const list = h('div', { class: 'strip ' + cls }, items.map((v) => card(v)));
  drag(list);
  const move = (d) => list.scrollBy({ left: d * list.clientWidth * 0.8, behavior: 'smooth' });
  return h('section', {}, heading(title, h('span', { class: 'arrows' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Geser kiri: ' + title, onclick: () => move(-1) }, icon('left')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Geser kanan: ' + title, onclick: () => move(1) }, icon('right')))), list);
}

// Layar utama: lima sorotan berganti pelan, dengan cuplikan bisu.
function hero(items) {
  const pics = h('div', { class: 'pics' });
  const copy = h('div', { class: 'copy' });
  const prev = new Preview(api);
  const dots = items.map((v, n) => h('button', { type: 'button', 'aria-label': 'Sorotan: ' + v.title, onclick: () => show(n) }, h('img', { src: v.thumb, alt: '', crossorigin: 'anonymous', referrerpolicy: 'no-referrer' }), h('span', { class: 'fuse', onanimationend: () => show((n + 1) % items.length) })));
  const hold = h('button', { type: 'button', class: 'icon-btn hold', 'aria-label': 'Jeda pergantian', 'aria-pressed': 'false', onclick: () => {
    const on = el.classList.toggle('held');
    hold.setAttribute('aria-pressed', on);
    hold.replaceChildren(icon(on ? 'play' : 'pause'));
    prev.pause(on);
  } }, icon('pause'));
  const el = h('section', { class: 'hero', 'aria-label': 'Sorotan' }, pics, copy, h('div', { class: 'dots' }, dots, hold));
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || calm.matches) return;
    pics.style.setProperty('--mx', (0.5 - e.clientX / innerWidth).toFixed(3));
    pics.style.setProperty('--my', (0.5 - e.clientY / innerHeight).toFixed(3));
  });
  let now = -1;
  function show(n) {
    if (n === now || !el.isConnected) return;
    now = n;
    const v = items[n];
    const href = '/watch?v=' + v.id;
    dots.forEach((d, i) => {
      d.classList.toggle('on', i === n);
      d.setAttribute('aria-current', i === n);
    });
    copy.replaceChildren(
      h('h2', {}, h('a', { href }, v.title)),
      h('p', {}, v.channelId ? h('a', { href: '/channel/' + v.channelId }, v.author) : v.author, [v.live ? 'Live' : v.duration, v.info[0]].filter(Boolean).map((t) => ' · ' + t).join('')),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href }, icon('play'), 'Putar'), saveButton(v, true)));
    prev.hush();
    bigThumb(v.id).then((im) => {
      if (now !== n || !el.isConnected) return;
      im.className = 'in';
      pics.append(im, prev.video);
      setTimeout(() => {
        while (pics.children.length > 2 && pics.firstChild !== im) pics.firstChild.remove();
      }, 1600);
    }, () => {});
    // Jangan rebutan dengan video yang sedang ditonton.
    if (!player.id && !v.live) prev.start(v.id);
  }
  const io = new IntersectionObserver(([x]) => {
    el.classList.toggle('away', !x.isIntersecting);
    if (!el.classList.contains('held')) prev.pause(!x.isIntersecting);
  }, { threshold: 0.2 });
  io.observe(el);
  cleanup.push(() => {
    io.disconnect();
    prev.stop();
  });
  queueMicrotask(() => show(0));
  return el;
}

// Lima teratas: satu besar, empat berurutan di sampingnya.
function topFive(items) {
  const [first, ...rest] = items.slice(0, 5);
  const lead = card(first);
  lead.classList.add('lead');
  lead.querySelector('.thumb').append(h('span', { class: 'shade' }));
  bigThumb(first.id).then((hd) => {
    if ('bars' in hd.dataset) return;
    const im = lead.querySelector('img');
    im.src = hd.src;
    im.classList.add('hd');
  }, () => {});
  return h('section', { class: 'five' }, heading('Ramai minggu ini'), h('div', { class: 'cols' }, lead,
    h('ol', { class: 'list' }, rest.map((v, n) => h('li', {}, h('span', { class: 'rank', 'aria-hidden': 'true' }, String(n + 2)), card(v))))));
}

function coverRow(list) {
  const row = h('nav', { class: 'covers', 'aria-label': 'Topik' }, list.map(({ name, id }) => h('a', { href: '/?topik=' + name },
    id && h('img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: '', crossorigin: 'anonymous', referrerpolicy: 'no-referrer', loading: 'lazy', 'data-bars': true, draggable: 'false' }), h('span', {}, TOPICS[name]))));
  drag(row);
  return h('section', {}, heading('Jelajah'), row);
}

function peopleRow(items) {
  const seen = new Set();
  const list = items.filter((v) => v.channelId && v.avatar && !lib.isSub(v.channelId) && !seen.has(v.channelId) && seen.add(v.channelId)).slice(0, 14);
  if (list.length < 6) return null;
  const row = h('div', { class: 'people' }, list.map((v) => h('a', { href: '/channel/' + v.channelId, draggable: 'false' }, avatar(v.avatar), h('span', {}, v.author))));
  drag(row);
  return h('section', {}, heading('Channel buat dicoba'), row);
}

function daypart() {
  const t = new Date().getHours();
  return t >= 4 && t < 10 ? 'pagi' : t >= 10 && t < 15 ? 'siang' : t >= 15 && t < 18 ? 'sore' : 'malam';
}

function homePage(topic) {
  if (!TOPICS[topic]) topic = null;
  const g = grid();
  g.ghost(8);
  const top = topic ? pageHead(TOPICS[topic], 'Yang baru bulan ini') : h('div', { class: 'herobox' }, h('div', { class: 'hero empty' }));
  const spot = () => h('div', {});
  const [hot, covers, moodBox, people] = [spot(), spot(), spot(), spot()];
  let settled = () => {};
  const half = topic ? [] : lib.history.filter((x) => x.position > 0 && x.length && x.position / x.length < 0.95).slice(0, 12);
  return {
    flush: !topic,
    node: [!topic && h('h1', { class: 'sr' }, 'Beranda'), top, topic && topicNav(topic), half.length ? strip('Lanjut nonton', half) : null,
      hot, covers, moodBox, people, heading(topic ? 'Semua ' + TOPICS[topic].toLowerCase() : 'Buat kamu'), g.el, g.end].filter(Boolean),
    spot: g.el,
    settled: () => settled(),
    async fill(fresh) {
      const parts = [];
      const put = (box, path, make) => parts.push(api(path).then((r) => {
        const node = fresh() && make(r);
        if (node) box.replaceChildren(node);
      }, () => {}));
      settled = () => Promise.race([Promise.allSettled(parts), new Promise((r) => setTimeout(r, 3000))]);
      put(hot, '/hot' + (topic ? '?topic=' + topic : ''), (r) => r.items.length > 4 && topFive(r.items));
      if (!topic) {
        put(covers, '/covers', (r) => r.some((x) => x.id) && coverRow(r));
        const part = daypart();
        put(moodBox, '/mood/' + part, (r) => r.items.length > 4 && strip(`Nemenin ${part} ini`, r.items, 'cine'));
      }
      let r;
      try {
        r = await api(topic ? '/topic/' + topic : '/home');
      } catch (e) {
        if (!topic && fresh()) {
          top.replaceChildren();
          document.body.classList.remove('flush');
        }
        throw e;
      }
      if (!fresh()) return;
      if (!topic) {
        const star = r.items.slice(0, 5);
        const full = star.length === 5;
        top.replaceChildren(...(full ? [hero(star)] : []));
        document.body.classList.toggle('flush', full);
        if (full) r = { ...r, items: r.items.slice(5) };
        const row = peopleRow(r.items);
        if (row) people.replaceChildren(row);
      }
      g.set(r, { feature: true }, fresh);
      if (!r.items.length) g.el.replaceChildren(notice('Belum ada video', 'Cari sesuatu yang kamu suka, nanti beranda ikut menyesuaikan.'));
    },
  };
}

// ---------- halaman lain ----------
function searchPage(params) {
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const date = params.get('date') ?? '';
  document.title = `${q} - Play`;
  const g = grid('grid');
  g.ghost(8);
  const link = (o) => '/search?' + new URLSearchParams(Object.entries({ q, type, date, ...o }).filter(([, v]) => v));
  const chips = h('div', { class: 'chips' },
    ...[['', 'Semua'], ['video', 'Video'], ['channel', 'Channel'], ['playlist', 'Playlist']].map(([v, n]) => chip(link({ type: v, date: v === 'channel' || v === 'playlist' ? '' : date }), n, type === v)),
    type !== 'channel' && type !== 'playlist' && h('select', { class: 'chip', 'aria-label': 'Waktu unggah', onchange: (e) => go(link({ date: e.target.value })) },
      ...[['', 'Kapan saja'], ['today', 'Hari ini'], ['week', 'Minggu ini'], ['month', 'Bulan ini'], ['year', 'Tahun ini']].map(([v, n]) => h('option', { value: v, selected: date === v }, n))));
  return {
    node: [h('header', { class: 'pagehead' }, h('h1', {}, h('button', { type: 'button', 'aria-label': `Ubah pencarian: ${q}`, onclick: () => openFinder(q) }, q))), chips, g.el, g.end],
    spot: g.el,
    async fill(fresh) {
      const r = await api('/search?' + new URLSearchParams({ q, type, date }));
      if (!fresh()) return;
      g.set(r, {}, fresh);
      if (!r.items.length) g.el.replaceChildren(notice('Tidak ketemu', 'Coba kata lain atau ubah filternya.'));
    },
  };
}

function channelPage(id, tab) {
  const top = h('div', { class: 'chan' });
  const g = grid();
  g.ghost(8);
  return {
    node: [top, g.el, g.end],
    spot: g.el,
    async fill(fresh) {
      const c = await api(`/channel/${encodeURIComponent(id)}?tab=${encodeURIComponent(tab)}`);
      if (!fresh()) return;
      document.title = `${c.title} - Play`;
      const names = { videos: 'Video', live: 'Live', playlists: 'Playlist' };
      top.replaceChildren(...[
        ...(c.banner ? [h('div', { class: 'banner' }, h('img', { src: c.banner, alt: '', crossorigin: 'anonymous', referrerpolicy: 'no-referrer' }))] : []),
        pageHead(c.title, c.info.join(' · '), subButton({ id: c.id, title: c.title, avatar: c.avatar })),
        c.description && h('p', { class: 'meta clamp' }, c.description),
        h('div', { class: 'chips' }, ...c.tabs.map((t) => chip(`/channel/${id}${t === 'videos' ? '' : '?tab=' + t}`, names[t], t === tab)))].filter(Boolean));
      g.set(c, {}, fresh);
      if (!c.items.length) g.el.replaceChildren(notice('Belum ada isi di sini'));
    },
  };
}

function playlistPage(id) {
  const top = h('div', {});
  const g = grid();
  g.ghost(8);
  return {
    node: [top, g.el, g.end],
    spot: g.el,
    async fill(fresh) {
      const p = await api('/playlist/' + encodeURIComponent(id ?? ''));
      if (!fresh()) return;
      document.title = `${p.title} - Play`;
      top.replaceChildren(pageHead(p.title, [p.author, p.count].filter(Boolean).join(' · '),
        p.items[0] && h('a', { class: 'btn primary', href: `/watch?v=${p.items[0].id}&list=${id}` }, icon('play'), 'Putar semua')));
      g.set(p, { list: id }, fresh);
    },
  };
}

function subsPage() {
  const g = grid();
  if (!lib.subs.length) return { node: [pageHead('Langganan'), notice('Belum ada langganan', 'Buka channel yang kamu suka lalu tekan Langganan. Video barunya muncul di sini.', h('a', { class: 'btn primary', href: '/search?q=indonesia&type=channel' }, 'Cari channel'))] };
  g.ghost(8);
  return {
    node: [pageHead('Langganan', `Video baru dari ${lib.subs.length} channel`), h('div', { class: 'people' }, lib.subs.map((s) => h('a', { href: '/channel/' + s.id }, avatar(s.avatar), h('span', {}, s.title)))), g.el, g.end],
    spot: g.el,
    async fill(fresh) {
      const r = await api('/feed');
      if (!fresh()) return;
      g.set({ items: r.items }, {}, fresh);
      if (r.failed.length) toast(`Gagal memuat ${r.failed.length} channel`);
    },
  };
}
function savedPage() {
  if (!lib.saved.length) return { node: [pageHead('Simpanan'), notice('Masih kosong', 'Tekan ikon simpan di video mana pun untuk ditonton nanti.')] };
  return { node: [pageHead('Simpanan', `${lib.saved.length} video buat nanti`), h('div', { class: 'grid' }, lib.saved.map((v) => card(v)))] };
}
function historyPage() {
  const empty = () => notice('Belum ada riwayat', 'Video yang kamu tonton tercatat di sini, cuma di PC ini.');
  const list = h('div', {});
  const clear = h('button', { class: 'btn', type: 'button' }, 'Hapus semua');
  let armed;
  clear.addEventListener('click', () => {
    if (!armed) {
      clear.textContent = 'Yakin? Tekan lagi';
      armed = setTimeout(() => {
        armed = null;
        clear.textContent = 'Hapus semua';
      }, 4000);
      return;
    }
    clearTimeout(armed);
    lib.clear();
    list.replaceChildren(empty());
    clear.remove();
  });
  const dayOf = (t) => new Date(t).setHours(0, 0, 0, 0);
  const today = dayOf(Date.now());
  const label = (d) => (d === today ? 'Hari ini' : d === dayOf(today - 432e5) ? 'Kemarin' : new Date(d).toLocaleDateString('id', { weekday: 'long', day: 'numeric', month: 'long' }));
  let last;
  let box;
  for (const v of lib.history.slice(0, 200)) {
    const d = dayOf(v.at ?? 0);
    if (d !== last) {
      last = d;
      box = h('div', { class: 'grid' });
      list.append(h('section', {}, heading(label(d)), box));
    }
    const c = card(v, { onRemove: () => {
      lib.forget(v.id);
      const sec = c.closest('section');
      c.remove();
      if (!sec.querySelector('.card')) sec.remove();
    } });
    box.append(c);
  }
  if (!lib.history.length) return { node: [pageHead('Riwayat'), empty()] };
  return { node: [pageHead('Riwayat', `${lib.history.length} video, cuma tersimpan di PC ini`, clear), list] };
}

// ---------- pengaturan ----------
const nfull = new Intl.NumberFormat('id');
const summary = (c) => `${nfull.format(c.subs)} langganan, ${nfull.format(c.saved)} simpanan, ${nfull.format(c.history)} riwayat`;
const toggle = (key, title, note) => h('label', { class: 'opt' }, h('span', {}, h('strong', {}, title), h('span', { class: 'meta' }, note)),
  h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: pref.get(key, true), onchange: (e) => pref.set(key, e.target.checked) })));
// Tekan dua kali untuk hal yang mengganti data.
function twice(label, sure, run) {
  let armed;
  const b = h('button', { class: 'btn', type: 'button', onclick: async () => {
    if (!armed) {
      b.textContent = sure;
      armed = setTimeout(() => { armed = null; b.textContent = label; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    b.disabled = true;
    await run();
    b.disabled = false;
    b.textContent = label;
  } }, label);
  return b;
}
const UPDATE = 'pip install -U "yt-dlp[default]"';
function copyButton(text, label) {
  return h('button', { class: 'btn', type: 'button', onclick: async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Perintah disalin');
    } catch {
      toast('Gagal menyalin');
    }
  } }, label);
}

// Unduh yt-dlp resmi dari GitHub, diperiksa checksum-nya oleh server.
let fetching = null;
function fetchYtdlp(button, done) {
  fetching ??= (async () => {
    await api('/ytdlp', { method: 'POST' });
    for (;;) {
      await new Promise((r) => setTimeout(r, 700));
      const { job } = await api('/ytdlp');
      if (!job) return null;
      if (job.phase === 'gagal') return job.error;
      for (const b of watchers) b.textContent = job.total ? `Mengunduh ${Math.floor((job.done / job.total) * 100)}%` : 'Mengunduh…';
    }
  })().catch((e) => e.message).finally(() => (fetching = null));
  const label = button?.textContent;
  if (button) {
    button.disabled = true;
    watchers.add(button);
  }
  return fetching.then((err) => {
    watchers.delete(button);
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
    toast(err ? 'yt-dlp gagal dipasang: ' + err : 'yt-dlp siap dipakai');
    if (!err) done?.();
  });
}
const watchers = new Set();

function settingsPage() {
  const ver = h('div', { class: 'opt' }, h('span', { class: 'meta' }, 'Memeriksa versi…'));
  const now = h('span', { class: 'meta' }, summary({ subs: lib.subs.length, saved: lib.saved.length, history: lib.history.length }));
  const list = h('div', {}, h('p', { class: 'meta' }, 'Memuat cadangan…'));
  const reload = async () => {
    await lib.load();
    now.textContent = summary({ subs: lib.subs.length, saved: lib.saved.length, history: lib.history.length });
    await show();
  };
  const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'sr', 'aria-label': 'Pilih file cadangan', onchange: async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const r = await post('/import', await f.text());
      await reload();
      toast(r.subs + r.saved + r.history ? `Ditambahkan: ${summary(r)}` : 'Semua isinya sudah ada');
    } catch (e) {
      toast(e.message);
    }
  } });
  async function show() {
    const all = await api('/backups');
    list.replaceChildren(...(all.length ? all.map((b) => h('div', { class: 'opt' },
      h('span', {}, h('strong', {}, new Date(b.at).toLocaleString('id', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })), h('span', { class: 'meta' }, summary(b))),
      twice('Pulihkan', 'Yakin? Tekan lagi', async () => {
        try {
          await post('/restore', JSON.stringify({ name: b.name }));
          await reload();
          toast('Data dipulihkan');
        } catch (e) {
          toast(e.message);
        }
      }))) : [h('p', { class: 'meta' }, 'Cadangan pertama dibuat begitu datamu berubah.')]));
  }
  return {
    node: [pageHead('Pengaturan'), h('div', { class: 'opts' },
      h('section', {}, h('h2', {}, 'Pemutaran'),
        toggle('siap', 'Siapkan video lebih dulu', 'Video yang disentuh mouse diproses diam-diam supaya langsung main. Menambah permintaan ke YouTube.'),
        toggle('cuplikan', 'Cuplikan di beranda', 'Sorotan memutar potongan videonya tanpa suara. Matikan untuk hemat kuota.'),
        toggle('suasana', 'Cahaya suasana', 'Cahaya lembut di sekitar pemutar mengikuti adegan.')),
      h('section', {}, h('h2', {}, 'Data'),
        h('div', { class: 'opt' }, h('span', {}, h('strong', {}, 'Data kamu'), now),
          h('span', { class: 'row' }, h('a', { class: 'btn', href: '/api/export', download: true }, 'Ekspor'), h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Impor'), file)),
        h('h3', {}, 'Cadangan otomatis'), h('p', { class: 'meta' }, 'Satu salinan per hari ditambah sebelum impor atau pulihkan. 14 terakhir disimpan di folder data/cadangan.'), list),
      h('section', {}, h('h2', {}, 'yt-dlp'), ver))],
    async fill(fresh) {
      show().catch((e) => list.replaceChildren(h('p', { class: 'meta' }, e.message)));
      const v = await api('/version');
      if (!fresh()) return;
      const own = v.owned || (!v.have && !v.job);
      const get = h('button', { class: 'btn', type: 'button', onclick: () => fetchYtdlp(get, () => fresh() && route()) }, v.have ? 'Perbarui' : 'Pasang (23 MB)');
      if (v.job?.phase === 'unduh') fetchYtdlp(get, () => fresh() && route());
      ver.replaceChildren(h('span', {}, h('strong', {}, v.have ? 'Versi ' + v.have : 'Belum terpasang'),
        h('span', { class: 'meta' }, !v.have ? 'Video tidak bisa diputar tanpa yt-dlp.' : v.outdated ? `Versi ${v.latest} sudah ada. Versi lama bisa membuat video gagal diputar.` : v.latest ? 'Sudah yang terbaru.' : 'Versi terbaru belum bisa diperiksa.')),
        ...(v.outdated || !v.have ? [own || v.job ? get : copyButton(UPDATE, 'Salin perintah update')] : []));
    },
  };
}

// ---------- halaman tonton ----------
async function nextFor(id, listId) {
  const data = await api('/video/' + id);
  let queue = null;
  if (listId) {
    queue = await api('/playlist/' + encodeURIComponent(listId)).catch(() => null);
    const i = queue?.items.findIndex((x) => x.id === id) ?? -1;
    if (queue && player.id === id) player.next = queue.items[i + 1] ?? null;
  } else if (player.id === id) player.next = data.related.find((r) => !r.live && !lib.seen(r.id)) ?? data.related[0] ?? null;
  return { data, queue };
}

function watchPage(id, params) {
  if (!VID.test(id ?? '')) return { node: notice('Link video tidak benar', null, h('a', { class: 'btn primary', href: '/' }, 'Ke beranda')) };
  const listId = params.get('list');
  const at = parseInt(params.get('t') ?? '', 10) || undefined;
  const glow = h('canvas', { class: 'glow', width: 32, height: 18, 'aria-hidden': 'true' });
  const slot = h('div', { class: 'slot' }, glow);
  const info = h('div', { class: 'info' }, h('span', { class: 'ghostline' }), h('span', { class: 'ghostline short' }));
  const side = h('aside', { class: 'side', 'aria-label': 'Video lainnya' });
  const talk = h('section', { class: 'talk', 'aria-label': 'Komentar' });
  return {
    flush: true,
    node: h('div', { class: 'watch' }, slot, h('div', { class: 'main' }, info, talk), side),
    spot: info,
    enter() {
      dock.classList.remove('on');
      player.dock(false);
      place(slot);
      player.list = listId;
      const g = glow.getContext('2d');
      const lit = () => glow.classList.toggle('on', pref.get('suasana', true));
      player.onglow = lit;
      lit();
      loadImage(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`).then((im) => player.video.currentTime || g.drawImage(im, 0, im.height * 0.125, im.width, im.height * 0.75, 0, 0, 32, 18), () => {});
      const tick = setInterval(() => {
        const v = player.video;
        if (v.paused || v.readyState < 2 || document.hidden || !pref.get('suasana', true)) return;
        g.globalAlpha = calm.matches ? 0.02 : 0.1;
        g.drawImage(v, 0, 0, 32, 18);
      }, 160);
      cleanup.push(() => {
        clearInterval(tick);
        player.onglow = player.onready = () => {};
      });
      if (player.id !== id) player.load(id, { at });
      else if (at) player.seek(at);
    },
    async fill(fresh) {
      const { data, queue } = await nextFor(id, listId);
      if (!fresh()) return;
      document.title = `${data.title} - Play`;
      const v = { type: 'video', id, title: data.title, author: data.author, channelId: data.channelId, avatar: data.avatar, duration: '', live: false, info: [data.views, data.published].filter(Boolean), thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
      if (player.id === id) player.setMeta(v);
      info.replaceChildren(...about(data, v));
      const chapters = () => {
        if (!fresh() || player.id !== id || player.chapters.length < 2 || info.querySelector('.chapters')) return;
        const row = h('div', { class: 'chapters', role: 'group', 'aria-label': 'Bab' }, player.chapters.map((c) => {
          const pic = h('span', { class: 'pic' });
          const b = h('button', { type: 'button', onclick: () => player.seek(c.start) }, pic, h('span', { class: 'meta' }, time(c.start)), h('span', { class: 'ct' }, c.title));
          if (!player.frame(pic, c.start + 8, 176)) pic.remove();
          return b;
        }));
        drag(row);
        info.querySelector('.owner').after(row);
      };
      player.onready = chapters;
      chapters();
      const auto = h('input', { type: 'checkbox', checked: pref.get('autoplay', true), onchange: (e) => pref.set('autoplay', e.target.checked) });
      side.replaceChildren(
        ...(queue ? [h('section', { class: 'queue' }, h('h2', {}, h('a', { href: '/playlist?list=' + listId }, queue.title)),
          h('div', { class: 'list' }, queue.items.map((x) => {
            const c = card(x, { list: listId });
            if (x.id === id) {
              c.classList.add('now');
              c.querySelector('.thumb').append(h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')));
            }
            return c;
          })))] : []),
        h('div', { class: 'sidehead' }, h('h2', {}, 'Selanjutnya'), h('label', { class: 'switch' }, auto, h('span', {}, 'Putar otomatis'))),
        h('div', { class: 'list' }, data.related.map((r) => card(r))));
      const box = side.querySelector('.queue .list');
      const cur = side.querySelector('.now');
      if (box && cur) box.scrollTop = cur.offsetTop - box.offsetTop - 12;
      loadTalk(talk, id, fresh);
    },
  };
}

const nf = new Intl.NumberFormat('id', { notation: 'compact', maximumFractionDigits: 1 });
function about(d, v) {
  const desc = h('div', { class: 'desc' }, ...rich(d.description));
  const box = h('div', { class: 'descbox' }, desc);
  if (d.description.length > 220 || d.description.split('\n').length > 3) {
    desc.classList.add('short');
    const b = h('button', { class: 'linkbtn', type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = !desc.classList.toggle('short');
      b.textContent = open ? 'Tutup' : 'Selengkapnya';
      b.setAttribute('aria-expanded', open);
    } }, 'Selengkapnya');
    box.append(b);
  }
  const copy = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try {
      await navigator.clipboard.writeText('https://youtu.be/' + d.id);
      toast('Link disalin');
    } catch {
      toast('Link gagal disalin');
    }
  } }, icon('share'), 'Salin link');
  return [
    h('h1', {}, d.title),
    h('p', { class: 'meta facts' }, [d.views, d.published, d.likes ? nf.format(d.likes) + ' suka' : ''].filter(Boolean).join(' · ')),
    h('div', { class: 'owner' },
      h('a', { class: 'who', href: '/channel/' + d.channelId }, avatar(d.avatar), h('span', {}, h('strong', {}, d.author), h('span', { class: 'meta' }, d.subscribers))),
      subButton({ id: d.channelId, title: d.author, avatar: d.avatar }), h('span', { class: 'grow' }), saveButton(v, true), copy),
    d.description ? box : null,
  ].filter(Boolean);
}

// Deskripsi dan komentar: link dan timestamp jadi bisa diklik.
function rich(text) {
  return text.split(/(https?:\/\/[^\s<>"]+|\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g).map((part) => {
    if (/^https?:\/\//.test(part)) {
      const inside = fromLink(part);
      return h('a', inside ? { href: inside } : { href: part, target: '_blank', rel: 'noreferrer' }, part);
    }
    if (/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(part)) {
      const s = part.split(':').reduce((a, b) => a * 60 + Number(b), 0);
      return h('a', { href: `/watch?v=${player.id}&t=${s}`, 'data-t': s }, part);
    }
    return part;
  });
}

function loadTalk(talk, id, fresh) {
  const list = h('div', { class: 'comments' });
  const end = h('div', { class: 'end' });
  const title = h('h2', {}, 'Komentar');
  talk.replaceChildren(title, list, end);
  const load = async (path) => {
    io.disconnect();
    end.replaceChildren(h('span', { class: 'spin inline', role: 'status', 'aria-label': 'Memuat komentar' }));
    try {
      const r = await api(path);
      if (!fresh()) return;
      if (r.count) title.textContent = r.count;
      if (r.off) return end.replaceChildren(h('p', { class: 'meta' }, 'Komentar dimatikan untuk video ini.'));
      list.append(...r.items.map((c) => h('article', { class: 'comment' }, avatar(c.avatar),
        h('div', {}, h('p', { class: 'meta' }, h('a', { class: 'strong', href: c.channelId ? '/channel/' + c.channelId : null }, c.author), ' ', c.when, c.pinned && ' · disematkan'),
          h('p', { class: 'said' }, ...rich(c.text)), c.likes && h('p', { class: 'meta' }, c.likes + ' suka')))));
      end.replaceChildren(...(r.next ? [h('button', { class: 'btn', type: 'button', onclick: () => load('/more/' + r.next) }, 'Komentar lainnya')] : []));
    } catch {
      if (fresh()) end.replaceChildren(h('p', { class: 'meta' }, 'Komentar tidak tersedia untuk video ini.'));
    }
  };
  const io = new IntersectionObserver((x) => x[0].isIntersecting && load('/comments/' + id), { rootMargin: '300px' });
  io.observe(end);
}

// ---------- kerangka ----------
const NAV = [['/', 'home', 'Beranda'], ['/subs', 'subs', 'Langganan'], ['/saved', 'saved', 'Simpanan'], ['/history', 'history', 'Riwayat']];
const links = NAV.map(([href, ic, name]) => h('a', { href }, icon(ic), h('span', {}, name)));
$('.links').append(...links);
function paintLinks(at) {
  for (const a of links) {
    if (a.getAttribute('href') === at) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
const gear = h('a', { class: 'icon-btn gear', href: '/pengaturan', 'aria-label': 'Pengaturan' }, icon('gear'));
$('.top').append(gear);
// Beri tahu kalau yt-dlp ketinggalan, paling sering sekali sehari per versi.
setTimeout(async () => {
  const v = await api('/version').catch(() => null);
  if (!v || !(v.outdated || !v.have)) return;
  // Baru dipasang lewat installer: siapkan sendiri.
  if (v.auto) {
    toast('Menyiapkan yt-dlp, sekitar 23 MB');
    return fetchYtdlp(null);
  }
  gear.classList.add('dot');
  gear.setAttribute('aria-label', 'Pengaturan, yt-dlp perlu diperbarui');
  const key = `${v.latest}@${new Date().toDateString()}`;
  if (pref.get('ingat-versi', '') === key) return;
  pref.set('ingat-versi', key);
  toast(v.have ? 'yt-dlp versi baru tersedia. Lihat Pengaturan.' : 'yt-dlp belum terpasang. Lihat Pengaturan.');
}, 2500);
addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 30), { passive: true });

// ---------- pencarian ----------
const finder = $('#finder');
const input = $('#q');
const box = $('#suggest');
let sel = -1;
let typing;
let ask = 0;
$('.find').prepend(icon('search'));
$('.find').addEventListener('click', () => openFinder());
$('#unfind').append(icon('close'));
$('#unfind').addEventListener('click', () => finder.close());
finder.addEventListener('click', (e) => e.target === finder && finder.close());
finder.addEventListener('close', () => {
  ask++;
  clearTimeout(typing);
});
function openFinder(text = '') {
  if (finder.open) return;
  input.value = text;
  box.replaceChildren();
  sel = -1;
  input.setAttribute('aria-expanded', 'false');
  finder.showModal();
  input.focus();
  input.select();
  if (text) suggest();
}
function closeFinder() {
  if (finder.open) finder.close();
}
function submit(text) {
  text = text.trim();
  if (!text) return;
  closeFinder();
  go(fromLink(text) || '/search?q=' + encodeURIComponent(text));
}
finder.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  submit(input.value);
});
async function suggest() {
  const text = input.value.trim();
  const my = ++ask;
  const list = text && !fromLink(text) ? await api('/suggest?q=' + encodeURIComponent(text)).catch(() => []) : [];
  if (my !== ask) return;
  sel = -1;
  input.removeAttribute('aria-activedescendant');
  box.replaceChildren(...list.slice(0, 7).map((s, i) => h('li', { id: 's' + i, role: 'option', 'aria-selected': 'false', style: { '--i': i }, onclick: () => submit(s) }, s)));
  input.setAttribute('aria-expanded', list.length > 0);
}
input.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(suggest, 150);
});
input.addEventListener('keydown', (e) => {
  const items = [...box.children];
  if (!items.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  e.preventDefault();
  sel = e.key === 'ArrowDown' ? (sel + 1) % items.length : (sel <= 0 ? items.length : sel) - 1;
  items.forEach((li, i) => li.setAttribute('aria-selected', i === sel));
  input.value = items[sel].textContent;
  input.setAttribute('aria-activedescendant', 's' + sel);
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || finder.open) return;
  const t = e.target;
  if (t.matches('input:not([type=range]):not([type=checkbox]), textarea, select')) return;
  if (e.key === '/') {
    e.preventDefault();
    return openFinder();
  }
  if ((e.key === ' ' || e.key === 'Enter') && t.closest('button, a, label, input')) return;
  if (player.key(e)) e.preventDefault();
});

// ---------- mulai ----------
intro();
try {
  await lib.load();
} catch (e) {
  toast(e.message);
}
route();
