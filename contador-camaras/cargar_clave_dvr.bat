@echo off
REM Cargar la clave del DVR de una camara sin pasarla por el chat (se escribe oculta y se prueba una sola vez)
cd /d "%~dp0"
.venv\Scripts\python.exe cargar_clave_dvr.py %*
pause
