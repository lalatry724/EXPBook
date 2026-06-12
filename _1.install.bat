@echo off
cd /d "%~dp0"
python _internal\scripts\install.py %*
pause
