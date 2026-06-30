@echo off
setlocal

cd /d "%~dp0"
set "PORT=5678"
set "HOST=127.0.0.1"
set "APP_URL=http://%HOST%:%PORT%"

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

node -e "fetch(process.argv[1] + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "%APP_URL%" >nul 2>nul
if not errorlevel 1 (
  echo [st-card-web-writer] Already running on %APP_URL%
  start "" "%APP_URL%"
  pause
  exit /b 0
)

node -e "const net=require('node:net'); const host=process.argv[1]; const port=Number(process.argv[2]); const s=net.createServer(); s.once('error', () => process.exit(1)); s.once('listening', () => s.close(() => process.exit(0))); s.listen(port, host);" "%HOST%" "%PORT%" >nul 2>nul
if errorlevel 1 (
  echo [st-card-web-writer] Port %HOST%:%PORT% is already in use by another process.
  echo [st-card-web-writer] Open %APP_URL% if it is the writer, or edit PORT in start-writer.bat.
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

echo [st-card-web-writer] Starting on %APP_URL%
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%APP_URL%'"
call npm run start

echo.
echo [st-card-web-writer] Server stopped.
pause
