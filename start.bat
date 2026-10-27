@echo off
cd /d "%~dp0"

set PORT=5173
set URL=http://127.0.0.1:%PORT%/

echo TimeGuesser - starter lokal server...

where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js/npm mangler. Installer fra https://nodejs.org og prov igjen.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installerer avhengigheter ^(forste gang^)...
  call npm install
)

echo Frigjor port %PORT% hvis den er opptatt...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  taskkill /F /PID %%P >nul 2>&1
)

start "" cmd /c "timeout /t 2 /nobreak >nul && start %URL%"
call npm run dev -- --host 127.0.0.1 --port %PORT% --strictPort
pause
