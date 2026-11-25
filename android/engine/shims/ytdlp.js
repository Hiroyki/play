// Di Android tidak ada yt-dlp yang perlu dipasang; lihat extract.js.
export const command = () => '';
export const runtimeArgs = [];
export const ready = async () => {};
export const progress = () => ({ job: null, have: true });
export const install = () => ({ job: null });
export const version = async () => ({ have: 'youtubei.js ' + YOUTUBEI_VERSION, latest: null, outdated: false, owned: true, auto: false, job: null, builtin: true });
