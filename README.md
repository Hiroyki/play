# Play

Play adalah aplikasi Windows untuk menonton video YouTube tanpa iklan, untuk pemakaian pribadi di satu PC. Jendelanya WinForms dengan WebView2; datanya diambil oleh server Node lokal yang hanya menerima permintaan dari PC itu sendiri.

Mengambil stream langsung seperti ini melanggar ketentuan layanan YouTube. Jangan hosting Play secara publik.

## Memasang

Jalankan `Play-Setup-<versi>.exe`. Pemasang tidak meminta hak admin dan menaruh program di `%LOCALAPPDATA%\Programs\Play`.

- Windows 11, atau Windows 10 dengan [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).
- yt-dlp dipasang otomatis dari rilis resmi GitHub saat pertama dibuka kalau belum ada di PC. Checksum SHA-256-nya diperiksa dulu.
- Pemasang belum ditandatangani, jadi SmartScreen menampilkan peringatan. Cocokkan SHA-256 file dengan yang tertulis di halaman rilis.

Langganan, simpanan, dan riwayat disimpan di `%LOCALAPPDATA%\Play` dan tidak ikut terhapus saat Play dihapus lewat Pengaturan Windows.

## Menjalankan dari kode

Perlu Node.js 22 atau lebih baru dan yt-dlp di `PATH`.

```
npm install
npm start
```

Buka `http://localhost:4321`. Data versi ini ada di folder `data`, terpisah dari versi terpasang.

## Membangun

Kompilasi memakai `csc.exe` bawaan Windows. SDK `Microsoft.Web.WebView2` diambil dari cache NuGet, dan build berhenti kalau tanda tangan Microsoft-nya tidak sah.

| Perintah | Hasil |
|---|---|
| `powershell -ExecutionPolicy Bypass -File windows\build.ps1` | `Play.exe` di folder ini |
| `powershell -ExecutionPolicy Bypass -File windows\installer.ps1` | `dist\Play-Setup-<versi>.exe` dengan Node di dalamnya |

Nomor versi diambil dari `package.json`.

## Susunan

| Folder | Isi |
|---|---|
| `server` | Server lokal: metadata (`youtube.js`), stream (`stream.js`), yt-dlp (`ytdlp.js`), data pengguna (`library.js`) |
| `public` | Tampilan, tanpa langkah build |
| `windows` | Jendela native (`Play.cs`), pemasang (`Setup.cs`), skrip build |

## Variabel lingkungan

| Nama | Bawaan | Dipakai untuk |
|---|---|---|
| `PORT` | `4321` | Port server |
| `PLAY_LIBRARY` | `data/library.json` | File data pengguna |
| `PLAY_BIN` | `data/bin` | Tempat yt-dlp yang dipasang Play |
| `PLAY_INSTALLED` | kosong | Kalau diisi, yt-dlp yang belum ada dipasang otomatis |
| `PLAY_YTDLP_URL` | rilis terbaru yt-dlp di GitHub | Sumber unduhan yt-dlp |
| `YTDLP` | kosong | Path yt-dlp yang dipaksa dipakai |
