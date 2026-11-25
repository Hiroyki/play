// Langganan, riwayat, dan simpanan. Semua disimpan di data/library.json di PC ini.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.PLAY_LIBRARY || fileURLToPath(new URL('../data/library.json', import.meta.url));
// Pengenal data ini, supaya aplikasi Windows tidak memakai server milik data lain.
export const id = createHash('sha256').update(resolve(FILE).toLowerCase()).digest('hex').slice(0, 16);
const empty = () => ({ subs: [], history: [], saved: [] });
let loading;
export const load = () => (loading ??= read());

async function read() {
  let raw;
  try {
    raw = await readFile(FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return empty();
    loading = undefined;
    throw e;
  }
  try {
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    await rename(FILE, `${FILE}.rusak-${Date.now()}`); // jangan timpa data yang rusak
    return empty();
  }
}

// ---------- cadangan ----------
// Satu salinan per hari sebelum perubahan pertama hari itu, disimpan 14 hari terakhir.
const DIR = join(dirname(FILE), 'cadangan');
const KEEP = 14;
const NAME = /^library-[\d-]{10}(?:-\d{9})?\.json$/;
const DAILY = /^library-[\d-]{10}\.json$/;
const pad = (n, l = 2) => String(n).padStart(l, '0');
const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const names = async () => (await readdir(DIR).catch(() => [])).filter((n) => NAME.test(n)).sort().reverse();
let lastDay = '';
async function backup(extra = false) {
  const d = new Date();
  if (!extra && lastDay === day(d)) return;
  if (!(await stat(FILE).catch(() => null))) return; // belum ada data sama sekali
  const tail = extra ? `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}` : '';
  const to = join(DIR, `library-${day(d)}${tail}.json`);
  await mkdir(DIR, { recursive: true });
  if (extra || !(await stat(to).catch(() => null))) await copyFile(FILE, to);
  if (!extra) lastDay = day(d);
  // Harian dan sebelum impor/pulihkan dihitung terpisah, jadi tidak saling menyingkirkan.
  const all = await names();
  for (const group of [all.filter((n) => DAILY.test(n)), all.filter((n) => !DAILY.test(n))])
    for (const old of group.slice(KEEP)) await unlink(join(DIR, old));
}
export async function backups() {
  return Promise.all((await names()).map(async (name) => {
    const [info, raw] = await Promise.all([stat(join(DIR, name)), readFile(join(DIR, name), 'utf8')]);
    let lib = empty();
    try {
      lib = clean(JSON.parse(raw));
    } catch {}
    return { name, at: info.mtimeMs, subs: lib.subs.length, saved: lib.saved.length, history: lib.history.length };
  }));
}

let writing = Promise.resolve();
function save(lib) {
  const json = JSON.stringify(lib);
  writing = writing
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(FILE), { recursive: true });
      await backup().catch((e) => console.error('Cadangan gagal:', e.message));
      await writeFile(FILE + '.tmp', json);
      await rename(FILE + '.tmp', FILE);
    });
  return writing;
}

const VID = /^[\w-]{11}$/;
const UC = /^UC[\w-]{22}$/;
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
const url = (v) => (typeof v === 'string' && v.startsWith('https://') ? v.slice(0, 600) : '');
const num = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const vid = (v) => ({
  type: 'video',
  id: v.id,
  title: str(v.title),
  author: str(v.author),
  channelId: UC.test(v.channelId) ? v.channelId : '',
  avatar: url(v.avatar),
  duration: str(v.duration, 12),
  live: !!v.live,
  info: Array.isArray(v.info) ? v.info.slice(0, 3).map((s) => str(s, 60)) : [],
  thumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
});
const without = (list, id) => list.filter((x) => x.id !== id);

const ops = {
  subscribe(lib, { channel: c }) {
    if (!UC.test(c?.id)) return false;
    lib.subs = [...without(lib.subs, c.id), { id: c.id, title: str(c.title), avatar: url(c.avatar) }];
  },
  unsubscribe(lib, { id }) {
    lib.subs = without(lib.subs, id);
  },
  save(lib, { video: v }) {
    if (!VID.test(v?.id)) return false;
    lib.saved = [vid(v), ...without(lib.saved, v.id)].slice(0, 2000);
  },
  unsave(lib, { id }) {
    lib.saved = without(lib.saved, id);
  },
  watched(lib, { video: v, position, length }) {
    if (!VID.test(v?.id)) return false;
    lib.history = [{ ...vid(v), position: num(position), length: num(length), at: Date.now() }, ...without(lib.history, v.id)].slice(0, 2000);
  },
  forget(lib, { id }) {
    lib.history = without(lib.history, id);
  },
  clearHistory(lib) {
    lib.history = [];
  },
};

export async function apply(body) {
  const lib = await load();
  const op = Object.hasOwn(ops, body?.op) ? ops[body.op] : null;
  if (!op || op(lib, body) === false) throw Object.assign(new Error('Perintah tidak dikenal.'), { status: 400 });
  await save(lib);
}

// ---------- ekspor, impor, pulihkan ----------
// Isi file dari luar diperiksa ulang satu per satu sebelum dipakai.
function clean(x) {
  if (!x || typeof x !== 'object' || ![x.subs, x.saved, x.history].some(Array.isArray)) throw Object.assign(new Error('Ini bukan file cadangan Play.'), { status: 400 });
  const list = (v, re, map) => {
    const seen = new Set();
    return (Array.isArray(v) ? v : []).filter((i) => re.test(i?.id) && !seen.has(i.id) && seen.add(i.id)).map(map).slice(0, 2000);
  };
  return {
    subs: list(x.subs, UC, (c) => ({ id: c.id, title: str(c.title), avatar: url(c.avatar) })),
    saved: list(x.saved, VID, vid),
    history: list(x.history, VID, (v) => ({ ...vid(v), position: num(v.position), length: num(v.length), at: num(v.at) })).sort((a, b) => b.at - a.at),
  };
}
const count = (l) => ({ subs: l.subs.length, saved: l.saved.length, history: l.history.length });

// Impor menggabungkan; data yang sudah ada tidak hilang.
export async function merge(body) {
  const add = clean(body);
  const lib = await load();
  await writing.catch(() => {});
  await backup(true);
  const before = count(lib);
  for (const k of ['subs', 'saved']) lib[k] = [...lib[k], ...add[k].filter((i) => !lib[k].some((o) => o.id === i.id))].slice(0, 2000);
  const newest = new Map();
  for (const v of [...lib.history, ...add.history]) if (!(newest.get(v.id)?.at >= v.at)) newest.set(v.id, v);
  lib.history = [...newest.values()].sort((a, b) => b.at - a.at).slice(0, 2000);
  await save(lib);
  const after = count(lib);
  return { subs: after.subs - before.subs, saved: after.saved - before.saved, history: after.history - before.history };
}

export async function restore(name) {
  if (!NAME.test(name)) throw Object.assign(new Error('Cadangan tidak ditemukan.'), { status: 404 });
  let old;
  try {
    old = clean(JSON.parse(await readFile(join(DIR, name), 'utf8')));
  } catch (e) {
    throw Object.assign(new Error('Cadangan tidak bisa dibaca.'), { status: 404 });
  }
  const lib = await load();
  await writing.catch(() => {});
  await backup(true); // keadaan sekarang tetap bisa dikembalikan
  Object.assign(lib, old);
  await save(lib);
  return count(lib);
}
