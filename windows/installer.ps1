# Membuat dist\Play-Setup-<versi>.exe yang berdiri sendiri. Jalankan:
#   powershell -ExecutionPolicy Bypass -File windows\installer.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'isi'
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version

# 1. Kumpulkan isi
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage, "$stage\runtime", "$stage\windows" | Out-Null
& (Join-Path $here 'build.ps1') -Out "$stage\Play.exe"
Copy-Item "$root\package.json", "$root\package-lock.json" $stage
Copy-Item "$root\server", "$root\public" $stage -Recurse
Copy-Item "$here\lib" "$stage\windows" -Recurse
$node = (Get-Command node).Source
$sig = Get-AuthenticodeSignature $node
if ($sig.Status -ne 'Valid') { throw 'node.exe tidak bertanda tangan sah.' }
Copy-Item $node "$stage\runtime\node.exe"

# 2. Dependensi dari package-lock, tanpa bagian yang tidak dipakai saat berjalan
Push-Location $stage
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm ci gagal.' }
Pop-Location
Get-ChildItem "$stage\node_modules\shaka-player" -Recurse -File | Where-Object { $_.Name -notin 'shaka-player.compiled.js', 'package.json', 'LICENSE' } | Remove-Item -Force
Remove-Item "$stage\node_modules\youtubei.js\bundle" -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem "$stage\node_modules" -Recurse -File -Include *.map, *.d.ts, *.d.mts, *.d.cts | Remove-Item -Force

# 3. Pastikan data pribadi tidak terbawa
$leak = Get-ChildItem $stage -Recurse -Force | Where-Object { $_.Name -in 'data', 'library.json', 'webview', '.env', '.git' }
if ($leak) { throw "File pribadi ikut terbawa: $($leak[0].FullName)" }

# 4. Bungkus
$zip = Join-Path $dist 'payload.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$src = Join-Path $dist 'Setup.cs'
(Get-Content "$here\Setup.cs" -Raw -Encoding UTF8) -replace 'AssemblyVersion\("[^"]+"\)', "AssemblyVersion(`"$version.0`")" | Set-Content $src -Encoding UTF8
$out = Join-Path $dist "Play-Setup-$version.exe"
& $csc /nologo /target:winexe /platform:x64 /optimize+ /warn:4 /codepage:65001 "/out:$out" "/win32icon:$here\play.ico" "/win32manifest:$here\app.manifest" "/resource:$zip,payload.zip" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll $src
if ($LASTEXITCODE -ne 0) { throw 'Kompilasi pemasang gagal.' }
Remove-Item $zip, $src, $stage -Recurse -Force
Write-Output ("{0}  {1:N1} MB" -f $out, ((Get-Item $out).Length / 1MB))
Write-Output ("SHA-256 " + (Get-FileHash $out -Algorithm SHA256).Hash.ToLower())
