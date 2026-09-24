@echo off
REM Clic derecho -> Ejecutar como administrador. "publicar_vista.bat quitar" para dejar de publicar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar_vista.ps1" %*
