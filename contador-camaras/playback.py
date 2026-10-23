"""
Descarga un tramo grabado del DVR (playback) por el SDK de Dahua y lo convierte a .mp4.

    python playback.py "Espinosa Puerta" --desde "2026-10-21 10:00" --hasta "2026-10-21 11:00"

Guarda en grabaciones/<camara>_<YYYYMMDD_HHMM>.dav (crudo) y .mp4 (para mirarlo). Usa el
login de la cámara en config.json (bloque "sdk"). El horario se da en el huso del DVR
(Argentina, UTC-3). Para verificar un conteo: bajar el tramo, mirarlo y comparar con el
número que muestra el Contador de clientes. Si no hay grabación en ese rango, avisa con
"no abrió el playback (error 85)".
"""

from __future__ import annotations

import argparse
import ctypes
import json
import time
from ctypes import POINTER, WINFUNCTYPE, byref, c_int, c_longlong, c_uint, c_void_p
from datetime import datetime
from pathlib import Path

import av
import cv2

from dahua import BASE, SDK, _Tubo  # noqa: F401


class NET_TIME(ctypes.Structure):
    """NET_TIME del NetSDK (hora local del DVR)."""
    _fields_ = [
        ("year", c_uint), ("month", c_uint), ("day", c_uint),
        ("hour", c_uint), ("minute", c_uint), ("second", c_uint),
    ]


# Callback de datos del PLAYBACK: (lPlayHandle, dwDataType, pBuffer, dwBufSize, dwUser)
_CB_PLAYBACK = WINFUNCTYPE(None, c_longlong, c_uint, POINTER(ctypes.c_ubyte), c_uint, c_longlong)


def _nt(dt: datetime) -> NET_TIME:
    return NET_TIME(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)


def descargar(sdk: SDK, h: int, canal: int, desde: datetime, hasta: datetime, ruta_dav: Path) -> tuple[int, float, dict]:
    """Baja el playback [desde, hasta) del canal crudo a .dav. Devuelve (bytes, segundos, por_tipo)."""
    d = sdk.dll
    d.CLIENT_PlayBackByTimeEx.argtypes = [
        c_longlong, c_int, POINTER(NET_TIME), POINTER(NET_TIME),
        c_void_p,       # hWnd (NULL en consola)
        c_void_p,       # cbDownLoadPos (NULL)
        c_longlong,     # dwPosUser
        _CB_PLAYBACK,   # fDownLoadDataCallBack
        c_longlong,     # dwDataUser
    ]
    d.CLIENT_PlayBackByTimeEx.restype = c_longlong
    d.CLIENT_StopPlayBack.argtypes = [c_longlong]
    d.CLIENT_StopPlayBack.restype = ctypes.c_bool

    estado = {"bytes": 0, "ultimo": time.time(), "por_tipo": {}}

    def cb(_h, tipo, buf, n, _u):
        if n:
            estado["por_tipo"][tipo] = estado["por_tipo"].get(tipo, 0) + n
            if tipo == 0:
                data = ctypes.string_at(buf, n)
                estado["bytes"] += len(data)
                estado["ultimo"] = time.time()
                f.write(data)

    ref = _CB_PLAYBACK(cb)
    f = open(ruta_dav, "wb")
    ini, fin = _nt(desde), _nt(hasta)
    ph = d.CLIENT_PlayBackByTimeEx(h, canal - 1, byref(ini), byref(fin), None, None, 0, ref, 0)
    if not ph:
        f.close()
        raise RuntimeError(f"no abrió el playback (error {d.CLIENT_GetLastError() & 0x7fffffff})")

    duracion = (hasta - desde).total_seconds()
    limite = time.time() + duracion * 2 + 180
    sin_datos = 45.0
    t0 = time.time()
    try:
        while time.time() < limite:
            time.sleep(2)
            if time.time() - estado["ultimo"] > sin_datos:
                break
    finally:
        d.CLIENT_StopPlayBack(ph)
        f.close()
        del ref
    return estado["bytes"], time.time() - t0, estado["por_tipo"]


def dav_a_mp4(ruta_dav: Path, ruta_mp4: Path) -> int:
    """Re-encoda el .dav a mp4 (mp4v) con el mismo fps de la fuente. Devuelve los cuadros."""
    cont = av.open(str(ruta_dav))
    st = cont.streams.video[0]
    fps = float(st.average_rate) if st.average_rate and st.average_rate > 0 else 15.0
    salida, n = None, 0
    for frame in cont.decode(video=0):
        img = frame.to_ndarray(format="bgr24")
        if salida is None:
            a, an = img.shape[:2]
            salida = cv2.VideoWriter(str(ruta_mp4), cv2.VideoWriter_fourcc(*"mp4v"), fps, (an, a))
        salida.write(img)
        n += 1
    if salida:
        salida.release()
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("camara")
    ap.add_argument("--desde", required=True, help='"AAAA-MM-DD HH:MM" (hora del DVR)')
    ap.add_argument("--hasta", required=True, help='"AAAA-MM-DD HH:MM" (hora del DVR)')
    args = ap.parse_args()

    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
    cam = next((c for c in cfg["camaras"] if c["nombre"] == args.camara), None)
    if not cam:
        raise SystemExit("Cámaras en config.json: " + ", ".join(c["nombre"] for c in cfg["camaras"]))
    sdk_cfg = cam.get("sdk") or {}
    desde = datetime.strptime(args.desde, "%Y-%m-%d %H:%M")
    hasta = datetime.strptime(args.hasta, "%Y-%m-%d %H:%M")
    if hasta <= desde:
        raise SystemExit("--hasta tiene que ser después de --desde")

    sdk = SDK.obtener(cfg)
    host = sdk_cfg.get("host", cfg["dvr"]["ip"])
    puerto = int(sdk_cfg.get("puerto", 37777))
    usuario = sdk_cfg.get("usuario", cfg["dvr"]["usuario"])
    clave = sdk_cfg.get("clave", cfg["dvr"]["clave"])
    canal = int(sdk_cfg.get("canal", cam.get("canal", 1)))

    h, info, err = sdk.login(host, puerto, usuario, clave, p2p=bool(sdk_cfg.get("p2p")))
    if not h:
        raise SystemExit(f"No entró al DVR ({host}): {err}")

    carpeta = BASE / "grabaciones"
    carpeta.mkdir(exist_ok=True)
    slug = "".join(ch if ch.isalnum() else "_" for ch in cam["nombre"])
    ruta_dav = carpeta / f"{slug}_{desde:%Y%m%d_%H%M}.dav"

    try:
        print(f"Descargando {cam['nombre']} canal {canal}: {desde:%H:%M} -> {hasta:%H:%M} ...", flush=True)
        nbytes, seg, por_tipo = descargar(sdk, h, canal, desde, hasta, ruta_dav)
        tam = ruta_dav.stat().st_size / 1024 / 1024
        print(f"Bajado: {ruta_dav.name} ({nbytes} bytes = {tam:.1f} MB en {seg:.0f} s)")
        if nbytes == 0:
            print("No llegó nada: no hay grabación en ese rango (o el canal no graba).")
        else:
            ruta_mp4 = ruta_dav.with_suffix(".mp4")
            n = dav_a_mp4(ruta_dav, ruta_mp4)
            print(f"Video: {ruta_mp4.name} ({n} cuadros, ~{n / 15:.0f} s)")
    finally:
        sdk.logout(h)


if __name__ == "__main__":
    main()
