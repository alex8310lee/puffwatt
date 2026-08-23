@echo off
cd /d %~dp0
set PUFFWATT_ENV=development
set PORT=3000
start "" http://localhost:3000
node server\index.js
