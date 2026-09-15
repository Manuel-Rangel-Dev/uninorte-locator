"""
Módulo de acceso a la base de datos PostgreSQL (AWS RDS).
Reemplaza la versión SQLite de Semana 4. Las credenciales se leen
SIEMPRE de variables de entorno (.env local o systemd EnvironmentFile),
nunca quemadas en el código.
"""

import os

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()  # busca un archivo .env en el directorio actual, si existe

DB_CONFIG = {
    "host": os.environ["DB_HOST"],
    "port": os.environ.get("DB_PORT", "5432"),
    "dbname": os.environ["DB_NAME"],
    "user": os.environ["DB_USER"],
    "password": os.environ["DB_PASSWORD"],
}


def _conectar():
    """Abre una conexión nueva a RDS. Falla rápido y explícito si faltan
    variables de entorno (KeyError arriba, antes de siquiera intentar conectar)."""
    return psycopg2.connect(**DB_CONFIG)


def init_db() -> None:
    """Crea la tabla telemetria si no existe. RDS ya trae la base de datos
    'telemetria' creada desde la consola (Initial database name)."""
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS telemetria (
                    id SERIAL PRIMARY KEY,
                    recibido_en TIMESTAMP NOT NULL,
                    lat DOUBLE PRECISION NOT NULL,
                    lng DOUBLE PRECISION NOT NULL,
                    fecha TEXT NOT NULL,
                    hora TEXT NOT NULL
                )
                """
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
                """
                INSERT INTO telemetria (recibido_en, lat, lng, fecha, hora)
                VALUES (%s, %s, %s, %s, %s)
                """,
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
            cur.execute("SELECT * FROM telemetria ORDER BY id DESC LIMIT 1")
            fila = cur.fetchone()
        return dict(fila) if fila else None
    finally:
        conexion.close()
