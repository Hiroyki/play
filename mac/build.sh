#!/bin/bash
# Membuat dist/Play.app yang berdiri sendiri dan dist/Play-<versi>-<arch>.dmg. Jalankan:
#   bash mac/build.sh            (arsitektur Mac ini)
#   ARCH=x64 bash mac/build.sh   (Mac Intel)
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
dist=$root/dist
app=$dist/Play.app
NODE_VERSION=${NODE_VERSION:-24.22.3}

case "${ARCH:-$(uname -m)}" in
  arm64) arch=arm64; target=arm64 ;;
  x64 | x86_64) arch=x64; target=x86_64 ;;
  *) echo 'ARCH harus arm64 atau x64.' >&2; exit 1 ;;
esac
command -v swiftc >/dev/null || { echo 'swiftc tidak ada. Jalankan: xcode-select --install' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm tidak ada. Pasang Node.js 22 atau lebih baru.' >&2; exit 1; }
version=$(node -p "require('./package.json').version")

# 1. Node resmi. Node dari Homebrew bergantung pada pustaka lain, jadi tidak bisa dibawa.
cache=$dist/cache
name=node-v$NODE_VERSION-darwin-$arch
mkdir -p "$cache"
if [ ! -f "$cache/$name.tar.xz" ]; then
  curl -fL --progress-bar -o "$cache/$name.tar.xz.unduh" "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.xz"
  mv "$cache/$name.tar.xz.unduh" "$cache/$name.tar.xz"
fi
[ -f "$cache/SHASUMS256-$NODE_VERSION.txt" ] || curl -fsSL -o "$cache/SHASUMS256-$NODE_VERSION.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
(cd "$cache" && grep " $name.tar.xz\$" "SHASUMS256-$NODE_VERSION.txt" | shasum -a 256 -c - >/dev/null) || {
  rm -f "$cache/$name.tar.xz"
  echo 'Node yang diunduh tidak cocok dengan checksum resminya, jadi dibuang.' >&2
  exit 1
}

# 2. Kumpulkan isi
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Helpers" "$app/Contents/Resources/app"
res=$app/Contents/Resources
tar -xJf "$cache/$name.tar.xz" -C "$app/Contents/Helpers" --strip-components 2 "$name/bin/node"
codesign --verify --strict "$app/Contents/Helpers/node"
codesign -dv "$app/Contents/Helpers/node" 2>&1 | grep -q 'TeamIdentifier=HX7739G8FX' || { echo 'node tidak bertanda tangan Node.js Foundation.' >&2; exit 1; }
cp package.json package-lock.json LICENSE.md "$res/app/"
cp -R server public "$res/app/"
cp mac/guard.mjs "$res/app/"
find "$res/app" -name .DS_Store -delete

# 3. Dependensi dari package-lock, tanpa bagian yang tidak dipakai saat berjalan
(cd "$res/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
find "$res/app/node_modules/shaka-player" -type f ! -name shaka-player.compiled.js ! -name package.json ! -name LICENSE -delete
rm -rf "$res/app/node_modules/youtubei.js/bundle" "$res/app/node_modules/.bin"
find "$res/app/node_modules" -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete
find "$res/app/node_modules" -type d -empty -delete

# 4. Pastikan data pribadi tidak terbawa
leak=$(find "$res" \( -name data -o -name library.json -o -name .env -o -name .git \) -not -path '*/node_modules/*' -print -quit)
[ -z "$leak" ] || { echo "File pribadi ikut terbawa: $leak" >&2; exit 1; }

# 5. Ikon, Info.plist, program
set=$dist/AppIcon.iconset
rm -rf "$set" && mkdir -p "$set"
swift mac/icon.swift public/icon.svg "$set"
iconutil -c icns -o "$res/AppIcon.icns" "$set"
rm -rf "$set"
cp mac/Info.plist "$app/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$version" "$app/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$app/Contents/Info.plist"
swiftc -O -swift-version 5 -target "$target-apple-macos13.5" -o "$app/Contents/MacOS/Play" mac/Play.swift

# 6. Tanda tangan lokal (ad-hoc), wajib supaya jalan di Apple Silicon
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"

# 7. Bungkus
dmg=$dist/Play-$version-$arch.dmg
stage=$dist/dmg
rm -rf "$stage" "$dmg" && mkdir -p "$stage"
ditto "$app" "$stage/Play.app"
ln -s /Applications "$stage/Applications"
hdiutil create -quiet -volname Play -srcfolder "$stage" -fs HFS+ -format ULFO "$dmg"
rm -rf "$stage"
echo "$app  $(du -sh "$app" | cut -f1 | tr -d ' ')"
echo "$dmg  $(du -h "$dmg" | cut -f1 | tr -d ' ')"
echo "SHA-256 $(shasum -a 256 "$dmg" | cut -d' ' -f1)"
