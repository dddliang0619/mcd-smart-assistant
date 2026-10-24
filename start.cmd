@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Order Assistant - backend

rem Notes: keep this file ASCII-only. cmd parses .bat in the system code page,
rem so Chinese text here would break the script on this machine.

rem This PC has no Node in PATH, so look for a usable node.exe first.
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE (
  echo [x] node.exe not found. Install Node.js 22.15+ from https://nodejs.org
  if /i not "%~1"=="nopause" pause
  exit /b 1
)

echo [i] Node     : %NODE%
echo [i] Backend  : http://127.0.0.1:8787
echo [i] Keep this window OPEN. Closing it stops the server.
echo.

rem Give the server two seconds before the browser opens.
if /i not "%~1"=="nobrowser" start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8787/'"

"%NODE%" --env-file-if-exists=.env server/index.mjs

echo.
echo [x] Server stopped.
if /i not "%~1"=="nopause" pause