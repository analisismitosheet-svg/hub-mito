"""
Junta imágenes de las cámaras para entrenar el modelo.

    python capturar.py "Entrada" --cada 3 --minutos 60     # en vivo desde el DVR
    python capturar.py --video backup_sabado.mp4 --cada 1  # desde una grabación exportada del DVR

Guarda en dataset/images/. Por defecto se queda solo con cuadros donde hay
gente (más un 10 % sin gente, que también hacen falta para que aprenda qué NO es una persona).

Tip: capturá distintos momentos: mañana, tarde, noche (infrarrojo), días de
lluvia, horas pico con mucha gente junta. La variedad importa más que la cantidad.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time
from datetime import datetime

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402

from contador import BASE, url_rtsp  # noqa: E402

DESTINO = BASE / "dataset" / "images"


def main() -> None:
    ap = argparse.ArgumentParser(description="Capturar imágenes para entrenar")
    ap.add_argument("camara", nargs="?", help="nombre de la cámara en config.json")
    ap.add_argument("--video", help="archivo de video en vez de la cámara en vivo")
    ap.add_argument("--cada", type=float, default=3, help="segundos entre capturas (default 3)")
    ap.add_argument("--minutos", type=float, default=30, help="duración en vivo (default 30)")
    ap.add_argument("--todas", action="store_true", help="guardar también cuadros sin gente")
    args = ap.parse_args()

    if args.video:
        origen, etiqueta = args.video, os.path.splitext(os.path.basename(args.video))[0]
    else:
        cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
        cam = next((c for c in cfg["camaras"] if c["nombre"] == args.camara), None)
        if not cam:
            raise SystemExit("Cámaras en config.json: " + ", ".join(c["nombre"] for c in cfg["camaras"]))
        origen, etiqueta = url_rtsp(cfg, cam), cam["nombre"]

    detector = None
    if not args.todas:
        from ultralytics import YOLO
        detector = YOLO(str(BASE / "yolo11n.pt"))

    DESTINO.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(origen, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        raise SystemExit("No se pudo abrir el video / la cámara.")

    fps_video = cap.get(cv2.CAP_PROP_FPS) or 25
    salto = max(1, int(fps_video * args.cada)) if args.video else 1
    fin = time.time() + args.minutos * 60
    ultimo, nro, guardadas = 0.0, 0, 0
    slug = "".join(ch if ch.isalnum() else "_" for ch in etiqueta)

    while True:
        ok, cuadro = cap.read()
        if not ok:
            if args.video:
                break
            time.sleep(0.2)
            continue
        nro += 1
        if args.video:
            if nro % salto:
                continue
        else:
            if time.time() > fin:
                break
            if time.time() - ultimo < args.cada:
                continue
            ultimo = time.time()

        if detector is not None:
            hay_gente = len(detector.predict(cuadro, classes=[0], conf=0.3, verbose=False)[0].boxes) > 0
            if not hay_gente and random.random() > 0.1:
                continue

        nombre = f"{slug}_{datetime.now():%Y%m%d_%H%M%S}_{nro:07d}.jpg"
        cv2.imwrite(str(DESTINO / nombre), cuadro, [cv2.IMWRITE_JPEG_QUALITY, 92])
        guardadas += 1
        print(f"\r{guardadas} imágenes guardadas", end="", flush=True)

    cap.release()
    total = len(list(DESTINO.glob("*.jpg")))
    print(f"\nListo. {guardadas} nuevas, {total} en total en dataset/images.")
    print("Siguiente paso: python autoetiquetar.py")


if __name__ == "__main__":
    main()
