"""
Listener UDP ("sniffer"): escucha en el puerto configurado, valida el JSON
enviado por la app Android y lo persiste en la base de datos (tabla
configurable vía DB_TABLE, ver db.py). Los paquetes del nodo OBD del Kia
("tipo": "obd") van a su propia tabla (DB_TABLE_OBD).

El puerto está abierto a todo internet, por eso TODO paquete pasa primero por
validacion.clasificar_paquete(); lo que no cumple el formato se descarta.
"""

import os
import socket
import threading
import time
import traceback
from collections import deque
from datetime import datetime

from db import (actualizar_recorrido, constante_k_vehiculo, init_db, init_db_obd, init_db_p3,
                insertar_registro, insertar_registro_obd, recorridos_pendientes)
from recorridos import VID_KIA, fuel_lph_ecuacion
from validacion import PaqueteInvalido, clasificar_paquete

# Configurable para poder correr un listener de dev en la misma EC2 que el
# de main sin pisarse el puerto UDP.
PUERTO_UDP = int(os.environ.get("LISTENER_UDP_PORT", "5000"))
# Vehículo que se asume cuando el paquete no trae vid (versiones viejas de la app).
VID_POR_DEFECTO = os.environ.get("VID_POR_DEFECTO", "celular")

# Token compartido con el firmware del nodo OBD. Si está definido, los paquetes
# OBD sin ese token se descartan (el puerto está abierto a todo internet).
TOKEN_OBD = os.environ.get("OBD_TOKEN") or None

# El paquete OBD (15 PIDs + GNSS) pesa hasta unos 470 bytes; 2048 deja margen.
TAMANO_MAX_DATAGRAMA = 2048

# Cada cuánto se actualizan los totales de los recorridos y se cierran los inactivos.
INTERVALO_RECORRIDOS_S = 60

# K de la ecuación de consumo del Kia. Se lee de la tabla vehiculos una vez al arrancar.
_k_kia = None

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
        tipo, paquete = clasificar_paquete(datos, TOKEN_OBD)
    except PaqueteInvalido as motivo:
        print(f"[{timestamp()}] Paquete descartado ({motivo}) desde {origen}")
        return

    if tipo == "obd":
        procesar_obd(paquete, origen)
        return

    vid = paquete["vid"] or VID_POR_DEFECTO
    clave = (paquete["lat"], paquete["lng"], paquete["fecha"], paquete["hora"], vid)
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
            vid=vid,
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
        f"vid={vid}"
    )


def procesar_obd(paquete: dict, origen: tuple) -> None:
    """Inserta una fila del nodo OBD. Los duplicados (mismo recorrido y seq) los
    descarta la base de datos con ON CONFLICT DO NOTHING."""
    paquete["fuel_lph_ecuacion"] = fuel_lph_ecuacion(
        paquete["carga_abs"], paquete["rpm"], paquete["lambda"], _k_kia
    )
    try:
        insertada = insertar_registro_obd(paquete)
    except Exception as error:
        print(f"[{timestamp()}] ERROR al insertar OBD en la base de datos: {error}")
        return
    if insertada:
        gps = f"lat={paquete['lat']}, lng={paquete['lng']}" if paquete["lat"] is not None else "sin GPS"
        print(
            f"[{timestamp()}] OBD desde {origen}: rid={paquete['rid']}, seq={paquete['seq']}, "
            f"rpm={paquete['rpm']}, vel={paquete['vel']}, fuel_lph={paquete['fuel_lph']}, {gps}"
        )


def actualizar_recorridos_pendientes() -> None:
    """Actualiza los totales de los recorridos con datos nuevos y cierra los inactivos.
    Un recorrido que falle no impide actualizar los demás."""
    for pendiente in recorridos_pendientes():
        try:
            actualizar_recorrido(pendiente["recorrido_id"], cerrar=pendiente["cerrar"])
        except Exception:
            print(f"[{timestamp()}] ERROR al actualizar el recorrido {pendiente['recorrido_id']}")
            traceback.print_exc()


def ciclo_recorridos() -> None:
    """Corre en un hilo daemon. Un error se registra y no tumba el listener."""
    while True:
        time.sleep(INTERVALO_RECORRIDOS_S)
        try:
            actualizar_recorridos_pendientes()
        except Exception:
            print(f"[{timestamp()}] ERROR en el ciclo de recorridos")
            traceback.print_exc()


def iniciar_listener() -> None:
    global _k_kia

    init_db()
    init_db_obd()
    init_db_p3()
    _k_kia = constante_k_vehiculo(VID_KIA)

    threading.Thread(target=ciclo_recorridos, name="recorridos", daemon=True).start()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", PUERTO_UDP))
    print(f"Escuchando UDP en 0.0.0.0:{PUERTO_UDP} ... (Ctrl+C para detener)")

    try:
        while True:
            datos, origen = sock.recvfrom(TAMANO_MAX_DATAGRAMA)
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
