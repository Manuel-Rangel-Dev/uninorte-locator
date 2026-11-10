"""
Modelo de ruta del Proyecto 3: litros y L/100 km estimados de un recorrido del Kia.

Igual que recorridos.py y validacion.py, no importa db.py al cargarse: se puede probar
sin base de datos ni variables de entorno. Tampoco necesita numpy ni scikit-learn.

El modelo es la regresión lineal física que entrenó route_model.py (PC) con eVED,
exportada a JSON con 2_modelo_ruta/export_ec2_model.py:
    L/100 km = intercepto + coeficientes · [1/v, v, v², 1/d, cilindrada, subida, bajada]
con v = velocidad media (distancia / duración total, con paradas) y d = distancia (km).
- "slope/linear_physics" (principal) usa la subida y la bajada del terreno en m/km,
  calculadas con el SRTM sobre la traza GNSS. Lleva el factor de corrección del Kia.
  Los recorridos emulados usan explícitamente factor 1.0: no son datos del Kia.
- "base/linear_physics" (respaldo) no usa pendiente ni factor. Se usa cuando el
  recorrido no tiene traza GNSS suficiente o sale del recorte SRTM.

Pendiente: misma regla que 2_modelo_ruta/elevation.py. La traza se remuestrea cada
30 m, la altitud de cada punto sale del SRTM por interpolación bilineal, se suaviza
con una media móvil de 5 muestras (150 m) y se suman las subidas y las bajadas.

Archivos (por defecto en backend/modelo/, se pueden cambiar por variables de entorno):
    MODELO_RUTA_JSON   modelo_ruta.json
    SRTM_RECORTE       opcional: limita la carga a un único .hgt y su .json
Por defecto se descubren todos los srtm_*.hgt del directorio modelo/ mediante mmap.
Si falta el modelo, estimar() devuelve None. Si falta el SRTM, se usa el respaldo. Cada
problema se registra en el log una sola vez.
"""

import json
import math
import os
import mmap
import struct
from pathlib import Path

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

CARPETA_MODELO = Path(__file__).resolve().parent / "modelo"
RUTA_MODELO = Path(os.environ.get("MODELO_RUTA_JSON", CARPETA_MODELO / "modelo_ruta.json"))
RUTA_SRTM = Path(os.environ.get("SRTM_RECORTE", CARPETA_MODELO / "srtm_barranquilla.hgt"))

CILINDRADA_L = 1.6         # todos los recorridos son del Kia K3
PASO_M = 30.0              # remuestreo de la traza (resolución del SRTM)
MUESTRAS_SUAVIZADO = 5     # media móvil de 150 m
MIN_TRAZA_M = 3 * PASO_M
VACIO_SRTM = -1000         # valores menores son huecos del SRTM
RADIO_TIERRA_M = 6371000.0  # el mismo de elevation.py

# ---------------------------------------------------------------------------
# Carga perezosa (una sola vez por proceso)
# ---------------------------------------------------------------------------

_modelo = None
_srtm = None
_avisos = set()


def _avisar(clave: str, mensaje: str) -> None:
    if clave not in _avisos:
        _avisos.add(clave)
        print(f"[modelo_ruta] {mensaje}")


def cargar_modelo() -> dict | None:
    """El JSON del modelo, o None si no está o no se puede leer."""
    global _modelo
    if _modelo is None:
        try:
            _modelo = json.loads(RUTA_MODELO.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            _avisar("modelo", f"sin modelo de ruta ({RUTA_MODELO}): {error}. litros_modelo queda en NULL")
            return None
    return _modelo


class _Srtm:
    """Recorte SRTM mapeado en modo lectura (int16 big-endian, sin copia en RAM)."""

    def __init__(self, ruta: Path):
        meta = json.loads(ruta.with_suffix(".json").read_text(encoding="utf-8"))
        self.lat_norte = meta["lat_norte"]
        self.lon_oeste = meta["lon_oeste"]
        self.por_grado = meta["muestras_por_grado"]
        self.filas = meta["filas"]
        self.columnas = meta["columnas"]
        with open(ruta, "rb") as archivo:
            if os.fstat(archivo.fileno()).st_size != self.filas * self.columnas * 2:
                raise ValueError("tamaño inesperado del recorte")
            self.datos = mmap.mmap(archivo.fileno(), 0, access=mmap.ACCESS_READ)

    def contiene(self, lat: float, lon: float) -> bool:
        return (self.lat_norte - (self.filas - 1) / self.por_grado <= lat <= self.lat_norte
                and self.lon_oeste <= lon <= self.lon_oeste + (self.columnas - 1) / self.por_grado)

    def _muestra(self, indice: int) -> int:
        return struct.unpack_from(">h", self.datos, indice * 2)[0]

    def altitud(self, lat: float, lon: float) -> float | None:
        """Altitud bilineal en metros. None fuera del recorte o en un hueco del SRTM."""
        if not self.contiene(lat, lon):
            return None
        # Los bordes pueden desviarse unas ulp al convertir grados a índices.
        fila = min(max((self.lat_norte - lat) * self.por_grado, 0), self.filas - 1)
        columna = min(max((lon - self.lon_oeste) * self.por_grado, 0), self.columnas - 1)
        f0 = min(int(fila), self.filas - 2)
        c0 = min(int(columna), self.columnas - 2)
        df, dc = fila - f0, columna - c0
        i = f0 * self.columnas + c0
        esquinas = (self._muestra(i), self._muestra(i + self.columnas),
                    self._muestra(i + 1), self._muestra(i + self.columnas + 1))
        if min(esquinas) < VACIO_SRTM:
            return None
        z00, z10, z01, z11 = esquinas
        return (z00 * (1 - df) * (1 - dc) + z10 * df * (1 - dc)
                + z01 * (1 - df) * dc + z11 * df * dc)


class _RecortesSrtm:
    """Selecciona por cobertura; los archivos mmap solo paginan los datos consultados."""

    def __init__(self, recortes):
        self.recortes = recortes

    def seleccionar(self, lat, lon):
        return next((r for r in self.recortes if r.contiene(lat, lon)), None)

    def altitud(self, lat, lon):
        recorte = self.seleccionar(lat, lon)
        return recorte.altitud(lat, lon) if recorte else None


def cargar_srtm() -> _RecortesSrtm:
    global _srtm
    if _srtm is None:
        rutas = [RUTA_SRTM] if os.environ.get("SRTM_RECORTE") else sorted(CARPETA_MODELO.glob("srtm_*.hgt"))
        recortes = []
        if not rutas:
            _avisar("srtm", "sin recortes SRTM. Se usa el modelo sin pendiente")
        for ruta in rutas:
            try:
                recortes.append(_Srtm(ruta))
            except (OSError, ValueError, KeyError) as error:
                _avisar(str(ruta), f"sin SRTM ({ruta}): {error}. Se usa el modelo sin pendiente")
        _srtm = _RecortesSrtm(recortes)
    return _srtm


# ---------------------------------------------------------------------------
# Pendiente de una traza
# ---------------------------------------------------------------------------

def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * RADIO_TIERRA_M * math.asin(math.sqrt(h))


def _interpolar(x: float, xs: list, ys: list, desde: int) -> tuple[float, int]:
    """Interpolación lineal en xs creciente. Devuelve (y, índice) para seguir buscando
    desde ahí: las muestras se piden en orden."""
    while desde < len(xs) - 2 and xs[desde + 1] < x:
        desde += 1
    x0, x1 = xs[desde], xs[desde + 1]
    t = (x - x0) / (x1 - x0)
    return ys[desde] + t * (ys[desde + 1] - ys[desde]), desde


def subida_bajada(puntos: list[tuple[float, float]]) -> dict | None:
    """{"subida_m", "bajada_m", "traza_m"} de una traza [(lat, lng), ...], o None si es
    muy corta, no hay SRTM o ningún punto cae dentro del recorte."""
    srtm = cargar_srtm()
    if srtm is None:
        return None
    lats, lons, dist = [], [], []
    for lat, lon in puntos:
        if lat is None or lon is None:
            continue
        if not lats:
            lats.append(lat), lons.append(lon), dist.append(0.0)
            continue
        paso = _haversine_m(lats[-1], lons[-1], lat, lon)
        if paso > 0:  # puntos repetidos no avanzan
            lats.append(lat), lons.append(lon), dist.append(dist[-1] + paso)
    if not dist or dist[-1] < MIN_TRAZA_M:
        return None

    alturas = []
    i_lat = i_lon = 0
    s = 0.0
    while s < dist[-1]:
        lat, i_lat = _interpolar(s, dist, lats, i_lat)
        lon, i_lon = _interpolar(s, dist, lons, i_lon)
        alturas.append(srtm.altitud(lat, lon))
        s += PASO_M
    validas = [i for i, z in enumerate(alturas) if z is not None]
    if not validas:
        return None
    # Huecos: interpolación lineal entre muestras válidas (bordes con el valor más cercano).
    for i, z in enumerate(alturas):
        if z is None:
            antes = max((j for j in validas if j < i), default=None)
            despues = min((j for j in validas if j > i), default=None)
            if antes is None:
                alturas[i] = alturas[despues]
            elif despues is None:
                alturas[i] = alturas[antes]
            else:
                t = (i - antes) / (despues - antes)
                alturas[i] = alturas[antes] + t * (alturas[despues] - alturas[antes])

    # Media móvil centrada, con el borde repetido (np.pad mode="edge" en elevation.py).
    k = min(MUESTRAS_SUAVIZADO, len(alturas))
    relleno = [alturas[0]] * (k // 2) + alturas + [alturas[-1]] * (k - 1 - k // 2)
    suavizada = [sum(relleno[i:i + k]) / k for i in range(len(alturas))]
    subida = bajada = 0.0
    for z1, z2 in zip(suavizada, suavizada[1:]):
        if z2 > z1:
            subida += z2 - z1
        else:
            bajada += z1 - z2
    return {"subida_m": subida, "bajada_m": bajada, "traza_m": dist[-1]}


def pendiente_por_km(puntos: list[tuple[float, float]], distancia_km: float) -> dict | None:
    """Subida y bajada en m/km de la distancia recorrida, o None si la traza cubre menos
    de min_cobertura_traza de esa distancia (GNSS con huecos o fuera del recorte)."""
    modelo = cargar_modelo()
    if modelo is None or not distancia_km:
        return None
    traza = subida_bajada(puntos)
    if traza is None or traza["traza_m"] / 1000 < modelo["min_cobertura_traza"] * distancia_km:
        return None
    return {"subida_m_km": traza["subida_m"] / distancia_km,
            "bajada_m_km": traza["bajada_m"] / distancia_km}


def fix_util(fila: dict, min_satelites: int, max_precision_m: float = 20) -> bool:
    """Con sats manda su umbral; sin sats se usa acc, o se acepta el dato antiguo."""
    sats, acc = fila.get("sats"), fila.get("acc")
    if sats is not None:
        return sats >= min_satelites
    return acc is None or acc <= max_precision_m


def traza_obd(filas: list[dict]) -> list[tuple[float, float]]:
    """Puntos GNSS útiles de un recorrido OBD (como route_model.kia_slope): vacío si
    menos de min_fraccion_gnss de las filas con velocidad tiene fix, y sin los puntos
    con satélites insuficientes o precisión horizontal peor que max_precision_m.
    Sin sats ni acc se aceptan las filas antiguas del ESP32."""
    modelo = cargar_modelo()
    if modelo is None:
        return []
    con_vel = [f for f in filas if f.get("vel") is not None]
    con_fix = [f for f in con_vel if f.get("lat") is not None and f.get("lng") is not None]
    if not con_vel or len(con_fix) / len(con_vel) < modelo["min_fraccion_gnss"]:
        return []
    return [(f["lat"], f["lng"]) for f in con_fix
            if fix_util(f, modelo["min_satelites"], modelo.get("max_precision_m", 20))]


# ---------------------------------------------------------------------------
# Estimación
# ---------------------------------------------------------------------------

def _l_100km(parametros: dict, entradas: dict) -> float:
    v = entradas["mean_speed_kmh"]
    d = entradas["distance_km"]
    terminos = [1 / v, v, v ** 2, 1 / d] + [entradas[n] for n in parametros["entradas"][2:]]
    tasa = parametros["intercepto"] + sum(c * t for c, t in zip(parametros["coeficientes"], terminos))
    return max(tasa, 0.0)


def estimar(distancia_km, duracion_s, pendiente: dict | None = None,
            factor: float | None = None) -> dict | None:
    """Estimación del modelo para un recorrido completo.

    pendiente: {"subida_m_km", "bajada_m_km"} o None (usa el modelo de respaldo).
    factor: factor del Kia para el modelo principal; None usa el factor_inicial del JSON.
            El respaldo nunca lleva factor.
    Devuelve None si no hay modelo, o si el recorrido es más corto o más lento que los
    viajes con que se entrenó (min_distancia_km, min_duracion_s, vel_media_kmh_rango)."""
    modelo = cargar_modelo()
    if modelo is None or distancia_km is None or not duracion_s:
        return None
    vel_media = distancia_km / (duracion_s / 3600)
    vel_min, vel_max = modelo["vel_media_kmh_rango"]
    if (distancia_km < modelo["min_distancia_km"] or duracion_s < modelo["min_duracion_s"]
            or not vel_min <= vel_media <= vel_max):
        return None

    nombre = modelo["principal"] if pendiente is not None else modelo["respaldo"]
    parametros = modelo["modelos"][nombre]
    entradas = {"mean_speed_kmh": vel_media, "distance_km": distancia_km,
                "displacement_l": CILINDRADA_L}
    if pendiente is not None:
        entradas["srtm_climb_m_per_km"] = pendiente["subida_m_km"]
        entradas["srtm_descent_m_per_km"] = pendiente["bajada_m_km"]
    if not parametros["usa_factor"]:
        factor = 1.0
    elif factor is None:
        factor = parametros["factor_inicial"]

    tasa = _l_100km(parametros, entradas)
    litros_sin_factor = tasa * distancia_km / 100
    return {
        "modelo": nombre,
        "usa_factor": parametros["usa_factor"],
        "vel_media_kmh": vel_media,
        "l_100km_sin_factor": tasa,
        "litros_sin_factor": litros_sin_factor,
        "factor": factor,
        "litros": litros_sin_factor * factor,
        "subida_m_km": pendiente["subida_m_km"] if pendiente else None,
        "bajada_m_km": pendiente["bajada_m_km"] if pendiente else None,
    }


def factor_inicial(nombre: str) -> float | None:
    """factor_inicial del JSON para ese modelo (el del PC), o None si no hay modelo."""
    modelo = cargar_modelo()
    if modelo is None or nombre not in modelo["modelos"]:
        return None
    return modelo["modelos"][nombre]["factor_inicial"]


def min_recorridos_factor() -> int:
    modelo = cargar_modelo()
    return modelo["min_recorridos_factor"] if modelo else 0
