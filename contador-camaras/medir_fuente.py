"""
Mide el techo REAL de cada cámara: cuántos cuadros por segundo entrega el DVR con el
stream que está usando, y a qué resolución. Sirve para saber si el límite es la placa,
el DVR o la red. Es solo lectura: NO toca al contador que está corriendo.

Se mide de a una cámara por vez a propósito: si se piden todas juntas se reparten el
ancho de banda del DVR y el número miente.

    python medir_fuente.py                      # 20 s por cámara, todas las activas
    python medir_fuente.py --segundos 10 --camara "Munoz Puerta"
"""

from __future__ import annotations

import argparse
import ctypes
import json
import time

from contador import BASE, url_rtsp
from dahua import _CB_DATOS, SDK, _Tubo


def medir_sdk(nombre: str, datos: dict, cfg: dict, segundos: float) -> dict:
    import av

    sdk = SDK.obtener(cfg)
    d = sdk.dll
    h, info, motivo = sdk.login(datos["host"], int(datos.get("puerto", 37777)), datos["usuario"], datos["clave"],
                                p2p=bool(datos.get("p2p")))
    if not h:
        return {"nombre": nombre, "error": f"DVR: {motivo}"}

    tipo = 3 if datos.get("stream") == "secundario" else 0
    tubo = _Tubo(espera=segundos + 5)

    def cb(_h, _tipo, buf, n, _p, _u):
        if _tipo == 0:
            tubo.escribir(ctypes.string_at(buf, n))

    ref = _CB_DATOS(cb)
    rh = d.CLIENT_RealPlayEx(h, int(datos.get("canal", 1)) - 1, None, tipo)
    if not rh:
        sdk.logout(h)
        return {"nombre": nombre, "error": f"no abre el canal {datos.get('canal')}"}

    ncuadros, resolucion = 0, ""
    d.CLIENT_SetRealDataCallBackEx2(rh, ref, 0, 0x1)
    arranque = time.time()
    try:
        cont = av.open(tubo, format="dhav")
        for frame in cont.decode(video=0):
            ncuadros += 1
            resolucion = f"{frame.width}x{frame.height}"
            if time.time() - arranque >= segundos:
                break
    except Exception as e:  # noqa: BLE001
        if not ncuadros:
            return {"nombre": nombre, "error": f"{type(e).__name__}"}
    finally:
        d.CLIENT_StopRealPlayEx(rh)
        tubo.cerrar()
        sdk.logout(h)
        del ref

    transcurrido = max(time.time() - arranque, 1e-3)
    return {"nombre": nombre, "fps": ncuadros / transcurrido, "resolucion": resolucion, "canal": info.canales}


def medir_rtsp(nombre: str, url: str, segundos: float) -> dict:
    import cv2

    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        return {"nombre": nombre, "error": "no conecta al RTSP"}
    ncuadros, resolucion, fin = 0, "", time.time() + segundos
    while time.time() < fin:
        ok, cuadro = cap.read()
        if not ok:
            break
        ncuadros += 1
        resolucion = f"{cuadro.shape[1]}x{cuadro.shape[0]}"
    cap.release()
    return {"nombre": nombre, "fps": ncuadros / segundos, "resolucion": resolucion}


def main() -> None:
    ap = argparse.ArgumentParser(description="Medir los FPS que entrega cada cámara")
    ap.add_argument("--segundos", type=float, default=20)
    ap.add_argument("--camara", help="medir solo esta cámara")
    args = ap.parse_args()

    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
    activas = [c for c in cfg["camaras"] if c.get("activa", True)]
    if args.camara:
        elegidas = [c for c in activas if c["nombre"] == args.camara]
        activas = elegidas or activas[:1]

    print(f"Midiendo {args.segundos:.0f} s por cámara, de a una ({len(activas)} activas).\n")
    resultados = []
    for cam in activas:
        print(f"  {cam['nombre']} ...", end="", flush=True)
        if cam.get("sdk"):
            r = medir_sdk(cam["nombre"], cam["sdk"], cfg, args.segundos)
        else:
            r = medir_rtsp(cam["nombre"], url_rtsp(cfg, cam), args.segundos)
        resultados.append(r)
        print(f" {r['error']}" if r.get("error") else f" {r['fps']:.1f} FPS @ {r['resolucion']}")

    print("\n%-32s %8s %12s %6s" % ("cámara", "FPS", "resolución", "canales"))
    for r in resultados:
        if r.get("error"):
            print("%-32s %8s %12s %6s" % (r["nombre"], "--", r["error"], ""))
        else:
            print("%-32s %8.1f %12s %6s" % (r["nombre"], r["fps"], r["resolucion"], r.get("canal", "")))

    validos = [r["fps"] for r in resultados if not r.get("error")]
    if validos:
        promedio = sum(validos) / len(validos)
        print(f"\nTecho promedio de la fuente: {promedio:.1f} FPS por cámara")
        print("Si queda por debajo de 8, el límite es el DVR/la red y no la placa.")


if __name__ == "__main__":
    main()
