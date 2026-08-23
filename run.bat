@echo off
cd /d %~dp0
where node >nul 2>nul || (echo Node.js 22.5 이상이 필요합니다: https://nodejs.org & pause & exit /b 1)
set PUFFWATT_ENV=development
start "" http://localhost:3000
node server\index.js
