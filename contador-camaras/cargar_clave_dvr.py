"""
Cargar (o corregir) el usuario y la clave del DVR de una cámara SIN pasarlos por ningún chat:
pide la clave con escritura oculta, prueba UNA vez contra el DVR con la librería de Dahua
y, si entra, la guarda en config.json y activa la cámara.

    python cargar_clave_dvr.py "Carlos Paz Puerta"
    (o doble clic en cargar_clave_dvr.bat)

Si el DVR la rechaza, dice el motivo y cuántos intentos quedan antes de que bloquee el usuario.
Después hay que reiniciar el contador (se hace solo si arrancó con iniciar.bat / autoarranque).
"""

from __future__ import annotations

import getpass
import json
import sys

from contador import BASE
from dahua import SDK

RUTA = BASE / "config.json"


def main() -> None:
    cfg = json.loads(RUTA.read_text(encoding="utf-8"))
    nombres = [c["nombre"] for c in cfg["camaras"]]
    nombre = sys.argv[1] if len(sys.argv) > 1 else input(f"Cámara ({', '.join(nombres)}): ").strip()
    cam = next((c for c in cfg["camaras"] if c["nombre"] == nombre), None)
    if cam is None:
        sys.exit(f"No existe la cámara '{nombre}'. Cámaras: {', '.join(nombres)}")
    sdk_cfg = cam.setdefault("sdk", {})
    for clave, pregunta, defecto in (("host", "Dirección del DVR (DDNS o IP, como en SmartPSS)", None),
                                     ("puerto", "Puerto (el de SmartPSS)", 37777),
                                     ("usuario", "Usuario del DVR", "admin")):
        actual = sdk_cfg.get(clave) or defecto
        valor = input(f"{pregunta} [{actual}]: ").strip() or actual
        if not valor:
            sys.exit("Falta ese dato.")
        sdk_cfg[clave] = int(valor) if clave == "puerto" else valor
    sdk_cfg.setdefault("canal", cam.get("canal") or 1)
    sdk_cfg.setdefault("stream", "principal")
    clave_dvr = getpass.getpass(f"Clave del usuario '{sdk_cfg['usuario']}' (no se ve al escribir): ")
    if not clave_dvr:
        sys.exit("No escribiste la clave.")

    print("Probando UNA vez contra el DVR…")
    sdk = SDK.obtener(cfg)
    h, info, error = sdk.login(sdk_cfg["host"], int(sdk_cfg["puerto"]), sdk_cfg["usuario"], clave_dvr)
    if not h:
        print(f"\nEl DVR NO la aceptó: {error}.")
        if info.intentos_restantes:
            print(f"Quedan {info.intentos_restantes} intentos antes de que bloquee al usuario '{sdk_cfg['usuario']}'.")
        print("No se guardó nada.")
        sys.exit(1)
    sdk.logout(h)
    sdk_cfg["clave"] = clave_dvr
    cam["activa"] = True
    RUTA.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nOK: entró al DVR (serie {info.serie.decode(errors='replace')}, {info.canales} canales).")
    print(f"Guardado y cámara '{nombre}' activada (canal {sdk_cfg['canal']}). Reiniciá el contador para que la tome.")


if __name__ == "__main__":
    main()
