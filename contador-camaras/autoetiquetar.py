"""
Pre-etiqueta las imágenes con un modelo grande (yolo11x) para no dibujar
todas las cajas a mano. Después se corrigen con revisar.py.

    python autoetiquetar.py

Solo procesa imágenes que todavía no tienen etiqueta (dataset/labels/*.txt).
Formato YOLO: una línea por persona -> "0 centro_x centro_y ancho alto" (0..1).
"""

from __future__ import annotations

import argparse

from contador import BASE

IMAGENES = BASE / "dataset" / "images"
ETIQUETAS = BASE / "dataset" / "labels"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", default="yolo11x.pt", help="modelo grande para pre-etiquetar")
    ap.add_argument("--confianza", type=float, default=0.35)
    args = ap.parse_args()

    from ultralytics import YOLO
    import torch

    ETIQUETAS.mkdir(parents=True, exist_ok=True)
    pendientes = [p for p in sorted(IMAGENES.glob("*.jpg")) if not (ETIQUETAS / f"{p.stem}.txt").exists()]
    if not pendientes:
        print("No hay imágenes nuevas sin etiquetar.")
        return

    dispositivo = 0 if torch.cuda.is_available() else "cpu"
    print(f"Pre-etiquetando {len(pendientes)} imágenes con {args.modelo} en {'GPU' if dispositivo == 0 else 'CPU'}...")
    modelo = YOLO(args.modelo)

    for i in range(0, len(pendientes), 16):
        lote = pendientes[i:i + 16]
        for ruta, res in zip(lote, modelo.predict([str(p) for p in lote], classes=[0], conf=args.confianza,
                                                 device=dispositivo, verbose=False)):
            lineas = [f"0 {x:.6f} {y:.6f} {w:.6f} {h:.6f}" for x, y, w, h in res.boxes.xywhn.tolist()]
            (ETIQUETAS / f"{ruta.stem}.txt").write_text("\n".join(lineas), encoding="utf-8")
        print(f"\r{min(i + 16, len(pendientes))}/{len(pendientes)}", end="", flush=True)

    print("\nListo. Siguiente paso: python revisar.py (corregir las cajas a mano)")


if __name__ == "__main__":
    main()
