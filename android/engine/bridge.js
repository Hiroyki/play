// Jembatan halaman ke aplikasi Android. Dimuat sebelum app.js.
(() => {
  // Di Android selalu dianggap layar sentuh, walaupun head unit mengaku punya mouse (lihat MainActivity).
  document.documentElement.classList.add('touch');
  // WebView tidak punya Media Session; cukup untuk mencatat judul yang sedang diputar.
  if (!navigator.mediaSession) {
    window.MediaMetadata = class { constructor(m) { Object.assign(this, m); } };
    Object.defineProperty(navigator, 'mediaSession', { value: { metadata: null, setActionHandler() {} } });
  }
  const video = () => document.querySelector('.player video');
  let last = '';
  const tell = (force) => {
    const v = video();
    const m = navigator.mediaSession.metadata;
    const s = {
      on: !!(v && v.readyState > 0), playing: !!(v && !v.paused && !v.ended), next: !!window.playHasNext?.(), live: v?.duration === Infinity || !!document.querySelector('.player.live'),
      title: m?.title ?? '', author: m?.artist ?? '', thumb: m?.artwork?.[0]?.src ?? '', width: v?.videoWidth || 0, height: v?.videoHeight || 0,
      speed: v?.playbackRate ?? 1, duration: Number.isFinite(v?.duration) ? v.duration : 0,
    };
    const k = JSON.stringify(s);
    if (k === last && force !== true) return;
    last = k;
    PlayAndroid.state(JSON.stringify({ ...s, position: v?.currentTime ?? 0 }));
  };
  for (const e of ['play', 'pause', 'ended', 'emptied', 'loadeddata', 'durationchange', 'ratechange', 'resize']) document.addEventListener(e, () => tell(), true);
  for (const e of ['seeked', 'playing']) document.addEventListener(e, (x) => x.target === video() && tell(true), true);
  setInterval(tell, 2000);

  HTMLVideoElement.prototype.requestPictureInPicture = async function () {
    const p = this.closest('.player');
    if (!document.fullscreenElement && p) await p.requestFullscreen();
    PlayAndroid.pip();
  };
  window.playCommand = (name, x) => {
    const v = video();
    if (!v) return;
    if (name === 'play') v.play().catch(() => {});
    if (name === 'pause') v.pause();
    if (name === 'next') window.playNext?.();
    if (name === 'seek') v.currentTime = x;
    if (name === 'skip') v.currentTime = Math.max(0, v.currentTime + x);
    if (name === 'save') dispatchEvent(new Event('pagehide'));
  };
})();
