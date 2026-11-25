// Yang disediakan Node dan dipakai server: process, Buffer, dan fetch tanpa batasan CORS.
globalThis.process = { env: { PORT: location.port, PLAY_LIBRARY: '/library.json' }, platform: 'android', execPath: '', on() {}, exit() {} };

const b64 = (s) => s.replace(/-/g, '+').replace(/_/g, '/');
class Buf {
  constructor(bytes) { this.bytes = bytes; }
  toString(enc) {
    if (enc !== 'base64url') return new TextDecoder().decode(this.bytes);
    let s = '';
    for (const b of this.bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
globalThis.Buffer = {
  from(v, enc) {
    if (typeof v !== 'string') return new Buf(new Uint8Array(v));
    if (enc === 'base64url') return new Buf(Uint8Array.from(atob(b64(v)), (c) => c.charCodeAt(0)));
    return new Buf(new TextEncoder().encode(v));
  },
};

// Media diteruskan Java langsung ke pemutar (res.splice), tanpa lewat JavaScript.
const direct = globalThis.fetch.bind(globalThis);
const isMedia = (u) => u.hostname.endsWith('.googlevideo.com');
class MediaResponse {
  constructor(j) {
    this.status = j.status;
    this.ok = j.status >= 200 && j.status < 300;
    this.url = j.url;
    this.headers = new Headers(j.headers);
    this.handle = j.handle;
    this.body = { handle: j.handle, cancel: async () => void (await direct('/__close/' + j.handle)) };
  }
  text() { return direct('/__body/' + this.handle).then((r) => r.text()); }
  arrayBuffer() { return direct('/__body/' + this.handle).then((r) => r.arrayBuffer()); }
}
globalThis.fetch = async (input, init = {}) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : input, location.href);
  if (url.origin === location.origin) return direct(input, init);
  const headers = Object.fromEntries(new Headers(init.headers ?? req?.headers ?? {}));
  const method = (init.method ?? req?.method ?? 'GET').toUpperCase();
  let body = init.body ?? null;
  if (body === null && req && method !== 'GET' && method !== 'HEAD') body = await req.arrayBuffer();
  if (method === 'POST' && url.hostname.endsWith('youtube.com')) headers.origin ??= 'https://www.youtube.com';
  const r = await direct('/__fetch', {
    method: 'POST',
    body: body ?? undefined,
    signal: init.signal ?? undefined,
    headers: {
      'content-type': 'application/octet-stream',
      'x-play-method': method,
      'x-play-url': url.href,
      'x-play-headers': encodeURIComponent(JSON.stringify(headers)),
      ...(isMedia(url) && { 'x-play-defer': '1' }),
    },
  });
  if (r.headers.get('x-play-error')) throw new TypeError('fetch failed');
  if (isMedia(url)) return new MediaResponse(await r.json());
  Object.defineProperty(r, 'url', { value: url.href });
  return r;
};
