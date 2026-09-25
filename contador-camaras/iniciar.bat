@echo off
cd /d "%~dp0"
REM Modelos de torchvision (reconocimiento) dentro de la carpeta: asi funciona igual si arranca como SYSTEM.
set TORCH_HOME=%~dp0modelos\torch
REM Reinicia solo si el proceso se cae (ej. corte de luz del DVR).
REM La espera usa ping y no "timeout": timeout falla cuando corre sin ventana (tarea al prender la PC).
:loop
.venv\Scripts\python.exe contador.py %*
echo %date% %time% El contador se detuvo. Reinicio en 10 segundos...>> reinicios.log
ping -n 11 127.0.0.1 >nul
goto loop
