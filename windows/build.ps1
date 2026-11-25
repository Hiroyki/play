# Membuat Play.exe dengan compiler C# bawaan Windows. Jalankan:
#   powershell -ExecutionPolicy Bypass -File windows\build.ps1
param([string]$Out)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$lib = Join-Path $here 'lib'
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path "$lib\Microsoft.Web.WebView2.Core.dll")) {
  $pkg = Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.web.webview2" -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]($_.Name -replace '-.*') } | Select-Object -Last 1
  if (-not $pkg) { throw 'SDK Microsoft.Web.WebView2 tidak ada di cache NuGet.' }
  New-Item -ItemType Directory -Force $lib | Out-Null
  Copy-Item "$($pkg.FullName)\lib\net462\Microsoft.Web.WebView2.Core.dll", "$($pkg.FullName)\lib\net462\Microsoft.Web.WebView2.WinForms.dll", "$($pkg.FullName)\runtimes\win-x64\native\WebView2Loader.dll" $lib
  Copy-Item "$($pkg.FullName)\LICENSE.txt" "$lib\WebView2-LICENSE.txt" -ErrorAction SilentlyContinue
}
foreach ($f in Get-ChildItem $lib -Filter *.dll) {
  $s = Get-AuthenticodeSignature $f.FullName
  if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "$($f.Name) bukan file resmi Microsoft." }
}

if (-not $Out) { $Out = Join-Path $root 'Play.exe' }
& $csc /nologo /target:winexe /platform:x64 /optimize+ /warn:4 /codepage:65001 "/out:$Out" "/win32icon:$here\play.ico" "/win32manifest:$here\app.manifest" `
  "/reference:$lib\Microsoft.Web.WebView2.Core.dll" "/reference:$lib\Microsoft.Web.WebView2.WinForms.dll" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "$here\Play.cs"
if ($LASTEXITCODE -ne 0) { throw 'Kompilasi gagal.' }
Write-Output ("Play.exe jadi, {0:N0} KB" -f ((Get-Item $Out).Length / 1KB))
