@echo off
REM Hace que el contador arranque SOLO cada vez que se prende la PC (aunque nadie inicie sesion).
REM Clic derecho -> "Ejecutar como administrador".   Para sacarlo:  autoarranque.bat quitar
cd /d "%~dp0"
set TAREA=MITO Contador Clientes
net session >nul 2>&1 || (echo Hay que ejecutarlo como administrador: clic derecho - Ejecutar como administrador. & pause & exit /b 1)

if /i "%~1"=="quitar" (
  schtasks /End /TN "%TAREA%" >nul 2>&1
  schtasks /Delete /F /TN "%TAREA%"
  echo Listo: el contador ya no arranca solo.
  pause
  exit /b 0
)

REM Arranca 1 minuto despues de prender (para que haya red y VPN), como SYSTEM (no hace falta iniciar sesion)
schtasks /Create /F /TN "%TAREA%" /SC ONSTART /DELAY 0001:00 /RU SYSTEM /RL HIGHEST /TR "\"%~dp0iniciar.bat\""
if errorlevel 1 (echo No se pudo crear la tarea. & pause & exit /b 1)

REM Windows corta las tareas a las 72 h por defecto: sin limite. Tambien que corra con la notebook a bateria.
powershell -NoProfile -Command "$t = Get-ScheduledTask -TaskName '%TAREA%'; $t.Settings.ExecutionTimeLimit = 'PT0S'; $t.Settings.DisallowStartIfOnBatteries = $false; $t.Settings.StopIfGoingOnBatteries = $false; Set-ScheduledTask -InputObject $t | Out-Null"

REM Cerrar el contador si estaba abierto a mano (si no, quedarian dos contando lo mismo) y arrancar la tarea ya
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe' or Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*contador.py*' -or $_.CommandLine -like '*iniciar.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
schtasks /Run /TN "%TAREA%" >nul

echo.
echo Listo: el contador ya esta corriendo y arranca solo cada vez que se prende la PC.
echo Log en contador.log  -  Estado en el hub: Sistemas - IA Camaras.
pause
