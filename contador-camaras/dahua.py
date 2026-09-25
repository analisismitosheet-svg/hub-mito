"""
Conexión a DVR/NVR Dahua con la librería oficial (NetSDK, la misma que usa SmartPSS),
en vez de RTSP. Sirve cuando el RTSP no está accesible:
  - por el puerto de SmartPSS (37777 o el que haya abierto el router por UPnP, ej. 31256),
  - por la nube P2P de Dahua con el número de serie (locales sin DDNS).

La librería (dhnetsdk.dll, play.dll y sus dependencias) NO va en git: se indica la
carpeta en config.json -> "sdk_dahua": "D:/ContadorIA" (o se copia a contador-camaras/sdk_dahua).

    python dahua.py login <host_o_serie> <puerto> <usuario>        # prueba de login (pide la clave)
"""

from __future__ import annotations

import ctypes
import getpass
import os
import sys
import threading
from ctypes import POINTER, WINFUNCTYPE, byref, c_char_p, c_int, c_longlong, c_uint, c_ushort, c_void_p
from pathlib import Path

BASE = Path(__file__).resolve().parent

# EM_LOGIN_SPAC_CAP_TYPE
LOGIN_TCP = 0
LOGIN_P2P = 19

# Errores de login (parámetro *error de CLIENT_LoginEx2)
ERRORES_LOGIN = {
    1: "clave incorrecta",
    2: "el usuario no existe",
    3: "tiempo de espera agotado (no responde)",
    4: "el usuario ya está conectado",
    5: "usuario BLOQUEADO por intentos fallidos",
    6: "usuario en lista negra",
    7: "el equipo está ocupado",
    8: "tiempo de espera agotado",
    9: "demasiadas conexiones",
    10: "no se pudo conectar",
    11: "no se pudo conectar",
    12: "el equipo no admite este tipo de login",
    13: "el usuario no tiene permiso para ver",
    17: "hay que cambiar la clave del equipo (clave inicial)",
    18: "el equipo pide otro tipo de login",
    20: "sin permiso para conectar",
}


class InfoEquipo(ctypes.Structure):
    """NET_DEVICEINFO_Ex (se reserva de más por si la versión del SDK la agranda)."""
    _fields_ = [
        ("serie", ctypes.c_char * 48),
        ("entradas_alarma", c_int),
        ("salidas_alarma", c_int),
        ("discos", c_int),
        ("tipo", c_int),
        ("canales", c_int),
        ("limite_intentos", ctypes.c_ubyte),
        ("intentos_restantes", ctypes.c_ubyte),
        ("_r1", ctypes.c_ubyte * 2),
        ("bloqueo_segundos", c_int),
        ("_reservado", ctypes.c_char * 512),
    ]


_DESCONEXION = WINFUNCTYPE(None, c_longlong, c_char_p, c_int, c_longlong)
_CB_DATOS = WINFUNCTYPE(None, c_longlong, c_uint, POINTER(ctypes.c_ubyte), c_uint, c_longlong, c_longlong)


def carpeta_sdk(cfg: dict | None = None) -> Path:
    cand = [Path(cfg["sdk_dahua"])] if cfg and cfg.get("sdk_dahua") else []
    cand += [BASE / "sdk_dahua", Path("D:/ContadorIA")]
    for c in cand:
        if (c / "dhnetsdk.dll").exists():
            return c
    raise FileNotFoundError("No encuentro dhnetsdk.dll: poné la carpeta del SDK de Dahua en config.json -> sdk_dahua")


class SDK:
    """Carga única de la librería (el SDK es global al proceso)."""

    _inst = None
    _lock = threading.Lock()

    def __init__(self, carpeta: Path):
        os.add_dll_directory(str(carpeta))
        self.carpeta = carpeta
        self.dll = ctypes.WinDLL(str(carpeta / "dhnetsdk.dll"))
        d = self.dll
        d.CLIENT_Init.argtypes = [_DESCONEXION, c_longlong]
        d.CLIENT_Init.restype = ctypes.c_bool
        d.CLIENT_LoginEx2.argtypes = [c_char_p, c_ushort, c_char_p, c_char_p, c_int, c_void_p, POINTER(InfoEquipo), POINTER(c_int)]
        d.CLIENT_LoginEx2.restype = c_longlong
        d.CLIENT_Logout.argtypes = [c_longlong]
        d.CLIENT_Logout.restype = ctypes.c_bool
        d.CLIENT_GetLastError.restype = c_uint
        d.CLIENT_SetConnectTime.argtypes = [c_int, c_int]
        self._cb_desconexion = _DESCONEXION(lambda *_: None)  # referencia viva: si no, el GC la borra
        if not d.CLIENT_Init(self._cb_desconexion, 0):
            raise RuntimeError("CLIENT_Init falló")
        d.CLIENT_SetConnectTime(5000, 3)  # 5 s por intento, 3 intentos
        d.CLIENT_RealPlayEx.argtypes = [c_longlong, c_int, c_void_p, c_int]
        d.CLIENT_RealPlayEx.restype = c_longlong
        d.CLIENT_SetRealDataCallBackEx2.argtypes = [c_longlong, _CB_DATOS, c_longlong, c_uint]
        d.CLIENT_StopRealPlayEx.argtypes = [c_longlong]

    @classmethod
    def obtener(cls, cfg: dict | None = None) -> "SDK":
        with cls._lock:
            if cls._inst is None:
                cls._inst = SDK(carpeta_sdk(cfg))
            return cls._inst

    def login(self, host: str, puerto: int, usuario: str, clave: str, p2p: bool = False) -> tuple[int, InfoEquipo, str | None]:
        """Devuelve (handle, info, error). handle 0 = falló (error dice por qué)."""
        info = InfoEquipo()
        err = c_int(0)
        h = self.dll.CLIENT_LoginEx2(host.encode(), puerto, usuario.encode(), clave.encode(),
                                     LOGIN_P2P if p2p else LOGIN_TCP, None, byref(info), byref(err))
        if h:
            return h, info, None
        motivo = ERRORES_LOGIN.get(err.value, f"error {err.value} (SDK {self.dll.CLIENT_GetLastError() & 0x7fffffff})")
        return 0, info, motivo

    def logout(self, h: int) -> None:
        if h:
            self.dll.CLIENT_Logout(h)


class _Tubo:
    """Buffer entre el callback del SDK (escribe) y FFmpeg (lee). read() bloquea hasta que haya
    datos; si no llega nada en `espera` segundos devuelve b'' y el decodificador termina."""

    def __init__(self, espera: float = 15.0):
        self.cond = threading.Condition()
        self.buf = bytearray()
        self.cerrado = False
        self.espera = espera

    def escribir(self, datos: bytes) -> None:
        with self.cond:
            if len(self.buf) > 8_000_000:  # si el decodificador se atrasa, no crecer sin límite
                self.buf.clear()
            self.buf += datos
            self.cond.notify()

    def cerrar(self) -> None:
        with self.cond:
            self.cerrado = True
            self.cond.notify()

    def read(self, n: int = -1) -> bytes:
        with self.cond:
            if not self.buf and not self.cerrado:
                self.cond.wait(self.espera)
            if not self.buf:
                return b""
            n = len(self.buf) if n < 0 else min(n, len(self.buf))
            out = bytes(self.buf[:n])
            del self.buf[:n]
            return out


def foto_canal(sdk: "SDK", h: int, canal: int, segundos: float = 6.0):
    """Un cuadro (BGR) de un canal, por el stream secundario, usando un login ya abierto."""
    import time

    import av

    d = sdk.dll
    tubo = _Tubo(espera=segundos)

    def cb(_h, tipo, buf, n, _p, _u):
        if tipo == 0:
            tubo.escribir(ctypes.string_at(buf, n))

    ref = _CB_DATOS(cb)
    rh = d.CLIENT_RealPlayEx(h, canal - 1, None, 3)
    if not rh:
        return None
    d.CLIENT_SetRealDataCallBackEx2(rh, ref, 0, 0x1)
    img, fin = None, time.time() + segundos
    try:
        cont = av.open(tubo, format="dhav")
        for frame in cont.decode(video=0):
            img = frame.to_ndarray(format="bgr24")
            if time.time() > fin - segundos / 2:  # un cuadro ya asentado, no el primero gris
                break
    except Exception:  # noqa: BLE001
        pass
    finally:
        d.CLIENT_StopRealPlayEx(rh)
        tubo.cerrar()
        del ref
    return img


class LectorDahua(threading.Thread):
    """Mismo contrato que contador.Lector (error, ultimo()), pero con el SDK de Dahua:
    login + video en vivo del canal, flujo DHAV decodificado con FFmpeg (PyAV).

    Config de la cámara:  "sdk": {"host": "x.ddns.net" | "<serie P2P>", "puerto": 37777,
                                   "usuario": "...", "clave": "...", "canal": 8, "stream": "principal"|"secundario",
                                   "p2p": false}
    """

    ESPERA_CLAVE_MALA = 30 * 60  # no insistir con una clave mala: el DVR bloquea el usuario

    def __init__(self, nombre: str, datos: dict, cfg: dict | None = None):
        super().__init__(daemon=True, name=f"sdk-{nombre}")
        self.nombre, self.datos, self.cfg = nombre, datos, cfg
        self.cuadro = None
        self.nro = 0
        self.error: str | None = "conectando"
        self.lock = threading.Lock()
        self._cb = _CB_DATOS(self._al_recibir)  # referencia viva
        self._tubo: _Tubo | None = None
        self._h = 0            # login activo (para sacar fotos de otros canales)
        self._fin = False
        self.canales = 0       # cantidad de canales del DVR
        self._fotos: dict[int, tuple[float, bytes]] = {}
        self._lock_fotos = threading.Lock()

    def detener(self) -> None:
        """Cámara quitada desde el hub: cortar el video y no reconectar."""
        self._fin = True
        if self._tubo is not None:
            self._tubo.cerrar()

    def cambiar_canal(self, canal: int) -> None:
        """Pasa a otro canal del DVR sin reiniciar el programa (lo elige el editor del hub)."""
        if int(self.datos.get("canal", 1)) == int(canal):
            return
        self.datos["canal"] = int(canal)
        if self._tubo is not None:
            self._tubo.cerrar()  # corta el video actual; el bucle reconecta con el canal nuevo

    def fotos_canales(self, max_edad: float = 180.0) -> dict[int, bytes]:
        """Una foto (JPEG) de cada canal del DVR, sacadas en paralelo por el stream secundario.
        Se guardan unos minutos para no pedirle 16 videos al DVR cada vez."""
        import time
        from concurrent.futures import ThreadPoolExecutor

        import cv2

        with self._lock_fotos:
            ahora = time.time()
            if self._fotos and all(ahora - t < max_edad for t, _ in self._fotos.values()):
                return {c: j for c, (_, j) in self._fotos.items()}
            h, n = self._h, self.canales
            if not h or not n:
                return {}
            sdk = SDK.obtener(self.cfg)

            def una(canal: int):
                img = foto_canal(sdk, h, canal)
                if img is None:
                    return canal, None
                img = cv2.resize(img, (640, int(img.shape[0] * 640 / img.shape[1])))
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])
                return canal, buf.tobytes() if ok else None

            with ThreadPoolExecutor(max_workers=8) as ex:
                for canal, jpg in ex.map(una, range(1, n + 1)):
                    if jpg:
                        self._fotos[canal] = (ahora, jpg)
            return {c: j for c, (_, j) in self._fotos.items()}

    def _al_recibir(self, _h, tipo, buf, n, _param, _user) -> None:
        if tipo == 0 and self._tubo is not None:
            self._tubo.escribir(ctypes.string_at(buf, n))

    def ultimo(self):
        with self.lock:
            return self.nro, self.cuadro

    def run(self) -> None:
        import logging
        import time
        import av

        log = logging.getLogger("contador")
        sdk = SDK.obtener(self.cfg)
        d = sdk.dll
        x = self.datos
        tipo_stream = 3 if x.get("stream") == "secundario" else 0  # DH_RType_Realplay_1 / Realplay
        espera = 5
        while not self._fin:
            h, info, motivo = sdk.login(x["host"], int(x.get("puerto", 37777)), x["usuario"], x["clave"],
                                        p2p=bool(x.get("p2p")))
            if not h:
                self.error = f"DVR: {motivo}"
                if info.intentos_restantes:
                    self.error += f" (quedan {info.intentos_restantes} intentos)"
                grave = any(p in (motivo or "") for p in ("clave", "BLOQUEADO", "no existe", "permiso"))
                pausa = self.ESPERA_CLAVE_MALA if grave else espera
                log.warning("[%s] %s; reintento en %s s", self.nombre, self.error, pausa)
                time.sleep(pausa)
                espera = min(espera * 2, 60)
                continue
            self._h, self.canales = h, info.canales
            rh = d.CLIENT_RealPlayEx(h, int(x.get("canal", 1)) - 1, None, tipo_stream)
            if not rh:
                self.error = f"DVR: no abre el canal {x.get('canal')} (error {d.CLIENT_GetLastError() & 0x7fffffff})"
                sdk.logout(h)
                time.sleep(espera)
                continue
            self._tubo = _Tubo()
            d.CLIENT_SetRealDataCallBackEx2(rh, self._cb, 0, 0x1)
            log.info("[%s] conectado por SDK Dahua (serie %s, canal %s)", self.nombre,
                     info.serie.decode(errors="replace"), x.get("canal"))
            try:
                cont = av.open(self._tubo, format="dhav")
                for frame in cont.decode(video=0):
                    img = frame.to_ndarray(format="bgr24")
                    with self.lock:
                        self.cuadro = img
                        self.nro += 1
                    if self.error:
                        self.error, espera = None, 5
                self.error = "se cortó el video"
            except Exception as e:  # noqa: BLE001 — flujo cortado o corrupto: reconectar
                self.error = f"se cortó el video ({type(e).__name__})"
            finally:
                d.CLIENT_StopRealPlayEx(rh)
                self._tubo.cerrar()
                self._tubo = None
                self._h = 0
                sdk.logout(h)
            if self._fin:
                return
            log.warning("[%s] %s; reconectando", self.nombre, self.error)
            time.sleep(espera)


def _main() -> None:
    if len(sys.argv) >= 5 and sys.argv[1] == "login":
        host, puerto, usuario = sys.argv[2], int(sys.argv[3]), sys.argv[4]
        clave = os.environ.get("DAHUA_CLAVE") or getpass.getpass("Clave del DVR: ")
        sdk = SDK.obtener()
        h, info, error = sdk.login(host, puerto, usuario, clave, p2p=not any(ch in host for ch in ".:"))
        if not h:
            print(f"NO entró: {error}. Intentos restantes antes de bloquear: {info.intentos_restantes}")
            return
        print(f"OK: serie {info.serie.decode(errors='replace')} · {info.canales} canales · tipo {info.tipo}")
        sdk.logout(h)
    else:
        print(__doc__)


if __name__ == "__main__":
    _main()
