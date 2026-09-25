"""
============================================================
CONTADOR DE CLIENTES — corre en una PC del local, en la red del DVR Dahua
============================================================

Toma el video RTSP de la(s) cámara(s) de entrada, detecta personas con YOLO,
las sigue (ByteTrack) y cuenta entradas/salidas. Dos modos por cámara:
  - "linea": cruzar una línea dibujada en la puerta (flecha = sentido entrada).
  - "zonas": pasar de la zona EXTERIOR (roja: vereda/puerta) a la INTERIOR
    (azul: dentro del local). Es la lógica de ContadorIA (porton_v10/v11),
    más robusta con cámaras en diagonal.
Además (opcionales, por cámara):
  - transeúntes: gente que cruza de la zona A a la B (o al revés) por la
    vereda SIN entrar -> tasa de atracción.
  - empleados: color de credencial/uniforme en el torso -> no suman a entradas.
  - reid: reconoce a la misma persona en el día (únicos vs reingresos) y
    descarta dobles conteos cuando el tracker pierde y recupera a alguien.
    Los vectores viven SOLO en memoria y se borran cada día. Nunca se guardan fotos.

Los conteos se agrupan en tramos de 15 minutos, se guardan en SQLite local
(conteos.db) y se suben al Hub MITO (/api/contador-ingesta). Si no hay
internet, se acumulan y se mandan cuando vuelve. Al hub solo viajan NÚMEROS.

Uso:
    python contador.py              # normal (dejarlo corriendo)
    python contador.py --ver        # abre ventanas con las detecciones (para probar)
    python calibrar.py <camara>     # dibujar línea / zonas / color de credencial
    python evaluar.py <video>       # medir el conteo sobre una grabación

Config: config.json (copiar de config.ejemplo.json).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

# RTSP por TCP: evita imágenes rotas/grises por pérdida de paquetes UDP
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402
import numpy as np  # noqa: E402

VERSION = "2.0.0"
BASE = Path(__file__).resolve().parent
TRAMO_S = 15 * 60
CLASE_PERSONA = 0
CAMPOS = ("entradas", "salidas", "transeuntes", "empleados", "nuevos", "reingresos")

log = logging.getLogger("contador")


# ---------------------------------------------------------------- config ----

def cargar_config(ruta: Path = BASE / "config.json") -> dict:
    if not ruta.exists():
        sys.exit(f"No existe {ruta.name}. Copiá config.ejemplo.json a config.json y completalo.")
    cfg = json.loads(ruta.read_text(encoding="utf-8"))
    for clave in ("hub_url", "token", "camaras"):
        if not cfg.get(clave):
            sys.exit(f"Falta '{clave}' en config.json")
    return cfg


def url_rtsp(cfg: dict, cam: dict) -> str:
    """URL RTSP de Dahua: rtsp://usuario:clave@ip:554/cam/realmonitor?channel=N&subtype=S"""
    if cam.get("rtsp"):
        return cam["rtsp"]
    dvr = cfg["dvr"]
    usuario = urllib.parse.quote(dvr["usuario"], safe="")
    clave = urllib.parse.quote(dvr["clave"], safe="")
    return (
        f"rtsp://{usuario}:{clave}@{dvr['ip']}:{dvr.get('puerto_rtsp', 554)}"
        f"/cam/realmonitor?channel={cam['canal']}&subtype={cam.get('substream', 1)}"
    )


# ------------------------------------------------------------- almacenado ---

class Almacen:
    """Conteos por (cámara, tramo). 'pendiente' = falta subirlo al hub."""

    def __init__(self, ruta: Path | str):
        self.db = sqlite3.connect(ruta, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock:
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS tramos (
                     camara TEXT NOT NULL, desde INTEGER NOT NULL,
                     entradas INTEGER NOT NULL DEFAULT 0, salidas INTEGER NOT NULL DEFAULT 0,
                     pendiente INTEGER NOT NULL DEFAULT 1,
                     PRIMARY KEY (camara, desde))"""
            )
            existentes = {r[1] for r in self.db.execute("PRAGMA table_info(tramos)")}
            for col in CAMPOS:
                if col not in existentes:  # base de la v1: agregar columnas nuevas
                    self.db.execute(f"ALTER TABLE tramos ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0")
            self.db.commit()

    def sumar(self, camara: str, *campos: str) -> None:
        assert all(c in CAMPOS for c in campos)
        desde = int(time.time()) // TRAMO_S * TRAMO_S
        cols = ", ".join(campos)
        unos = ", ".join("1" for _ in campos)
        sets = ", ".join(f"{c} = {c} + 1" for c in campos)
        with self.lock:
            self.db.execute(
                f"""INSERT INTO tramos (camara, desde, {cols}) VALUES (?, ?, {unos})
                    ON CONFLICT (camara, desde) DO UPDATE SET {sets}, pendiente = 1""",
                (camara, desde),
            )
            self.db.commit()

    def pendientes(self, limite: int = 1000) -> list[tuple]:
        with self.lock:
            return self.db.execute(
                f"SELECT camara, desde, {', '.join(CAMPOS)} FROM tramos WHERE pendiente = 1 ORDER BY desde LIMIT ?",
                (limite,),
            ).fetchall()

    def marcar_enviados(self, filas: list[tuple]) -> None:
        # Solo si no cambió desde que se leyó (si sumó otra persona, queda pendiente)
        cond = " AND ".join(f"{c} = ?" for c in CAMPOS)
        with self.lock:
            self.db.executemany(f"UPDATE tramos SET pendiente = 0 WHERE camara = ? AND desde = ? AND {cond}", filas)
            self.db.execute("DELETE FROM tramos WHERE pendiente = 0 AND desde < ?", (int(time.time()) - 90 * 86400,))
            self.db.commit()

    def hoy(self, camara: str) -> dict[str, int]:
        inicio = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        with self.lock:
            fila = self.db.execute(
                f"SELECT {', '.join(f'COALESCE(SUM({c}),0)' for c in CAMPOS)} FROM tramos WHERE camara = ? AND desde >= ?",
                (camara, int(inicio)),
            ).fetchone()
        return dict(zip(CAMPOS, fila))


# ------------------------------------------------------------ lectura RTSP --

class Lector(threading.Thread):
    """Lee el RTSP todo el tiempo y guarda solo el último cuadro.
    Así el detector nunca procesa video atrasado (el buffer de OpenCV acumula)."""

    def __init__(self, nombre: str, url: str):
        super().__init__(daemon=True, name=f"rtsp-{nombre}")
        self.nombre, self.url = nombre, url
        self.cuadro = None
        self.nro = 0
        self.error: str | None = "conectando"
        self.lock = threading.Lock()

    def run(self) -> None:
        espera = 2
        while True:
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                self.error = "no conecta al DVR"
                log.warning("[%s] no se pudo abrir el RTSP; reintento en %ss", self.nombre, espera)
                time.sleep(espera)
                espera = min(espera * 2, 60)
                continue
            log.info("[%s] conectado", self.nombre)
            self.error, espera = None, 2
            fallos = 0
            while True:
                ok, cuadro = cap.read()
                if not ok:
                    fallos += 1
                    if fallos > 25:
                        break
                    time.sleep(0.05)
                    continue
                fallos = 0
                with self.lock:
                    self.cuadro = cuadro
                    self.nro += 1
            cap.release()
            self.error = "se cortó el video"
            log.warning("[%s] se cortó el video; reconectando", self.nombre)
            time.sleep(espera)

    def ultimo(self):
        with self.lock:
            return self.nro, self.cuadro


# ---------------------------------------------------------------- geometría -

class Linea:
    """Línea A→B en coordenadas normalizadas (0..1).
    Entrada = cruzar hacia el lado de la normal (-dy, dx), que es la flecha que
    dibuja calibrar.py; 'invertir' da vuelta el sentido."""

    def __init__(self, puntos, invertir: bool, margen: float):
        (self.ax, self.ay), (self.bx, self.by) = puntos
        self.invertir = invertir
        self.margen = margen

    def evaluar(self, x: float, y: float) -> tuple[int, bool]:
        """Devuelve (lado, dentro_del_segmento). lado=0 si está muy cerca (histéresis)."""
        dx, dy = self.bx - self.ax, self.by - self.ay
        largo = (dx * dx + dy * dy) ** 0.5 or 1e-9
        dist = (dx * (y - self.ay) - dy * (x - self.ax)) / largo
        t = ((x - self.ax) * dx + (y - self.ay) * dy) / (largo * largo)
        lado = 0 if abs(dist) < self.margen else (1 if dist > 0 else -1)
        return lado, -0.1 <= t <= 1.1


class Poligono:
    """Polígono en coordenadas normalizadas (0..1)."""

    def __init__(self, puntos):
        self.pts = np.array(puntos, dtype=np.float32)

    def contiene(self, x: float, y: float) -> bool:
        return cv2.pointPolygonTest(self.pts, (float(x), float(y)), False) >= 0

    def pixeles(self, ancho: int, alto: int) -> np.ndarray:
        return (self.pts * [ancho, alto]).astype(np.int32)


def poligono_opcional(puntos) -> Poligono | None:
    return Poligono(puntos) if puntos and len(puntos) >= 3 else None


# ------------------------------------------------------------------- GPU ----

def elegir_dispositivo(pedido: str = "auto") -> str | int:
    """'auto' -> GPU NVIDIA si hay (CUDA), si no CPU. También acepta 'cpu' o 'cuda'/'0' para forzar."""
    try:
        import torch
        hay_gpu = torch.cuda.is_available()
    except Exception:  # noqa: BLE001
        hay_gpu = False
    if str(pedido).lower() == "cpu":
        return "cpu"
    if hay_gpu:
        return 0
    if str(pedido).lower() not in ("auto", ""):
        log.warning("se pidió GPU pero no hay CUDA disponible: uso CPU")
    return "cpu"


def gpu_nombre() -> str:
    import torch
    return torch.cuda.get_device_name(0)


# ------------------------------------------------------ empleados / reid ----

def fraccion_color(recorte, hsv_min, hsv_max) -> float:
    """Fracción de píxeles del color de la credencial/uniforme en el torso
    (35 % superior del recorte de la persona)."""
    alto = recorte.shape[0]
    torso = recorte[: max(4, int(alto * 0.35))]
    if torso.size == 0:
        return 0.0
    hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
    mascara = cv2.inRange(hsv, np.array(hsv_min, np.uint8), np.array(hsv_max, np.uint8))
    return float(np.count_nonzero(mascara)) / mascara.size


def histograma_ropa(recorte) -> np.ndarray:
    """Colores de la ropa: torso y piernas por separado (H×S para el color + V para negro/blanco/gris).
    Raíz cuadrada del histograma normalizado -> el producto punto es el coeficiente de Bhattacharyya."""
    h = recorte.shape[0]
    partes = []
    for a, b in ((0.15, 0.50), (0.55, 0.90)):
        hsv = cv2.cvtColor(recorte[int(h * a):int(h * b)], cv2.COLOR_BGR2HSV)
        hs = cv2.calcHist([hsv], [0, 1], None, [18, 4], [0, 180, 0, 256]).flatten()
        v = cv2.calcHist([hsv], [2], None, [8], [0, 256]).flatten()
        partes.append(np.sqrt(np.concatenate([hs / (hs.sum() + 1e-9), v / (v.sum() + 1e-9)])))
    return np.concatenate(partes) / np.sqrt(2)


class RedApariencia:
    """ResNet18 (forma del cuerpo/textura), compartida entre cámaras. GPU si hay."""

    _red = None
    _lock = threading.Lock()

    @classmethod
    def vector(cls, recorte) -> np.ndarray | None:
        with cls._lock:
            if cls._red is None:
                import torch
                import torch.nn as nn
                import torchvision.models as tvm
                dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
                red = tvm.resnet18(weights=tvm.ResNet18_Weights.DEFAULT)
                red = nn.Sequential(*list(red.children())[:-1]).to(dispositivo).eval()
                cls._red = (red, dispositivo, torch)
                log.info("reid: ResNet18 en %s", dispositivo)
        red, dispositivo, torch = cls._red
        img = cv2.resize(cv2.cvtColor(recorte, cv2.COLOR_BGR2RGB), (64, 128)).astype(np.float32) / 255.0
        img = (img - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
        t = torch.from_numpy(img.transpose(2, 0, 1)).float().unsqueeze(0).to(dispositivo)
        with torch.no_grad():
            v = red(t).flatten().cpu().numpy()
        n = np.linalg.norm(v)
        return v / n if n else None


@dataclass
class Persona:
    """Una persona reconocida HOY (solo en memoria). Junta la apariencia de todas sus pistas."""
    id: int
    cnn: np.ndarray | None = None   # sumas: se normaliza al comparar
    col: np.ndarray | None = None
    n: int = 0
    entradas: int = 0
    adentro: bool = False
    ultima_entrada: float = -1e12
    tid: int | None = None          # pista que la está siguiendo ahora
    visto: float = -1e12
    x: float = 0.0                  # última posición vista (0..1)
    y: float = 0.0

    def sumar(self, cnn, col, n) -> None:
        if cnn is None:
            return
        if self.cnn is None:
            self.cnn, self.col = cnn.copy(), col.copy()
        else:
            self.cnn, self.col = self.cnn + cnn, self.col + col
        self.n += n
        if self.n > 120:  # que pese más lo reciente (ej. se sacó la campera)
            self.cnn, self.col, self.n = self.cnn * 0.5, self.col * 0.5, self.n // 2


def _norm(v):
    n = np.linalg.norm(v)
    return v / n if n else v


class Reconocedor:
    """Reconoce a la misma persona durante el día: cuando el seguimiento la pierde
    adentro y aparece con otro id, cuando sale y vuelve a entrar (reingreso), o
    cuando la puerta la cuenta dos veces (doble conteo). Se borra al cambiar el día.
    Parecido = promedio de ResNet18 + colores de la ropa, sobre VARIAS vistas.
    Medido en Campo: misma persona 0.93-0.96 con muchas vistas, distintas < 0.89 (p95).
    Con pocas vistas (id recién cambiado) el parecido baja a 0.85-0.88, por eso el umbral
    depende de cuánto hace y qué tan lejos se la perdió de vista:
      - continuidad (≤ 3 s y cerca): el seguimiento la perdió y la recuperó -> 0.78
      - reciente (≤ 60 s): salió de cuadro un rato o salió y volvió -> 0.90
      - resto del día: reingreso -> 0.92"""

    def __init__(self, umbral: float = 0.92, umbral_reciente: float = 0.90, umbral_continuidad: float = 0.78):
        self.umbral = umbral
        self.umbral_reciente = umbral_reciente
        self.umbral_continuidad = umbral_continuidad
        self.dia = date.today()
        self.personas: list[Persona] = []

    def reiniciar_si_cambio_dia(self) -> None:
        if date.today() != self.dia:
            self.dia, self.personas = date.today(), []

    def umbral_para(self, per: Persona, inicio: float, x0: float, y0: float) -> tuple[float, str]:
        hueco = inicio - per.visto
        if hueco <= 3.0 and ((per.x - x0) ** 2 + (per.y - y0) ** 2) ** 0.5 <= 0.35:
            return self.umbral_continuidad, "continuidad"
        return (self.umbral_reciente, "reciente") if hueco <= 60.0 else (self.umbral, "dia")

    def vincular(self, cnn, col, n, tid, ahora, inicio, x0, y0) -> tuple[Persona, float, str]:
        """Busca a quién se parece (sin tomar personas que otra pista está siguiendo ahora).
        inicio/x0/y0: cuándo y dónde apareció esta pista (para saber si es la continuación de otra)."""
        self.reiniciar_si_cambio_dia()
        mejor, margen_mejor, sim_mejor, tipo = None, 0.0, 0.0, "nueva"
        if cnn is not None:
            c, k = _norm(cnn), _norm(col)
            for per in self.personas:
                if per.cnn is None or (per.tid not in (None, tid) and ahora - per.visto < 1.0):
                    continue
                sim = (float(_norm(per.cnn) @ c) + float(_norm(per.col) @ k)) / 2
                umbral, nivel = self.umbral_para(per, inicio, x0, y0)
                margen = sim - umbral
                if margen >= 0 and (mejor is None or margen > margen_mejor):
                    mejor, margen_mejor, sim_mejor, tipo = per, margen, sim, nivel
        if mejor is None:
            mejor = Persona(id=len(self.personas) + 1)
            self.personas.append(mejor)
        mejor.sumar(cnn, col, n)
        mejor.tid, mejor.visto, mejor.x, mejor.y = tid, ahora, x0, y0
        # Solo se usa para DESCARTAR una entrada si la evidencia es fuerte
        seguro = tipo == "continuidad" or sim_mejor >= self.umbral
        return mejor, sim_mejor, ("seguro" if seguro else tipo)


# ------------------------------------------------------------------ cámara --

@dataclass
class Pista:
    tid: int = -1
    visto: float = field(default_factory=time.time)
    lado: int = 0                 # modo línea: -1 / +1 (0 = sin definir)
    zona: str | None = None       # modo zonas: 'ext' | 'int' confirmada
    candidata: str | None = None
    frames_candidata: int = 0
    ab: str | None = None         # transeúntes: última zona A/B pisada
    transeunte: bool = False
    entro: bool = False
    emp_si: int = 0
    emp_total: int = 0
    cnn: np.ndarray | None = None  # sumas de apariencia de esta pista (hasta saber quién es)
    col: np.ndarray | None = None
    n: int = 0
    persona: Persona | None = None
    vinculo: str = ""                # 'seguro' | 'reciente' | 'dia' | 'nueva'
    entrada_pend: float | None = None  # entrada detectada, esperando reconocer quién es
    inicio: float = 0.0              # cuándo y dónde apareció (para unir ids que cambian)
    x0: float = -1.0
    y0: float = -1.0
    x: float = 0.0
    y: float = 0.0


class Camara(threading.Thread):
    def __init__(self, cfg: dict, cam: dict, almacen: Almacen, ver: bool = False):
        super().__init__(daemon=True, name=f"cam-{cam['nombre']}")
        self.cfg, self.cam, self.almacen, self.ver = cfg, cam, almacen, ver
        self.nombre = cam["nombre"]
        self.modo = cam.get("modo", "zonas" if cam.get("zona_interior") else "linea")
        if self.modo == "linea":
            if not cam.get("linea"):
                sys.exit(f"La cámara '{self.nombre}' no tiene línea. Corré: python calibrar.py \"{self.nombre}\"")
            self.linea = Linea(cam["linea"], cam.get("invertir", False), cam.get("margen", 0.02))
        else:
            self.exterior = poligono_opcional(cam.get("zona_exterior"))
            self.interior = poligono_opcional(cam.get("zona_interior"))
            if not (self.exterior and self.interior):
                sys.exit(f"La cámara '{self.nombre}' está en modo zonas pero le faltan zona_exterior/zona_interior.")
        self.zona_a = poligono_opcional(cam.get("zona_a"))
        self.zona_b = poligono_opcional(cam.get("zona_b"))
        emp = cam.get("empleados") or {}
        self.emp = emp if emp.get("activo") and emp.get("hsv_min") and emp.get("hsv_max") else None
        self.reid = (Reconocedor(float(cam.get("reid_umbral", 0.92)), float(cam.get("reid_umbral_reciente", 0.90)),
                                 float(cam.get("reid_umbral_continuidad", 0.78))) if cam.get("reid") else None)
        self.dedupe_s = float(cam.get("dedupe_segundos", 20))
        self.min_muestras = int(cam.get("reid_muestras", 4))
        self.espera_entrada = float(cam.get("reid_espera_segundos", 5))
        self.frames_zona = int(cam.get("frames_confirmar", 2))
        self.punto = cam.get("punto", "pie")
        self.pistas: dict[int, Pista] = {}
        self.fps = 0.0
        self.n_cuadro = 0
        self.reloj = time.time  # evaluar.py lo cambia por el tiempo del video
        self.vista = None  # último cuadro anotado (con --ver o mientras alguien mira el video en vivo)
        self.mirando = 0   # conexiones abiertas al video en vivo (vista.py)
        self.vista_url: str | None = None
        self.lector: Lector | None = None
        self.eventos: list[str] = []  # para evaluar.py
        self.traza = None  # evaluar.py --traza: callback(tid, x, y, zona_confirmada)

    # -- estado para el hub
    def estado(self) -> dict:
        h = self.almacen.hoy(self.nombre)
        error = self.lector.error if self.lector else None
        return {"nombre": self.nombre, "modo": self.modo, "ok": error is None, "error": error,
                "fps": round(self.fps, 1), "entradas_hoy": h["entradas"], "salidas_hoy": h["salidas"],
                "transeuntes_hoy": h["transeuntes"], "empleados_hoy": h["empleados"], "vista_url": self.vista_url}

    def cargar_modelo(self):
        from ultralytics import YOLO  # import pesado: recién acá
        self.dispositivo = elegir_dispositivo(self.cfg.get("dispositivo", "auto"))
        log.info("[%s] detección en %s", self.nombre, "GPU (" + gpu_nombre() + ")" if self.dispositivo != "cpu" else "CPU")
        # Un modelo por cámara: el tracker guarda estado dentro del modelo
        return YOLO(str(BASE / self.cfg.get("modelo", "yolo11n.pt")))

    def detectar(self, modelo, cuadro):
        return modelo.track(cuadro, persist=True, classes=[CLASE_PERSONA], conf=float(self.cfg.get("confianza", 0.4)),
                            imgsz=int(self.cfg.get("imgsz", 640)), device=self.dispositivo,
                            tracker="bytetrack.yaml", verbose=False)[0]

    def run(self) -> None:
        modelo = self.cargar_modelo()
        self.lector = Lector(self.nombre, url_rtsp(self.cfg, self.cam))
        self.lector.start()
        periodo = 1.0 / float(self.cfg.get("fps_proceso", 8))
        ultimo_nro, t_prev = -1, time.time()

        while True:
            t0 = time.time()
            nro, cuadro = self.lector.ultimo()
            if cuadro is None or nro == ultimo_nro:
                time.sleep(0.05)
                continue
            ultimo_nro = nro
            try:
                res = self.detectar(modelo, cuadro)
                self.procesar(res, cuadro)
            except Exception as e:  # noqa: BLE001 — un cuadro corrupto no debe tirar el contador
                log.warning("[%s] error procesando: %s", self.nombre, e)
                continue
            ahora = time.time()
            self.fps = 0.9 * self.fps + 0.1 * (1.0 / max(ahora - t_prev, 1e-3))
            t_prev = ahora
            time.sleep(max(0.0, periodo - (ahora - t0)))

    # -- lógica de conteo
    def procesar(self, res, cuadro) -> None:
        alto, ancho = cuadro.shape[:2]
        ahora = self.reloj()
        self.n_cuadro += 1
        cajas = res.boxes
        if cajas is not None and cajas.id is not None:
            for (x1, y1, x2, y2), tid in zip(cajas.xyxy.tolist(), cajas.id.int().tolist()):
                p = self.pistas.setdefault(tid, Pista(tid=tid, visto=ahora, inicio=ahora))
                p.visto = ahora
                px = (x1 + x2) / 2 / ancho
                py = (y2 if self.punto == "pie" else (y1 + y2) / 2) / alto
                if p.x0 < 0:
                    p.x0, p.y0 = px, py
                p.x, p.y = px, py
                recorte = cuadro[max(0, int(y1)):int(y2), max(0, int(x1)):int(x2)]
                entero = x1 > 2 and y1 > 2 and x2 < ancho - 2 and y2 < alto - 2
                self.observar(p, recorte, entero and (y2 - y1) >= 0.12 * alto, ahora)
                if self.modo == "linea":
                    self.paso_linea(p, px, py)
                else:
                    self.paso_zonas(p, px, py)
                if self.traza:
                    self.traza(tid, px, py, p.zona)
                self.paso_transeunte(p, px, py)
        if self.reid:
            for p in self.pistas.values():
                if p.persona is None and p.n >= self.min_muestras and p.visto == ahora:
                    self.identificar(p, ahora)
                if p.entrada_pend is not None and (p.persona is not None or ahora - p.entrada_pend >= self.espera_entrada
                                                   or ahora - p.visto > 1.0):
                    self.cerrar_entrada(p, ahora)
        # Olvidar personas que no se ven hace rato
        for tid in [t for t, p in self.pistas.items() if ahora - p.visto > 10]:
            if self.pistas[tid].entrada_pend is not None:
                self.cerrar_entrada(self.pistas[tid], ahora)
            del self.pistas[tid]
        if self.ver or self.mirando > 0:  # dibujar cuesta: solo si alguien mira
            self.vista = self.anotar(res.plot(), ancho, alto)

    def observar(self, p: Pista, recorte, sirve_para_reid: bool, ahora: float) -> None:
        if recorte.size == 0:
            return
        if self.emp:
            p.emp_total += 1
            if fraccion_color(recorte, self.emp["hsv_min"], self.emp["hsv_max"]) >= float(self.emp.get("frac_min", 0.04)):
                p.emp_si += 1
        if not self.reid:
            return
        if p.persona is not None:
            p.persona.tid, p.persona.visto, p.persona.x, p.persona.y = p.tid, ahora, p.x, p.y
        # Una muestra de apariencia cada 2 cuadros, solo de vistas completas y de buen tamaño
        if sirve_para_reid and self.n_cuadro % 2 == 0:
            cnn = RedApariencia.vector(recorte)
            if cnn is None:
                return
            col = histograma_ropa(recorte)
            if p.persona is not None:
                p.persona.sumar(cnn, col, 1)
            else:
                p.cnn = cnn if p.cnn is None else p.cnn + cnn
                p.col = col if p.col is None else p.col + col
                p.n += 1

    def identificar(self, p: Pista, ahora: float) -> None:
        p.persona, sim, p.vinculo = self.reid.vincular(p.cnn, p.col, p.n, p.tid, ahora, p.inicio, p.x0, p.y0)
        p.persona.x, p.persona.y = p.x, p.y
        log.info("[%s] id %s = persona %s (parecido %.3f, %s)", self.nombre, p.tid, p.persona.id, sim, p.vinculo)

    def es_empleado(self, p: Pista) -> bool:
        return bool(self.emp) and p.emp_si >= 2 and p.emp_si / max(p.emp_total, 1) >= 0.3

    def paso_linea(self, p: Pista, x: float, y: float) -> None:
        lado, dentro = self.linea.evaluar(x, y)
        if lado == 0:
            return
        if p.lado != 0 and lado != p.lado and dentro:
            self.contar(p, entrada=(p.lado < 0) != self.linea.invertir)
        p.lado = lado

    def paso_zonas(self, p: Pista, x: float, y: float) -> None:
        zona = "int" if self.interior.contiene(x, y) else "ext" if self.exterior.contiene(x, y) else None
        if zona is None:
            return  # huecos entre zonas no borran la última zona confirmada
        if zona == p.candidata:
            p.frames_candidata += 1
        else:
            p.candidata, p.frames_candidata = zona, 1
        if p.frames_candidata < self.frames_zona or zona == p.zona:
            return
        if p.zona == "ext" and zona == "int":
            self.contar(p, entrada=True)
        elif p.zona == "int" and zona == "ext":
            self.contar(p, entrada=False)
        p.zona = zona

    def paso_transeunte(self, p: Pista, x: float, y: float) -> None:
        if not (self.zona_a and self.zona_b) or p.transeunte:
            return
        ab = "A" if self.zona_a.contiene(x, y) else "B" if self.zona_b.contiene(x, y) else None
        if ab and p.ab and ab != p.ab and not p.entro:
            p.transeunte = True
            self.registrar(p, "transeuntes")
        if ab:
            p.ab = ab

    def contar(self, p: Pista, entrada: bool) -> None:
        empleado = self.es_empleado(p)
        ahora = self.reloj()
        if not entrada:
            if p.persona is not None:
                p.persona.adentro = False
            if not empleado:  # las salidas del personal tampoco cuentan (si no, la ocupación queda negativa)
                self.registrar(p, "salidas")
            return
        p.entro = True
        if empleado:
            self.registrar(p, "empleados")
        elif self.reid:
            p.entrada_pend = ahora  # se cuenta cuando se sabe quién es (o a los pocos segundos)
        else:
            self.registrar(p, "entradas")

    def cerrar_entrada(self, p: Pista, ahora: float) -> None:
        p.entrada_pend = None
        if p.persona is None:
            self.identificar(p, ahora)  # con las muestras que haya (si no hay, persona nueva)
        per = p.persona
        if p.vinculo == "seguro" and per.adentro and ahora - per.ultima_entrada < self.dedupe_s:
            log.info("[%s] entrada descartada (id %s): la persona %s ya entró hace %.0f s sin salir",
                     self.nombre, p.tid, per.id, ahora - per.ultima_entrada)
            self.eventos.append("duplicado")
            return
        tipo = "reingresos" if per.entradas else "nuevos"
        per.entradas += 1
        per.adentro, per.ultima_entrada = True, ahora
        self.registrar(p, "entradas", tipo)

    def registrar(self, p: Pista, *campos: str) -> None:
        self.almacen.sumar(self.nombre, *campos)
        self.eventos.append(campos[0])
        quien = f" persona {p.persona.id}" if p.persona else ""
        log.info("[%s] %s (id %s%s)", self.nombre, " + ".join(c.upper() for c in campos), p.tid, quien)

    def anotar(self, img, ancho, alto):
        if self.modo == "linea":
            a = (int(self.linea.ax * ancho), int(self.linea.ay * alto))
            b = (int(self.linea.bx * ancho), int(self.linea.by * alto))
            cv2.line(img, a, b, (0, 255, 255), 2)
        else:
            cv2.polylines(img, [self.exterior.pixeles(ancho, alto)], True, (0, 0, 255), 2)
            cv2.polylines(img, [self.interior.pixeles(ancho, alto)], True, (255, 0, 0), 2)
        for z, color in ((self.zona_a, (0, 200, 255)), (self.zona_b, (255, 200, 0))):
            if z:
                cv2.polylines(img, [z.pixeles(ancho, alto)], True, color, 1)
        h = self.almacen.hoy(self.nombre)
        texto = f"Entradas {h['entradas']}  Salidas {h['salidas']}  Transeuntes {h['transeuntes']}  Empleados {h['empleados']}  {self.fps:.1f} fps"
        cv2.putText(img, texto, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4)
        cv2.putText(img, texto, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        return img


# ------------------------------------------------------------------ envío ---

def enviar(cfg: dict, almacen: Almacen, camaras: list[Camara]) -> None:
    """Sube los tramos pendientes. Cada cámara puede tener su propio "token" (de OTRO local
    registrado en el hub): así una PC puede contar varios locales y cada conteo va a su local."""
    url = cfg["hub_url"].rstrip("/") + "/api/contador-ingesta"
    cada = int(cfg.get("envio_segundos", 60))
    token_de = {c.nombre: c.cam.get("token") or cfg["token"] for c in camaras}
    while True:
        pendientes = almacen.pendientes()
        for token in dict.fromkeys(token_de.values()):
            filas = [f for f in pendientes if token_de.get(f[0], cfg["token"]) == token]
            suyas = [c for c in camaras if token_de[c.nombre] == token]
            cuerpo = {
                "tramos": [
                    {"camara": f[0], "desde": datetime.fromtimestamp(f[1], timezone.utc).isoformat().replace("+00:00", "Z"),
                     **dict(zip(CAMPOS, f[2:]))}
                    for f in filas
                ],
                "estado": {"version": VERSION, "camaras": [c.estado() for c in suyas]},
            }
            pedido = urllib.request.Request(
                url, data=json.dumps(cuerpo).encode(), method="POST",
                headers={"Content-Type": "application/json", "X-Contador-Token": token},
            )
            quienes = ", ".join(c.nombre for c in suyas)
            try:
                with urllib.request.urlopen(pedido, timeout=30) as r:
                    json.load(r)
                almacen.marcar_enviados(filas)
                if filas:
                    log.info("subidos %d tramos al hub (%s)", len(filas), quienes)
            except urllib.error.HTTPError as e:
                log.error("el hub rechazó el envío de %s (%s): %s", quienes, e.code, e.read()[:300].decode(errors="replace"))
            except Exception as e:  # noqa: BLE001 — sin internet: se reintenta en el próximo ciclo
                log.warning("sin conexión con el hub (%s); %d tramos quedan pendientes", e, len(filas))
        time.sleep(cada)


# ------------------------------------------------------------------- main ---

def configurar_log() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(),
                  RotatingFileHandler(BASE / "contador.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")],
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Contador de clientes MITO")
    ap.add_argument("--ver", action="store_true", help="mostrar ventanas con las detecciones")
    ap.add_argument("--camara", help="correr solo esta cámara (para probar)")
    args = ap.parse_args()

    configurar_log()
    cfg = cargar_config()
    almacen = Almacen(BASE / "conteos.db")
    camaras = [Camara(cfg, c, almacen, args.ver) for c in cfg["camaras"]
               if c.get("activa", True) and (not args.camara or c["nombre"] == args.camara)]
    if not camaras:
        sys.exit("No hay cámaras activas en config.json")

    log.info("Contador MITO %s — %d cámara(s)", VERSION, len(camaras))
    for c in camaras:
        c.start()
    vista = cfg.get("vista") or {}
    if vista.get("activo"):
        from vista import ServidorVista
        servidor = ServidorVista(camaras, vista)
        servidor.iniciar()
        if vista.get("url_publica"):
            for c in camaras:
                c.vista_url = servidor.url_camara(vista["url_publica"], c.nombre)
    threading.Thread(target=enviar, args=(cfg, almacen, camaras), daemon=True, name="envio").start()

    try:
        while True:
            if args.ver:
                for c in camaras:
                    if c.vista is not None:
                        cv2.imshow(c.nombre, c.vista)
                if cv2.waitKey(30) & 0xFF == ord("q"):
                    break
            else:
                time.sleep(1)
    except KeyboardInterrupt:
        pass
    log.info("detenido")


if __name__ == "__main__":
    main()
