@echo off
cd /d "%~dp0"
set PORT=3737
start "" http://localhost:3737
node server.js
