"""
Ajusta (fine-tuning) el detector de personas con las imágenes de NUESTRAS cámaras.

    python entrenar.py                  # yolo11n, 60 épocas
    python entrenar.py --epocas 100
    python entrenar.py --base yolo11s.pt   # modelo algo más grande (más preciso, más lento en la PC del local)

Usa solo las imágenes marcadas como revisadas (revisar.py). Primero mide qué
tan bien detecta el modelo original en nuestras imágenes, entrena, y compara.
El resultado queda en modelos/mito-personas.pt. Para usarlo, en config.json:
    "modelo": "modelos/mito-personas.pt"
"""

from __future__ import annotations

import argparse
import random
import shutil
from datetime import datetime

from contador import BASE

DS = BASE / "dataset"
MODELOS = BASE / "modelos"


def preparar() -> tuple[str, int, int]:
    revisadas = set((DS / "revisadas.txt").read_text(encoding="utf-8").split()) if (DS / "revisadas.txt").exists() else set()
    imagenes = [p for p in sorted((DS / "images").glob("*.jpg"))
                if p.stem in revisadas and (DS / "labels" / f"{p.stem}.txt").exists()]
    if len(imagenes) < 50:
        raise SystemExit(f"Hay {len(imagenes)} imágenes revisadas. Hacen falta al menos 50 (ideal 300 o más).")

    # Separar por grabación/cámara+hora evitaría que val se parezca demasiado a train;
    # con cuadros cada 3 s alcanza con mezclar al azar con semilla fija.
    random.Random(0).shuffle(imagenes)
    n_val = max(10, len(imagenes) * 15 // 100)
    val, train = imagenes[:n_val], imagenes[n_val:]
    (DS / "train.txt").write_text("\n".join(str(p) for p in train), encoding="utf-8")
    (DS / "val.txt").write_text("\n".join(str(p) for p in val), encoding="utf-8")
    yaml = DS / "data.yaml"
    yaml.write_text(
        f"path: {DS.as_posix()}\ntrain: train.txt\nval: val.txt\nnames:\n  0: persona\n", encoding="utf-8"
    )
    return str(yaml), len(train), len(val)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="yolo11n.pt")
    ap.add_argument("--epocas", type=int, default=60)
    ap.add_argument("--imgsz", type=int, default=640)
    args = ap.parse_args()

    import torch
    from ultralytics import YOLO

    gpu = torch.cuda.is_available()
    dispositivo = 0 if gpu else "cpu"
    print(f"Entrenando en {'GPU: ' + torch.cuda.get_device_name(0) if gpu else 'CPU (va a tardar bastante)'}")

    data, n_train, n_val = preparar()
    print(f"Imágenes: {n_train} para entrenar, {n_val} para validar")

    antes = None
    try:
        m = YOLO(args.base).val(data=data, classes=[0], imgsz=args.imgsz, device=dispositivo, verbose=False, plots=False)
        antes = m.box.map50
        print(f"\nModelo original en nuestras cámaras: mAP50 = {antes:.3f}\n")
    except Exception as e:  # noqa: BLE001 — la comparación es informativa, no bloquea
        print(f"(no se pudo medir el modelo original: {e})")

    modelo = YOLO(args.base)
    modelo.train(
        data=data, epochs=args.epocas, imgsz=args.imgsz, device=dispositivo,
        batch=-1 if gpu else 8,          # -1 = el máximo que entre en la memoria de la placa
        single_cls=True, patience=15,     # corta solo si deja de mejorar
        workers=2, project=str(BASE / "runs"), name="mito", exist_ok=False,
    )
    mejor = modelo.trainer.best
    despues = YOLO(mejor).val(data=data, imgsz=args.imgsz, device=dispositivo, verbose=False, plots=False).box.map50

    MODELOS.mkdir(exist_ok=True)
    destino = MODELOS / "mito-personas.pt"
    if destino.exists():
        shutil.copy2(destino, MODELOS / f"mito-personas_{datetime.now():%Y%m%d_%H%M}.pt")
    shutil.copy2(mejor, destino)

    print("\n================ RESULTADO ================")
    if antes is not None:
        print(f"Modelo original : mAP50 = {antes:.3f}")
    print(f"Modelo entrenado: mAP50 = {despues:.3f}")
    if antes is not None and despues <= antes:
        print("El entrenado NO mejora al original: conviene sumar más imágenes variadas antes de usarlo.")
    else:
        print(f'Guardado en modelos/{destino.name}. Para usarlo: "modelo": "modelos/{destino.name}" en config.json')


if __name__ == "__main__":
    main()
