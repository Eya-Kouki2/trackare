@echo off
title Trackare IoT PC Server (Port 9000)
echo ====================================================
echo Starting Trackare IoT PC Server on Port 9000...
echo ====================================================

cd /d "c:\Users\ASUS TUF A15\Desktop\Eyaa\projects\ies2\trackare\backend\ml\iot"

:loop
"c:\Users\ASUS TUF A15\Desktop\Eyaa\projects\ies2\trackare\backend\ml\.venv\Scripts\python.exe" pc_server.py
echo [WARN] PC Server stopped. Restarting in 2 seconds...
timeout /t 2 >nul
goto loop
