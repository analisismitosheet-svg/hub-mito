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


_CB_DATOS = WINFUNCTYPE(None, c_longlong, c_uint, POINTER(ctypes.c_ubyte), c_uint, c_longlong, c_longlong)


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
        d.CLIENT_RealPlayEx.argtypes = [c_longlong, c_int, c_void_p, c_int]
        d.CLIENT_RealPlayEx.restype = c_longlong
        d.CLIENT_SetRealDataCallBackEx2.argtypes = [c_longlong, _CB_DATOS, c_longlong, c_uint]
        d.CLIENT_StopRealPlayEx.argtypes = [c_longlong]
        x = self.datos
        tipo_stream = 3 if x.get("stream") == "secundario" else 0  # DH_RType_Realplay_1 / Realplay
        espera = 5
        while True:
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
                sdk.logout(h)
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
