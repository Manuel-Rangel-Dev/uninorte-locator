"""
Validación estricta de los datagramas UDP recibidos por listener.py.

El puerto UDP está abierto a todo internet (las IP de los celulares cambian),
así que NADA de lo que llega se puede asumir válido. Este módulo no importa
db.py a propósito: así se puede probar sin base de datos ni variables de entorno.

Hay dos tipos de datagrama:

1. App Android (formato original, JSON UTF-8):
  obligatorios: lat (float), lng (float), date ("YYYY-MM-DD"), hour ("HH:MM:SS")
  opcionales:   acc (precisión en metros), spd (velocidad en m/s), seq (contador),
                vid (identificador del vehículo)

2. Nodo OBD (Android GPS-System; compatible con ESP32-S3 + A7608SA), se reconoce por "tipo": "obd":
  obligatorios: tipo ("obd"), rid (id del recorrido), seq (contador), t_ms (milisegundos del nodo)
  opcionales:   tok (token compartido, obligatorio si el servidor define OBD_TOKEN),
                utc ("YYYY-MM-DDTHH:MM:SS", hora UTC del celular o GNSS),
                lat, lng, alt (m), gkmh (velocidad GNSS en km/h), sat (satélites),
                acc (precisión horizontal, 0..10000 m; inválida -> None),
                y los 15 PIDs con los mismos nombres de columnas de log_csv.py (CAMPOS_OBD).
  Un PID inválido o ausente se guarda como NULL, no descarta el paquete.
"""

import hmac
import json
import math
import re
from datetime import datetime, timedelta

from tiempo import ahora_colombia

VID_VALIDO = re.compile(r"[A-Za-z0-9_-]{1,32}")  # letras, números, _ y -

CAMPOS_REQUERIDOS = {"lat", "lng", "date", "hour"}
FECHA_MINIMA = datetime(2020, 1, 1)
MARGEN_FUTURO = timedelta(days=1)  # tolera relojes de celular algo adelantados
ACC_MAX_VALIDA = 100_000.0  # metros; más que esto se considera dato basura
SPD_MAX_VALIDA = 200.0  # m/s
SEQ_MAX_VALIDO = 10**12


class PaqueteInvalido(Exception):
    """El datagrama no cumple el formato. El mensaje es seguro de imprimir
    en logs (nunca contiene texto controlado por quien envió el paquete)."""


def _rechazar_constante(nombre):
    # json.loads acepta NaN, Infinity y -Infinity por defecto; aquí se rechazan.
    raise ValueError("constante no permitida")


def _numero_finito(valor, nombre):
    """Convierte a float exigiendo número finito. Rechaza bool (True == 1.0)."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float, str)):
        raise PaqueteInvalido(f"{nombre} con tipo inválido")
    try:
        numero = float(valor)
    except ValueError:
        raise PaqueteInvalido(f"{nombre} no es numérico") from None
    if not math.isfinite(numero):
        raise PaqueteInvalido(f"{nombre} no es finito")
    return numero


def _opcional_float(valor, minimo, maximo):
    """Campo opcional: si es inválido se ignora (None), NO se descarta el paquete."""
    if valor is None or isinstance(valor, bool):
        return None
    try:
        numero = float(valor)
    except (TypeError, ValueError, OverflowError):  # OverflowError: entero JSON gigante
        return None
    if not math.isfinite(numero) or numero < minimo or numero > maximo:
        return None
    return numero


def _opcional_int(valor, minimo, maximo):
    if isinstance(valor, bool) or not isinstance(valor, int):
        return None
    if valor < minimo or valor > maximo:
        return None
    return valor


def _decodificar(datos: bytes) -> dict:
    """JSON UTF-8 -> dict. Lanza PaqueteInvalido si no es un objeto JSON válido."""
    try:
        payload = json.loads(datos.decode("utf-8"), parse_constant=_rechazar_constante)
    except (ValueError, RecursionError):
        # ValueError incluye UnicodeDecodeError y JSONDecodeError
        raise PaqueteInvalido("no es JSON válido") from None

    if not isinstance(payload, dict):
        raise PaqueteInvalido("el JSON no es un objeto")
    return payload


def parsear_paquete(datos: bytes) -> dict:
    """Valida un datagrama de la app y devuelve un dict limpio con las claves:
    lat, lng, ts (datetime naive hora Colombia), fecha, hora (canónicas),
    acc, spd, seq (los tres pueden ser None).
    Lanza PaqueteInvalido si algo obligatorio falla."""
    return _validar_app(_decodificar(datos))


def _validar_app(payload: dict) -> dict:
    if not CAMPOS_REQUERIDOS.issubset(payload.keys()):
        raise PaqueteInvalido("faltan campos obligatorios")

    lat = _numero_finito(payload["lat"], "lat")
    lng = _numero_finito(payload["lng"], "lng")
    if not -90.0 <= lat <= 90.0:
        raise PaqueteInvalido("lat fuera de rango")
    if not -180.0 <= lng <= 180.0:
        raise PaqueteInvalido("lng fuera de rango")

    fecha_txt, hora_txt = payload["date"], payload["hour"]
    if not isinstance(fecha_txt, str) or not isinstance(hora_txt, str):
        raise PaqueteInvalido("date/hour deben ser texto")
    try:
        ts = datetime.strptime(f"{fecha_txt.strip()} {hora_txt.strip()}", "%Y-%m-%d %H:%M:%S")
    except ValueError:
        raise PaqueteInvalido("date/hour con formato inválido") from None
    if ts < FECHA_MINIMA or ts > ahora_colombia() + MARGEN_FUTURO:
        raise PaqueteInvalido("fecha fuera de rango")

    vid = payload.get("vid")
    if vid is not None:
        # Este puerto está abierto a internet: el vid solo se acepta con formato estricto.
        if not isinstance(vid, str) or not VID_VALIDO.fullmatch(vid.strip()):
            raise PaqueteInvalido("vid con formato inválido")
        vid = vid.strip().lower()

    return {
        "lat": lat,
        "lng": lng,
        "ts": ts,
        # Se guardan en formato canónico (ya validado), nunca el texto original.
        "fecha": ts.strftime("%Y-%m-%d"),
        "hora": ts.strftime("%H:%M:%S"),
        "acc": _opcional_float(payload.get("acc"), 0.0, ACC_MAX_VALIDA),
        "spd": _opcional_float(payload.get("spd"), 0.0, SPD_MAX_VALIDA),
        "seq": _opcional_int(payload.get("seq"), 0, SEQ_MAX_VALIDO),
        "vid": vid,
    }


# ---------------------------------------------------------------------------
# Nodo OBD del Kia
# ---------------------------------------------------------------------------

# PIDs en el mismo orden y con los mismos nombres de columnas de log_csv.py.
# (nombre, mínimo, máximo): rangos físicos que permite cada PID según SAE J1979.
CAMPOS_OBD = (
    ("rpm", 0.0, 16_384.0),        # 0x0C
    ("vel", 0.0, 255.0),           # 0x0D, km/h
    ("carga", 0.0, 100.0),         # 0x04, %
    ("tps", 0.0, 100.0),           # 0x11, %
    ("pedal", 0.0, 100.0),         # 0x49, %
    ("acel_cmd", 0.0, 100.0),      # 0x4C, %
    ("map", 0.0, 255.0),           # 0x0B, kPa
    ("carga_abs", 0.0, 25_700.0),  # 0x43, %
    ("lambda", 0.0, 2.0),          # 0x44
    ("avance", -64.0, 64.0),       # 0x0E, grados
    ("stft", -100.0, 100.0),       # 0x06, %
    ("fuel_lph", 0.0, 3_277.0),    # 0x5E, L/h
    ("ltft", -100.0, 100.0),       # 0x07, %
    ("ect", -40.0, 215.0),         # 0x05, °C
    ("iat", -40.0, 215.0),         # 0x0F, °C
)
NOMBRES_OBD = tuple(nombre for nombre, _, _ in CAMPOS_OBD)

RID_VALIDO = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
T_MS_MAX = 2**32  # millis() del ESP32 es un entero de 32 bits sin signo


def _token_coincide(recibido: str, esperado: str) -> bool:
    """Compara en tiempo constante. Usa bytes porque compare_digest lanza TypeError
    con str no ASCII, y surrogatepass porque el JSON puede traer "\\ud800" suelto."""
    return hmac.compare_digest(
        recibido.encode("utf-8", "surrogatepass"),
        esperado.encode("utf-8", "surrogatepass"),
    )


def _validar_obd(payload: dict, token_esperado: str | None) -> dict:
    """Valida un datagrama del nodo OBD. Devuelve un dict con: rid, seq, t_ms,
    ts (datetime naive hora Colombia, o None sin fix GNSS), lat, lng, alt,
    gkmh, sat, acc y los PIDs de NOMBRES_OBD (cualquiera puede ser None)."""
    if token_esperado:
        token = payload.get("tok")
        if not isinstance(token, str) or not _token_coincide(token, token_esperado):
            raise PaqueteInvalido("token OBD inválido")

    rid = payload.get("rid")
    if not isinstance(rid, str) or not RID_VALIDO.fullmatch(rid):
        raise PaqueteInvalido("rid inválido")
    seq = _opcional_int(payload.get("seq"), 0, SEQ_MAX_VALIDO)
    t_ms = _opcional_int(payload.get("t_ms"), 0, T_MS_MAX)
    if seq is None or t_ms is None:
        raise PaqueteInvalido("seq o t_ms inválido")

    # Hora del GNSS (UTC) -> hora Colombia, igual que la columna ts de la app.
    ts = None
    utc_txt = payload.get("utc")
    if isinstance(utc_txt, str):
        try:
            ts = datetime.strptime(utc_txt.strip(), "%Y-%m-%dT%H:%M:%S") - timedelta(hours=5)
        except (ValueError, OverflowError):  # OverflowError: fechas cercanas al año 1
            ts = None
        if ts is not None and (ts < FECHA_MINIMA or ts > ahora_colombia() + MARGEN_FUTURO):
            ts = None

    lat = _opcional_float(payload.get("lat"), -90.0, 90.0)
    lng = _opcional_float(payload.get("lng"), -180.0, 180.0)
    if lat is None or lng is None:
        lat = lng = None  # una coordenada sin la otra no sirve

    limpio = {
        "rid": rid,
        "seq": seq,
        "t_ms": t_ms,
        "ts": ts,
        "lat": lat,
        "lng": lng,
        "alt": _opcional_float(payload.get("alt"), -500.0, 9_000.0),
        "gkmh": _opcional_float(payload.get("gkmh"), 0.0, 400.0),
        "sat": _opcional_int(payload.get("sat"), 0, 200),
        "acc": _opcional_float(payload.get("acc"), 0.0, 10_000.0),
    }
    for nombre, minimo, maximo in CAMPOS_OBD:
        limpio[nombre] = _opcional_float(payload.get(nombre), minimo, maximo)
    return limpio


def clasificar_paquete(datos: bytes, token_obd: str | None = None) -> tuple[str, dict]:
    """Decodifica un datagrama y lo valida según su tipo.
    Devuelve ("obd", dict) para el nodo del Kia o ("app", dict) para la app Android.
    Lanza PaqueteInvalido si no cumple el formato de su tipo."""
    payload = _decodificar(datos)
    if payload.get("tipo") == "obd":
        return "obd", _validar_obd(payload, token_obd)
    return "app", _validar_app(payload)
