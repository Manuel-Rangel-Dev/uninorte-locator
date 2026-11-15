"""Segmentación GPS y formato común de recorridos, sin Flask ni base de datos."""

from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from filtros import distancia_m, filtrar_ruido
from recorridos import MINUTOS_CIERRE, VID_VEHICULO_2, es_emulado

# Umbrales compartidos con frontend/js/historico/segmentacion.js y constantes.js:
# si cambia uno, cambiar el otro.
UMBRAL_SEGMENTACION_MINUTOS = 30
UMBRAL_SEGMENTACION_METROS = 2000
UMBRAL_ESTACIONADO_METROS = 50
DECIMALES_COORDENADAS = 4

VENTANA_RECORRIDOS = timedelta(days=7)
MAX_RANGO_RECORRIDOS = timedelta(days=31)


def memorizar_por_clave(consulta, clave):
    """Crea una consulta con memoria propia; conserva el argumento de la primera llamada por clave."""
    memoria = {}

    def obtener(argumento):
        llave = clave(argumento)
        if llave not in memoria:
            memoria[llave] = consulta(argumento)
        return memoria[llave]

    return obtener


def _redondear_coordenada(valor: float) -> float:
    """Equivale a Number(valor.toFixed(4)), incluso en los empates exactos."""
    precision = Decimal(1).scaleb(-DECIMALES_COORDENADAS)
    return float(Decimal.from_float(float(valor)).quantize(precision, rounding=ROUND_HALF_UP))


def segmentar_recorridos(registros: list[dict]) -> list[list[dict]]:
    """Separa registros ordenados por ts sin modificarlos; decide cortes con todos los válidos.

    Cada salida empieza en el último registro de su racha inicial de posiciones iguales
    a cuatro decimales, como la página. Conserva los repetidos intermedios y finales;
    una racha única queda con su último registro. El ancla usa los registros originales.
    """
    validos = [r for r in registros if all(r.get(c) is not None for c in ("lat", "lng", "ts"))]
    if not validos:
        return []
    coordenadas = [(_redondear_coordenada(r["lat"]),
                    _redondear_coordenada(r["lng"])) for r in validos]
    recorridos = []
    actual = [validos[0]]
    ancla = 0
    for i in range(1, len(validos)):
        anterior, punto = validos[i - 1], validos[i]
        corta = (punto["ts"] - anterior["ts"]).total_seconds() >= UMBRAL_SEGMENTACION_MINUTOS * 60
        if not corta:
            corta = distancia_m(*coordenadas[i - 1], *coordenadas[i]) >= UMBRAL_SEGMENTACION_METROS
        if not corta and distancia_m(*coordenadas[ancla], *coordenadas[i]) > UMBRAL_ESTACIONADO_METROS:
            corta = (anterior["ts"] - validos[ancla]["ts"]).total_seconds() >= UMBRAL_SEGMENTACION_MINUTOS * 60
            if not corta:
                ancla = i
        if corta:
            recorridos.append(actual)
            actual = []
            ancla = i
        actual.append(punto)
    recorridos.append(actual)
    salidas = []
    desplazamiento = 0
    for recorrido in recorridos:
        inicio = 0
        while (inicio + 1 < len(recorrido)
               and coordenadas[desplazamiento + inicio + 1] == coordenadas[desplazamiento]):
            inicio += 1
        salidas.append(recorrido[inicio:])
        desplazamiento += len(recorrido)
    return salidas


def filtrar_vehiculo_2(registros: list[dict]) -> list[dict]:
    """Incluye la telemetría de celular y las filas antiguas cuyo vid es NULL."""
    return [r for r in registros if r.get("vid") in (None, VID_VEHICULO_2)]


def preparar_segmentos(registros: list[dict]) -> list[tuple[list[dict], datetime, bool]]:
    """Devuelve puntos para estimar, último ts original y si era el segmento más reciente."""
    segmentos = segmentar_recorridos(filtrar_ruido(registros))
    preparados = []
    for i, segmento in enumerate(segmentos):
        # Refiltrar cada recorrido reproduce el ancla inicial de /api/historico/consumo.
        puntos = filtrar_ruido(segmento)
        if len(puntos) >= 2:
            preparados.append((puntos, segmento[-1]["ts"], i == len(segmentos) - 1))
    return preparados


def completar_rango(desde: datetime | None, hasta: datetime | None, ahora: datetime) -> tuple:
    """Completa extremos a siete días; admite hasta 31 días de diferencia entre fechas."""
    if desde is None and hasta is None:
        hasta = ahora
    if desde is None:
        desde = hasta - VENTANA_RECORRIDOS
    if hasta is None:
        hasta = desde + VENTANA_RECORRIDOS
    if hasta < desde:
        raise ValueError("'hasta' no puede ser anterior a 'desde'")
    if (hasta.date() - desde.date()).days > MAX_RANGO_RECORRIDOS.days:
        raise ValueError("El rango no puede pasar de 31 días de diferencia entre fechas")
    return desde, hasta


def recorrido_kia(fila: dict) -> dict:
    """Convierte una fila de recorridos OBD al formato común de la API."""
    return {
        "id": fila["recorrido_id"],
        "inicio": fila["inicio"].strftime("%Y-%m-%d %H:%M:%S") if fila["inicio"] else None,
        "fin": fila["fin"].strftime("%Y-%m-%d %H:%M:%S") if fila["fin"] else None,
        **{c: fila.get(c) for c in ("duracion_s", "distancia_km", "vel_media_kmh", "modelo")},
        "litros": fila.get("litros_modelo"),
        "costo_cop": fila.get("costo_modelo_cop"),
        "litros_medidos": fila.get("litros_pid"),
        "costo_medido_cop": fila.get("costo_cop"),
        "factor": fila.get("factor_modelo"),
        "en_curso": not fila["cerrado"],
        "emulado": es_emulado(fila["recorrido_id"]),
    }


def recorrido_vehiculo_2(estimado: dict, ultimo_ts: datetime, ahora: datetime,
                         es_mas_reciente: bool) -> dict:
    """Convierte el resultado de _consumo_estimado; solo el último puede seguir abierto."""
    inicio = datetime.strptime(estimado["inicio"], "%Y-%m-%d %H:%M:%S")
    return {
        "id": "v2_" + inicio.strftime("%Y%m%d_%H%M%S"),
        **{c: estimado.get(c) for c in ("inicio", "fin", "duracion_s", "distancia_km",
                                       "vel_media_kmh", "litros", "costo_cop", "modelo", "factor")},
        "litros_medidos": None,
        "costo_medido_cop": None,
        "en_curso": es_mas_reciente and ahora - ultimo_ts < timedelta(minutes=MINUTOS_CIERRE),
        "emulado": False,
    }
