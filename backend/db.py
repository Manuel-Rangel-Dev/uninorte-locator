"""
Módulo de acceso a la base de datos PostgreSQL (AWS RDS).
Las credenciales se leen SIEMPRE de variables de entorno (.env local o
systemd EnvironmentFile), nunca quemadas en el código.
"""

import os
from datetime import datetime, timedelta

import psycopg2
import psycopg2.extras
from psycopg2 import sql
from dotenv import load_dotenv

from recorridos import (AFR_GASOLINA, CILINDRADA_KIA_L, DENSIDAD_AIRE_G_L, DENSIDAD_COMBUSTIBLE_G_L,
                        MINUTOS_CIERRE, NOMBRE_CARRO_2, NOMBRE_KIA, PRECIO_INICIAL_COP_GALON,
                        PRECIO_INICIAL_FUENTE, VID_CARRO_2, VID_KIA, constante_k, costo_en_pesos,
                        fuel_lph_ecuacion, resumir, velocidad_media_kmh)
import modelo_ruta
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

# Tabla del nodo OBD del Kia (ESP32-S3 + A7608SA). A diferencia de DB_TABLE, es una
# sola tabla compartida por main y dev; no se deriva de DB_TABLE a propósito.
DB_TABLE_OBD = os.environ.get("DB_TABLE_OBD", "telemetria_obd")

# Tablas del Proyecto 3. Igual que la OBD, son compartidas por main y dev.
DB_TABLE_VEHICULOS = os.environ.get("DB_TABLE_VEHICULOS", "vehiculos")
DB_TABLE_PRECIOS = os.environ.get("DB_TABLE_PRECIOS", "precios_combustible")
DB_TABLE_RECORRIDOS = os.environ.get("DB_TABLE_RECORRIDOS", "recorridos")
DB_TABLE_PREDICCIONES = os.environ.get("DB_TABLE_PREDICCIONES", "predicciones")
DB_TABLE_PREDICCIONES_RUTAS = os.environ.get("DB_TABLE_PREDICCIONES_RUTAS", "predicciones_rutas")

VISTA_FACTOR_CORRECCION = "v_factor_correccion"
# Factor por modelo calculado con los litros sin factor. Es una vista aparte para no
# cambiar v_factor_correccion, que main vuelve a crear con su definición al reiniciar.
VISTA_FACTOR_MODELO = "v_factor_modelo"

# Columnas del modelo de ruta (P3-S3) en la tabla recorridos. litros_modelo es
# litros_modelo_sin_factor · factor_modelo. modelo_calculado_en permite saber si el
# modelo está al día: el listener de main actualiza la tabla sin calcular el modelo.
COLUMNAS_MODELO_RECORRIDOS = (
    ("litros_modelo_sin_factor", "DOUBLE PRECISION"),
    ("factor_modelo", "DOUBLE PRECISION"),
    ("subida_m_km", "DOUBLE PRECISION"),
    ("bajada_m_km", "DOUBLE PRECISION"),
    ("modelo_calculado_en", "TIMESTAMP"),
)

# Serializa init_db_p3 entre listeners: con varias EC2 reiniciando a la vez sobre la
# misma RDS, CREATE OR REPLACE VIEW puede fallar con "tuple concurrently updated".
LLAVE_INIT_P3 = 202603001

# Fecha desde la que rige el precio inicial del combustible.
PRECIO_INICIAL_DESDE = datetime(2026, 11, 1)

# Filas por lote al rellenar fuel_lph_ecuacion.
TAMANO_LOTE_RELLENO = 2000

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
                *(columna for columna, _ in _COLUMNAS_GNSS), "fuel_lph_ecuacion"]
    valores = [ahora_colombia(), paquete["rid"], paquete["seq"], paquete["t_ms"], paquete["ts"],
               *(paquete[nombre] for nombre in NOMBRES_OBD),
               *(paquete[clave] for _, clave in _COLUMNAS_GNSS),
               paquete.get("fuel_lph_ecuacion")]
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


# ---------------------------------------------------------------------------
# Proyecto 3: vehículos, precios, recorridos y predicciones
# ---------------------------------------------------------------------------

def _crear_tablas_p3(cur) -> None:
    """Crea las tablas nuevas en el orden que piden las llaves foráneas."""
    nombres = {
        "vehiculos": sql.Identifier(DB_TABLE_VEHICULOS),
        "precios": sql.Identifier(DB_TABLE_PRECIOS),
        "predicciones": sql.Identifier(DB_TABLE_PREDICCIONES),
        "rutas": sql.Identifier(DB_TABLE_PREDICCIONES_RUTAS),
        "recorridos": sql.Identifier(DB_TABLE_RECORRIDOS),
        "vid_kia": sql.Literal(VID_KIA),
    }

    cur.execute(sql.SQL(
        """
        CREATE TABLE IF NOT EXISTS {vehiculos} (
            vid TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            cilindrada_l DOUBLE PRECISION,
            tiene_obd BOOLEAN NOT NULL DEFAULT FALSE,
            afr DOUBLE PRECISION,
            densidad_comb_g_l DOUBLE PRECISION,
            densidad_aire_g_l DOUBLE PRECISION,
            creado_en TIMESTAMP NOT NULL
        )
        """
    ).format(**nombres))

    cur.execute(sql.SQL(
        """
        CREATE TABLE IF NOT EXISTS {precios} (
            id SERIAL PRIMARY KEY,
            vigente_desde TIMESTAMP NOT NULL UNIQUE,
            cop_por_galon DOUBLE PRECISION NOT NULL CHECK (cop_por_galon > 0),
            fuente TEXT
        )
        """
    ).format(**nombres))

    cur.execute(sql.SQL(
        """
        CREATE TABLE IF NOT EXISTS {predicciones} (
            id BIGSERIAL PRIMARY KEY,
            solicitado_en TIMESTAMP NOT NULL,
            vid TEXT NOT NULL DEFAULT {vid_kia} REFERENCES {vehiculos}(vid),
            origen_lat DOUBLE PRECISION NOT NULL,
            origen_lng DOUBLE PRECISION NOT NULL,
            destino_lat DOUBLE PRECISION NOT NULL,
            destino_lng DOUBLE PRECISION NOT NULL,
            destino_texto TEXT,
            precio_id INTEGER REFERENCES {precios}(id),
            ruta_elegida_id BIGINT
        )
        """
    ).format(**nombres))
    cur.execute(sql.SQL(
        "CREATE INDEX IF NOT EXISTS {indice} ON {predicciones} (vid, solicitado_en DESC)"
    ).format(indice=sql.Identifier(f"idx_{DB_TABLE_PREDICCIONES}_vid_solicitado"), **nombres))

    cur.execute(sql.SQL(
        """
        CREATE TABLE IF NOT EXISTS {rutas} (
            id BIGSERIAL PRIMARY KEY,
            prediccion_id BIGINT NOT NULL REFERENCES {predicciones}(id) ON DELETE CASCADE,
            opcion SMALLINT NOT NULL,
            tipo_ruta TEXT,
            distancia_km DOUBLE PRECISION,
            tiempo_s DOUBLE PRECISION,
            tiempo_sin_trafico_s DOUBLE PRECISION,
            tiempo_historico_s DOUBLE PRECISION,
            retraso_trafico_s DOUBLE PRECISION,
            vel_media_kmh DOUBLE PRECISION,
            litros_modelo DOUBLE PRECISION,
            costo_cop DOUBLE PRECISION,
            modelo TEXT,
            geometria JSONB,
            UNIQUE (prediccion_id, opcion)
        )
        """
    ).format(**nombres))

    # ADD CONSTRAINT no admite IF NOT EXISTS: se revisa primero para ser idempotente.
    restriccion = f"fk_{DB_TABLE_PREDICCIONES}_ruta_elegida"
    cur.execute(
        "SELECT 1 FROM pg_constraint WHERE conname = %s AND conrelid = %s::regclass",
        (restriccion, sql.Identifier(DB_TABLE_PREDICCIONES).as_string(cur)),
    )
    if cur.fetchone() is None:
        cur.execute(sql.SQL(
            """
            ALTER TABLE {predicciones} ADD CONSTRAINT {restriccion}
            FOREIGN KEY (ruta_elegida_id) REFERENCES {rutas}(id) ON DELETE SET NULL
            """
        ).format(restriccion=sql.Identifier(restriccion), **nombres))

    cur.execute(sql.SQL(
        """
        CREATE TABLE IF NOT EXISTS {recorridos} (
            id BIGSERIAL PRIMARY KEY,
            vid TEXT NOT NULL REFERENCES {vehiculos}(vid),
            recorrido_id TEXT UNIQUE,
            inicio TIMESTAMP,
            fin TIMESTAMP,
            filas INTEGER,
            filas_con_gps INTEGER,
            duracion_s DOUBLE PRECISION,
            segundos_sin_datos DOUBLE PRECISION,
            distancia_km DOUBLE PRECISION,
            vel_media_kmh DOUBLE PRECISION,
            litros_pid DOUBLE PRECISION,
            litros_ecuacion DOUBLE PRECISION,
            litros_modelo DOUBLE PRECISION,
            modelo TEXT,
            precio_id INTEGER REFERENCES {precios}(id),
            costo_cop DOUBLE PRECISION,
            costo_modelo_cop DOUBLE PRECISION,
            prediccion_ruta_id BIGINT REFERENCES {rutas}(id),
            cerrado BOOLEAN NOT NULL DEFAULT FALSE,
            actualizado_en TIMESTAMP NOT NULL
        )
        """
    ).format(**nombres))
    cur.execute(sql.SQL(
        "CREATE INDEX IF NOT EXISTS {indice} ON {recorridos} (vid, inicio DESC)"
    ).format(indice=sql.Identifier(f"idx_{DB_TABLE_RECORRIDOS}_vid_inicio"), **nombres))


def _sembrar_datos_p3(cur) -> None:
    """Datos iniciales. ON CONFLICT DO NOTHING: no pisa lo que se cambie a mano."""
    cur.execute(
        sql.SQL(
            """
            INSERT INTO {tabla} (vid, nombre, cilindrada_l, tiene_obd, afr,
                                 densidad_comb_g_l, densidad_aire_g_l, creado_en)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s), (%s, %s, NULL, FALSE, NULL, NULL, NULL, %s)
            ON CONFLICT (vid) DO NOTHING
            """
        ).format(tabla=sql.Identifier(DB_TABLE_VEHICULOS)),
        (VID_KIA, NOMBRE_KIA, CILINDRADA_KIA_L, True, AFR_GASOLINA, DENSIDAD_COMBUSTIBLE_G_L,
         DENSIDAD_AIRE_G_L, ahora_colombia(), VID_CARRO_2, NOMBRE_CARRO_2, ahora_colombia()),
    )
    cur.execute(
        sql.SQL(
            "INSERT INTO {tabla} (vigente_desde, cop_por_galon, fuente) VALUES (%s, %s, %s) "
            "ON CONFLICT (vigente_desde) DO NOTHING"
        ).format(tabla=sql.Identifier(DB_TABLE_PRECIOS)),
        (PRECIO_INICIAL_DESDE, PRECIO_INICIAL_COP_GALON, PRECIO_INICIAL_FUENTE),
    )


def _ampliar_tabla_obd(cur) -> None:
    """fuel_lph_ecuacion en la tabla OBD. fuel_lph (PID 0x5E) sigue aparte: es la
    referencia para validar la ecuación. La tabla no lleva vid: solo el Kia tiene nodo."""
    cur.execute(sql.SQL("ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS fuel_lph_ecuacion DOUBLE PRECISION").format(
        tabla=sql.Identifier(DB_TABLE_OBD)
    ))


def _crear_vista_factor(cur) -> None:
    """Factor para ajustar el modelo con el Kia. error_medio_pct conserva el signo:
    positivo significa que el modelo sobreestima el consumo real (PID)."""
    cur.execute(sql.SQL(
        """
        CREATE OR REPLACE VIEW {vista} AS
        SELECT vid,
               COUNT(*) AS recorridos,
               SUM(litros_pid) / NULLIF(SUM(litros_modelo), 0) AS factor,
               AVG((litros_modelo - litros_pid) / NULLIF(litros_pid, 0)) * 100 AS error_medio_pct
        FROM {recorridos}
        WHERE cerrado AND litros_pid IS NOT NULL AND litros_modelo IS NOT NULL
        GROUP BY vid
        """
    ).format(vista=sql.Identifier(VISTA_FACTOR_CORRECCION),
             recorridos=sql.Identifier(DB_TABLE_RECORRIDOS)))


def _ampliar_tabla_recorridos(cur) -> None:
    """Columnas del modelo de ruta en recorridos (P3-S3)."""
    for columna, tipo in COLUMNAS_MODELO_RECORRIDOS:
        cur.execute(sql.SQL("ALTER TABLE {tabla} ADD COLUMN IF NOT EXISTS {columna} {tipo}").format(
            tabla=sql.Identifier(DB_TABLE_RECORRIDOS), columna=sql.Identifier(columna),
            tipo=sql.SQL(tipo),
        ))


def _crear_vista_factor_modelo(cur) -> None:
    """Factor y error por modelo, con los litros sin factor (el factor no se corrige
    sobre sí mismo). error_sin_factor_pct y error_con_factor_pct conservan el signo:
    positivo significa que el modelo sobreestima el consumo real (PID)."""
    cur.execute(sql.SQL(
        """
        CREATE OR REPLACE VIEW {vista} AS
        SELECT vid,
               modelo,
               COUNT(*) AS recorridos,
               SUM(litros_pid) / NULLIF(SUM(litros_modelo_sin_factor), 0) AS factor,
               AVG((litros_modelo_sin_factor - litros_pid) / NULLIF(litros_pid, 0)) * 100
                   AS error_sin_factor_pct,
               AVG((litros_modelo - litros_pid) / NULLIF(litros_pid, 0)) * 100 AS error_con_factor_pct
        FROM {recorridos}
        WHERE cerrado AND litros_pid IS NOT NULL AND litros_modelo_sin_factor IS NOT NULL
        GROUP BY vid, modelo
        """
    ).format(vista=sql.Identifier(VISTA_FACTOR_MODELO),
             recorridos=sql.Identifier(DB_TABLE_RECORRIDOS)))


def init_db_p3() -> None:
    """Crea las tablas del Proyecto 3, sus datos iniciales, las columnas nuevas de la
    tabla OBD y la vista. Idempotente. Debe correr después de init_db_obd()."""
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (LLAVE_INIT_P3,))
            _crear_tablas_p3(cur)
            _sembrar_datos_p3(cur)
            _ampliar_tabla_obd(cur)
            _ampliar_tabla_recorridos(cur)
            _crear_vista_factor(cur)
            _crear_vista_factor_modelo(cur)
        conexion.commit()
    finally:
        conexion.close()


def constante_k_vehiculo(vid: str) -> float | None:
    """K de la ecuación de consumo con los datos de la tabla vehiculos.
    None si el vehículo no existe o le falta algún dato."""
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                sql.SQL(
                    "SELECT cilindrada_l, afr, densidad_comb_g_l, densidad_aire_g_l "
                    "FROM {tabla} WHERE vid = %s"
                ).format(tabla=sql.Identifier(DB_TABLE_VEHICULOS)),
                (vid,),
            )
            fila = cur.fetchone()
        return constante_k(*fila) if fila else None
    finally:
        conexion.close()


def rellenar_fuel_lph_ecuacion() -> int:
    """Calcula fuel_lph_ecuacion en las filas OBD que lo tienen en NULL.
    Devuelve cuántas llenó. Avanza por id porque las filas sin lambda o sin rpm siguen
    en NULL después de procesarlas: repetir la misma consulta no terminaría nunca."""
    k = constante_k_vehiculo(VID_KIA)
    if k is None:
        return 0

    tabla = sql.Identifier(DB_TABLE_OBD)
    consulta_lote = sql.SQL(
        'SELECT id, carga_abs, rpm, "lambda" FROM {tabla} '
        "WHERE fuel_lph_ecuacion IS NULL AND id > %s ORDER BY id LIMIT %s"
    ).format(tabla=tabla)
    conexion = _conectar()
    try:
        consulta_update = sql.SQL(
            "UPDATE {tabla} SET fuel_lph_ecuacion = %s WHERE id = %s AND fuel_lph_ecuacion IS NULL"
        ).format(tabla=tabla).as_string(conexion)
        total = 0
        ultimo_id = 0
        while True:
            with conexion.cursor() as cur:
                cur.execute(consulta_lote, (ultimo_id, TAMANO_LOTE_RELLENO))
                lote = cur.fetchall()
                if not lote:
                    return total
                ultimo_id = lote[-1][0]
                valores = []
                for id_fila, carga_abs, rpm, lambda_ in lote:
                    consumo = fuel_lph_ecuacion(carga_abs, rpm, lambda_, k)
                    if consumo is not None:
                        valores.append((consumo, id_fila))
                psycopg2.extras.execute_batch(cur, consulta_update, valores, page_size=500)
            conexion.commit()
            total += len(valores)
    finally:
        conexion.close()


def _precio_vigente(cur, instante: datetime) -> tuple | None:
    """(id, cop_por_galon) del precio vigente en ese instante, o None si no hay."""
    cur.execute(
        sql.SQL(
            "SELECT id, cop_por_galon FROM {tabla} WHERE vigente_desde <= %s "
            "ORDER BY vigente_desde DESC LIMIT 1"
        ).format(tabla=sql.Identifier(DB_TABLE_PRECIOS)),
        (instante,),
    )
    return cur.fetchone()


def _factor_previo(cur, modelo: str, inicio: datetime) -> float | None:
    """Factor del Kia para un recorrido que empieza en inicio: SUM(litros_pid) /
    SUM(litros_modelo_sin_factor) de los recorridos cerrados anteriores del mismo
    modelo, igual que el MAPE con factor de route_model.py. Así el factor se recalcula
    solo con cada recorrido nuevo. Con menos de min_recorridos_factor devuelve None
    (modelo_ruta.estimar usa entonces el factor del PC)."""
    cur.execute(
        sql.SQL(
            "SELECT COUNT(*), SUM(litros_pid), SUM(litros_modelo_sin_factor) FROM {tabla} "
            "WHERE vid = %s AND modelo = %s AND cerrado AND inicio < %s "
            "AND litros_pid IS NOT NULL AND litros_modelo_sin_factor > 0"
        ).format(tabla=sql.Identifier(DB_TABLE_RECORRIDOS)),
        (VID_KIA, modelo, inicio),
    )
    cantidad, litros_pid, litros_modelo = cur.fetchone()
    if cantidad < modelo_ruta.min_recorridos_factor() or not litros_modelo:
        return None
    return litros_pid / litros_modelo


def _columnas_modelo(cur, filas: list[dict], resumen: dict, cop_por_galon) -> dict:
    """Columnas del modelo de ruta de un recorrido. Con traza GNSS usa el modelo con
    pendiente y su factor; sin ella, el de respaldo (sin factor). Todo en None si el
    recorrido es muy corto para el modelo."""
    distancia_km, duracion_s = resumen["distancia_km"], resumen["duracion_s"]
    pendiente = modelo_ruta.pendiente_por_km(modelo_ruta.traza_obd(filas), distancia_km)
    estimado = modelo_ruta.estimar(distancia_km, duracion_s, pendiente)
    if estimado is not None and estimado["usa_factor"]:
        factor = _factor_previo(cur, estimado["modelo"], resumen["inicio"])
        if factor is not None:
            estimado = modelo_ruta.estimar(distancia_km, duracion_s, pendiente, factor=factor)
    if estimado is None:
        return {"litros_modelo": None, "litros_modelo_sin_factor": None, "factor_modelo": None,
                "modelo": None, "costo_modelo_cop": None, "subida_m_km": None, "bajada_m_km": None}
    return {
        "litros_modelo": estimado["litros"],
        "litros_modelo_sin_factor": estimado["litros_sin_factor"],
        "factor_modelo": estimado["factor"],
        "modelo": estimado["modelo"],
        "costo_modelo_cop": costo_en_pesos(estimado["litros"], cop_por_galon),
        "subida_m_km": estimado["subida_m_km"],
        "bajada_m_km": estimado["bajada_m_km"],
    }


def actualizar_recorrido(recorrido_id: str, cerrar: bool = False) -> dict | None:
    """Recalcula el resumen de un recorrido y lo guarda. Devuelve el resumen, o None
    si el recorrido no tiene filas. Si llegan datos nuevos a uno cerrado, se reabre
    y el hilo del listener lo vuelve a cerrar cuando pasen los minutos de cierre.
    Si el modelo de ruta está disponible, también llena las columnas del modelo
    (COLUMNAS_MODELO_RECORRIDOS, litros_modelo, modelo, costo_modelo_cop). Sin
    modelo no las toca. prediccion_ruta_id nunca se toca."""
    # Se toma antes de leer: una fila que llegue durante la lectura queda más nueva
    # que actualizado_en, y el recorrido sigue pendiente en el siguiente ciclo.
    actualizado_en = ahora_colombia()
    filas = obtener_recorrido_obd(recorrido_id)
    if not filas:
        return None
    resumen = resumir(filas)

    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            precio = _precio_vigente(cur, resumen["inicio"])
            precio_id, cop_por_galon = precio if precio else (None, None)
            litros = resumen["litros_pid"]
            if litros is None:
                litros = resumen["litros_ecuacion"]
            resumen.update(
                precio_id=precio_id,
                costo_cop=costo_en_pesos(litros, cop_por_galon),
                cerrado=cerrar,
                actualizado_en=actualizado_en,
            )
            if modelo_ruta.cargar_modelo() is not None:
                resumen.update(_columnas_modelo(cur, filas, resumen, cop_por_galon),
                               modelo_calculado_en=actualizado_en)

            columnas = list(resumen)
            cur.execute(
                sql.SQL(
                    "INSERT INTO {tabla} ({columnas}) VALUES ({marcadores}) "
                    "ON CONFLICT (recorrido_id) DO UPDATE SET {cambios}"
                ).format(
                    tabla=sql.Identifier(DB_TABLE_RECORRIDOS),
                    columnas=sql.SQL(", ").join(map(sql.Identifier, columnas)),
                    marcadores=sql.SQL(", ").join(sql.Placeholder() * len(columnas)),
                    cambios=sql.SQL(", ").join(
                        sql.SQL("{columna} = EXCLUDED.{columna}").format(columna=sql.Identifier(c))
                        for c in columnas if c != "recorrido_id"
                    ),
                ),
                [resumen[c] for c in columnas],
            )
        conexion.commit()
        return resumen
    finally:
        conexion.close()


def recorridos_pendientes(minutos_cierre: int = MINUTOS_CIERRE, todos: bool = False) -> list[dict]:
    """Recorridos de la tabla OBD que hay que actualizar: {"recorrido_id", "cerrar"}.
    Son los que no están en recorridos, los que tienen filas más nuevas que su
    actualizado_en y los que siguen abiertos pero ya no reciben datos. Sin esta última
    condición, un recorrido actualizado después de su última fila nunca se cerraría.
    Si el modelo de ruta está disponible, también los que tienen el modelo sin
    calcular o desactualizado (el listener de main los actualiza sin el modelo).
    Con todos=True devuelve todos los recorridos de la tabla OBD."""
    limite_inactivo = ahora_colombia() - timedelta(minutes=minutos_cierre)
    con_modelo = modelo_ruta.cargar_modelo() is not None
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL(
                    """
                    SELECT o.recorrido_id, o.ultimo < %(limite)s AS cerrar
                    FROM (
                        SELECT recorrido_id, MAX(recibido_en) AS ultimo
                        FROM {obd} GROUP BY recorrido_id
                    ) AS o
                    LEFT JOIN {recorridos} AS r ON r.recorrido_id = o.recorrido_id
                    WHERE %(todos)s
                       OR r.id IS NULL
                       OR o.ultimo > r.actualizado_en
                       OR (NOT r.cerrado AND o.ultimo < %(limite)s)
                       OR (%(con_modelo)s AND (r.modelo_calculado_en IS NULL
                                               OR r.modelo_calculado_en < r.actualizado_en))
                    ORDER BY o.ultimo
                    """
                ).format(obd=sql.Identifier(DB_TABLE_OBD),
                         recorridos=sql.Identifier(DB_TABLE_RECORRIDOS)),
                {"limite": limite_inactivo, "todos": todos, "con_modelo": con_modelo},
            )
            return [dict(f) for f in cur.fetchall()]
    finally:
        conexion.close()


def listar_recorridos(vid: str | None = None, desde: datetime | None = None,
                      hasta: datetime | None = None, limite: int = 500) -> list[dict]:
    """Filas de la tabla recorridos, más recientes primero. desde y hasta filtran por inicio."""
    condiciones = []
    params = []
    if vid:
        condiciones.append(sql.SQL("vid = %s"))
        params.append(vid)
    if desde:
        condiciones.append(sql.SQL("inicio >= %s"))
        params.append(desde)
    if hasta:
        condiciones.append(sql.SQL("inicio <= %s"))
        params.append(hasta)
    filtro = sql.SQL("WHERE {} ").format(sql.SQL(" AND ").join(condiciones)) if condiciones else sql.SQL("")

    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL("SELECT * FROM {tabla} {filtro}ORDER BY inicio DESC LIMIT %s").format(
                    tabla=sql.Identifier(DB_TABLE_RECORRIDOS), filtro=filtro
                ),
                params + [limite],
            )
            return [dict(f) for f in cur.fetchall()]
    finally:
        conexion.close()


def obtener_consumo_vivo(vid: str = VID_KIA, max_edad_s: float = 30) -> dict | None:
    """Última fila OBD, o None si es más vieja que max_edad_s o el vehículo no es el
    Kia, el único con nodo OBD. hora es la del GNSS o, sin fix, la de llegada al
    servidor. La edad se mide con esa hora: una fila de la cola del ESP32 que acaba de
    llegar pero se midió hace rato no cuenta."""
    if vid != VID_KIA:
        return None
    conexion = _conectar()
    try:
        with conexion.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                sql.SQL(
                    "SELECT recorrido_id, fuel_lph, fuel_lph_ecuacion, vel, lat, lng, "
                    "COALESCE(ts, recibido_en) AS hora "
                    "FROM {tabla} ORDER BY id DESC LIMIT 1"
                ).format(tabla=sql.Identifier(DB_TABLE_OBD))
            )
            fila = cur.fetchone()
    finally:
        conexion.close()
    if fila is None or (ahora_colombia() - fila["hora"]).total_seconds() > max_edad_s:
        return None
    return dict(fila)


def guardar_prediccion(origen_lat: float, origen_lng: float, destino_lat: float, destino_lng: float,
                       rutas: list[dict], vid: str = VID_KIA, destino_texto: str | None = None,
                       precio_id: int | None = None) -> dict:
    """Guarda una predicción y sus rutas en una sola transacción. Cada ruta es un dict
    con las columnas de predicciones_rutas; opcion es su posición en la lista si no
    viene, y vel_media_kmh se calcula si no viene. Si no se indica precio_id, se usa el
    vigente. Devuelve {"prediccion_id": id, "rutas_ids": [ids en el orden recibido]}.
    Lanza ValueError si el vehículo no tiene OBD o no se conoce su cilindrada."""
    columnas_ruta = ("opcion", "tipo_ruta", "distancia_km", "tiempo_s", "tiempo_sin_trafico_s",
                     "tiempo_historico_s", "retraso_trafico_s", "vel_media_kmh", "litros_modelo",
                     "costo_cop", "modelo", "geometria")
    insertar_ruta = sql.SQL(
        "INSERT INTO {tabla} (prediccion_id, {columnas}) VALUES (%s, {marcadores}) RETURNING id"
    ).format(
        tabla=sql.Identifier(DB_TABLE_PREDICCIONES_RUTAS),
        columnas=sql.SQL(", ").join(map(sql.Identifier, columnas_ruta)),
        marcadores=sql.SQL(", ").join(sql.Placeholder() * len(columnas_ruta)),
    )

    solicitado_en = ahora_colombia()
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                sql.SQL("SELECT tiene_obd, cilindrada_l FROM {tabla} WHERE vid = %s").format(
                    tabla=sql.Identifier(DB_TABLE_VEHICULOS)
                ),
                (vid,),
            )
            vehiculo = cur.fetchone()
            if vehiculo is None or not vehiculo[0] or vehiculo[1] is None:
                raise ValueError("El vehículo no admite predicciones: sin OBD o sin cilindrada")

            if precio_id is None:
                precio = _precio_vigente(cur, solicitado_en)
                precio_id = precio[0] if precio else None

            cur.execute(
                sql.SQL(
                    "INSERT INTO {tabla} (solicitado_en, vid, origen_lat, origen_lng, destino_lat, "
                    "destino_lng, destino_texto, precio_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
                    "RETURNING id"
                ).format(tabla=sql.Identifier(DB_TABLE_PREDICCIONES)),
                (solicitado_en, vid, origen_lat, origen_lng, destino_lat, destino_lng,
                 destino_texto, precio_id),
            )
            prediccion_id = cur.fetchone()[0]

            rutas_ids = []
            for posicion, ruta in enumerate(rutas):
                valores = {**ruta, "opcion": ruta.get("opcion", posicion)}
                if valores.get("vel_media_kmh") is None:
                    valores["vel_media_kmh"] = velocidad_media_kmh(
                        ruta.get("distancia_km"), ruta.get("tiempo_s")
                    )
                if ruta.get("geometria") is not None:
                    valores["geometria"] = psycopg2.extras.Json(ruta["geometria"])
                cur.execute(insertar_ruta, [prediccion_id, *(valores.get(c) for c in columnas_ruta)])
                rutas_ids.append(cur.fetchone()[0])
        conexion.commit()
        return {"prediccion_id": prediccion_id, "rutas_ids": rutas_ids}
    finally:
        conexion.close()


def marcar_ruta_elegida(prediccion_id: int, ruta_id: int) -> bool:
    """Guarda la ruta que eligió el usuario. Devuelve False si la ruta no pertenece a
    esa predicción (o no existe), y en ese caso no cambia nada."""
    conexion = _conectar()
    try:
        with conexion.cursor() as cur:
            cur.execute(
                sql.SQL(
                    "UPDATE {predicciones} SET ruta_elegida_id = %s WHERE id = %s AND EXISTS "
                    "(SELECT 1 FROM {rutas} WHERE id = %s AND prediccion_id = %s)"
                ).format(predicciones=sql.Identifier(DB_TABLE_PREDICCIONES),
                         rutas=sql.Identifier(DB_TABLE_PREDICCIONES_RUTAS)),
                (ruta_id, prediccion_id, ruta_id, prediccion_id),
            )
            actualizada = cur.rowcount == 1
        conexion.commit()
        return actualizada
    finally:
        conexion.close()
