"""
Módulo de acceso a la base de datos PostgreSQL (AWS RDS).
Las credenciales se leen SIEMPRE de variables de entorno (.env local o
systemd EnvironmentFile), nunca quemadas en el código.
"""

import os
from datetime import datetime

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

# Columnas añadidas después de la primera versión de la tabla. init_db() las
# agrega con ALTER TABLE ... IF NOT EXISTS, así que las tablas antiguas se migran
# solas al reiniciar el listener (las filas viejas quedan con NULL en acc/spd/seq).
COLUMNAS_NUEVAS = (
    ("acc", "DOUBLE PRECISION"),  # precisión horizontal en metros (location.accuracy)
    ("spd", "DOUBLE PRECISION"),  # velocidad en m/s (location.speed)
    ("seq", "BIGINT"),            # contador incremental de la app (mide pérdida de UDP)
    ("ts", "TIMESTAMP"),          # fecha+hora de la telemetría (hora Colombia), indexada
)


def _conectar():
    """Abre una conexión nueva a RDS. Falla rápido y explícito si faltan
    variables de entorno (KeyError arriba, antes de siquiera intentar conectar)."""
    return psycopg2.connect(**DB_CONFIG)


def _rellenar_ts(conexion) -> None:
    """Calcula ts para las filas que aún no lo tienen, parseando fecha y hora en
    Python. Las filas con fecha/hora inválidas se omiten (quedan con ts NULL y
    el histórico las ignora) en vez de hacer fallar todo el UPDATE."""
    tabla = sql.Identifier(DB_TABLE)
    with conexion.cursor() as cur:
        cur.execute(sql.SQL("SELECT id, fecha, hora FROM {tabla} WHERE ts IS NULL").format(tabla=tabla))
        pendientes = cur.fetchall()
    if not pendientes:
        return

    validas = []
    invalidas = 0
    for id_fila, fecha, hora in pendientes:
        try:
            ts = datetime.strptime(f"{fecha} {hora}", "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            invalidas += 1
            continue
        validas.append((ts, id_fila))

    if validas:
        consulta = sql.SQL("UPDATE {tabla} SET ts = %s WHERE id = %s").format(tabla=tabla).as_string(conexion)
        with conexion.cursor() as cur:
            psycopg2.extras.execute_batch(cur, consulta, validas, page_size=500)
        conexion.commit()
    print(f"[db] ts rellenado en {len(validas)} fila(s); {invalidas} con fecha/hora inválida (omitidas)")


def init_db() -> None:
    """Crea la tabla (DB_TABLE) si no existe, agrega las columnas nuevas si
    faltan, crea el índice sobre ts y rellena ts en las filas antiguas.
    Es idempotente: se puede ejecutar cuantas veces haga falta."""
    tabla = sql.Identifier(DB_TABLE)
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
                ).format(tabla=tabla)
            )
            for columna, tipo in COLUMNAS_NUEVAS:
                cur.execute(
                    sql.SQL("ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS {columna} {tipo}").format(
                        tabla=tabla,
                        columna=sql.Identifier(columna),
                        tipo=sql.SQL(tipo),
                    )
                )
            cur.execute(
                sql.SQL("CREATE INDEX IF NOT EXISTS {indice} ON {tabla} (ts)").format(
                    indice=sql.Identifier(f"idx_{DB_TABLE}_ts"),
                    tabla=tabla,
                )
            )
        conexion.commit()
        _rellenar_ts(conexion)
    finally:
        conexion.close()


def insertar_registro(lat: float, lng: float, fecha: str, hora: str,
                      acc: float | None = None, spd: float | None = None,
                      seq: int | None = None, ts: datetime | None = None) -> None:
    """Inserta un nuevo registro de telemetría.
    ts (hora Colombia) se calcula a partir de fecha y hora si no se entrega."""
    if ts is None:
        ts = datetime.strptime(f"{fecha} {hora}", "%Y-%m-%d %H:%M:%S")

    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                sql.SQL(
                    """
                    INSERT INTO {tabla} (recibido_en, lat, lng, fecha, hora, acc, spd, seq, ts)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                ).format(tabla=sql.Identifier(DB_TABLE)),
                (datetime.now(), lat, lng, fecha, hora, acc, spd, seq, ts),
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
    """Devuelve los registros entre dos timestamps según la fecha y hora de la
    telemetría (enviada por la app en hora colombiana), ordenados cronológicamente."""
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL(
                    "SELECT lat, lng, fecha, hora, recibido_en FROM {tabla} "
                    "WHERE (fecha || ' ' || hora)::timestamp BETWEEN %s AND %s "
                    "ORDER BY (fecha || ' ' || hora)::timestamp ASC, id ASC"
                ).format(tabla=sql.Identifier(DB_TABLE)),
                (desde, hasta),
            )
            filas = cur.fetchall()
        return [dict(f) for f in filas]
    finally:
        conexion.close()