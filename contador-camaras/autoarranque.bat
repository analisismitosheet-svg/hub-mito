@echo off
REM Crea una tarea programada que inicia el contador al prender la PC.
REM Ejecutar con clic derecho > "Ejecutar como administrador".
cd /d "%~dp0"
schtasks /Create /F /TN "MITO Contador Clientes" /SC ONSTART /DELAY 0001:00 /RU SYSTEM /RL HIGHEST ^
  /TR "\"%~dp0iniciar.bat\""
if errorlevel 1 (echo No se pudo crear la tarea. Corre este archivo como administrador. & pause & exit /b 1)
schtasks /Run /TN "MITO Contador Clientes"
echo Listo: el contador arranca solo con la PC. Log en contador.log
pause
