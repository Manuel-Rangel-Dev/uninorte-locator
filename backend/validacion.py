"""
Validación estricta de los datagramas UDP recibidos por listener.py.

El puerto UDP está abierto a todo internet (las IP de los celulares cambian),
así que NADA de lo que llega se puede asumir válido. Este módulo no importa
db.py a propósito: así se puede probar sin base de datos ni variables de entorno.

Formato esperado (JSON, UTF-8):
  obligatorios: lat (float), lng (float), date ("YYYY-MM-DD"), hour ("HH:MM:SS")
  opcionales:   acc (precisión en metros), spd (velocidad en m/s), seq (contador)
"""

import json
import math
from datetime import datetime, timedelta

from tiempo import ahora_colombia

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
    except (TypeError, ValueError):
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


def parsear_paquete(datos: bytes) -> dict:
    """Valida un datagrama y devuelve un dict limpio con las claves:
    lat, lng, ts (datetime naive hora Colombia), fecha, hora (canónicas),
    acc, spd, seq (los tres pueden ser None).
    Lanza PaqueteInvalido si algo obligatorio falla."""
    try:
        payload = json.loads(datos.decode("utf-8"), parse_constant=_rechazar_constante)
    except (ValueError, RecursionError):
        # ValueError incluye UnicodeDecodeError y JSONDecodeError
        raise PaqueteInvalido("no es JSON válido") from None

    if not isinstance(payload, dict):
        raise PaqueteInvalido("el JSON no es un objeto")

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
    }
