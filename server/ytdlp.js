// Mencari, memasang, dan memperbarui yt-dlp.
// Urutan: variabel YTDLP, salinan milik Play (folder bin), lalu yang ada di PATH.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = process.env.PLAY_BIN || fileURLToPath(new URL('../data/bin', import.meta.url));
const OWN = join(BIN, 'yt-dlp.exe');
const BASE = process.env.PLAY_YTDLP_URL || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const NAME = 'yt-dlp.exe';

export const command = () => process.env.YTDLP || (existsSync(OWN) ? OWN : 'yt-dlp');
const owned = () => !process.env.YTDLP && existsSync(OWN);
// Node yang menjalankan Play juga dipakai yt-dlp untuk memecahkan tantangan YouTube.
export const runtimeArgs = ['--js-runtimes', 'node:' + process.execPath];

const run = (args, timeout = 20_000) =>
  new Promise((ok) => execFile(command(), args, { timeout, windowsHide: true }, (e, out) => ok(e ? null : out.trim())));

// ---------- versi ----------
let latest = { at: 0, v: null };
async function newest() {
  if (Date.now() - latest.at < 12 * 3600e3) return latest.v;
  try {
    const r = await fetch('https://pypi.org/rss/project/yt-dlp/releases.xml', { signal: AbortSignal.timeout(8000) });
    const all = [...(await r.text()).matchAll(/<title>(\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?)<\/title>/g)].map((m) => m[1]);
    latest = { at: Date.now(), v: all[0] ?? null };
  } catch {
    latest = { at: Date.now() - 11 * 3600e3, v: latest.v }; // coba lagi sejam kemudian
  }
  return latest.v;
}
function older(a, b) {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}
export async function version() {
  const [have, want] = await Promise.all([run(['--ignore-config', '--version']), newest()]);
  return {
    have,
    latest: want,
    outdated: !!(have && want && /^[\d.]+$/.test(have) && older(have, want)),
    owned: owned(),
    // Versi terpasang lewat installer memasang yt-dlp sendiri kalau belum ada.
    auto: !have && !!process.env.PLAY_INSTALLED,
    job,
  };
}

// ---------- pasang dan perbarui ----------
let job = null; // { phase, done, total, error }
let working = null;
const get = async (file, ms) => {
  const r = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('GitHub menjawab ' + r.status);
  return r;
};

async function download() {
  await mkdir(BIN, { recursive: true });
  const sums = await (await get('SHA2-256SUMS', 20_000)).text();
  const want = sums.match(/^([0-9a-f]{64})\s+\*?yt-dlp\.exe\s*$/im)?.[1]?.toLowerCase();
  if (!want) throw new Error('Daftar checksum tidak memuat ' + NAME);
  const r = await get(NAME, 15 * 60_000);
  job.total = Number(r.headers.get('content-length')) || 0;
  const tmp = OWN + '.unduh';
  const hash = createHash('sha256');
  const file = await open(tmp, 'w');
  try {
    for await (const chunk of r.body) {
      hash.update(chunk);
      await file.write(chunk);
      job.done += chunk.length;
    }
  } finally {
    await file.close();
  }
  if (hash.digest('hex') !== want) {
    await rm(tmp, { force: true });
    throw new Error('File yang diunduh tidak cocok dengan checksum resminya, jadi dibuang.');
  }
  await rename(tmp, OWN);
}

// Aman dipanggil berkali-kali; yang sedang berjalan dipakai bersama.
export function install() {
  working ??= (async () => {
    job = { phase: 'unduh', done: 0, total: 0, error: null };
    try {
      await download();
      job = null;
    } catch (e) {
      console.error('yt-dlp:', e.message);
      job = { phase: 'gagal', done: 0, total: 0, error: e.name === 'TimeoutError' || e.message === 'fetch failed' ? 'Tidak bisa terhubung ke GitHub.' : e.message };
    } finally {
      working = null;
    }
  })();
  return { job };
}
export const progress = () => ({ job, have: existsSync(OWN) });
