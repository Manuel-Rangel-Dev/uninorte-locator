"""
Listener UDP ("sniffer"): escucha en el puerto configurado, valida el JSON
enviado por la app Android y lo persiste en la base de datos (tabla
configurable vía DB_TABLE, ver db.py).

El puerto está abierto a todo internet, por eso TODO paquete pasa primero por
validacion.parsear_paquete(); lo que no cumple el formato se descarta.
"""

import os
import socket
import traceback
from collections import deque
from datetime import datetime

from db import init_db, insertar_registro
from validacion import PaqueteInvalido, parsear_paquete

# Configurable para poder correr un listener de dev en la misma EC2 que el
# de main sin pisarse el puerto UDP.
PUERTO_UDP = int(os.environ.get("LISTENER_UDP_PORT", "5000"))

# Claves (lat, lng, fecha, hora) de los últimos paquetes guardados. La app puede
# reenviar el mismo fix; así no se insertan duplicados. Se usa una ventana en
# vez de solo "el último" por si dos celulares envían al mismo listener.
_recientes = deque(maxlen=50)


def timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def procesar_paquete(datos: bytes, origen: tuple) -> None:
    """Valida, deduplica e inserta un datagrama recibido. Nunca lanza excepciones
    hacia el bucle principal."""
    try:
        paquete = parsear_paquete(datos)
    except PaqueteInvalido as motivo:
        print(f"[{timestamp()}] Paquete descartado ({motivo}) desde {origen}")
        return

    clave = (paquete["lat"], paquete["lng"], paquete["fecha"], paquete["hora"])
    if clave in _recientes:
        return  # fix repetido: no se guarda dos veces

    try:
        insertar_registro(
            paquete["lat"],
            paquete["lng"],
            paquete["fecha"],
            paquete["hora"],
            acc=paquete["acc"],
            spd=paquete["spd"],
            seq=paquete["seq"],
            ts=paquete["ts"],
        )
    except Exception as error:
        # Corte de RDS, credenciales, etc.: se registra y el listener sigue vivo.
        print(f"[{timestamp()}] ERROR al insertar en la base de datos: {error}")
        return

    _recientes.append(clave)
    print(
        f"[{timestamp()}] Registrado desde {origen}: lat={paquete['lat']}, lng={paquete['lng']}, "
        f"fecha={paquete['fecha']}, hora={paquete['hora']}, acc={paquete['acc']}, "
        f"spd={paquete['spd']}, seq={paquete['seq']}"
    )


def iniciar_listener() -> None:
    init_db()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", PUERTO_UDP))
    print(f"Escuchando UDP en 0.0.0.0:{PUERTO_UDP} ... (Ctrl+C para detener)")

    try:
        while True:
            datos, origen = sock.recvfrom(1024)
            try:
                procesar_paquete(datos, origen)
            except Exception:
                # Última red de seguridad: ningún paquete debe tumbar el proceso.
                traceback.print_exc()
    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
    finally:
        sock.close()


if __name__ == "__main__":
    iniciar_listener()
