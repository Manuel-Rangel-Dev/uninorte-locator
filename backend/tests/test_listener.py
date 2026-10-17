import json
import os
import sys

for _k, _v in {"DB_HOST": "x", "DB_NAME": "x", "DB_USER": "x", "DB_PASSWORD": "x"}.items():
    os.environ.setdefault(_k, _v)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import listener  # noqa: E402
from tiempo import ahora_colombia  # noqa: E402

ORIGEN = ("1.2.3.4", 5555)


@pytest.fixture(autouse=True)
def limpio():
    listener._recientes.clear()


def crudo(**extra):
    ahora = ahora_colombia()
    d = {"lat": 11.0, "lng": -74.85, "date": ahora.strftime("%Y-%m-%d"), "hour": ahora.strftime("%H:%M:%S")}
    d.update(extra)
    return json.dumps(d).encode()


def test_inserta_valido_con_campos_nuevos(monkeypatch):
    llamadas = []
    monkeypatch.setattr(listener, "insertar_registro", lambda *a, **k: llamadas.append((a, k)))
    listener.procesar_paquete(crudo(acc=5.0, spd=2.0, seq=7), ORIGEN)
    assert len(llamadas) == 1
    assert llamadas[0][1]["acc"] == 5.0 and llamadas[0][1]["seq"] == 7


def test_duplicado_no_se_inserta_dos_veces(monkeypatch):
    llamadas = []
    monkeypatch.setattr(listener, "insertar_registro", lambda *a, **k: llamadas.append(1))
    p = crudo()
    listener.procesar_paquete(p, ORIGEN)
    listener.procesar_paquete(p, ORIGEN)
    assert len(llamadas) == 1


@pytest.mark.parametrize("basura", [b"[1,2,3]", b"hola", b'{"lat": NaN}', b"\xff\xff"])
def test_basura_no_lanza_ni_inserta(monkeypatch, basura):
    llamadas = []
    monkeypatch.setattr(listener, "insertar_registro", lambda *a, **k: llamadas.append(1))
    listener.procesar_paquete(basura, ORIGEN)
    assert llamadas == []


def test_error_de_bd_no_propaga_y_permite_reintento(monkeypatch):
    estado = {"falla": True, "n": 0}

    def inserta(*a, **k):
        estado["n"] += 1
        if estado["falla"]:
            raise RuntimeError("rds caído")

    monkeypatch.setattr(listener, "insertar_registro", inserta)
    p = crudo()
    listener.procesar_paquete(p, ORIGEN)      # falla, no debe lanzar
    estado["falla"] = False
    listener.procesar_paquete(p, ORIGEN)      # el mismo paquete se reintenta (no quedó como "reciente")
    assert estado["n"] == 2
