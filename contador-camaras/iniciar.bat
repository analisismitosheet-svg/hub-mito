@echo off
cd /d "%~dp0"
REM Reinicia solo si el proceso se cae (ej. corte de luz del DVR)
:loop
.venv\Scripts\python.exe contador.py %*
echo El contador se detuvo. Reinicio en 10 segundos... (Ctrl+C para salir)
timeout /t 10 /nobreak >nul
goto loop
