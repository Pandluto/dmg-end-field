@echo off
setlocal
cd /d "%~dp0"

title DEF Preview Launcher

echo [1/2] Building project...
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed.
  echo Press any key to exit.
  pause >nul
  exit /b 1
)

echo.
echo [2/2] Starting local preview server...
echo The browser will open automatically at http://127.0.0.1:4173/
echo Close this window to stop the preview server.
echo.

call npm run preview -- --host 127.0.0.1 --port 4173 --open

if errorlevel 1 (
  echo.
  echo Preview server failed to start.
  echo Press any key to exit.
  pause >nul
  exit /b 1
)

