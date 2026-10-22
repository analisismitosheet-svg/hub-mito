@echo off
REM Reinicia el contador de clientes. Hace falta ADMINISTRADOR: la tarea "MITO Contador Clientes"
REM corre como SYSTEM y no se puede matar desde una consola normal.
REM Clic derecho -> "Ejecutar como administrador".
REM
REM Cuando sirve: si en el hub las camaras se ven congeladas y el log (contador.log) se llena de
REM "CUDA error" / "Sticky error detected". Pasa cuando Windows reinstala el driver de video con el
REM contador andando: el contexto de la GPU queda roto y ya no se recupera solo.
cd /d "%~dp0"
set TAREA=MITO Contador Clientes

net session >nul 2>&1 || (echo Hay que ejecutarlo como administrador: clic derecho - Ejecutar como administrador. & pause & exit /b 1)

echo Deteniendo el contador...
schtasks /End /TN "%TAREA%" >nul 2>&1
ping -n 4 127.0.0.1 >nul

echo Arrancando de nuevo...
schtasks /Run /TN "%TAREA%" >nul 2>&1
if errorlevel 1 (echo No se pudo arrancar la tarea "%TAREA%". & pause & exit /b 1)

echo Esperando que levante (hasta 60 segundos)...
set INTENTOS=0
:espera
set /a INTENTOS+=1
ping -n 6 127.0.0.1 >nul
netstat -ano | findstr /C:"127.0.0.1:8765" | findstr /C:"LISTENING" >nul && goto listo
if %INTENTOS% LSS 10 goto espera
echo No levanto el video en vivo (8765). Mirar contador.log.
pause
exit /b 1

:listo
echo Listo: el contador esta andando de nuevo. Revisar en el hub que las camaras se muevan.
pause
