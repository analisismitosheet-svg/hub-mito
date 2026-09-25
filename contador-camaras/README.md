# Contador de clientes (cámaras Dahua → Hub MITO)

> **v2**: unifica este contador con el de `D:\ContadorIA` (conteo por zonas roja→azul, transeúntes,
> exclusión de empleados y clientes únicos/reingresos). Usa la GPU NVIDIA automáticamente si hay.
> Sin fotos ni datos biométricos guardados: el reconocimiento vive en memoria y se borra cada día.

Programa para una PC de cada local. Lee el video de la cámara de la puerta desde el DVR Dahua,
detecta personas con IA (YOLO) y cuenta cuando cruzan una línea. Sube **solo números**
(entradas/salidas cada 15 min) al hub. Nunca sube imágenes. Si se corta internet, guarda
los conteos y los manda cuando vuelve.

```
Cámara → DVR Dahua ──RTSP──▶ PC del local (contador.py) ──HTTPS──▶ /api/contador-ingesta ──▶ Supabase ──▶ Hub: Locales → Contador de clientes
```

## Qué hace falta

- Una PC con Windows 10/11 en la misma red que el DVR, que quede prendida en horario de atención.
  Con una cámara alcanza un i5 o Ryzen 5 de los últimos ~6 años. Para 2 o más cámaras conviene más CPU o una placa NVIDIA.
- **Una cámara que mire la puerta**, idealmente desde arriba o en diagonal (que se vea a la gente pasar, no de frente tapándose entre sí).
- Usuario y clave del DVR. Si se puede, crear en el DVR un usuario **solo de visualización** para esto.
- Python 3.10 o más nuevo ([python.org](https://www.python.org/downloads/), tildar **"Add python.exe to PATH"**).

## Instalación (una vez por local)

1. **En el hub**: Locales → Contador de clientes → **Cámaras** → *Registrar PC de un local*.
   Elegí el local y tocá **Generar token**. Copialo porque no se vuelve a mostrar.
2. Copiá esta carpeta `contador-camaras` a la PC (ej. `C:\MITO\contador-camaras`).
3. Doble clic en **`instalar.bat`**. Crea el entorno, instala las dependencias y baja el modelo (~6 MB).
4. Editá **`config.json`**:
   - `token`: el del paso 1.
   - `dvr.ip`, `dvr.usuario`, `dvr.clave`: los del DVR.
   - `camaras[].canal`: el número de cámara en el DVR (el que se ve en el monitor: CH1 = 1, etc.).
   - Si hay 2 puertas, agregá otra cámara a la lista con otro `nombre` y `canal`.
5. Dibujá la línea de conteo:
   ```
   .venv\Scripts\python calibrar.py "Entrada"
   ```
   Hacé clic en dos puntos **sobre el piso, a la altura de la puerta** (de un marco al otro).
   La flecha verde tiene que apuntar **hacia adentro del local**. Si apunta para afuera, apretá `i`. Después `g` para guardar.
6. Probá con ventana:
   ```
   iniciar.bat --ver
   ```
   Pasá por la puerta: arriba tiene que sumar *Entradas* al entrar y *Salidas* al salir. Cerrá con `q`.
7. Clic derecho en **`autoarranque.bat`** → *Ejecutar como administrador*. Cierra el contador si estaba abierto a mano,
   lo arranca en segundo plano y desde ahí **arranca solo cada vez que se prende la PC**, aunque nadie inicie sesión.
   Corre sin límite de tiempo (Windows corta las tareas a las 72 h si no se configura) y se reinicia solo si se cae
   (los reinicios quedan en `reinicios.log`). Para sacarlo: `autoarranque.bat quitar`, también como administrador.
8. En el hub, en **Cámaras**, la PC tiene que aparecer con el punto verde (*En línea*).

## Entrenar el modelo con nuestras cámaras (opcional, en la PC con placa NVIDIA)

El modelo de fábrica ya detecta personas. Entrenarlo con imágenes de nuestras cámaras sirve
si falla en casos propios del local: cámara muy desde arriba, infrarrojo de noche, maniquíes o reflejos en vidrieras.

1. `instalar_entrenamiento.bat`: instala todo más PyTorch para la placa. Tiene que decir `GPU disponible: True`.
2. `.venv\Scripts\python capturar.py "Entrada" --cada 3 --minutos 60`: junta cuadros en vivo.
   También funciona desde grabaciones exportadas del DVR: `--video archivo.mp4`. Juntá variedad: horas pico, noche, días de lluvia.
3. `.venv\Scripts\python autoetiquetar.py`: un modelo grande marca las personas automáticamente.
4. `.venv\Scripts\python revisar.py`: corregís a mano. Arrastrar agrega una caja, clic derecho borra una caja y ESPACIO pasa a la siguiente.
   **Este paso define la calidad del entrenamiento.**
5. `.venv\Scripts\python entrenar.py`: entrena y compara contra el modelo original.
   Si mejora, deja `modelos/mito-personas.pt`. Copialo a las PCs de los locales y poné `"modelo": "modelos/mito-personas.pt"` en su `config.json`.

Las carpetas `dataset/`, `runs/` y `modelos/` no se suben a git porque tienen imágenes de clientes.

## Qué cuenta y cómo

| Métrica | Cómo se obtiene |
|---|---|
| **Entradas / salidas** | Modo `zonas`: pasar de la zona exterior (roja) a la interior (azul) y al revés. Modo `linea`: cruzar la línea según la flecha. |
| **Transeúntes** | Cruzar de la zona A a la B (o al revés) por la vereda sin entrar. En el hub: tasa de atracción = entradas / transeúntes. |
| **Personal** | Color de credencial/uniforme en el torso (se marca con `calibrar.py`, tecla 6). No suma a entradas ni salidas. |
| **Únicos / reingresos** | `"reid": true`: reconoce si la persona ya entró hoy. Además descarta el doble conteo cuando el seguimiento pierde y recupera a alguien en menos de `dedupe_segundos`. |

Para migrar un local ya calibrado en ContadorIA:
```
.venv\Scripts\python calibrar.py "Campo Puerta" --importar D:\ContadorIA\config_zonas.json
```

## Medir la precisión (antes y después de entrenar)

1. `.venv\Scripts\python grabar.py "Campo Puerta" --minutos 30`: graba un clip en `grabaciones/`, mejor en un horario con movimiento.
2. Contá a mano cuántos entran y salen en ese clip.
3. `.venv\Scripts\python evaluar.py grabaciones\<clip>.mp4 --camara "Campo Puerta" --real-entradas 42 --real-salidas 40`
   muestra lo que contó el sistema, el error en porcentaje y cuántos dobles conteos se evitaron. Con `--anotado revisar.mp4` genera un video con cajas y zonas para ver dónde falla.
4. Después de entrenar: el mismo comando con `--modelo modelos/mito-personas.pt` para comparar con el mismo clip.

## Ajustes finos (`config.json`)

| Campo | Para qué |
|---|---|
| `dispositivo` | `"auto"` usa la GPU NVIDIA si hay (recomendado) y si no, el procesador. `"cpu"` fuerza el procesador. |
| `modelo` | `yolo11n.pt` liviano (PC sin GPU), `yolo11s.pt` más preciso (con GPU), o `modelos/mito-personas.pt` entrenado. |
| `substream` | `0` = calidad principal (recomendado con GPU). `1` = calidad baja: en muchos DVR es 352×288 y la gente lejos no se detecta. |
| `punto` | `"pie"` cuenta por los pies (línea en el piso). `"centro"` cuenta por el centro del cuerpo (cámaras cenitales). |
| `confianza` | 0.3 a 0.6. Bajarlo si no detecta gente. Subirlo si cuenta cosas que no son personas. |
| `fps_proceso` | Cuadros por segundo analizados. 6 a 10 alcanza. Bajarlo si la PC va al 100 %. |
| `margen` (por cámara) | Zona muerta alrededor de la línea (0.02 = 2 % del alto) para no contar a quien queda parado encima. |
| `invertir` | Da vuelta entradas y salidas. |

## Problemas comunes

- **"no conecta al DVR"**: probá la URL en VLC (Medio → Abrir ubicación de red):
  `rtsp://usuario:clave@IP:554/cam/realmonitor?channel=1&subtype=1`.
  Si VLC tampoco la abre, revisá IP, usuario y clave, y que el RTSP esté habilitado en el DVR (Red → Puertos, RTSP 554).
- **Cuenta de más**: la línea está donde la gente se queda parada (ej. frente a la caja o a una vidriera). Movela al marco de la puerta.
- **Cuenta de menos**: la cámara ve a la gente tapándose. Subí `substream` a `0` o bajá `confianza`.
- **Logs**: `contador.log` en esta carpeta. Los conteos locales están en `conteos.db`.

## Seguridad

- El token solo permite **sumar conteos del local al que se registró**. Si se pierde o roban la PC, desactivá o borrá la PC en el hub.
- `config.json` tiene la clave del DVR y el token, y no se sube a git (`.gitignore`).
