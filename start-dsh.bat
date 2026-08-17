@echo off
chcp 65001 >nul
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm not found in PATH. Install Node.js with pnpm first.
    pause
    exit /b 1
)
echo Starting DeepSeek Harness Web UI at http://127.0.0.1:3080
pnpm dsh web
pause
