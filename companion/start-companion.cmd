@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 valtrack_companion.py
) else (
  python valtrack_companion.py
)
echo.
echo If Python was not found, install Python 3.10 or newer from https://www.python.org/downloads/windows/
echo The companion needs no extra packages. Do not run as administrator.
pause
