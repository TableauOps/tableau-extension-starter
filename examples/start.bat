@echo off
REM One command to serve ALL three viz extensions from a single origin.
REM
REM   start.bat                  -> http://localhost:1111
REM   set PORT=8080 ^& start.bat -> override the port
REM
REM No install step, no dependencies — just Node.js (v14+).
REM Double-click this file, or run it from a terminal.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on your PATH.
  echo Install it from https://nodejs.org/ ^(v14 or newer^), then re-run start.bat
  echo.
  pause
  exit /b 1
)

node server.js

REM Keep the window open if the server stops or errors out.
echo.
pause
