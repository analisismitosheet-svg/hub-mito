"""
Graba un clip de una cámara para medir el conteo (evaluar.py) o sacar imágenes (capturar.py --video).

    python grabar.py "Campo Puerta" --minutos 30

Guarda en grabaciones/<camara>_<fecha>.mp4 a 10 cuadros por segundo.
Grabá en horario con movimiento (ej. sábado a la tarde) y contá a mano en paralelo,
o mirá el video después, para tener el número real contra el cual comparar.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402

from contador import BASE, Lector, url_rtsp  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("camara")
    ap.add_argument("--minutos", type=float, default=30)
    ap.add_argument("--fps", type=float, default=10)
    args = ap.parse_args()

    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
    cam = next((c for c in cfg["camaras"] if c["nombre"] == args.camara), None)
    if not cam:
        raise SystemExit("Cámaras en config.json: " + ", ".join(c["nombre"] for c in cfg["camaras"]))

    lector = Lector(cam["nombre"], url_rtsp(cfg, cam))
    lector.start()
    carpeta = BASE / "grabaciones"
    carpeta.mkdir(exist_ok=True)
    slug = "".join(ch if ch.isalnum() else "_" for ch in cam["nombre"])
    ruta = carpeta / f"{slug}_{datetime.now():%Y%m%d_%H%M}.mp4"

    salida, fin, cuadros = None, time.time() + args.minutos * 60, 0
    periodo = 1.0 / args.fps
    proximo = time.time()
    while time.time() < fin:
        _, cuadro = lector.ultimo()
        if cuadro is None or time.time() < proximo:
            time.sleep(0.01)
            continue
        proximo += periodo
        if salida is None:
            alto, ancho = cuadro.shape[:2]
            salida = cv2.VideoWriter(str(ruta), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (ancho, alto))
        salida.write(cuadro)
        cuadros += 1
        if cuadros % int(args.fps * 30) == 0:
            print(f"\r{cuadros / args.fps / 60:.1f} de {args.minutos:.0f} min grabados", end="", flush=True)
    if salida:
        salida.release()
    print(f"\nListo: {ruta} ({cuadros} cuadros). Para medir: python evaluar.py \"{ruta}\" --camara \"{cam['nombre']}\"")


if __name__ == "__main__":
    main()
