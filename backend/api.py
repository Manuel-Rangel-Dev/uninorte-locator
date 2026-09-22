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

@app.get("/api/historico")
def historico():
    fecha = request.args.get("fecha")
    desde = request.args.get("desde")
    hasta = request.args.get("hasta")

    if not fecha or not desde or not hasta:
        return jsonify({"error": "Faltan parámetros: fecha, desde, hasta"}), 400

    try:
        desde_dt = datetime.strptime(f"{fecha} {desde}", "%Y-%m-%d %H:%M")
        hasta_dt = datetime.strptime(f"{fecha} {hasta}", "%Y-%m-%d %H:%M")
    except ValueError:
        return jsonify({"error": "Formato inválido. Usar fecha=YYYY-MM-DD, desde/hasta=HH:MM"}), 400

    if hasta_dt < desde_dt:
        return jsonify({"error": "'hasta' no puede ser antes que 'desde'"}), 400

    registros = obtener_registros_en_rango(desde_dt, hasta_dt)
    return jsonify([{"lat": r["lat"], "lng": r["lng"]} for r in registros])
    
if __name__ == "__main__":
    # host="127.0.0.1": solo accesible localmente, jamás directo desde la web.
    # El puerto viene del .env (API_PORT); si no está definido, usa 8000 (main).
    puerto = int(os.environ.get("API_PORT", 8000))
    app.run(host="127.0.0.1", port=puerto, debug=False)
