// Menjalankan server/*.js di mesin JavaScript bawaan WebView, jadi APK tidak perlu membawa Node dan Python.
// Modul Node diganti tiruan kecil di shims; jaringan, file, dan soket dikerjakan Java.
import './env.js';
import '../../server/index.js';
