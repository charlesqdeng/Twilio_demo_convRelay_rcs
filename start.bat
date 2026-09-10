@echo off
REM Betwext Conversation AI Demo - Windows Launcher
REM ================================================

SETLOCAL EnableDelayedExpansion

SET PORT=3030
SET NGROK_DOMAIN=your-subdomain.ngrok.io

REM Prefer NEXT_PUBLIC_APP_URL from .env.local so the tunnel domain stays in
REM sync with the TwiML App / webhooks. Falls back to the placeholder above.
if exist ".env.local" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env.local") do (
        if /I "%%a"=="NEXT_PUBLIC_APP_URL" (
            set "APP_URL=%%b"
            set "APP_URL=!APP_URL:https://=!"
            set "APP_URL=!APP_URL:http://=!"
            for /f "delims=/" %%c in ("!APP_URL!") do set NGROK_DOMAIN=%%c
        )
    )
)

echo ╔════════════════════════════════════════════════╗
echo ║  Betwext Conversation AI Demo - Launcher     ║
echo ╚════════════════════════════════════════════════╝
echo.

REM Check if ngrok is installed
where ngrok >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error: ngrok is not installed
    echo Install it from: https://ngrok.com/download
    pause
    exit /b 1
)

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Error: Node.js is not installed
    pause
    exit /b 1
)

REM Check if .env.local exists
if not exist ".env.local" (
    echo ❌ Error: .env.local file not found
    echo Please create .env.local with your Twilio credentials
    pause
    exit /b 1
)

REM Kill any existing processes on the port
echo 🧹 Cleaning up existing processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
taskkill /F /IM ngrok.exe >nul 2>nul
timeout /t 1 >nul

REM Step 1: Start Next.js dev server
echo.
echo 📦 Step 1: Starting Next.js dev server on port %PORT%...
start /B cmd /c "npm run dev > nextjs.log 2>&1"
echo ✅ Next.js server starting...

REM Wait for Next.js to be ready
echo ⏳ Waiting for Next.js to be ready...
timeout /t 5 >nul

REM Step 2: Start ngrok tunnel
echo.
echo 📡 Step 2: Starting ngrok tunnel with domain %NGROK_DOMAIN%...
start /B cmd /c "ngrok http %PORT% --domain=%NGROK_DOMAIN% --log=stdout > ngrok.log 2>&1"
echo ✅ ngrok tunnel starting...

REM Wait for ngrok to be ready
echo ⏳ Waiting for ngrok tunnel to establish...
timeout /t 3 >nul

REM Get ngrok URL (requires curl or PowerShell)
for /f "delims=" %%i in ('powershell -Command "(Invoke-WebRequest -Uri 'http://localhost:4040/api/tunnels' -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -ExpandProperty tunnels | Where-Object {$_.proto -eq 'https'} | Select-Object -ExpandProperty public_url"') do set NGROK_URL=%%i

if "!NGROK_URL!"=="" (
    set NGROK_URL=https://%NGROK_DOMAIN%
)

echo.
echo ╔════════════════════════════════════════════════╗
echo ║            🚀 ALL SERVICES RUNNING             ║
echo ╚════════════════════════════════════════════════╝
echo.
echo 📱 Local Development:
echo    http://localhost:%PORT%
echo.
echo 🌐 Public URL (Twilio):
echo    !NGROK_URL!
echo.
echo 🔧 ngrok Dashboard:
echo    http://localhost:4040
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ⚙️  Twilio Configuration Required:
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo Set your Messaging Service Inbound Request URL to:
echo !NGROK_URL!/api/rcs-inbound
echo.
echo Console URL:
echo https://console.twilio.com/us1/develop/sms/services
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo 💡 Tips:
echo    • Open http://localhost:%PORT% in your browser
echo    • View ngrok traffic at http://localhost:4040
echo    • Press Ctrl+C to stop all services
echo.
echo 📝 Logs:
echo    Next.js: type nextjs.log
echo    ngrok:   type ngrok.log
echo.
echo ✨ Ready — voice agent takes the call, this app handles Airtable + RCS.
echo.
echo Press Ctrl+C to stop all services...
echo.

REM Keep window open
pause
