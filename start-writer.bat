@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"
set "PORT=5679"
set "HOST=127.0.0.1"
set /a MAX_PORT=%PORT%+10

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

:check_port
set "APP_URL=http://%HOST%:%PORT%"
node -e "fetch(process.argv[1] + '/api/health', { signal: AbortSignal.timeout(1500) }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" "!APP_URL!" >nul 2>nul
if not errorlevel 1 (
  echo [st-card-web-writer] Already running on !APP_URL!
  start "" "!APP_URL!"
  pause
  exit /b 0
)

node -e "const net=require('node:net'); const host=process.argv[1]; const port=Number(process.argv[2]); const s=net.createServer(); s.once('error', () => process.exit(1)); s.once('listening', () => s.close(() => process.exit(0))); s.listen(port, host);" "%HOST%" "!PORT!" >nul 2>nul
if errorlevel 1 (
  if !PORT! GEQ !MAX_PORT! (
    echo [st-card-web-writer] Ports %HOST%:5679 through %HOST%:!MAX_PORT! are already in use.
    echo [st-card-web-writer] Edit PORT in start-writer.bat if you want another range.
    pause
    exit /b 1
  )
  set /a NEXT_PORT=!PORT!+1
  echo [st-card-web-writer] Port %HOST%:!PORT! is in use; trying !NEXT_PORT!...
  set /a PORT=!NEXT_PORT!
  goto check_port
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

echo [st-card-web-writer] Starting on !APP_URL!
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '!APP_URL!'"
call npm run start

echo.
echo [st-card-web-writer] Server stopped.
pause
