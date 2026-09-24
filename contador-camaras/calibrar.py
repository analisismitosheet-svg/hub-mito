"""
Configurar el conteo de una cámara dibujando sobre una imagen en vivo.

    python calibrar.py                                   # lista las cámaras de config.json
    python calibrar.py "Entrada"                         # abre un cuadro en vivo de esa cámara
    python calibrar.py "Campo Puerta" --importar D:\\ContadorIA\\config_zonas.json
                                                         # trae las zonas ya dibujadas en ContadorIA

Teclas (elegís qué dibujar y después hacés clics):
    1   LÍNEA de conteo (2 clics) — modo línea
    2   zona EXTERIOR (roja: puerta/vereda) — clics = vértices
    3   zona INTERIOR (azul: dentro del local) — clics = vértices
    4   zona A de transeúntes (vereda, un lado)       5   zona B (vereda, el otro lado)
    6   color de CREDENCIAL/uniforme: arrastrá un rectángulo SOLO sobre la credencial
    i   invertir sentido de la línea (flecha verde = hacia ADENTRO)
    m   cambiar modo de conteo (línea <-> zonas)
    c   borrar lo que estás dibujando          r   refrescar imagen
    g   guardar en config.json                 q / Esc  salir sin guardar

Zonas: la persona cuenta como ENTRADA cuando pasa de la roja a la azul (y SALIDA al revés).
Transeúnte: cruza de A a B (o al revés) sin entrar. A y B van sobre la vereda/pasillo, a cada lado de la puerta.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from contador import BASE, url_rtsp  # noqa: E402

RUTA = BASE / "config.json"
CAPAS = {  # tecla: (clave en config, nombre, color BGR)
    "1": ("linea", "LINEA", (0, 255, 255)),
    "2": ("zona_exterior", "EXTERIOR", (0, 0, 255)),
    "3": ("zona_interior", "INTERIOR", (255, 0, 0)),
    "4": ("zona_a", "ZONA A", (0, 200, 255)),
    "5": ("zona_b", "ZONA B", (255, 200, 0)),
}


def capturar(url: str):
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    cuadro = None
    for _ in range(15):  # descartar los primeros cuadros (suelen venir grises)
        ok, c = cap.read()
        if ok:
            cuadro = c
    cap.release()
    return cuadro


def importar_contadoria(ruta: str, cam: dict) -> None:
    """Convierte config_zonas.json de ContadorIA (píxeles a 960x540) a coordenadas 0..1."""
    viejo = json.loads(open(ruta, encoding="utf-8").read())
    w, h = 960, 540

    def norm(puntos):
        return [[round(x / w, 4), round(y / h, 4)] for x, y in puntos] if puntos else None

    cam["modo"] = "zonas"
    cam["zona_exterior"] = norm(viejo.get("poligono_rojo"))
    cam["zona_interior"] = norm(viejo.get("poligono_azul"))
    cam["zona_a"] = norm(viejo.get("zona_a"))
    cam["zona_b"] = norm(viejo.get("zona_b"))
    hsv = viejo.get("emp_credencial_hsv")
    if hsv and any(any(v) for v in hsv):
        cam["empleados"] = {"activo": bool(viejo.get("emp_credencial_on")), "hsv_min": hsv[0], "hsv_max": hsv[1],
                            "frac_min": viejo.get("emp_frac_min", 0.04)}


def rango_hsv(recorte) -> tuple[list[int], list[int]]:
    """Rango HSV que cubre el color de la credencial (percentiles 5-95, con margen)."""
    hsv = cv2.cvtColor(recorte, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    bajo = np.percentile(hsv, 5, axis=0) - [8, 40, 40]
    alto = np.percentile(hsv, 95, axis=0) + [8, 40, 40]
    return np.clip(bajo, 0, [179, 255, 255]).astype(int).tolist(), np.clip(alto, 0, [179, 255, 255]).astype(int).tolist()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("camara", nargs="?")
    ap.add_argument("--importar", help="config_zonas.json de ContadorIA")
    ap.add_argument("--solo-importar", action="store_true", help="importar y salir sin abrir la ventana")
    args = ap.parse_args()

    cfg = json.loads(RUTA.read_text(encoding="utf-8"))
    nombres = [c["nombre"] for c in cfg["camaras"]]
    if args.camara not in nombres:
        print("Cámaras en config.json:", ", ".join(nombres) or "(ninguna)")
        print('Uso: python calibrar.py "<nombre>"')
        return
    cam = next(c for c in cfg["camaras"] if c["nombre"] == args.camara)

    if args.importar:
        importar_contadoria(args.importar, cam)
        RUTA.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Zonas de ContadorIA importadas en '{cam['nombre']}' (modo zonas). Revisalas abriendo el calibrador.")
        if args.solo_importar:
            return

    url = url_rtsp(cfg, cam)
    print("Conectando al DVR...")
    base = capturar(url)
    if base is None:
        sys.exit("No se pudo leer video. Revisá IP, usuario, clave y canal en config.json.")
    alto, ancho = base.shape[:2]

    capas = {clave: [tuple(p) for p in (cam.get(clave) or [])] for clave, _, _ in CAPAS.values()}
    invertir = bool(cam.get("invertir", False))
    modo = cam.get("modo", "zonas" if cam.get("zona_interior") else "linea")
    empleados = cam.get("empleados") or {}
    actual = "1" if modo == "linea" else "2"
    arrastre = {"ini": None, "fin": None}

    def clic(evento, x, y, *_):
        if actual == "6":
            if evento == cv2.EVENT_LBUTTONDOWN:
                arrastre["ini"], arrastre["fin"] = (x, y), (x, y)
            elif evento == cv2.EVENT_MOUSEMOVE and arrastre["ini"]:
                arrastre["fin"] = (x, y)
            elif evento == cv2.EVENT_LBUTTONUP and arrastre["ini"]:
                (x0, y0), (x1, y1) = arrastre["ini"], (x, y)
                arrastre["ini"] = None
                recorte = base[min(y0, y1):max(y0, y1), min(x0, x1):max(x0, x1)]
                if recorte.size >= 20:
                    hmin, hmax = rango_hsv(recorte)
                    empleados.update(activo=True, hsv_min=hmin, hsv_max=hmax, frac_min=empleados.get("frac_min", 0.04))
                    print(f"Color de credencial: HSV {hmin} .. {hmax}")
            return
        if evento == cv2.EVENT_LBUTTONDOWN:
            clave = CAPAS[actual][0]
            if clave == "linea" and len(capas[clave]) >= 2:
                capas[clave] = []
            capas[clave].append((x / ancho, y / alto))

    cv2.namedWindow("calibrar")
    cv2.setMouseCallback("calibrar", clic)
    while True:
        img = base.copy()
        if empleados.get("activo"):
            hsv = cv2.cvtColor(base, cv2.COLOR_BGR2HSV)
            mascara = cv2.inRange(hsv, np.array(empleados["hsv_min"], np.uint8), np.array(empleados["hsv_max"], np.uint8))
            img[mascara > 0] = (255, 0, 255)  # en violeta: lo que se tomaría como credencial
        for tecla, (clave, nombre, color) in CAPAS.items():
            pix = [(int(px * ancho), int(py * alto)) for px, py in capas[clave]]
            grosor = 3 if tecla == actual else 1
            for p in pix:
                cv2.circle(img, p, 4, color, -1)
            if clave == "linea" and len(pix) == 2:
                (ax, ay), (bx, by) = pix
                cv2.line(img, pix[0], pix[1], color, grosor)
                dx, dy = bx - ax, by - ay
                largo = (dx * dx + dy * dy) ** 0.5 or 1
                nx, ny = -dy / largo, dx / largo
                if invertir:
                    nx, ny = -nx, -ny
                mx, my = (ax + bx) // 2, (ay + by) // 2
                cv2.arrowedLine(img, (int(mx - nx * 40), int(my - ny * 40)), (int(mx + nx * 60), int(my + ny * 60)),
                                (0, 220, 0), 3, tipLength=0.35)
            elif len(pix) >= 2:
                cv2.polylines(img, [np.array(pix)], len(pix) >= 3, color, grosor)
                cv2.putText(img, nombre, pix[0], cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        if arrastre["ini"]:
            cv2.rectangle(img, arrastre["ini"], arrastre["fin"], (255, 0, 255), 1)
        dibujando = "CREDENCIAL (arrastrar)" if actual == "6" else CAPAS[actual][1]
        barra = f"MODO: {modo.upper()} | dibujando: {dibujando} | 1 linea 2 ext 3 int 4 A 5 B 6 credencial | i m c r g q"
        cv2.rectangle(img, (0, alto - 26), (ancho, alto), (0, 0, 0), -1)
        cv2.putText(img, barra, (8, alto - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        cv2.imshow("calibrar", img)

        k = cv2.waitKey(30) & 0xFF
        ch = chr(k) if k < 128 else ""
        if k in (ord("q"), 27):
            print("Salí sin guardar.")
            break
        if ch in CAPAS or ch == "6":
            actual = ch
        elif ch == "i":
            invertir = not invertir
        elif ch == "m":
            modo = "zonas" if modo == "linea" else "linea"
        elif ch == "c":
            if actual == "6":
                empleados["activo"] = False
            else:
                capas[CAPAS[actual][0]] = []
        elif ch == "r":
            nuevo = capturar(url)
            base = nuevo if nuevo is not None else base
        elif ch == "g":
            if modo == "linea" and len(capas["linea"]) != 2:
                print("Modo línea: marcá los dos puntos de la línea (tecla 1).")
                continue
            if modo == "zonas" and (len(capas["zona_exterior"]) < 3 or len(capas["zona_interior"]) < 3):
                print("Modo zonas: dibujá la zona exterior (2) y la interior (3), de 3 puntos o más.")
                continue
            for clave, _, _ in CAPAS.values():
                cam[clave] = [[round(x, 4), round(y, 4)] for x, y in capas[clave]] or None
            cam["modo"], cam["invertir"] = modo, invertir
            cam["empleados"] = empleados or None
            RUTA.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"Guardado en {RUTA.name}. Reiniciá el contador para que tome los cambios.")
            break
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
