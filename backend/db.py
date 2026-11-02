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

from tiempo import ahora_colombia
from validacion import NOMBRES_OBD

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

# Tabla del nodo OBD del Kia (ESP32-S3 + A7608SA). Por defecto se deriva de
# DB_TABLE ("telemetria" -> "telemetria_obd") para que main y dev tampoco se pisen.
DB_TABLE_OBD = os.environ.get("DB_TABLE_OBD", f"{DB_TABLE}_obd")

# Columnas añadidas después de la primera versión de la tabla. init_db() las
# agrega con ALTER TABLE ... IF NOT EXISTS, así que las tablas antiguas se migran
# solas al reiniciar el listener (las filas viejas quedan con NULL en acc/spd/seq).
COLUMNAS_NUEVAS = (
    ("acc", "DOUBLE PRECISION"),  # precisión horizontal en metros (location.accuracy)
    ("spd", "DOUBLE PRECISION"),  # velocidad en m/s (location.speed)
    ("seq", "BIGINT"),            # contador incremental de la app (mide pérdida de UDP)
    ("ts", "TIMESTAMP"),
    ("vid", "TEXT"),          # fecha+hora de la telemetría (hora Colombia), indexada
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
                      seq: int | None = None, ts: datetime | None = None,
                      vid: str | None = None) -> None:
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
                    INSERT INTO {tabla} (recibido_en, lat, lng, fecha, hora, acc, spd, seq, ts, vid)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                ).format(tabla=sql.Identifier(DB_TABLE)),
                (datetime.now(), lat, lng, fecha, hora, acc, spd, seq, ts, vid),
            )
        conexion.commit()
    finally:
        conexion.close()


def obtener_ultimo_registro(vid: str | None = None) -> dict | None:
    """Último registro (de un vehículo si se indica vid), o None si no hay datos."""
    filtro = sql.SQL("WHERE vid = %s ") if vid else sql.SQL("")
    params = (vid,) if vid else ()
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL("SELECT * FROM {tabla} {filtro}ORDER BY id DESC LIMIT 1").format(
                    tabla=sql.Identifier(DB_TABLE), filtro=filtro
                ),
                params,
            )
            fila = cur.fetchone()
        return dict(fila) if fila else None
    finally:
        conexion.close()
def obtener_registros_en_rango(desde, hasta, limite: int = 200_000,
                               vid: str | None = None) -> list[dict]:
    """Registros entre `desde` y `hasta` (columna ts), en orden cronológico.
    Si se indica vid, solo los de ese vehículo."""
    filtro = sql.SQL(" AND vid = %s") if vid else sql.SQL("")
    params = (desde, hasta) + ((vid,) if vid else ()) + (limite,)
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL(
                    "SELECT id, lat, lng, fecha, hora, ts, acc, vid FROM {tabla} "
                    "WHERE ts BETWEEN %s AND %s{filtro} "
                    "ORDER BY ts ASC, id ASC LIMIT %s"
                ).format(tabla=sql.Identifier(DB_TABLE), filtro=filtro),
                params,
            )
            filas = cur.fetchall()
        return [dict(f) for f in filas]
    finally:
        conexion.close()


# ---------------------------------------------------------------------------
# Nodo OBD del Kia
# ---------------------------------------------------------------------------

# Columnas de la tabla OBD en el orden de log_csv.py, más los datos del GNSS.
# Las claves del dict validado se mapean a las columnas donde el nombre cambia.
_COLUMNAS_GNSS = (("lat", "lat"), ("lng", "lng"), ("alt", "alt"), ("gnss_kmh", "gkmh"), ("sats", "sat"))


def init_db_obd() -> None:
    """Crea la tabla DB_TABLE_OBD si no existe. Idempotente.
    UNIQUE (recorrido_id, seq) evita filas repetidas si el ESP32 reenvía un paquete."""
    tabla = sql.Identifier(DB_TABLE_OBD)
    columnas_pid = sql.SQL(",\n").join(
        sql.SQL("{} DOUBLE PRECISION").format(sql.Identifier(nombre)) for nombre in NOMBRES_OBD
    )
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                sql.SQL(
                    """
                    CREATE TABLE IF NOT EXISTS {tabla} (
                        id BIGSERIAL PRIMARY KEY,
                        recibido_en TIMESTAMP NOT NULL,
                        recorrido_id TEXT NOT NULL,
                        seq BIGINT NOT NULL,
                        t_ms BIGINT NOT NULL,
                        ts TIMESTAMP,
                        {columnas_pid},
                        lat DOUBLE PRECISION,
                        lng DOUBLE PRECISION,
                        alt DOUBLE PRECISION,
                        gnss_kmh DOUBLE PRECISION,
                        sats INTEGER,
                        CONSTRAINT {unico} UNIQUE (recorrido_id, seq)
                    )
                    """
                ).format(
                    tabla=tabla,
                    columnas_pid=columnas_pid,
                    unico=sql.Identifier(f"uq_{DB_TABLE_OBD}_rid_seq"),
                )
            )
            cur.execute(
                sql.SQL("CREATE INDEX IF NOT EXISTS {indice} ON {tabla} (recorrido_id, t_ms)").format(
                    indice=sql.Identifier(f"idx_{DB_TABLE_OBD}_rid_tms"),
                    tabla=tabla,
                )
            )
        conexion.commit()
    finally:
        conexion.close()


def insertar_registro_obd(paquete: dict) -> bool:
    """Inserta una fila del nodo OBD (dict de validacion.clasificar_paquete).
    Devuelve False si la fila ya existía (mismo recorrido_id y seq)."""
    columnas = ["recibido_en", "recorrido_id", "seq", "t_ms", "ts", *NOMBRES_OBD,
                *(columna for columna, _ in _COLUMNAS_GNSS)]
    valores = [ahora_colombia(), paquete["rid"], paquete["seq"], paquete["t_ms"], paquete["ts"],
               *(paquete[nombre] for nombre in NOMBRES_OBD),
               *(paquete[clave] for _, clave in _COLUMNAS_GNSS)]
    consulta = sql.SQL(
        "INSERT INTO {tabla} ({columnas}) VALUES ({marcadores}) "
        "ON CONFLICT (recorrido_id, seq) DO NOTHING"
    ).format(
        tabla=sql.Identifier(DB_TABLE_OBD),
        columnas=sql.SQL(", ").join(map(sql.Identifier, columnas)),
        marcadores=sql.SQL(", ").join(sql.Placeholder() * len(columnas)),
    )
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(consulta, valores)
            insertada = cur.rowcount == 1
        conexion.commit()
        return insertada
    finally:
        conexion.close()


def listar_recorridos_obd(limite: int = 500) -> list[dict]:
    """Un resumen por recorrido: filas, filas con GPS, inicio y fin (hora Colombia;
    hora del GNSS si la hay, si no la de llegada al servidor). Más recientes primero."""
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL(
                    "SELECT recorrido_id, COUNT(*) AS filas, COUNT(lat) AS filas_con_gps, "
                    "MIN(COALESCE(ts, recibido_en)) AS inicio, MAX(COALESCE(ts, recibido_en)) AS fin "
                    "FROM {tabla} GROUP BY recorrido_id ORDER BY inicio DESC LIMIT %s"
                ).format(tabla=sql.Identifier(DB_TABLE_OBD)),
                (limite,),
            )
            return [dict(f) for f in cur.fetchall()]
    finally:
        conexion.close()


def obtener_recorrido_obd(recorrido_id: str) -> list[dict]:
    """Todas las filas de un recorrido, en el orden en que se midieron (t_ms)."""
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL("SELECT * FROM {tabla} WHERE recorrido_id = %s ORDER BY t_ms ASC, seq ASC").format(
                    tabla=sql.Identifier(DB_TABLE_OBD)
                ),
                (recorrido_id,),
            )
            return [dict(f) for f in cur.fetchall()]
    finally:
        conexion.close()
