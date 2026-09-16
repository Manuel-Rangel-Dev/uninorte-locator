"""
API mínima que expone el último registro de telemetría.
Escucha SOLO en 127.0.0.1:8000 — nunca expuesto directamente a la red,
NGINX es el único que le hace reverse proxy desde afuera.
"""

from flask import Flask, jsonify

from db import obtener_ultimo_registro

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


if __name__ == "__main__":
    puerto = int(os.environ.get("API_PORT", 8000))
    # host="127.0.0.1": solo accesible localmente, jamás directo desde la web.
    app.run(host="127.0.0.1", port=puerto, debug=False)
