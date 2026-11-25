// Bagian Express yang dipakai server/index.js. Permintaan datang dari Java, file statis juga dilayani Java.
const compile = (p) => {
  if (p === '/{*path}') return { re: /^/, names: [] };
  const names = [];
  const src = p.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+?)'));
  return { re: new RegExp(`^${src}/?$`), names };
};

class Res {
  #id;
  headers = {};
  code = 200;
  headersSent = false;
  constructor(id) { this.#id = id; }
  #finish(body, handle = -1) {
    if (this.headersSent) return;
    this.headersSent = true;
    Native.reply(this.#id, this.code, JSON.stringify(this.headers), body ?? '', handle);
  }
  on() { return this; }
  status(n) { this.code = n; return this; }
  setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); return this; }
  type(t) { return this.setHeader('content-type', /^text\/|json/.test(t) ? t + '; charset=utf-8' : t); }
  attachment(name) { return this.setHeader('content-disposition', `attachment; filename="${name}"`); }
  json(v) { return this.type('application/json').send(JSON.stringify(v)); }
  send(s) {
    if (!this.headers['content-type']) this.type('text/html');
    this.#finish(String(s));
    return this;
  }
  sendFile() { this.status(404).end(); }
  end() { this.#finish(''); }
  splice(handle) { this.#finish('', handle); }
  destroy() { this.status(502).#finish(''); }
}

export default function express() {
  const layers = [];
  const route = (method) => (path, ...fns) => void layers.push({ method, ...compile(path), fns });
  async function run(r) {
    const u = new URL(r.url, location.origin);
    const req = { method: r.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: r.headers, raw: r.body, params: {} };
    const res = new Res(r.id);
    let error = null;
    for (const l of layers) {
      if (res.headersSent) return;
      let m = [''];
      if (l.method) {
        if (l.method !== r.method || !(m = req.path.match(l.re))) continue;
        req.params = Object.fromEntries(l.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      } else if (l.prefix && !req.path.startsWith(l.prefix)) continue;
      for (const fn of l.fns) {
        if (!!error !== (fn.length === 4)) continue;
        let passed = false;
        const next = (e) => {
          passed = true;
          if (e) error = e;
        };
        try {
          await (error ? fn(error, req, res, next) : fn(req, res, next));
        } catch (e) {
          error = e;
          break;
        }
        if (!passed) {
          if (!res.headersSent) res.end();
          return;
        }
        if (error) break;
      }
    }
    if (!res.headersSent) res.status(error ? 500 : 404).end();
  }
  return {
    disable() {},
    use(...a) {
      const prefix = typeof a[0] === 'string' ? a.shift() : '';
      layers.push({ prefix, fns: a });
    },
    get: route('GET'),
    post: route('POST'),
    listen(port, host, cb) {
      globalThis.__play = run;
      cb?.();
      Native.ready();
    },
  };
}
const units = { kb: 1024, mb: 1024 ** 2 };
express.json = ({ limit = '100kb' } = {}) => {
  const [, n, u] = limit.match(/^(\d+)(\w+)$/);
  return (req, res, next) => {
    if (req.raw.length > n * units[u]) return next(Object.assign(new Error('large'), { type: 'entity.too.large' }));
    try {
      req.body = JSON.parse(req.raw);
    } catch {
      return next(Object.assign(new Error('parse'), { type: 'entity.parse.failed' }));
    }
    next();
  };
};
express.static = () => (req, res, next) => next();
