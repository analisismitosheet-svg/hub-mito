"""
Mide qué tan bien cuenta: pasa el contador (misma lógica y config que en vivo)
sobre una grabación y muestra los totales, para compararlos con un conteo a mano.

    python evaluar.py grabaciones/Campo_Puerta_20260924_1600.mp4 --camara "Campo Puerta"
    python evaluar.py video.mp4 --camara "Campo Puerta" --real-entradas 42 --real-salidas 39
    python evaluar.py video.mp4 --camara "Campo Puerta" --modelo modelos/mito-personas.pt   # comparar modelos
    python evaluar.py video.mp4 --camara "Campo Puerta" --anotado revisar.mp4               # video con cajas y zonas

No sube nada al hub (usa una base temporal). Corre en la GPU si hay.
"""

from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path

import cv2

from contador import BASE, CAMPOS, Almacen, Camara, configurar_log


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--camara", required=True)
    ap.add_argument("--modelo", help="otro modelo (ej. modelos/mito-personas.pt) en vez del de config.json")
    ap.add_argument("--fps", type=float, help="cuadros por segundo a analizar (default: fps_proceso de config.json)")
    ap.add_argument("--real-entradas", type=int)
    ap.add_argument("--real-salidas", type=int)
    ap.add_argument("--anotado", help="guardar video con las detecciones dibujadas")
    ap.add_argument("--ver", action="store_true")
    ap.add_argument("--traza", help="CSV con la posición de cada persona en cada cuadro (para depurar)")
    ap.add_argument("--capturas", help="carpeta donde guardar una imagen por cada evento contado (para revisarlos)")
    args = ap.parse_args()

    configurar_log()
    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
    if args.modelo:
        cfg["modelo"] = args.modelo
    cam = next((c for c in cfg["camaras"] if c["nombre"] == args.camara), None)
    if not cam:
        raise SystemExit("Cámaras en config.json: " + ", ".join(c["nombre"] for c in cfg["camaras"]))

    almacen = Almacen(Path(tempfile.mkdtemp()) / "eval.db")
    camara = Camara(cfg, cam, almacen, ver=bool(args.anotado or args.ver or args.capturas))
    if args.capturas:
        Path(args.capturas).mkdir(parents=True, exist_ok=True)
    modelo = camara.cargar_modelo()
    camara.reloj = lambda: nro / fps_video  # esperas y dobles conteos en tiempo de VIDEO, no de proceso
    traza = open(args.traza, "w", encoding="utf-8") if args.traza else None
    if traza:
        traza.write("seg,tid,x,y,zona\n")
        camara.traza = lambda tid, x, y, z: traza.write(f"{nro / fps_video:.2f},{tid},{x:.3f},{y:.3f},{z}\n")

    cap = cv2.VideoCapture(args.video)
    fps_video = cap.get(cv2.CAP_PROP_FPS) or 25
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    fps_objetivo = args.fps or float(cfg.get("fps_proceso", 8))
    salto = max(1, round(fps_video / fps_objetivo))
    escritor = None
    nro, t0 = 0, time.time()

    while True:
        ok, cuadro = cap.read()
        if not ok:
            break
        nro += 1
        if nro % salto:
            continue
        antes = len(camara.eventos)
        camara.procesar(camara.detectar(modelo, cuadro), cuadro)
        if args.capturas and len(camara.eventos) > antes and camara.vista is not None:
            seg = nro / fps_video
            for ev in camara.eventos[antes:]:
                nombre = f"{len(list(Path(args.capturas).glob('*.jpg'))) + 1:03d}_{int(seg // 60):02d}m{int(seg % 60):02d}s_{ev}.jpg"
                cv2.imwrite(str(Path(args.capturas) / nombre), camara.vista)
        if camara.vista is not None:
            if args.anotado:
                if escritor is None:
                    h, w = camara.vista.shape[:2]
                    escritor = cv2.VideoWriter(args.anotado, cv2.VideoWriter_fourcc(*"mp4v"), fps_video / salto, (w, h))
                escritor.write(camara.vista)
            if args.ver:
                cv2.imshow("evaluar", camara.vista)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
        if total and nro % (salto * 200) == 0:
            print(f"\r{100 * nro / total:.0f}%", end="", flush=True)

    if escritor:
        escritor.release()
    if traza:
        traza.close()
    duracion = nro / fps_video
    res = almacen.hoy(camara.nombre)
    print(f"\n\n===== {Path(args.video).name}  ({duracion / 60:.1f} min de video en {time.time() - t0:.0f} s) =====")
    for c in CAMPOS:
        print(f"  {c:<12} {res[c]}")
    print(f"  {'descartadas':<12} {camara.eventos.count('duplicado')}  (dobles conteos evitados por reid)")
    for nombre, real in (("entradas", args.real_entradas), ("salidas", args.real_salidas)):
        if real:
            err = res[nombre] - real
            print(f"  {nombre}: contó {res[nombre]} vs real {real} -> error {err:+d} ({100 * abs(err) / real:.1f} %)")


if __name__ == "__main__":
    main()
