// Dimuat sebelum server di aplikasi Mac. macOS tidak punya job object seperti Windows, jadi
// pipa stdin dari Play dipakai sebagai tali: begitu Play mati (walaupun crash) pipanya putus,
// lalu server dan yt-dlp yang sedang jalan ikut berhenti.
const stop = () => {
  try {
    process.kill(-process.pid, 'SIGKILL'); // satu grup proses, termasuk yt-dlp
  } catch {}
  process.exit(0);
};
for (const e of ['end', 'close', 'error']) process.stdin.on(e, stop);
process.stdin.resume();
