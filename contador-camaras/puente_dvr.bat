@echo off
REM Clic derecho -> Ejecutar como administrador. Ej: puente_dvr.bat 192.168.0.108
set DVR=%1
if "%DVR%"=="" set /p DVR=IP interna del DVR (ej 192.168.0.108): 
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0puente_dvr.ps1" -Dvr %DVR%
