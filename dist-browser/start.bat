@echo off
setlocal
title Palma City
cd /d "%~dp0"

echo Palma City - optional local-server fallback
echo (The normal way to play is to double-click index.html.)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

echo.
echo Palma City has stopped.
pause
