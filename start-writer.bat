@echo off
setlocal

cd /d "%~dp0"
set "PORT=5678"
set "HOST=127.0.0.1"

where node >nul 2>nul
if errorlevel 1 (
  echo [st-card-web-writer] Node.js was not found. Please install Node.js 20 or newer.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [st-card-web-writer] npm was not found. Please reinstall Node.js with npm enabled.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [st-card-web-writer] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [st-card-web-writer] npm install failed.
    pause
    exit /b 1
  )
)

echo [st-card-web-writer] Starting on http://%HOST%:%PORT%
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://%HOST%:%PORT%'"
call npm run start

echo.
echo [st-card-web-writer] Server stopped.
pause
