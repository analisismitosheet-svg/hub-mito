"""
Foto de cada canal de uno o varios DVR por la librería de Dahua (como SmartPSS), en una hoja por
local, para identificar la cámara de la puerta. Usa el stream secundario (más liviano).

    python ver_canales_sdk.py dvrs_indonesia.json            # todos los que entraron
    python ver_canales_sdk.py dvrs_indonesia.json LIBERD     # uno solo

El JSON sale de probar los logins (local, host, puerto, usuario, p2p). La clave se pide o va en DAHUA_CLAVE.
Guarda canales/<LOCAL>.jpg (no se sube a git: son imágenes de clientes).
"""

from __future__ import annotations

import ctypes
import getpass
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from ctypes import c_int, c_longlong, c_uint, c_void_p
from pathlib import Path

import av
import cv2
import numpy as np

from dahua import SDK, _CB_DATOS, _Tubo

BASE = Path(__file__).resolve().parent


def foto_canal(sdk: SDK, h: int, canal: int, segundos: float = 6.0):
    d = sdk.dll
    tubo = _Tubo(espera=segundos)

    def cb(_h, tipo, buf, n, _p, _u):
        if tipo == 0:
            tubo.escribir(ctypes.string_at(buf, n))

    ref = _CB_DATOS(cb)
    rh = d.CLIENT_RealPlayEx(h, canal - 1, None, 3)  # stream secundario
    if not rh:
        return None
    d.CLIENT_SetRealDataCallBackEx2(rh, ref, 0, 0x1)
    img, fin = None, time.time() + segundos
    try:
        cont = av.open(tubo, format="dhav")
        for frame in cont.decode(video=0):
            img = frame.to_ndarray(format="bgr24")
            if time.time() > fin - segundos / 2:  # un cuadro ya "asentado", no el primero gris
                break
    except Exception:  # noqa: BLE001
        pass
    finally:
        d.CLIENT_StopRealPlayEx(rh)
        tubo.cerrar()
    return img


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
    sdk.dll.CLIENT_RealPlayEx.argtypes = [c_longlong, c_int, c_void_p, c_int]
    sdk.dll.CLIENT_RealPlayEx.restype = c_longlong
    sdk.dll.CLIENT_SetRealDataCallBackEx2.argtypes = [c_longlong, _CB_DATOS, c_longlong, c_uint]
    sdk.dll.CLIENT_StopRealPlayEx.argtypes = [c_longlong]
    with ThreadPoolExecutor(max_workers=4) as ex:  # varios DVR a la vez, canales de a uno por DVR
        for r in ex.map(lambda d: hoja_local(sdk, d, clave), dvrs):
            print(r, flush=True)


if __name__ == "__main__":
    main()
