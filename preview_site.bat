@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Local Site Preview
echo ========================================
echo   Build and start local site preview
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 22.12 or newer from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Please reinstall Node.js with npm.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\astro.cmd" (
  echo [1/3] Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install project dependencies.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Project dependencies are ready.
)

echo.
echo [2/3] Building the site...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] Site build failed. Review the messages above and try again.
  pause
  exit /b 1
)

echo.
echo [3/3] Starting the local preview server...
call ".\node_modules\.bin\astro.cmd" dev stop >nul 2>nul
call ".\node_modules\.bin\astro.cmd" dev --background --host localhost --port 4321
if errorlevel 1 (
  echo.
  echo [ERROR] The local preview server failed to start.
  echo Run "npm run astro -- dev logs" to view the server log.
  pause
  exit /b 1
)

echo.
echo Build complete. Opening http://localhost:4321/
if /I "%~1"=="--no-open" goto preview_ready
start "" "http://localhost:4321/"
:preview_ready
echo.
echo The preview server will keep running in the background.
echo To stop it, run: npm run astro -- dev stop
echo.
pause
exit /b 0
