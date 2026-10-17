import os
import sys
from datetime import datetime, timedelta

# db.py lee estas variables al importarse; aquí son valores falsos (no se conecta a nada).
for _k, _v in {"DB_HOST": "x", "DB_NAME": "x", "DB_USER": "x", "DB_PASSWORD": "x"}.items():
    os.environ.setdefault(_k, _v)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import api  # noqa: E402

T0 = datetime(2026, 10, 15, 18, 0, 0)


def fila(seg, lat, lng, acc=None, id_=0):
    ts = T0 + timedelta(seconds=seg)
    return {"id": id_, "lat": lat, "lng": lng, "fecha": ts.strftime("%Y-%m-%d"),
            "hora": ts.strftime("%H:%M:%S"), "ts": ts, "acc": acc}


def cliente(monkeypatch, filas, capturas=None):
    def falso(desde, hasta, limite):
        if capturas is not None:
            capturas.update(desde=desde, hasta=hasta, limite=limite)
        return list(filas)
    monkeypatch.setattr(api, "obtener_registros_en_rango", falso)
    return api.app.test_client()


def test_aplica_filtro_y_devuelve_solo_cuatro_campos(monkeypatch):
    filas = [fila(0, 11.0, -74.85, id_=1), fila(0, 11.0, -74.85, id_=2),   # duplicado
             fila(10, 11.0001, -74.85, id_=3), fila(20, 11.0002, -74.85, id_=4)]
    r = cliente(monkeypatch, filas).get("/api/historico?fecha=2026-10-15")
    assert r.status_code == 200
    datos = r.get_json()
    assert len(datos) == 3
    assert set(datos[0].keys()) == {"lat", "lng", "fecha", "hora"}


def test_filtrar_cero_devuelve_crudo(monkeypatch):
    filas = [fila(0, 11.0, -74.85, id_=1), fila(0, 11.0, -74.85, id_=2), fila(10, 11.0001, -74.85, id_=3)]
    r = cliente(monkeypatch, filas).get("/api/historico?fecha=2026-10-15&filtrar=0")
    assert len(r.get_json()) == 3


def test_sin_parametros_usa_ultimas_24h(monkeypatch):
    cap = {}
    r = cliente(monkeypatch, [], cap).get("/api/historico")
    assert r.status_code == 200
    assert cap["hasta"] - cap["desde"] >= timedelta(hours=23, minutes=59)
    assert cap["limite"] == api.MAX_REGISTROS_HISTORICO


def test_parametros_invalidos_400(monkeypatch):
    r = cliente(monkeypatch, []).get("/api/historico?fecha=basura")
    assert r.status_code == 400


def test_hasta_anterior_a_desde_400(monkeypatch):
    r = cliente(monkeypatch, []).get(
        "/api/historico?fecha_desde=2026-10-15&hora_desde=10:00:00&fecha_hasta=2026-10-15&hora_hasta=09:00:00")
    assert r.status_code == 400


def test_error_de_base_de_datos_devuelve_500_json(monkeypatch):
    def falla(*a, **k):
        raise RuntimeError("rds caído")
    monkeypatch.setattr(api, "obtener_registros_en_rango", falla)
    r = api.app.test_client().get("/api/historico?fecha=2026-10-15")
    assert r.status_code == 500
    assert "error" in r.get_json()
