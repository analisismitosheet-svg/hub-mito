"""
Saca una foto de cada canal del DVR y arma una hoja para identificar la cámara de la puerta.

    python ver_canales.py                 # canales 1 a 16 del "dvr" de config.json
    python ver_canales.py --hasta 8

Guarda canales_dvr.jpg (no se sube a git).
"""

from __future__ import annotations

import argparse
import json
import os

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;6000000")

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from contador import BASE, url_rtsp  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hasta", type=int, default=16)
    args = ap.parse_args()
    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))

    celdas = []
    for canal in range(1, args.hasta + 1):
        cap = cv2.VideoCapture(url_rtsp(cfg, {"canal": canal, "substream": 1}), cv2.CAP_FFMPEG)
        cuadro = None
        for _ in range(8):
            ok, c = cap.read()
            if ok:
                cuadro = c
        cap.release()
        img = cv2.resize(cuadro, (400, 225)) if cuadro is not None else np.zeros((225, 400, 3), np.uint8)
        cv2.putText(img, f"CANAL {canal}" + ("" if cuadro is not None else " (sin imagen)"), (8, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
        celdas.append(img)
        print(f"canal {canal}: {'ok' if cuadro is not None else 'sin imagen'}")
    while len(celdas) % 4:
        celdas.append(np.zeros((225, 400, 3), np.uint8))
    filas = [np.hstack(celdas[i:i + 4]) for i in range(0, len(celdas), 4)]
    cv2.imwrite(str(BASE / "canales_dvr.jpg"), np.vstack(filas))
    print("Listo: canales_dvr.jpg")


if __name__ == "__main__":
    main()
