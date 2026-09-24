@echo off
title Police Exam - Local Web Server
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   Police Exam Local Web Server
echo ========================================================
echo กำลังเริ่มต้นเซิร์ฟเวอร์จำลอง...
python serve.py 8000
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo เกิดข้อผิดพลาดในการรัน python serve.py
    pause
)

