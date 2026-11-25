// node bundle.mjs <esbuild> <keluaran>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { build } = createRequire(pathToFileURL(process.argv[2] + '/'))('esbuild');
const shim = { express: 'express', 'node:child_process': 'child_process', 'node:fs/promises': 'fs', 'node:path': 'path', 'node:crypto': 'crypto', 'node:url': 'url', 'node:stream': 'stream', 'node:stream/promises': 'stream' };
await build({
  entryPoints: [here('main.js')],
  outfile: process.argv[3],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome110',
  legalComments: 'none',
  logLevel: 'warning',
  define: {
    'import.meta.url': '"http://play/server/index.js"',
    YOUTUBEI_VERSION: JSON.stringify(JSON.parse(readFileSync(here('../../node_modules/youtubei.js/package.json'), 'utf8')).version),
  },
  plugins: [{
    name: 'shims',
    setup(b) {
      b.onResolve({ filter: /^(express|node:.*)$/ }, (a) => (shim[a.path] ? { path: here(`shims/${shim[a.path]}.js`) } : { errors: [{ text: 'Belum ada tiruan untuk ' + a.path }] }));
      b.onResolve({ filter: /^\.\/ytdlp\.js$/ }, () => ({ path: here('shims/ytdlp.js') }));
      b.onResolve({ filter: /^youtubei\.js$/ }, () => ({ path: here('../../node_modules/youtubei.js/dist/src/platform/web.js') }));
    },
  }],
});
