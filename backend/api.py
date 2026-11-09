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
from db import (factor_modelo_actual, guardar_prediccion, listar_recorridos_obd,
                marcar_ruta_elegida, obtener_recorrido_obd, obtener_registros_en_rango,
                obtener_ultimo_registro, precio_vigente_actual)
from filtros import filtrar_ruido
from recorridos import costo_en_pesos, horas_pc
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


if __name__ == "__main__":
    # host="127.0.0.1": solo accesible localmente, jamás directo desde la web.
    # El puerto viene del .env (API_PORT); si no está definido, usa 8000 (main).
    puerto = int(os.environ.get("API_PORT", 8000))
    app.run(host="127.0.0.1", port=puerto, debug=False)
