#!/bin/bash
# Membuat dist/Play-<versi>.apk. Butuh Node.js, JDK 17+ (yang dari Android Studio juga bisa), dan Android SDK. Jalankan:
#   bash android/build.sh
#   DEBUG=1 bash android/build.sh   (bisa diperiksa lewat chrome://inspect)
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
dist=$root/dist
work=$dist/android
SDK=${ANDROID_HOME:-$HOME/Library/Android/sdk}
[ -d "$SDK" ] || SDK=$HOME/Android/Sdk
if [ -z "${JAVA_HOME:-}" ] && [ -d '/Applications/Android Studio.app' ]; then export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'; fi
[ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"
tools=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
jar=$(ls -d "$SDK"/platforms/android-36*/android.jar 2>/dev/null | sort -V | tail -1)
[ -x "$tools/aapt2" ] || { echo 'Android SDK build-tools tidak ada.' >&2; exit 1; }
[ -f "$jar" ] || { echo 'Android SDK Platform 36 tidak ada.' >&2; exit 1; }
version=$(node -p "require('./package.json').version")
code=$(node -p "require('./package.json').version.split('.').reduce((n, x) => n * 100 + Number(x), 0)")
ESBUILD=0.25.12

rm -rf "$work"
mkdir -p "$work/assets/web/vendor/instrument" "$work/gen" "$work/classes" "$work/dex"

# 1. Dependensi dari package-lock
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
tool=$dist/cache/esbuild-$ESBUILD
if [ ! -d "$tool/node_modules/esbuild" ]; then
  mkdir -p "$tool"
  echo '{"private":true}' > "$tool/package.json"
  npm i --prefix "$tool" --no-audit --no-fund --loglevel=error "esbuild@$ESBUILD"
fi

# 2. Antarmuka dan mesin
web=$work/assets/web
cp public/*.js public/*.css public/*.svg "$web/"
node -e "
const fs = require('fs');
const s = fs.readFileSync('public/index.html', 'utf8');
const t = s.replace('<link rel=\"icon\"', '<script src=\"/bridge.js\"></script>\n  <link rel=\"icon\"');
if (s === t) throw new Error('index.html berubah, bridge.js tidak terpasang');
fs.writeFileSync('$web/index.html', t);"
cp android/engine/bridge.js "$web/"
echo '<!doctype html><meta charset="utf-8"><script src="/engine.js"></script>' > "$web/engine.html"
node android/engine/bundle.mjs "$tool" "$web/engine.js"
cp node_modules/shaka-player/dist/shaka-player.compiled.js "$web/vendor/shaka.js"
for f in $(grep -oE 'instrument-sans-[a-z-]+\.woff2' public/style.css public/index.html -h | sort -u); do
  cp "node_modules/@fontsource-variable/instrument-sans/files/$f" "$web/vendor/instrument/"
done
cp LICENSE.md "$work/assets/"
{
  for p in youtubei.js shaka-player @fontsource-variable/instrument-sans meriyah fflate; do
    printf '\n===== %s =====\n\n' "$p"
    cat node_modules/$p/LICENSE*
  done
  printf '\n===== @bufbuild/protobuf =====\n\nCopyright Buf Technologies, Inc. Apache-2.0 AND BSD-3-Clause. https://github.com/bufbuild/protobuf-es\n'
} > "$work/assets/THIRD-PARTY.txt"

# 3. Kompilasi
"$tools/aapt2" compile --dir android/res -o "$work/res.zip"
"$tools/aapt2" link -o "$work/base.apk" -I "$jar" --manifest android/AndroidManifest.xml -A "$work/assets" --java "$work/gen" \
  --min-sdk-version 26 --target-sdk-version 36 --version-code "$code" --version-name "$version" ${DEBUG:+--debug-mode} "$work/res.zip"
javac -nowarn -Xlint:-options --release 17 -encoding UTF-8 -classpath "$jar" -d "$work/classes" $(find "$work/gen" android/src -name '*.java')
"$tools/d8" --release --min-api 26 --lib "$jar" --output "$work/dex" $(find "$work/classes" -name '*.class')
(cd "$work/dex" && zip -q -9 "$work/base.apk" classes.dex)

# 4. Tanda tangan. Kunci dibuat sekali dan disimpan di luar repo; tanpa kunci yang sama, pembaruan tidak bisa dipasang.
key=${PLAY_KEYSTORE:-$HOME/.android/play.keystore}
pass=${PLAY_KEYSTORE_PASS_FILE:-$key.pass}
if [ ! -f "$key" ]; then
  mkdir -p "$(dirname "$key")"
  (umask 077; openssl rand -hex 24 > "$pass")
  keytool -genkeypair -keystore "$key" -storetype PKCS12 -alias play -keyalg RSA -keysize 3072 -validity 10000 -dname CN=Play -storepass:file "$pass" -keypass:file "$pass" 2>/dev/null
  chmod 600 "$key"
  echo "Kunci baru: $key (simpan cadangannya)"
fi
out=$dist/Play-$version.apk
"$tools/zipalign" -f -p 4 "$work/base.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$key" --ks-key-alias play --ks-pass "file:$pass" --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out "$out" "$work/aligned.apk"
"$tools/apksigner" verify "$out"
rm -rf "$work" "$out.idsig"
echo "$out  $(du -k "$out" | cut -f1) KB"
echo "SHA-256 $(shasum -a 256 "$out" | cut -d' ' -f1)"
