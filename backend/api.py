"""
API mínima que expone el último registro de telemetría.
Escucha SOLO en localhost — nunca expuesto directamente a la red,
NGINX es el único que le hace reverse proxy desde afuera.
"""

import os

import json
import urllib.error
import urllib.parse
import urllib.request

from datetime import datetime, timedelta
from flask import Flask, jsonify, request
from db import obtener_ultimo_registro, obtener_registros_en_rango
from filtros import filtrar_ruido
from tiempo import ahora_colombia

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
    params = {"key": TOMTOM_KEY, "traffic": "true", "travelMode": "car",
              "routeType": "fastest", "maxAlternatives": 2}
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


def _puntos_ruta(ruta: dict) -> list:
    """Lista [[lat, lon], ...] de la ruta, reducida a MAX_PUNTOS_RUTA como máximo."""
    puntos = [[p["latitude"], p["longitude"]]
              for tramo in ruta.get("legs", []) for p in tramo.get("points", [])]
    if not puntos:
        return []
    paso = max(1, -(-len(puntos) // MAX_PUNTOS_RUTA))
    reducidos = puntos[::paso]
    if reducidos[-1] != puntos[-1]:
        reducidos.append(puntos[-1])
    return reducidos


@app.get("/api/rutas")
def rutas():
    """Rutas alternativas con tráfico. Ej.:
    /api/rutas?origen_lat=..&origen_lon=..&destino_lat=..&destino_lon=.."""
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

    salida = []
    for i, ruta in enumerate(datos["routes"]):
        resumen = _resumen_ruta(ruta)
        salida.append({
            "id": i,
            "distancia_m": resumen.get("lengthInMeters"),
            "tiempo_s": resumen.get("travelTimeInSeconds"),
            "retraso_trafico_s": resumen.get("trafficDelayInSeconds"),
            "puntos": _puntos_ruta(ruta),
        })
    return jsonify(salida)

if __name__ == "__main__":
    # host="127.0.0.1": solo accesible localmente, jamás directo desde la web.
    # El puerto viene del .env (API_PORT); si no está definido, usa 8000 (main).
    puerto = int(os.environ.get("API_PORT", 8000))
    app.run(host="127.0.0.1", port=puerto, debug=False)
