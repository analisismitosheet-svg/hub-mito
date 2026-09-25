"""
Foto de cada canal de uno o varios DVR por la librería de Dahua (como SmartPSS), en una hoja por
local, para identificar la cámara de la puerta. Usa el stream secundario (más liviano).

    python ver_canales_sdk.py dvrs_indonesia.json            # todos los que entraron
    python ver_canales_sdk.py dvrs_indonesia.json LIBERD     # uno solo

El JSON sale de probar los logins (local, host, puerto, usuario, p2p). La clave se pide o va en DAHUA_CLAVE.
Guarda canales/<LOCAL>.jpg (no se sube a git: son imágenes de clientes).
"""

from __future__ import annotations

import getpass
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

from dahua import SDK, foto_canal

BASE = Path(__file__).resolve().parent


def hoja_local(sdk: SDK, dvr: dict, clave: str) -> str:
    h, info, err = sdk.login(dvr["host"], dvr["puerto"], dvr["usuario"], clave, p2p=dvr.get("p2p", False))
    if not h:
        return f"{dvr['local']}: no entró ({err})"
    celdas = []
    try:
        for canal in range(1, (info.canales or 16) + 1):
            img = foto_canal(sdk, h, canal)
            celda = cv2.resize(img, (360, 203)) if img is not None else np.zeros((203, 360, 3), np.uint8)
            cv2.rectangle(celda, (0, 0), (150, 30), (0, 0, 0), -1)
            cv2.putText(celda, f"CANAL {canal}", (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            celdas.append(celda)
    finally:
        sdk.logout(h)
    while len(celdas) % 4:
        celdas.append(np.zeros((203, 360, 3), np.uint8))
    hoja = np.vstack([np.hstack(celdas[i:i + 4]) for i in range(0, len(celdas), 4)])
    (BASE / "canales").mkdir(exist_ok=True)
    cv2.imwrite(str(BASE / "canales" / f"{dvr['local']}.jpg"), hoja)
    return f"{dvr['local']}: {len([c for c in celdas if c.any()])} canales con imagen"


def main() -> None:
    dvrs = [d for d in json.load(open(sys.argv[1], encoding="utf-8")) if d.get("ok")]
    if len(sys.argv) > 2:
        dvrs = [d for d in dvrs if d["local"] in sys.argv[2:]]
    clave = os.environ.get("DAHUA_CLAVE") or getpass.getpass("Clave de los DVR: ")
    sdk = SDK.obtener()
    with ThreadPoolExecutor(max_workers=4) as ex:  # varios DVR a la vez, canales de a uno por DVR
        for r in ex.map(lambda d: hoja_local(sdk, d, clave), dvrs):
            print(r, flush=True)


if __name__ == "__main__":
    main()
