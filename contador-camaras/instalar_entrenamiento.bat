@echo off
REM Solo para la PC donde se ENTRENA (la que tiene placa NVIDIA). Las PCs de los locales usan instalar.bat.
cd /d "%~dp0"
call instalar.bat
call .venv\Scripts\activate.bat

REM La build de PyTorch tiene que traer kernels para ESTA placa: las RTX 50xx (sm_120) no
REM andan con cu126 (el proceso muere sin traceback al primer calculo en la GPU).
set CANAL=cu126
for /f "tokens=1 delims=." %%a in ('nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2^>nul') do if %%a GEQ 10 set CANAL=cu130
echo.
echo Instalando PyTorch con soporte para la placa NVIDIA (%CANAL%, descarga grande, ~2.5 GB)...
pip uninstall -y torch torchvision
pip install torch torchvision --index-url https://download.pytorch.org/whl/%CANAL% || (echo Fallo la instalacion de PyTorch con CUDA. & pause & exit /b 1)
echo.
echo Comprobando que la placa realmente ejecute (no alcanza con "disponible"):
python -c "import torch; torch.zeros(8, device='cuda').add_(1); torch.cuda.synchronize(); print('GPU utilizable: True', torch.cuda.get_device_name(0))"
if errorlevel 1 (
  echo GPU utilizable: False - esta build de PyTorch no tiene kernels para la placa.
  echo Para RTX 50xx hace falta cu130 o superior.
  pause
  exit /b 1
)
echo.
echo Si dice "GPU utilizable: True" esta todo listo para entrenar.
pause
