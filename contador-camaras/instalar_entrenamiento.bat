@echo off
REM Solo para la PC donde se ENTRENA (la que tiene placa NVIDIA). Las PCs de los locales usan instalar.bat.
cd /d "%~dp0"
call instalar.bat
call .venv\Scripts\activate.bat
echo.
echo Instalando PyTorch con soporte para la placa NVIDIA (descarga grande, ~2.5 GB)...
pip uninstall -y torch torchvision
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126 || (echo Fallo la instalacion de PyTorch con CUDA. & pause & exit /b 1)
python -c "import torch; ok=torch.cuda.is_available(); print('GPU disponible:', ok, torch.cuda.get_device_name(0) if ok else ''); ok and print('Prueba en GPU:', (torch.ones(2, device='cuda')*2).tolist())"
echo.
echo Si dice "GPU disponible: True" esta todo listo para entrenar.
pause
