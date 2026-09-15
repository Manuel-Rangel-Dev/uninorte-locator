"""
Listener UDP ("sniffer"): escucha en el puerto 5000, parsea el JSON
enviado por la app Android y lo persiste en SQLite.
"""

import json
import socket
from datetime import datetime

from db import init_db, insertar_registro

PUERTO_UDP = 5000
CAMPOS_REQUERIDOS = {"lat", "lng", "date", "hour"}


def procesar_paquete(datos: bytes, origen: tuple) -> None:
    """Decodifica, valida e inserta un datagrama recibido."""
    try:
        texto = datos.decode("utf-8")
        payload = json.loads(texto)
    except (UnicodeDecodeError, json.JSONDecodeError):
        print(f"[{timestamp()}] Paquete descartado (no es JSON válido) desde {origen}")
        return

    if not CAMPOS_REQUERIDOS.issubset(payload.keys()):
        print(f"[{timestamp()}] Paquete descartado (faltan campos) desde {origen}: {payload}")
        return

    try:
        lat = float(payload["lat"])
        lng = float(payload["lng"])
        fecha = str(payload["date"])
        hora = str(payload["hour"])
    except (ValueError, TypeError):
        print(f"[{timestamp()}] Paquete descartado (tipos inválidos) desde {origen}: {payload}")
        return

    insertar_registro(lat, lng, fecha, hora)
    print(f"[{timestamp()}] Registrado desde {origen}: lat={lat}, lng={lng}, fecha={fecha}, hora={hora}")


def timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def iniciar_listener() -> None:
    init_db()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", PUERTO_UDP))
    print(f"Escuchando UDP en 0.0.0.0:{PUERTO_UDP} ... (Ctrl+C para detener)")

    try:
        while True:
            datos, origen = sock.recvfrom(1024)
            procesar_paquete(datos, origen)
    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
    finally:
        sock.close()


if __name__ == "__main__":
    iniciar_listener()
