"""
Video en vivo del conteo (cajas, zonas y contadores dibujados) para el Hub MITO.

Escucha SOLO en 127.0.0.1: desde afuera se llega a través de `tailscale serve`
(HTTPS dentro de la VPN de la empresa, nunca abierto a internet). Pide token.
Solo dibuja y comprime cuadros mientras alguien está mirando.

    GET /video/<camara>?t=<token>   MJPEG (lo muestra un <img> en el hub)
    GET /foto/<camara>?t=<token>    un cuadro JPEG
    GET /salud                      {"ok": true}

Config (config.json):
    "vista": {"activo": true, "puerto": 8765, "token": "...",
              "url_publica": "https://<esta-pc>.<tailnet>.ts.net:8765"}
Publicar en la VPN: publicar_vista.bat (una vez, como administrador).
"""

from __future__ import annotations

import hmac
import json
import logging
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

log = logging.getLogger("contador")


class ServidorVista:
    def __init__(self, camaras: list, cfg_vista: dict):
        self.camaras = {c.nombre: c for c in camaras}
        self.token = str(cfg_vista.get("token") or "")
        self.puerto = int(cfg_vista.get("puerto", 8765))
        self.fps = float(cfg_vista.get("fps", 6))
        self.ancho = int(cfg_vista.get("ancho", 960))
        self.calidad = int(cfg_vista.get("calidad", 70))
        if len(self.token) < 16:
            raise SystemExit("vista.token tiene que tener al menos 16 caracteres (lo genera publicar_vista.bat)")

    def url_camara(self, url_publica: str, nombre: str) -> str:
        return f"{url_publica.rstrip('/')}/video/{urllib.parse.quote(nombre)}?t={self.token}"

    def jpeg(self, camara) -> bytes | None:
        img = camara.vista
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

            def responder(self, codigo: int, cuerpo: bytes, tipo: str) -> None:
                self.send_response(codigo)
                self.send_header("Content-Type", tipo)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(cuerpo)))
                self.end_headers()
                self.wfile.write(cuerpo)

            def do_GET(self):  # noqa: N802
                url = urllib.parse.urlparse(self.path)
                if url.path == "/salud":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')
                    return
                token = urllib.parse.parse_qs(url.query).get("t", [""])[0]
                if not hmac.compare_digest(token, servidor.token):
                    return self.responder(401, b"token invalido", "text/plain")
                partes = url.path.strip("/").split("/", 1)
                if len(partes) != 2 or partes[0] not in ("video", "foto"):
                    return self.responder(404, b"no existe", "text/plain")
                cam = servidor.camaras.get(urllib.parse.unquote(partes[1]))
                if cam is None:
                    return self.responder(404, json.dumps(list(servidor.camaras)).encode(), "application/json")
                cam.mirando += 1
                try:
                    if partes[0] == "foto":
                        for _ in range(30):  # esperar a que se dibuje el primer cuadro
                            if cam.vista is not None:
                                break
                            time.sleep(0.1)
                        img = servidor.jpeg(cam)
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
        log.info("video en vivo en http://127.0.0.1:%s (publicar en la VPN con publicar_vista.bat)", self.puerto)
