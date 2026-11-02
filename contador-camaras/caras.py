"""
Reconocer al PERSONAL por la cara, para que sus entradas y salidas no cuenten como clientes.
Se suma al uniforme (empleados.py): alcanza con que una de las dos cosas lo reconozca.

Modelos de OpenCV (sin dependencias nuevas), en modelos/ (no van a git):
  - face_detection_yunet_2023mar.onnx   detecta caras (YuNet)
  - face_recognition_sface_2021dec.onnx vector de 128 números por cara (SFace)
  Se bajan de https://github.com/opencv/opencv_zoo (models/face_detection_yunet y face_recognition_sface).

Personal: caras_personal.json en esta carpeta (no va a git). Por cada empleado se guarda SOLO el
vector de la cara (no la foto). Se carga desde el hub (IA Cámaras -> Calibrar -> Caras del personal):
subiendo fotos de frente o tocando a la persona en la foto de la cámara. Las caras de los clientes
nunca se guardan: se comparan en memoria y se descartan.

Con cámaras de puerta la cara sale chica (25-40 px): para no sacar a un cliente del conteo por
error, una pista se marca como personal recién con 2 coincidencias en cuadros distintos.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger("contador")
BASE = Path(__file__).resolve().parent
ARCHIVO = BASE / "caras_personal.json"
DETECTOR = BASE / "modelos" / "face_detection_yunet_2023mar.onnx"
RECONOCEDOR = BASE / "modelos" / "face_recognition_sface_2021dec.onnx"
UMBRAL = 0.42       # coseno de SFace: OpenCV recomienda 0.363; más alto = menos clientes confundidos
CARA_MINIMA = 18    # px de ancho: más chica no sirve para reconocer


class Caras:
    """Personal registrado + detector/reconocedor. Una sola instancia para todas las cámaras."""

    _inst: "Caras | None" = None
    _inst_lock = threading.Lock()

    @classmethod
    def compartida(cls) -> "Caras":
        with cls._inst_lock:
            if cls._inst is None:
                cls._inst = Caras()
            return cls._inst

    def __init__(self):
        self.lock = threading.Lock()
        self.disponible = DETECTOR.exists() and RECONOCEDOR.exists()
        if not self.disponible:
            log.warning("caras: faltan los modelos en modelos/ (ver caras.py): no se reconoce al personal por la cara")
            return
        self.detector = cv2.FaceDetectorYN.create(str(DETECTOR), "", (320, 320), 0.6)
        self.reconocedor = cv2.FaceRecognizerSF.create(str(RECONOCEDOR), "")
        self.personal: list[dict] = []
        self.matriz = np.zeros((0, 128), np.float32)  # un vector por fila (varios por empleado)
        self.duenos: list[int] = []                    # fila -> índice en self.personal
        self._mtime = None
        self.cargar()

    # -- personal registrado (caras_personal.json)
    def cargar(self) -> None:
        try:
            mtime = ARCHIVO.stat().st_mtime if ARCHIVO.exists() else None
            if mtime == self._mtime:
                return
            datos = json.loads(ARCHIVO.read_text(encoding="utf-8")) if mtime else []
        except (OSError, ValueError) as e:
            log.error("caras: no se pudo leer %s: %s", ARCHIVO.name, e)
            return
        filas, duenos = [], []
        for i, emp in enumerate(datos):
            for v in emp.get("vectores", []):
                filas.append(np.asarray(v, np.float32))
                duenos.append(i)
        self.personal, self.duenos, self._mtime = datos, duenos, mtime
        self.matriz = np.vstack(filas) if filas else np.zeros((0, 128), np.float32)
        log.info("caras: %d persona(s) del personal, %d vector(es)", len(datos), len(filas))

    def guardar(self) -> None:
        tmp = ARCHIVO.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.personal, ensure_ascii=False), encoding="utf-8")
        tmp.replace(ARCHIVO)
        self._mtime = None
        self.cargar()

    @property
    def activo(self) -> bool:
        return self.disponible and len(self.matriz) > 0

    def lista(self) -> list[dict]:
        with self.lock:
            return [{"id": e["id"], "nombre": e["nombre"], "local": e.get("local") or "",
                     "vectores": len(e.get("vectores", [])), "alta": e.get("alta")} for e in self.personal]

    def agregar(self, nombre: str, local: str, vector: np.ndarray) -> dict:
        """Suma una cara a un empleado (mismo nombre y local = el mismo) o lo crea."""
        nombre, local = nombre.strip()[:60], local.strip().upper()[:20]
        with self.lock:
            emp = next((e for e in self.personal
                        if e["nombre"].lower() == nombre.lower() and (e.get("local") or "") == local), None)
            if emp is None:
                emp = {"id": uuid.uuid4().hex[:12], "nombre": nombre, "local": local, "vectores": [],
                       "alta": time.strftime("%Y-%m-%d %H:%M")}
                self.personal.append(emp)
            emp["vectores"] = (emp["vectores"] + [[round(float(x), 5) for x in vector]])[-12:]
            self.guardar()
            return {"id": emp["id"], "nombre": emp["nombre"], "vectores": len(emp["vectores"])}

    def quitar(self, id_: str) -> bool:
        with self.lock:
            antes = len(self.personal)
            self.personal = [e for e in self.personal if e["id"] != id_]
            if len(self.personal) == antes:
                return False
            self.guardar()
            return True

    # -- detección y vectores
    def _caras(self, img) -> np.ndarray | None:
        h, w = img.shape[:2]
        with self.lock:
            self.detector.setInputSize((w, h))
            _, caras = self.detector.detect(img)
        return caras

    def _vector(self, img, cara) -> np.ndarray:
        with self.lock:
            alineada = self.reconocedor.alignCrop(img, cara)
            v = self.reconocedor.feature(alineada).flatten().astype(np.float32)
        return v / (np.linalg.norm(v) or 1)

    def vector_de_foto(self, img) -> tuple[np.ndarray | None, str]:
        """Foto subida desde el hub o recorte de la cámara: la cara más grande. (vector, motivo si no hay)."""
        if not self.disponible:
            return None, "la PC contadora no tiene los modelos de caras"
        if img is None or img.size == 0:
            return None, "imagen vacía"
        if max(img.shape[:2]) > 1600:  # fotos de celular: achicar
            f = 1600 / max(img.shape[:2])
            img = cv2.resize(img, (int(img.shape[1] * f), int(img.shape[0] * f)))
        elif img.shape[0] < 400:  # recorte chico de la cámara: agrandar para que YuNet la encuentre
            f = 400 / img.shape[0]
            img = cv2.resize(img, (int(img.shape[1] * f), 400), interpolation=cv2.INTER_CUBIC)
        caras = self._caras(img)
        if caras is None or not len(caras):
            return None, "no se encontró una cara: usá una foto de frente, con la cara bien visible"
        cara = max(caras, key=lambda c: c[2] * c[3])
        return self._vector(img, cara), ""

    def en_persona(self, recorte) -> tuple[str, float] | None:
        """Busca la cara en el recorte de una persona de la cámara y la compara con el personal.
        Devuelve (nombre, parecido) si coincide; None si no hay cara o no es del personal."""
        if not self.activo or recorte is None or recorte.size == 0:
            return None
        cabeza = recorte[: max(8, int(recorte.shape[0] * 0.4))]  # la cara está arriba
        if cabeza.shape[1] < 160:  # agrandar: YuNet no encuentra caras de menos de ~10 px
            f = 160 / cabeza.shape[1]
            cabeza = cv2.resize(cabeza, (160, int(cabeza.shape[0] * f)), interpolation=cv2.INTER_CUBIC)
            minima = CARA_MINIMA * f
        else:
            minima = CARA_MINIMA
        caras = self._caras(cabeza)
        if caras is None or not len(caras):
            return None
        cara = max(caras, key=lambda c: c[2] * c[3])
        if cara[2] < minima:
            return None
        v = self._vector(cabeza, cara)
        sims = self.matriz @ v
        i = int(np.argmax(sims))
        if sims[i] < UMBRAL:
            return None
        return self.personal[self.duenos[i]]["nombre"], float(sims[i])
