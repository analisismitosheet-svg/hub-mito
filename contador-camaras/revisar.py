"""
Revisar y corregir las cajas de personas, imagen por imagen.

    python revisar.py            # sigue desde la primera sin revisar
    python revisar.py --todas    # recorre también las ya revisadas

En la ventana:
    arrastrar (clic izq.)   dibujar una caja nueva (persona que faltaba)
    clic derecho            borrar la caja donde hiciste clic (no era una persona / estaba repetida)
    ESPACIO o ENTER         está bien -> guardar y pasar a la siguiente
    a                       volver a la anterior
    z                       deshacer el último cambio
    b                       descartar la imagen (mala, borrosa, repetida)
    q                       salir (lo revisado queda guardado)

Reglas para marcar: una caja por persona, de la cabeza a los pies, incluyendo
la parte tapada si se adivina dónde está. Personas en carteles, maniquíes o
reflejos en vidrieras NO se marcan.
"""

from __future__ import annotations

import argparse
import shutil

import cv2

from contador import BASE

DS = BASE / "dataset"
IMAGENES, ETIQUETAS = DS / "images", DS / "labels"
REVISADAS = DS / "revisadas.txt"
DESCARTADAS = DS / "descartadas"
ANCHO_MAX = 1280


def leer_cajas(stem: str) -> list[list[float]]:
    ruta = ETIQUETAS / f"{stem}.txt"
    if not ruta.exists():
        return []
    cajas = []
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        partes = linea.split()
        if len(partes) == 5:
            cx, cy, w, h = map(float, partes[1:])
            cajas.append([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2])
    return cajas


def guardar_cajas(stem: str, cajas: list[list[float]]) -> None:
    lineas = []
    for x1, y1, x2, y2 in cajas:
        x1, x2 = sorted((max(0.0, x1), min(1.0, x2)))
        y1, y2 = sorted((max(0.0, y1), min(1.0, y2)))
        if x2 - x1 > 0.005 and y2 - y1 > 0.005:
            lineas.append(f"0 {(x1 + x2) / 2:.6f} {(y1 + y2) / 2:.6f} {x2 - x1:.6f} {y2 - y1:.6f}")
    ETIQUETAS.mkdir(parents=True, exist_ok=True)
    (ETIQUETAS / f"{stem}.txt").write_text("\n".join(lineas), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--todas", action="store_true")
    args = ap.parse_args()

    revisadas = set(REVISADAS.read_text(encoding="utf-8").split()) if REVISADAS.exists() else set()
    imagenes = sorted(IMAGENES.glob("*.jpg"))
    if not imagenes:
        raise SystemExit("No hay imágenes. Primero: python capturar.py")
    i = 0 if args.todas else next((k for k, p in enumerate(imagenes) if p.stem not in revisadas), None)
    if i is None:
        raise SystemExit(f"Las {len(imagenes)} imágenes ya están revisadas. Siguiente paso: python entrenar.py")

    estado = {"cajas": [], "historial": [], "arrastre": None, "mouse": (0, 0)}

    def al_mouse(evento, x, y, *_):
        W, H = estado["tam"]
        estado["mouse"] = (x, y)
        if evento == cv2.EVENT_LBUTTONDOWN:
            estado["arrastre"] = (x, y)
        elif evento == cv2.EVENT_LBUTTONUP and estado["arrastre"]:
            x0, y0 = estado["arrastre"]
            estado["arrastre"] = None
            if abs(x - x0) > 5 and abs(y - y0) > 5:
                estado["historial"].append([c[:] for c in estado["cajas"]])
                estado["cajas"].append([min(x0, x) / W, min(y0, y) / H, max(x0, x) / W, max(y0, y) / H])
        elif evento == cv2.EVENT_RBUTTONDOWN:
            nx, ny = x / W, y / H
            dentro = [k for k, (x1, y1, x2, y2) in enumerate(estado["cajas"]) if x1 <= nx <= x2 and y1 <= ny <= y2]
            if dentro:  # la más chica que contiene el clic
                k = min(dentro, key=lambda k: (estado["cajas"][k][2] - estado["cajas"][k][0]) * (estado["cajas"][k][3] - estado["cajas"][k][1]))
                estado["historial"].append([c[:] for c in estado["cajas"]])
                del estado["cajas"][k]

    cv2.namedWindow("revisar", cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback("revisar", al_mouse)

    def cargar(k: int):
        img = cv2.imread(str(imagenes[k]))
        if img.shape[1] > ANCHO_MAX:
            img = cv2.resize(img, (ANCHO_MAX, int(img.shape[0] * ANCHO_MAX / img.shape[1])))
        estado.update(cajas=leer_cajas(imagenes[k].stem), historial=[], arrastre=None,
                      tam=(img.shape[1], img.shape[0]))
        return img

    img = cargar(i)
    while True:
        W, H = estado["tam"]
        vista = img.copy()
        for n, (x1, y1, x2, y2) in enumerate(estado["cajas"], 1):
            cv2.rectangle(vista, (int(x1 * W), int(y1 * H)), (int(x2 * W), int(y2 * H)), (0, 220, 0), 2)
            cv2.putText(vista, str(n), (int(x1 * W) + 3, int(y1 * H) + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 220, 0), 2)
        if estado["arrastre"]:
            cv2.rectangle(vista, estado["arrastre"], estado["mouse"], (0, 200, 255), 1)
        ok = sum(1 for p in imagenes if p.stem in revisadas)
        cv2.putText(vista, f"{i + 1}/{len(imagenes)}  revisadas {ok}  personas {len(estado['cajas'])}"
                    "   ESPACIO ok | a atras | z deshacer | b descartar | q salir",
                    (8, H - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        cv2.imshow("revisar", vista)

        k = cv2.waitKey(20) & 0xFF
        if k in (ord("q"), 27):
            break
        if k in (32, 13):  # espacio / enter
            guardar_cajas(imagenes[i].stem, estado["cajas"])
            revisadas.add(imagenes[i].stem)
            REVISADAS.write_text("\n".join(sorted(revisadas)), encoding="utf-8")
            if i + 1 >= len(imagenes):
                print("¡Terminaste! Siguiente paso: python entrenar.py")
                break
            i += 1
            img = cargar(i)
        elif k == ord("a") and i > 0:
            i -= 1
            img = cargar(i)
        elif k == ord("z") and estado["historial"]:
            estado["cajas"] = estado["historial"].pop()
        elif k == ord("b"):
            DESCARTADAS.mkdir(parents=True, exist_ok=True)
            shutil.move(str(imagenes[i]), DESCARTADAS / imagenes[i].name)
            (ETIQUETAS / f"{imagenes[i].stem}.txt").unlink(missing_ok=True)
            revisadas.discard(imagenes[i].stem)
            del imagenes[i]
            if not imagenes:
                break
            i = min(i, len(imagenes) - 1)
            img = cargar(i)
    cv2.destroyAllWindows()
    print(f"Revisadas: {sum(1 for p in imagenes if p.stem in revisadas)} de {len(imagenes)}")


if __name__ == "__main__":
    main()
