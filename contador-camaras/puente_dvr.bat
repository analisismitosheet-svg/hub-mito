@echo off
REM Clic derecho -> Ejecutar como administrador. Busca el DVR solo; o: puente_dvr.bat 192.168.0.108 [puerto TCP, 37777 si no se pone]
set PUERTO=%~2
if "%PUERTO%"=="" set PUERTO=37777
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0puente_dvr.ps1" -Dvr "%~1" -PuertoSdk %PUERTO%
