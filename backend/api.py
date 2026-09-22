"""
API mínima que expone el último registro de telemetría.
Escucha SOLO en localhost — nunca expuesto directamente a la red,
NGINX es el único que le hace reverse proxy desde afuera.
"""

import os
from datetime import datetime
from flask import Flask, jsonify, request
from db import obtener_ultimo_registro, obtener_registros_en_rango
app = Flask(__name__)


def registro_o_vacio() -> dict:
    """Devuelve el último registro, o valores vacíos si aún no hay datos."""
    registro = obtener_ultimo_registro()
    if registro is None:
        return {"lat": None, "lng": None, "fecha": None, "hora": None}
    return {
        "lat": registro["lat"],
        "lng": registro["lng"],
        "fecha": registro["fecha"],
        "hora": registro["hora"],
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

    if not dt_desde or not dt_hasta:
        return jsonify({
            "error": "Parámetros de fecha/hora faltantes o con formato inválido. "
                     "Usa fecha_desde/fecha_hasta (YYYY-MM-DD) y hora_desde/hora_hasta (HH:MM o HH:MM:SS), "
                     "o desde/hasta con fecha y hora completa."
        }), 400

    # Si no se especificaron segundos en hasta, incluir el minuto completo (:59.999999).
    # Si se especificaron segundos, cubrir hasta el final de ese segundo (.999999) para abarcar registros intermedios.
    if not hasta_tiene_segundos:
        dt_hasta = dt_hasta.replace(second=59, microsecond=999999)
    elif dt_hasta.microsecond == 0:
        dt_hasta = dt_hasta.replace(microsecond=999999)

    if dt_hasta < dt_desde:
        return jsonify({"error": "'hasta' no puede ser anterior a 'desde'"}), 400

    registros = obtener_registros_en_rango(dt_desde, dt_hasta)
    return jsonify([
        {
            "lat": r["lat"],
            "lng": r["lng"],
            "fecha": r.get("fecha"),
            "hora": r.get("hora"),
        }
        for r in registros
    ])
    
if __name__ == "__main__":
    # host="127.0.0.1": solo accesible localmente, jamás directo desde la web.
    # El puerto viene del .env (API_PORT); si no está definido, usa 8000 (main).
    puerto = int(os.environ.get("API_PORT", 8000))
    app.run(host="127.0.0.1", port=puerto, debug=False)
