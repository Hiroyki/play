@echo off
title Play
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terpasang. Ambil di https://nodejs.org & pause & exit /b 1)
where yt-dlp >nul 2>nul || (echo yt-dlp belum terpasang. Jalankan: pip install -U "yt-dlp[default]" & pause & exit /b 1)
if not exist node_modules call npm install || (pause & exit /b 1)
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:4321"
node server\index.js
pause
