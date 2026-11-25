import { extract } from '../extract.js';
// stream.js hanya memanggil yt-dlp untuk satu video; alamatnya selalu argumen terakhir.
export function execFile(cmd, args, opts, cb) {
  const id = new URL(args.at(-1)).searchParams.get('v');
  extract(id).then((d) => cb(null, JSON.stringify(d), ''), (e) => cb(e, '', 'ERROR: ' + (e?.message ?? e)));
}
