@echo off
setlocal
title LoyaltyLoopV2 Backup Key Setup
echo Starting LoyaltyLoopV2 backup key setup...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0create-age-key.ps1"
set "exitCode=%ERRORLEVEL%"
echo.
echo Tool exited. If no folder picker appeared, report the error shown above.
pause
exit /b %exitCode%
