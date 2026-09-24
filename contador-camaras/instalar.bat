@echo off
REM Instala el contador en esta PC (una sola vez). Requiere Python 3.10+ (python.org, tildar "Add to PATH").
cd /d "%~dp0"
python --version || (echo Falta Python. Instalalo desde python.org y volve a correr este archivo. & pause & exit /b 1)
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || (echo Fallo la instalacion de dependencias. & pause & exit /b 1)
REM Descarga el modelo de deteccion (queda en esta carpeta)
python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"
if not exist config.json copy config.ejemplo.json config.json
echo.
echo Listo. Ahora:
echo   1) Edita config.json (token del hub, IP/usuario/clave del DVR, canal de la camara)
echo   2) .venv\Scripts\python calibrar.py "Entrada"
echo   3) iniciar.bat --ver   (para probar)   /   autoarranque.bat (para que arranque solo)
pause
