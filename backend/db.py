"""
Módulo de acceso a la base de datos PostgreSQL (AWS RDS).
Las credenciales se leen SIEMPRE de variables de entorno (.env local o
systemd EnvironmentFile), nunca quemadas en el código.
"""

import os

import psycopg2
import psycopg2.extras
from psycopg2 import sql
from dotenv import load_dotenv

load_dotenv()  # busca un archivo .env en el directorio actual, si existe

DB_CONFIG = {
    "host": os.environ["DB_HOST"],
    "port": os.environ.get("DB_PORT", "5432"),
    "dbname": os.environ["DB_NAME"],
    "user": os.environ["DB_USER"],
    "password": os.environ["DB_PASSWORD"],
}

if os.environ.get("DB_SSLMODE"):
    DB_CONFIG["sslmode"] = os.environ["DB_SSLMODE"]
    if os.environ.get("DB_SSLROOTCERT"):
        DB_CONFIG["sslrootcert"] = os.environ["DB_SSLROOTCERT"]

# Nombre de la tabla: permite que main y los entornos dev convivan en la
# misma RDS sin pisarse los datos (cada uno con su propia tabla).
DB_TABLE = os.environ.get("DB_TABLE", "telemetria")


def _conectar():
    """Abre una conexión nueva a RDS. Falla rápido y explícito si faltan
    variables de entorno (KeyError arriba, antes de siquiera intentar conectar)."""
    return psycopg2.connect(**DB_CONFIG)


def init_db() -> None:
    """Crea la tabla (DB_TABLE) si no existe."""
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                sql.SQL(
                    """
                    CREATE TABLE IF NOT EXISTS {tabla} (
                        id SERIAL PRIMARY KEY,
                        recibido_en TIMESTAMP NOT NULL,
                        lat DOUBLE PRECISION NOT NULL,
                        lng DOUBLE PRECISION NOT NULL,
                        fecha TEXT NOT NULL,
                        hora TEXT NOT NULL
                    )
                    """
                ).format(tabla=sql.Identifier(DB_TABLE))
            )
        conexion.commit()
    finally:
        conexion.close()


def insertar_registro(lat: float, lng: float, fecha: str, hora: str) -> None:
    """Inserta un nuevo registro de telemetría."""
    from datetime import datetime

    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                sql.SQL(
                    """
                    INSERT INTO {tabla} (recibido_en, lat, lng, fecha, hora)
                    VALUES (%s, %s, %s, %s, %s)
                    """
                ).format(tabla=sql.Identifier(DB_TABLE)),
                (datetime.now(), lat, lng, fecha, hora),
            )
        conexion.commit()
    finally:
        conexion.close()


def obtener_ultimo_registro() -> dict | None:
    """Devuelve el registro más reciente como diccionario, o None si la tabla está vacía."""
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL("SELECT * FROM {tabla} ORDER BY id DESC LIMIT 1").format(
                    tabla=sql.Identifier(DB_TABLE)
                )
            )
            fila = cur.fetchone()
        return dict(fila) if fila else None
    finally:
        conexion.close()
def obtener_registros_en_rango(desde, hasta) -> list[dict]:
    """Devuelve los registros entre dos timestamps, ordenados cronológicamente."""
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL(
                    "SELECT lat, lng, fecha, hora, recibido_en FROM {tabla} "
                    "WHERE recibido_en BETWEEN %s AND %s "
                    "ORDER BY recibido_en ASC"
                ).format(tabla=sql.Identifier(DB_TABLE)),
                (desde, hasta),
            )
            filas = cur.fetchall()
        return [dict(f) for f in filas]
    finally:
        conexion.close()