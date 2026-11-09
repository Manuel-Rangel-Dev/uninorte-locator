"""
API mínima que expone el último registro de telemetría.
Escucha SOLO en localhost — nunca expuesto directamente a la red,
NGINX es el único que le hace reverse proxy desde afuera.
"""

import csv
import io
import os

import json
import urllib.error
import urllib.parse
import urllib.request

from datetime import datetime, timedelta
from flask import Flask, Response, jsonify, request
import modelo_ruta
from db import (factor_modelo_actual, guardar_prediccion, listar_recorridos, listar_recorridos_obd,
                marcar_ruta_elegida, obtener_recorrido_obd, obtener_registros_en_rango,
                obtener_resumen_recorrido, obtener_ultima_fila_kia, obtener_ultimo_registro,
                precio_vigente_actual)
from filtros import distancia_m, filtrar_ruido
from recorridos import VID_KIA, costo_en_pesos, error_pct, horas_pc, metricas_litros, resumir
from tiempo import ahora_colombia
from validacion import NOMBRES_OBD, RID_VALIDO

app = Flask(__name__)

# Sin parámetros, /api/historico devuelve solo las últimas 24 h (antes devolvía toda la tabla).
VENTANA_POR_DEFECTO = timedelta(hours=24)
# Tope de filas por consulta (a 1 fix cada 5 s, un día son ~17.000).
MAX_REGISTROS_HISTORICO = 200_000


def registro_o_vacio() -> dict:
    """Devuelve el último registro (del vehículo ?vid= si se indica), o vacíos."""
    registro = obtener_ultimo_registro(request.args.get("vid"))
    if registro is None:
        return {"lat": None, "lng": None, "fecha": None, "hora": None, "vid": None}
    return {
        "lat": registro["lat"],
        "lng": registro["lng"],
        "fecha": registro["fecha"],
        "hora": registro["hora"],
        "vid": registro.get("vid"),
    }


@app.get("/api/ultimo")
def ultimo_completo():
    """Devuelve los cuatro campos juntos (útil para carga inicial de la página)."""
    return jsonify(registro_o_vacio())


@app.get("/api/lat")
def solo_lat():
    return jsonify({"lat": registro_o_vacio()["lat"]})


@app.get("/api/lng")
def solo_lng():
    return jsonify({"lng": registro_o_vacio()["lng"]})


@app.get("/api/fecha")
def solo_fecha():
    return jsonify({"fecha": registro_o_vacio()["fecha"]})


@app.get("/api/hora")
def solo_hora():
    return jsonify({"hora": registro_o_vacio()["hora"]})


@app.get("/api/integrante")
def nombre_integrante():
    return jsonify({"nombre": os.environ.get("NOMBRE_INTEGRANTE", "Desconocido")})


def _parsear_param_fecha_hora(fecha_val: str | None, hora_val: str | None, combinado_val: str | None) -> tuple[datetime | None, bool]:
    """Parsea una fecha y hora a datetime soportando parámetros combinados o separados. Retorna (dt, tiene_segundos)."""
    tiene_segundos = False
    if combinado_val:
        texto = combinado_val.strip().replace("T", " ")
        tiene_segundos = texto.count(":") >= 2
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(texto, fmt), tiene_segundos
            except ValueError:
                pass
        if fecha_val:
            texto_con_fecha = f"{fecha_val.strip()} {combinado_val.strip()}"
            tiene_segundos = texto_con_fecha.count(":") >= 2
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
                try:
                    return datetime.strptime(texto_con_fecha, fmt), tiene_segundos
                except ValueError:
                    pass

    if fecha_val and hora_val:
        texto = f"{fecha_val.strip()} {hora_val.strip()}"
        tiene_segundos = hora_val.strip().count(":") >= 2
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                return datetime.strptime(texto, fmt), tiene_segundos
            except ValueError:
                pass

    if fecha_val and not hora_val:
        try:
            return datetime.strptime(fecha_val.strip(), "%Y-%m-%d"), False
        except ValueError:
            pass

    return None, False


@app.get("/api/historico")
def historico():
    fecha_global = request.args.get("fecha")

    fecha_desde = request.args.get("fecha_desde") or fecha_global
    hora_desde = request.args.get("hora_desde")
    desde_param = request.args.get("desde")

    fecha_hasta = request.args.get("fecha_hasta") or fecha_global
    hora_hasta = request.args.get("hora_hasta")
    hasta_param = request.args.get("hasta")

    dt_desde, _ = _parsear_param_fecha_hora(fecha_desde, hora_desde, desde_param)
    dt_hasta, hasta_tiene_segundos = _parsear_param_fecha_hora(fecha_hasta, hora_hasta, hasta_param)
    hasta_es_solo_fecha = (
        (bool(fecha_hasta) and not hora_hasta and not hasta_param)
        or (
            bool(hasta_param)
            and len(hasta_param.strip()) == 10
            and hasta_param.strip().count("-") == 2
        )
    )

    if not dt_desde or not dt_hasta:
        if not fecha_desde and not fecha_hasta and not desde_param and not hasta_param and not fecha_global:
            # Sin parámetros: últimas 24 h en hora de Colombia (los datos están en esa hora).
            dt_hasta = ahora_colombia()
            dt_desde = dt_hasta - VENTANA_POR_DEFECTO
            hasta_tiene_segundos = True
        else:
            return jsonify({
                "error": "Parámetros de fecha/hora faltantes o con formato inválido. "
                         "Usa fecha_desde/fecha_hasta (YYYY-MM-DD) y hora_desde/hora_hasta (HH:MM o HH:MM:SS), "
                         "o desde/hasta con fecha y hora completa."
            }), 400

    # Si no se especificaron segundos en hasta, incluir el minuto completo (:59.999999).
    # Si se especificaron segundos, cubrir hasta el final de ese segundo (.999999) para abarcar registros intermedios.
    if hasta_es_solo_fecha:
        dt_hasta = dt_hasta.replace(hour=23, minute=59, second=59, microsecond=999999)
    elif not hasta_tiene_segundos:
        dt_hasta = dt_hasta.replace(second=59, microsecond=999999)
    elif dt_hasta.microsecond == 0:
        dt_hasta = dt_hasta.replace(microsecond=999999)

    if dt_hasta < dt_desde:
        return jsonify({"error": "'hasta' no puede ser anterior a 'desde'"}), 400
    
    vid = request.args.get("vid")
    try:
        registros = obtener_registros_en_rango(dt_desde, dt_hasta, MAX_REGISTROS_HISTORICO, vid)

    except Exception:
        app.logger.exception("Error consultando el histórico")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500

    # Filtro de ruido GPS (duplicados, mala precisión, saltos imposibles).
    # Para depurar con los datos crudos: /api/historico?...&filtrar=0
    if request.args.get("filtrar", "1") != "0":
        registros = filtrar_ruido(registros)

    return jsonify([
        {
            "lat": r["lat"],
            "lng": r["lng"],
            "fecha": r.get("fecha"),
            "hora": r.get("hora"),
            "vid": r.get("vid"),
        }
        for r in registros
    ])


# ----------------------------------------------------------------------------
# Planificación de rutas (TomTom). La clave vive solo en el servidor.
# ----------------------------------------------------------------------------
TOMTOM_KEY = os.environ.get("TOMTOM_KEY")
CENTRO_DEFECTO = (10.9685, -74.7813)   # Barranquilla: sesgo de búsqueda si no llega ubicación
MAX_PUNTOS_RUTA = 400                  # tope de puntos por ruta, para que la respuesta no pese
# Desplazamientos (grados, ~30 m cada paso) para cuando TomTom no ubica un punto en la vía
OFFSETS_GRADOS = [(0, 0), (0.0003, 0), (-0.0003, 0), (0, 0.0003), (0, -0.0003),
                  (0.0006, 0), (-0.0006, 0), (0, 0.0006), (0, -0.0006)]


def _float_param(nombre: str, minimo: float, maximo: float):
    """Lee un parámetro numérico de la URL; None si falta, no es número o está fuera de rango."""
    try:
        valor = float(request.args.get(nombre, ""))
    except ValueError:
        return None
    return valor if minimo <= valor <= maximo else None


def _tomtom_get(url: str):
    """GET a TomTom. Devuelve (estado, dict). No imprime la clave en los logs."""
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            cuerpo = json.loads(e.read().decode("utf-8"))
        except Exception:
            cuerpo = {}
        return e.code, cuerpo
    except Exception:
        app.logger.exception("Error consultando TomTom")
        return 502, {}


@app.get("/api/buscar")
def buscar_lugar():
    """Busca direcciones o lugares. Ej.: /api/buscar?q=Universidad del Norte&lat=10.99&lon=-74.80"""
    if not TOMTOM_KEY:
        return jsonify({"error": "TOMTOM_KEY no está configurada en el servidor"}), 500
    texto = (request.args.get("q") or "").strip()
    if not 3 <= len(texto) <= 100:
        return jsonify({"error": "q debe tener entre 3 y 100 caracteres"}), 400

    lat = _float_param("lat", -90, 90)
    lon = _float_param("lon", -180, 180)
    if lat is None or lon is None:
        lat, lon = CENTRO_DEFECTO

    params = {"key": TOMTOM_KEY, "countrySet": "CO", "limit": 5, "lat": lat, "lon": lon}
    url = ("https://api.tomtom.com/search/2/search/"
           f"{urllib.parse.quote(texto, safe='')}.json?{urllib.parse.urlencode(params)}")
    estado, datos = _tomtom_get(url)
    if estado != 200:
        return jsonify({"error": "Falló la búsqueda en TomTom"}), 502

    resultados = []
    for r in datos.get("results", []):
        pos = r.get("position") or {}
        if "lat" not in pos or "lon" not in pos:
            continue
        direccion = (r.get("address") or {}).get("freeformAddress", "")
        nombre = (r.get("poi") or {}).get("name") or direccion
        resultados.append({"nombre": nombre, "direccion": direccion,
                           "lat": pos["lat"], "lon": pos["lon"]})
    return jsonify(resultados)


def _calcular_rutas(origen, destino):
    locs = f"{origen[0]},{origen[1]}:{destino[0]},{destino[1]}"
    # computeTravelTimeFor=all agrega al resumen el tiempo sin tráfico y con tráfico histórico.
    params = {"key": TOMTOM_KEY, "traffic": "true", "travelMode": "car",
              "routeType": "fastest", "maxAlternatives": 2, "computeTravelTimeFor": "all"}
    url = (f"https://api.tomtom.com/routing/1/calculateRoute/{locs}/json?"
           f"{urllib.parse.urlencode(params)}")
    return _tomtom_get(url)


def _rutas_con_ajuste(origen, destino):
    """Pide las rutas; si TomTom no ubica un punto en una vía, lo mueve unos metros y reintenta."""
    o_aj, d_aj = origen, destino
    i_o = i_d = 0
    estado, datos = _calcular_rutas(o_aj, d_aj)
    while estado == 400 and "MAP_MATCHING_FAILURE" in json.dumps(datos):
        error = json.dumps(datos)
        if "Origin" in error and i_o < len(OFFSETS_GRADOS) - 1:
            i_o += 1
            o_aj = (origen[0] + OFFSETS_GRADOS[i_o][0], origen[1] + OFFSETS_GRADOS[i_o][1])
        elif "Destination" in error and i_d < len(OFFSETS_GRADOS) - 1:
            i_d += 1
            d_aj = (destino[0] + OFFSETS_GRADOS[i_d][0], destino[1] + OFFSETS_GRADOS[i_d][1])
        else:
            break
        estado, datos = _calcular_rutas(o_aj, d_aj)
    return estado, datos


def _resumen_ruta(ruta: dict) -> dict:
    resumen = ruta.get("summary")
    if resumen:
        return resumen
    tramos = [t.get("summary", {}) for t in ruta.get("legs", [])]
    return {k: sum(t.get(k, 0) for t in tramos)
            for k in ("lengthInMeters", "travelTimeInSeconds", "trafficDelayInSeconds")}


def _puntos_completos(ruta: dict) -> list:
    """Lista [[lat, lon], ...] con todos los puntos de la ruta."""
    return [[p["latitude"], p["longitude"]]
            for tramo in ruta.get("legs", []) for p in tramo.get("points", [])]


def _puntos_ruta(ruta: dict) -> list:
    """Lista [[lat, lon], ...] de la ruta, reducida a MAX_PUNTOS_RUTA como máximo."""
    puntos = _puntos_completos(ruta)
    if not puntos:
        return []
    paso = max(1, -(-len(puntos) // MAX_PUNTOS_RUTA))
    reducidos = puntos[::paso]
    if reducidos[-1] != puntos[-1]:
        reducidos.append(puntos[-1])
    return reducidos


def _factor_y_precio() -> tuple:
    """(factor del modelo principal, (precio_id, cop_por_galon)) para una ruta de ahora.
    Si la base falla, (None, None): el modelo usa el factor del PC y el costo queda en
    None, pero las rutas se devuelven igual."""
    try:
        modelo = modelo_ruta.cargar_modelo()
        factor = factor_modelo_actual(modelo["principal"]) if modelo else None
        return factor, precio_vigente_actual()
    except Exception:
        app.logger.exception("No se pudo leer el factor o el precio de la base")
        return None, None


def _estimar_ruta(ruta: dict, factor: float | None, cop_por_galon: float | None) -> dict:
    """Campos del modelo de ruta para una ruta de TomTom: litros y costo con el tiempo con
    tráfico, y la pendiente SRTM sobre su geometría completa (como predict_route.py)."""
    resumen = _resumen_ruta(ruta)
    distancia_m, tiempo_s = resumen.get("lengthInMeters"), resumen.get("travelTimeInSeconds")
    distancia_km = distancia_m / 1000 if distancia_m else None
    pendiente = modelo_ruta.pendiente_por_km(_puntos_completos(ruta), distancia_km)
    estimado = modelo_ruta.estimar(distancia_km, tiempo_s, pendiente)
    if estimado is not None and estimado["usa_factor"] and factor is not None:
        estimado = modelo_ruta.estimar(distancia_km, tiempo_s, pendiente, factor=factor)
    vacio = estimado is None
    return {
        "tiempo_sin_trafico_s": resumen.get("noTrafficTravelTimeInSeconds"),
        "tiempo_historico_s": resumen.get("historicTrafficTravelTimeInSeconds"),
        "vel_media_kmh": None if vacio else estimado["vel_media_kmh"],
        "litros": None if vacio else estimado["litros"],
        "costo_cop": None if vacio else costo_en_pesos(estimado["litros"], cop_por_galon),
        "subida_m_km": None if vacio else estimado["subida_m_km"],
        "bajada_m_km": None if vacio else estimado["bajada_m_km"],
        "factor": None if vacio else estimado["factor"],
        "modelo": None if vacio else estimado["modelo"],
        "litros_sin_factor": None if vacio else estimado["litros_sin_factor"],
    }


def _guardar_rutas(origen, destino, salida: list, precio_id, destino_texto) -> None:
    """Guarda la predicción y agrega prediccion_id y ruta_id a cada ruta de salida.
    Si la base falla, quedan en None y las rutas se devuelven igual."""
    for ruta in salida:
        ruta["prediccion_id"] = ruta["ruta_id"] = None
    filas = [{
        "opcion": r["id"],
        "tipo_ruta": "principal" if r["id"] == 0 else "alternativa",
        "distancia_km": r["distancia_m"] / 1000 if r["distancia_m"] is not None else None,
        "tiempo_s": r["tiempo_s"],
        "tiempo_sin_trafico_s": r["tiempo_sin_trafico_s"],
        "tiempo_historico_s": r["tiempo_historico_s"],
        "retraso_trafico_s": r["retraso_trafico_s"],
        "vel_media_kmh": r["vel_media_kmh"],
        "litros_modelo": r["litros"],
        "costo_cop": r["costo_cop"],
        "modelo": r["modelo"],
        "geometria": r["puntos"],
        "litros_modelo_sin_factor": r["litros_sin_factor"],
        "factor_modelo": r["factor"],
        "subida_m_km": r["subida_m_km"],
        "bajada_m_km": r["bajada_m_km"],
    } for r in salida]
    try:
        guardado = guardar_prediccion(origen[0], origen[1], destino[0], destino[1], filas,
                                      destino_texto=destino_texto, precio_id=precio_id)
    except Exception:
        app.logger.exception("No se pudo guardar la predicción de rutas")
        return
    for ruta, ruta_id in zip(salida, guardado["rutas_ids"]):
        ruta["prediccion_id"] = guardado["prediccion_id"]
        ruta["ruta_id"] = ruta_id


@app.get("/api/rutas")
def rutas():
    """Rutas alternativas con tráfico, con los litros y el costo estimados por el modelo
    de ruta para el Kia. Ej.:
    /api/rutas?origen_lat=..&origen_lon=..&destino_lat=..&destino_lon=..[&destino_texto=..]
    Cada ruta trae su posición en "id" (como antes) y, si se pudo guardar, prediccion_id
    y ruta_id para POST /api/rutas/elegida."""
    if not TOMTOM_KEY:
        return jsonify({"error": "TOMTOM_KEY no está configurada en el servidor"}), 500
    o_lat, o_lon = _float_param("origen_lat", -90, 90), _float_param("origen_lon", -180, 180)
    d_lat, d_lon = _float_param("destino_lat", -90, 90), _float_param("destino_lon", -180, 180)
    if None in (o_lat, o_lon, d_lat, d_lon):
        return jsonify({"error": "Faltan origen_lat, origen_lon, destino_lat o destino_lon (o son inválidos)"}), 400

    estado, datos = _rutas_con_ajuste((o_lat, o_lon), (d_lat, d_lon))
    if estado != 200 or not datos.get("routes"):
        codigo = (datos.get("detailedError") or {}).get("code")
        return jsonify({"error": "No se pudo calcular la ruta", "codigo": codigo}), 502

    destino_texto = (request.args.get("destino_texto") or "").strip()[:200] or None
    factor, precio = _factor_y_precio()
    precio_id, cop_por_galon = precio if precio else (None, None)
    salida = []
    for i, ruta in enumerate(datos["routes"]):
        resumen = _resumen_ruta(ruta)
        salida.append({
            "id": i,
            "distancia_m": resumen.get("lengthInMeters"),
            "tiempo_s": resumen.get("travelTimeInSeconds"),
            "retraso_trafico_s": resumen.get("trafficDelayInSeconds"),
            "puntos": _puntos_ruta(ruta),
            **_estimar_ruta(ruta, factor, cop_por_galon),
        })
    _guardar_rutas((o_lat, o_lon), (d_lat, d_lon), salida, precio_id, destino_texto)
    return jsonify(salida)


def _entero_positivo(valor) -> int | None:
    """El valor como entero > 0, o None. bool no cuenta (True es un int en Python)."""
    if isinstance(valor, bool):
        return None
    if isinstance(valor, str) and valor.strip().isdigit():
        valor = int(valor)
    return valor if isinstance(valor, int) and 0 < valor < 2**63 else None


@app.post("/api/rutas/elegida")
def ruta_elegida():
    """Guarda la ruta que eligió el usuario de una predicción de /api/rutas.
    Cuerpo JSON: {"prediccion_id": N, "ruta_id": M}."""
    cuerpo = request.get_json(silent=True)
    if not isinstance(cuerpo, dict):
        return jsonify({"error": "El cuerpo debe ser JSON: {\"prediccion_id\": N, \"ruta_id\": M}"}), 400
    prediccion_id = _entero_positivo(cuerpo.get("prediccion_id"))
    ruta_id = _entero_positivo(cuerpo.get("ruta_id"))
    if prediccion_id is None or ruta_id is None:
        return jsonify({"error": "prediccion_id y ruta_id deben ser enteros positivos"}), 400
    if not marcar_ruta_elegida(prediccion_id, ruta_id):
        return jsonify({"error": "La ruta no pertenece a esa predicción"}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Nodo OBD del Kia
# ---------------------------------------------------------------------------

# Mismo encabezado que log_csv.py (así route_model.py y predict_route.py leen el
# archivo sin cambios), más las columnas del GNSS al final.
# seq va al final: un salto en seq es un paquete UDP perdido; un salto en t_ms sin
# salto en seq es una pausa en la lectura OBD.
ENCABEZADO_CSV_OBD = ["recorrido_id", "hora_pc", "t_ms", *NOMBRES_OBD, "lat", "lng", "alt", "gnss_kmh", "sats", "seq"]


@app.get("/api/obd/recorridos")
def recorridos_obd():
    """Lista los recorridos del nodo OBD: id, filas, filas con GPS, inicio y fin."""
    try:
        recorridos = listar_recorridos_obd()
    except Exception:
        app.logger.exception("Error listando los recorridos OBD")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500
    return jsonify([
        {
            "recorrido_id": r["recorrido_id"],
            "filas": r["filas"],
            "filas_con_gps": r["filas_con_gps"],
            "inicio": r["inicio"].strftime("%Y-%m-%d %H:%M:%S"),
            "fin": r["fin"].strftime("%Y-%m-%d %H:%M:%S"),
            "csv": f"/api/obd/recorridos/{r['recorrido_id']}.csv",
        }
        for r in recorridos
    ])


@app.get("/api/obd/recorridos/<recorrido_id>.csv")
def recorrido_obd_csv(recorrido_id: str):
    """Descarga un recorrido como CSV con el formato de log_csv.py.
    hora_pc = hora del GNSS (Colombia). Sin fix, se estima con t_ms desde la primera
    fila con hora GNSS o, si ninguna tiene, desde la llegada más rápida al servidor."""
    if not RID_VALIDO.fullmatch(recorrido_id):
        return jsonify({"error": "recorrido_id inválido"}), 400
    try:
        filas = obtener_recorrido_obd(recorrido_id)
    except Exception:
        app.logger.exception("Error consultando el recorrido OBD")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500
    if not filas:
        return jsonify({"error": "recorrido no encontrado"}), 404

    horas = horas_pc(filas)

    salida = io.StringIO()
    escritor = csv.writer(salida, lineterminator="\n")
    escritor.writerow(ENCABEZADO_CSV_OBD)
    for f, hora in zip(filas, horas):
        escritor.writerow(
            [f["recorrido_id"], hora.strftime("%Y-%m-%d %H:%M:%S.%f"), f["t_ms"]]
            + ["" if f[c] is None else f[c] for c in ENCABEZADO_CSV_OBD[3:]]
        )

    inicio = horas[0]
    nombre = f"{recorrido_id}_{inicio:%Y%m%d_%H%M%S}.csv"
    return Response(
        salida.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


# ---------------------------------------------------------------------------
# Consumo del Kia y del histórico de la app (P3-S3)
# ---------------------------------------------------------------------------

EDAD_EN_VIVO_S = 30          # sin datos por más tiempo, el Kia ya no está "en vivo"
CACHE_VIVO_S = 5             # el acumulado del recorrido en curso se recalcula a lo sumo cada 5 s
MAX_PUNTOS_RECORRIDO = 600   # tope de puntos del detalle de un recorrido del Kia
MAX_RANGO_CONSUMO = timedelta(hours=24)  # tope del rango de /api/historico/consumo
DECIMALES_COORDENADAS = 4    # igual que el frontend (constantes.js): ~11 m

_cache_vivo: dict = {}       # recorrido_id -> (instante, acumulado)


def _texto_fecha(valor) -> str | None:
    return valor.strftime("%Y-%m-%d %H:%M:%S") if valor else None


def _param_instante(nombre: str) -> tuple[datetime | None, bool, bool]:
    """(instante, vino, tiene_segundos) de un parámetro desde/hasta. vino es False si
    el parámetro no está; instante es None si vino con formato inválido."""
    texto = request.args.get(nombre)
    if not texto:
        return None, False, False
    instante, tiene_segundos = _parsear_param_fecha_hora(None, None, texto)
    return instante, True, tiene_segundos


def _rango_opcional():
    """(desde, hasta) opcionales para filtrar por inicio. hasta sin hora incluye el día
    completo. Devuelve una respuesta 400 en vez del rango si un formato es inválido."""
    desde, vino_desde, _ = _param_instante("desde")
    hasta, vino_hasta, hasta_con_segundos = _param_instante("hasta")
    if (vino_desde and desde is None) or (vino_hasta and hasta is None):
        return None, (jsonify({"error": "desde y hasta deben ser YYYY-MM-DD o YYYY-MM-DD HH:MM[:SS]"}), 400)
    if hasta is not None:
        texto = request.args["hasta"].strip()
        if len(texto) == 10:
            hasta = hasta.replace(hour=23, minute=59, second=59, microsecond=999999)
        elif not hasta_con_segundos:
            hasta = hasta.replace(second=59, microsecond=999999)
        else:
            hasta = hasta.replace(microsecond=999999)
    if desde and hasta and hasta < desde:
        return None, (jsonify({"error": "'hasta' no puede ser anterior a 'desde'"}), 400)
    return (desde, hasta), None


def _recorrido_kia_json(r: dict) -> dict:
    """Campos de un recorrido del Kia para la lista y el detalle."""
    return {
        "recorrido_id": r["recorrido_id"],
        "inicio": _texto_fecha(r.get("inicio")),
        "fin": _texto_fecha(r.get("fin")),
        "duracion_s": r.get("duracion_s"),
        "distancia_km": r.get("distancia_km"),
        "vel_media_kmh": r.get("vel_media_kmh"),
        "cerrado": r.get("cerrado", False),
        "con_traza": (r.get("filas_con_gps") or 0) >= 2,
        "litros_pid": r.get("litros_pid"),
        "litros_ecuacion": r.get("litros_ecuacion"),
        "litros_modelo": r.get("litros_modelo"),
        "modelo": r.get("modelo"),
        "factor": r.get("factor_modelo"),
        "subida_m_km": r.get("subida_m_km"),
        "bajada_m_km": r.get("bajada_m_km"),
        "costo_cop": r.get("costo_cop"),
        "costo_modelo_cop": r.get("costo_modelo_cop"),
        "error_modelo_pct": error_pct(r.get("litros_modelo"), r.get("litros_pid")),
        "error_ecuacion_pct": error_pct(r.get("litros_ecuacion"), r.get("litros_pid")),
    }


def _acumulado_en_curso(recorrido_id: str) -> dict:
    """Distancia, litros (PID y ecuación) y costo del recorrido hasta ahora. Se guarda
    CACHE_VIVO_S segundos: la página consulta cada 5 s y el recorrido puede tener miles de filas."""
    guardado = _cache_vivo.get(recorrido_id)
    if guardado and (datetime.now() - guardado[0]).total_seconds() < CACHE_VIVO_S:
        return guardado[1]
    resumen = resumir(obtener_recorrido_obd(recorrido_id))
    precio = precio_vigente_actual(resumen["inicio"])
    cop_por_galon = precio[1] if precio else None
    acumulado = {
        "inicio": _texto_fecha(resumen["inicio"]),
        "duracion_s": resumen["duracion_s"],
        "distancia_km": resumen["distancia_km"],
        "litros_pid": resumen["litros_pid"],
        "litros_ecuacion": resumen["litros_ecuacion"],
        "costo_pid_cop": costo_en_pesos(resumen["litros_pid"], cop_por_galon),
        "costo_ecuacion_cop": costo_en_pesos(resumen["litros_ecuacion"], cop_por_galon),
    }
    _cache_vivo.clear()  # solo interesa el recorrido en curso
    _cache_vivo[recorrido_id] = (datetime.now(), acumulado)
    return acumulado


@app.get("/api/kia/vivo")
def kia_vivo():
    """Última lectura del Kia y lo acumulado en su recorrido. en_vivo es False si la
    última fila tiene más de EDAD_EN_VIVO_S segundos. null si no hay ninguna fila."""
    try:
        fila = obtener_ultima_fila_kia()
        if fila is None:
            return jsonify(None)
        acumulado = _acumulado_en_curso(fila["recorrido_id"])
    except Exception:
        app.logger.exception("Error consultando el Kia en vivo")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500
    edad_s = max(0.0, (ahora_colombia() - fila["hora"]).total_seconds())
    return jsonify({
        "en_vivo": edad_s <= EDAD_EN_VIVO_S,
        "edad_s": round(edad_s, 1),
        "recorrido_id": fila["recorrido_id"],
        "hora": _texto_fecha(fila["hora"]),
        "lat": fila["lat"],
        "lng": fila["lng"],
        "hora_posicion": _texto_fecha(fila["hora_posicion"]),
        "vel_kmh": fila["vel"],
        "lph_ecuacion": fila["fuel_lph_ecuacion"],
        "lph_pid": fila["fuel_lph"],
        "recorrido": acumulado,
    })


@app.get("/api/kia/recorridos")
def kia_recorridos():
    """Recorridos del Kia, más recientes primero, con lo medido frente a lo estimado.
    Por defecto solo los que tienen estimado del modelo; todos=1 los lista todos.
    desde/hasta (opcionales) filtran por inicio."""
    rango, error = _rango_opcional()
    if error:
        return error
    try:
        filas = listar_recorridos(vid=VID_KIA, desde=rango[0], hasta=rango[1])
    except Exception:
        app.logger.exception("Error listando los recorridos del Kia")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500
    if request.args.get("todos") != "1":
        filas = [f for f in filas if f.get("litros_modelo") is not None]
    return jsonify([_recorrido_kia_json(f) for f in filas])


def _reducir(puntos: list, maximo: int) -> list:
    """Uno de cada n puntos para no pasar de maximo, conservando el último."""
    if len(puntos) <= maximo:
        return puntos
    paso = -(-len(puntos) // maximo)
    reducidos = puntos[::paso]
    if reducidos[-1] is not puntos[-1]:
        reducidos.append(puntos[-1])
    return reducidos


@app.get("/api/kia/recorridos/<recorrido_id>")
def kia_recorrido(recorrido_id: str):
    """Resumen de un recorrido del Kia y sus puntos con GNSS (lat, lng, hora,
    velocidad y L/h por ecuación y por PID), a lo sumo MAX_PUNTOS_RECORRIDO."""
    if not RID_VALIDO.fullmatch(recorrido_id):
        return jsonify({"error": "recorrido_id inválido"}), 400
    try:
        filas = obtener_recorrido_obd(recorrido_id)
        resumen = obtener_resumen_recorrido(recorrido_id) if filas else None
    except Exception:
        app.logger.exception("Error consultando el recorrido del Kia")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500
    if not filas:
        return jsonify({"error": "recorrido no encontrado"}), 404
    if resumen is None:  # el listener aún no lo resume (primer minuto): sin modelo ni costo
        resumen = resumir(filas)

    puntos = [
        {"lat": f["lat"], "lng": f["lng"], "hora": hora.strftime("%Y-%m-%d %H:%M:%S"),
         "vel_kmh": f["vel"], "lph_ecuacion": f.get("fuel_lph_ecuacion"), "lph_pid": f["fuel_lph"]}
        for f, hora in zip(filas, horas_pc(filas))
        if f["lat"] is not None and f["lng"] is not None
    ]
    return jsonify({"recorrido": _recorrido_kia_json(resumen),
                    "puntos": _reducir(puntos, MAX_PUNTOS_RECORRIDO)})


@app.get("/api/kia/metricas")
def kia_metricas():
    """Métricas del modelo y de la ecuación frente al PID 0x5E sobre los recorridos
    cerrados con PID y útiles para el modelo (mínimos de distancia y duración del
    modelo). desde/hasta (opcionales) filtran por inicio."""
    rango, error = _rango_opcional()
    if error:
        return error
    try:
        filas = listar_recorridos(vid=VID_KIA, desde=rango[0], hasta=rango[1], limite=5000)
    except Exception:
        app.logger.exception("Error calculando las métricas del Kia")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500
    modelo = modelo_ruta.cargar_modelo() or {}
    min_km = modelo.get("min_distancia_km", 1.0)
    min_s = modelo.get("min_duracion_s", 180)
    utiles = [f for f in filas if f["cerrado"] and f["litros_pid"] and (f["distancia_km"] or 0) >= min_km
              and (f["duracion_s"] or 0) >= min_s]

    def pares(columna, sub):
        return [(f["litros_pid"], f[columna], f["distancia_km"]) for f in sub]

    nombres = sorted({f["modelo"] for f in utiles if f["modelo"]})
    return jsonify({
        "recorridos": len(utiles),
        "desde": _texto_fecha(rango[0]),
        "hasta": _texto_fecha(rango[1]),
        "modelo": metricas_litros(pares("litros_modelo", utiles)),
        "ecuacion": metricas_litros(pares("litros_ecuacion", utiles)),
        "por_modelo": {n: metricas_litros(pares("litros_modelo", [f for f in utiles if f["modelo"] == n]))
                       for n in nombres},
    })


def _consumo_estimado(puntos: list[dict]) -> dict:
    """Estimado del modelo para una traza de la app (lat, lng, ts ordenados), como si
    fuera el Kia. Coordenadas redondeadas y sin repetidos seguidos, como en la página."""
    traza = []
    for p in puntos:
        lat, lng = round(p["lat"], DECIMALES_COORDENADAS), round(p["lng"], DECIMALES_COORDENADAS)
        if traza and (lat, lng) == (traza[-1][0], traza[-1][1]):
            traza[-1] = (lat, lng, p["ts"])  # mismo punto: vale la hora del último
            continue
        traza.append((lat, lng, p["ts"]))
    vacio = {"puntos": len(traza), "inicio": None, "fin": None, "distancia_km": None, "duracion_s": None,
             "vel_media_kmh": None, "litros": None, "costo_cop": None, "modelo": None, "factor": None,
             "subida_m_km": None, "bajada_m_km": None}
    if not puntos:
        return vacio
    distancia_km = sum(distancia_m(a[0], a[1], b[0], b[1]) for a, b in zip(traza, traza[1:])) / 1000
    inicio, fin = puntos[0]["ts"], puntos[-1]["ts"]
    duracion_s = (fin - inicio).total_seconds()
    vacio.update(inicio=_texto_fecha(inicio), fin=_texto_fecha(fin), distancia_km=distancia_km,
                 duracion_s=duracion_s,
                 vel_media_kmh=distancia_km / (duracion_s / 3600) if duracion_s > 0 else None)

    pendiente = modelo_ruta.pendiente_por_km([(a, b) for a, b, _ in traza], distancia_km)
    estimado = modelo_ruta.estimar(distancia_km, duracion_s, pendiente)
    if estimado is None:
        return vacio
    factor = factor_modelo_actual(estimado["modelo"]) if estimado["usa_factor"] else None
    if factor is not None:
        estimado = modelo_ruta.estimar(distancia_km, duracion_s, pendiente, factor=factor)
    precio = precio_vigente_actual(inicio)
    vacio.update(litros=estimado["litros"], modelo=estimado["modelo"], factor=estimado["factor"],
                 costo_cop=costo_en_pesos(estimado["litros"], precio[1] if precio else None),
                 subida_m_km=estimado["subida_m_km"], bajada_m_km=estimado["bajada_m_km"])
    return vacio


@app.get("/api/historico/consumo")
def historico_consumo():
    """Consumo estimado por el modelo de un recorrido de la app, como si fuera el Kia
    (1,6 L). desde y hasta son el primer y el último punto del recorrido tal como los
    segmenta la página (YYYY-MM-DD HH:MM[:SS]); vid opcional, como /api/historico.
    Usa los mismos puntos que /api/historico (con el filtro de ruido). Los campos del
    modelo quedan en null si el recorrido es muy corto o lento para el modelo."""
    desde, vino_desde, _ = _param_instante("desde")
    if not vino_desde or desde is None or not request.args.get("hasta"):
        return jsonify({"error": "Faltan desde y hasta (YYYY-MM-DD HH:MM[:SS]) o tienen formato inválido"}), 400
    rango, error = _rango_opcional()
    if error:
        return error
    desde, hasta = rango
    if hasta - desde > MAX_RANGO_CONSUMO:
        return jsonify({"error": "El rango no puede pasar de 24 horas"}), 400
    try:
        registros = obtener_registros_en_rango(desde, hasta, MAX_REGISTROS_HISTORICO, request.args.get("vid"))
        return jsonify(_consumo_estimado(filtrar_ruido(registros)))
    except Exception:
        app.logger.exception("Error estimando el consumo del histórico")
        return jsonify({"error": "Error interno consultando la base de datos"}), 500


if __name__ == "__main__":
    # host="127.0.0.1": solo accesible localmente, jamás directo desde la web.
    # El puerto viene del .env (API_PORT); si no está definido, usa 8000 (main).
    puerto = int(os.environ.get("API_PORT", 8000))
    app.run(host="127.0.0.1", port=puerto, debug=False)
