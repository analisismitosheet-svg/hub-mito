"""
Video en vivo del conteo (cajas, zonas y contadores dibujados) para el Hub MITO.

Escucha SOLO en 127.0.0.1. Desde afuera se llega por Tailscale (serve para la VPN y/o
Funnel para internet). NO hay links fijos: para ver una cámara el hub pide un PASE temporal
con la sesión del usuario, y esta PC le pregunta al hub (Supabase, con las mismas reglas
RLS: cada local ve solo lo suyo) si ese usuario puede ver ese local. Calibrar (foto limpia,
canales) exige además el permiso contador.gestionar.

    POST /pase    Authorization: Bearer <sesión del hub>   {"camara", "alcance": "ver"|"gestion"}
                  -> {"pase", "vence"}   (30 min)
    GET  /video/<camara>?k=<pase>          MJPEG (lo muestra un <img> en el hub)
    GET  /foto/<camara>?k=<pase>[&limpia=1]  un cuadro JPEG (limpia = sin dibujos, para calibrar)
    GET  /canales/<camara>?k=<pase>        {"canales", "actual"}          (alcance gestion)
    GET  /canal/<camara>/<n>?k=<pase>      foto de otro canal del DVR     (alcance gestion)
    GET  /salud                            {"ok": true}

Config (config.json):
    "vista": {"activo": true, "puerto": 8765, "token": "<secreto de la PC>",
              "url_publica": "https://<esta-pc>.<tailnet>.ts.net:8443",
              "fps": 4, "ancho": 800, "calidad": 65}
    "hub_supabase": {"url": "https://xxx.supabase.co", "anon": "<anon key pública>"}
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

log = logging.getLogger("contador")

DURACION_PASE = 30 * 60
ALCANCES = {"ver": 1, "gestion": 2}


class Autorizador:
    """Pregunta al hub (Supabase, con la sesión del usuario) qué puede ver. Cachea 60 s."""

    def __init__(self, url: str, anon: str):
        self.url, self.anon = url.rstrip("/"), anon
        self.cache: dict[tuple, tuple[bool, float]] = {}
        self.lock = threading.Lock()

    def _pedir(self, metodo: str, ruta: str, jwt: str, cuerpo: dict | None = None):
        req = urllib.request.Request(
            self.url + ruta, method=metodo, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
            headers={"apikey": self.anon, "Authorization": f"Bearer {jwt}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)

    def _cacheado(self, clave: tuple, calcular) -> bool:
        ahora = time.time()
        with self.lock:
            v = self.cache.get(clave)
            if v and v[1] > ahora:
                return v[0]
        try:
            ok = bool(calcular())
        except (urllib.error.URLError, ValueError, TimeoutError):
            ok = False
        with self.lock:
            if len(self.cache) > 2000:
                self.cache.clear()
            self.cache[clave] = (ok, ahora + 60)
        return ok

    def puede_ver(self, jwt: str, local: str) -> bool:
        """Si RLS le deja ver la PC contadora de ese local, puede ver su video."""
        h = hashlib.sha256(jwt.encode()).hexdigest()
        ruta = f"/rest/v1/contador_dispositivos?select=local&local=eq.{urllib.parse.quote(local)}&limit=1"
        return self._cacheado((h, "ver", local), lambda: len(self._pedir("GET", ruta, jwt)) > 0)

    def puede_gestionar(self, jwt: str) -> bool:
        h = hashlib.sha256(jwt.encode()).hexdigest()

        def calcular():
            perfil = self._pedir("POST", "/rest/v1/rpc/mi_perfil", jwt, {})
            perfil = perfil[0] if isinstance(perfil, list) and perfil else perfil
            if isinstance(perfil, dict) and (perfil.get("es_admin") or perfil.get("rol") == "administrador"
                                             or "administrador" in (perfil.get("roles") or [])):
                return True
            permisos = self._pedir("POST", "/rest/v1/rpc/mis_permisos", jwt, {})
            return any((p.get("clave") if isinstance(p, dict) else p) == "contador.gestionar" for p in permisos or [])

        return self._cacheado((h, "gestion"), calcular)


class ServidorVista:
    def __init__(self, camaras: list, cfg_vista: dict, cfg_hub: dict | None = None):
        self.camaras = {c.nombre: c for c in camaras}
        self.secreto = str(cfg_vista.get("token") or "").encode()
        self.puerto = int(cfg_vista.get("puerto", 8765))
        # Livianos por defecto: el video sale por la subida de internet de la PC contadora
        self.fps = float(cfg_vista.get("fps", 4))
        self.ancho = int(cfg_vista.get("ancho", 800))
        self.calidad = int(cfg_vista.get("calidad", 65))
        if len(self.secreto) < 16:
            raise SystemExit("vista.token tiene que tener al menos 16 caracteres (lo genera publicar_vista.bat)")
        cfg_hub = cfg_hub or {}
        self.autorizador = Autorizador(cfg_hub["url"], cfg_hub["anon"]) if cfg_hub.get("url") and cfg_hub.get("anon") else None
        if not self.autorizador:
            log.warning("vista: falta 'hub_supabase' (url y anon) en config.json: nadie va a poder pedir pases de video")

    # -- pases temporales
    def emitir(self, camara: str, alcance: str) -> tuple[str, int]:
        vence = int(time.time()) + DURACION_PASE
        datos = f"{camara}|{alcance}|{vence}".encode("utf-8")
        firma = hmac.new(self.secreto, datos, "sha256").hexdigest()[:40]
        return base64.urlsafe_b64encode(datos).decode().rstrip("=") + "." + firma, vence

    def validar(self, pase: str, camara: str, alcance: str) -> bool:
        try:
            cuerpo, firma = pase.split(".", 1)
            datos = base64.urlsafe_b64decode(cuerpo + "=" * (-len(cuerpo) % 4))
            if not hmac.compare_digest(firma, hmac.new(self.secreto, datos, "sha256").hexdigest()[:40]):
                return False
            cam, alc, vence = datos.decode("utf-8").rsplit("|", 2)
            return cam == camara and int(vence) > time.time() and ALCANCES.get(alc, 0) >= ALCANCES[alcance]
        except (ValueError, UnicodeDecodeError):
            return False

    def jpeg(self, camara, limpia: bool = False) -> bytes | None:
        # limpia: el último cuadro de la cámara SIN cajas ni zonas (para calibrar desde el hub)
        img = (camara.lector.ultimo()[1] if camara.lector else None) if limpia else camara.vista
        if img is None:
            return None
        if img.shape[1] > self.ancho:
            img = cv2.resize(img, (self.ancho, int(img.shape[0] * self.ancho / img.shape[1])))
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, self.calidad])
        return buf.tobytes() if ok else None

    def iniciar(self) -> None:
        servidor = self

        class Manejador(BaseHTTPRequestHandler):
            def log_message(self, *_):  # sin ruido en la consola
                pass

            def cors(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

            def responder(self, codigo: int, cuerpo: bytes, tipo: str) -> None:
                self.send_response(codigo)
                self.send_header("Content-Type", tipo)
                self.cors()  # el editor del hub lee los píxeles de la foto (color de credencial)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)

            def json(self, codigo: int, datos: dict) -> None:
                self.responder(codigo, json.dumps(datos).encode(), "application/json")

            def do_OPTIONS(self):  # noqa: N802 — preflight del fetch del hub
                self.send_response(204)
                self.cors()
                self.send_header("Access-Control-Max-Age", "600")
                self.end_headers()

            def do_POST(self):  # noqa: N802
                if urllib.parse.urlparse(self.path).path != "/pase":
                    return self.json(404, {"error": "no existe"})
                if servidor.autorizador is None:
                    return self.json(503, {"error": "La PC contadora no tiene configurado el acceso al hub"})
                auth = self.headers.get("Authorization", "")
                jwt = auth[7:].strip() if auth.startswith("Bearer ") else ""
                try:
                    largo = min(int(self.headers.get("Content-Length") or 0), 4096)
                    pedido = json.loads(self.rfile.read(largo) or b"{}")
                except ValueError:
                    return self.json(400, {"error": "JSON inválido"})
                nombre = str(pedido.get("camara") or "")
                alcance = pedido.get("alcance") if pedido.get("alcance") in ALCANCES else "ver"
                cam = servidor.camaras.get(nombre)
                if not jwt or cam is None:
                    return self.json(401 if not jwt else 404, {"error": "sin sesión" if not jwt else "cámara inexistente"})
                local = getattr(cam, "local", None)
                if not local:
                    return self.json(503, {"error": "la cámara todavía no se vinculó a su local (esperá unos segundos)"})
                ok = servidor.autorizador.puede_ver(jwt, local)
                if ok and alcance == "gestion":
                    ok = servidor.autorizador.puede_gestionar(jwt)
                if not ok:
                    return self.json(403, {"error": "tu usuario no tiene permiso para ver esta cámara"})
                pase, vence = servidor.emitir(nombre, alcance)
                return self.json(200, {"pase": pase, "vence": vence})

            def do_GET(self):  # noqa: N802
                url = urllib.parse.urlparse(self.path)
                if url.path == "/salud":
                    return self.json(200, {"ok": True})
                q = urllib.parse.parse_qs(url.query)
                pase = q.get("k", [""])[0]
                partes = url.path.strip("/").split("/", 1)
                if len(partes) != 2 or partes[0] not in ("video", "foto", "canales", "canal"):
                    return self.responder(404, b"no existe", "text/plain")
                numero = None
                if partes[0] == "canal":  # /canal/<camara>/<n>
                    resto, _, num = partes[1].rpartition("/")
                    if not num.isdigit():
                        return self.responder(404, b"no existe", "text/plain")
                    partes[1], numero = resto, int(num)
                nombre = urllib.parse.unquote(partes[1])
                cam = servidor.camaras.get(nombre)
                limpia = q.get("limpia", ["0"])[0] == "1"
                alcance = "gestion" if partes[0] in ("canales", "canal") or limpia else "ver"
                if cam is None or not servidor.validar(pase, nombre, alcance):
                    return self.responder(401, b"pase invalido o vencido", "text/plain")
                if partes[0] in ("canales", "canal"):
                    # Fotos de todos los canales del DVR para elegir la cámara desde el hub (solo SDK Dahua)
                    lector = cam.lector
                    if not hasattr(lector, "fotos_canales"):
                        return self.responder(501, b"solo con conexion por SDK Dahua", "text/plain")
                    if partes[0] == "canales":
                        return self.json(200, {"canales": lector.canales, "actual": cam.canal()})
                    jpg = lector.fotos_canales().get(numero)
                    return self.responder(200 if jpg else 404, jpg or b"sin imagen", "image/jpeg" if jpg else "text/plain")
                cam.mirando += 1
                try:
                    if partes[0] == "foto":
                        for _ in range(30):  # esperar a que haya un cuadro
                            if servidor.jpeg(cam, limpia) is not None:
                                break
                            time.sleep(0.1)
                        img = servidor.jpeg(cam, limpia)
                        return self.responder(200 if img else 503, img or b"sin imagen", "image/jpeg" if img else "text/plain")
                    for _ in range(50):  # hasta 5 s para el primer cuadro; si no hay, avisar y no quedar colgado
                        if cam.vista is not None:
                            break
                        time.sleep(0.1)
                    if cam.vista is None:
                        motivo = (cam.lector.error if cam.lector else None) or "sin imagen"
                        return self.responder(503, f"sin imagen: {motivo}".encode(), "text/plain; charset=utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=cuadro")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    periodo = 1.0 / servidor.fps
                    while True:
                        t0 = time.time()
                        img = servidor.jpeg(cam)
                        if img:
                            self.wfile.write(b"--cuadro\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                             + str(len(img)).encode() + b"\r\n\r\n" + img + b"\r\n")
                        time.sleep(max(0.0, periodo - (time.time() - t0)))
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass  # el que miraba cerró la pestaña
                finally:
                    cam.mirando -= 1

        httpd = ThreadingHTTPServer(("127.0.0.1", self.puerto), Manejador)
        httpd.daemon_threads = True
        threading.Thread(target=httpd.serve_forever, daemon=True, name="vista").start()
        log.info("video en vivo en http://127.0.0.1:%s (pases temporales validados contra el hub)", self.puerto)
