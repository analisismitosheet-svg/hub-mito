"""
Reconocer al personal por el UNIFORME (ej. remera negra con estampado blanco), no solo por un color:
se compara la zona del pecho de cada persona contra fotos de referencia del uniforme.

Referencias: imágenes en contador-camaras/empleados_ref/ (recortes de una persona con el uniforme,
de cuerpo entero o del torso). Se agregan desde el hub (IA Cámaras → Calibrar → Marcar empleado)
o copiando imágenes a mano. Son las mismas para todos los locales (el uniforme es de la empresa).

Parecido = promedio de ResNet18 (forma/estampado) + histograma de color, SOLO del torso.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger("contador")
CARPETA = Path(__file__).resolve().parent / "empleados_ref"


def torso(recorte, cuerpo_entero: bool = True):
    """Zona del pecho (donde va el estampado). Si la imagen ya es solo el torso, se usa entera."""
    if recorte is None or recorte.size == 0:
        return None
    if not cuerpo_entero:
        return recorte
    h, w = recorte.shape[:2]
    t = recorte[int(h * 0.14):int(h * 0.55), int(w * 0.12):int(w * 0.88)]
    return t if t.size else None


def _hist(img) -> np.ndarray:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hs = cv2.calcHist([hsv], [0, 1], None, [18, 4], [0, 180, 0, 256]).flatten()
    v = cv2.calcHist([hsv], [2], None, [8], [0, 256]).flatten()
    x = np.sqrt(np.concatenate([hs / (hs.sum() + 1e-9), v / (v.sum() + 1e-9)]))
    return x / (np.linalg.norm(x) or 1)


class Uniforme:
    """Referencias del uniforme y comparación. Se recarga sola si cambia la carpeta."""

    def __init__(self, umbral: float = 0.86):
        self.umbral = umbral
        self.refs: list[tuple[np.ndarray, np.ndarray]] = []
        self._firma = None
        self._lock = threading.Lock()
        self._revisado = 0.0
        self.recargar()

    def _descriptor(self, img) -> tuple[np.ndarray, np.ndarray] | None:
        from contador import RedApariencia
        if img is None or img.size == 0 or img.shape[0] < 24:
            return None
        v = RedApariencia.vector(img)
        return (v, _hist(img)) if v is not None else None

    def recargar(self) -> None:
        archivos = sorted(CARPETA.glob("*.jpg")) + sorted(CARPETA.glob("*.png")) if CARPETA.exists() else []
        firma = tuple((a.name, a.stat().st_mtime) for a in archivos)
        if firma == self._firma:
            return
        refs = []
        for a in archivos:
            img = cv2.imread(str(a))
            if img is None:
                continue
            # "_torso" en el nombre = la imagen ya es solo el pecho
            d = self._descriptor(torso(img, cuerpo_entero="_torso" not in a.stem))
            if d:
                refs.append(d)
        with self._lock:
            self.refs, self._firma = refs, firma
        if refs:
            log.info("uniforme del personal: %d referencia(s) cargadas", len(refs))

    @property
    def activo(self) -> bool:
        if time.time() - self._revisado > 30:  # ver si agregaron referencias desde el hub
            self._revisado = time.time()
            self.recargar()
        return bool(self.refs)

    def parecido(self, recorte_persona) -> float:
        d = self._descriptor(torso(recorte_persona))
        if d is None:
            return 0.0
        v, h = d
        with self._lock:
            refs = list(self.refs)
        return max((float(v @ rv) + float(h @ rh)) / 2 for rv, rh in refs) if refs else 0.0

    def es_uniforme(self, recorte_persona) -> bool:
        return self.parecido(recorte_persona) >= self.umbral

    @staticmethod
    def agregar(recorte_persona) -> Path:
        """Guarda una referencia nueva (recorte de cuerpo entero de un empleado)."""
        CARPETA.mkdir(exist_ok=True)
        ruta = CARPETA / f"ref_{time.strftime('%Y%m%d_%H%M%S')}_{int(time.time() * 1000) % 1000:03d}.jpg"
        cv2.imwrite(str(ruta), recorte_persona, [cv2.IMWRITE_JPEG_QUALITY, 92])
        return ruta

    @staticmethod
    def cantidad() -> int:
        return len(list(CARPETA.glob("*.jpg")) + list(CARPETA.glob("*.png"))) if CARPETA.exists() else 0
