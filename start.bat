@echo off
cd /d "%~dp0"
title NovaBank - Banking and ATM Management System
set DB_USER=root
set DB_PASS=1234
set NODE=node
if exist runtime\node.exe set NODE=runtime\node.exe
%NODE% -v >nul 2>&1 || (echo Node.js not found. Install from nodejs.org, or use the full package with runtime folder. & pause & exit /b)
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:8080"
%NODE% server.js
pause
