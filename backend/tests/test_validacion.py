import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from tiempo import ahora_colombia  # noqa: E402
from validacion import PaqueteInvalido, parsear_paquete  # noqa: E402


def paquete(**campos):
    ahora = ahora_colombia()
    base = {
        "lat": 11.0176922,
        "lng": -74.8517093,
        "date": ahora.strftime("%Y-%m-%d"),
        "hour": ahora.strftime("%H:%M:%S"),
    }
    base.update(campos)
    return json.dumps(base).encode()


def test_paquete_valido_basico():
    p = parsear_paquete(paquete())
    assert p["lat"] == 11.0176922 and p["lng"] == -74.8517093
    assert p["acc"] is None and p["spd"] is None and p["seq"] is None
    assert len(p["fecha"]) == 10 and len(p["hora"]) == 8


def test_paquete_valido_con_opcionales():
    p = parsear_paquete(paquete(acc=7.5, spd=3.2, seq=42))
    assert p["acc"] == 7.5 and p["spd"] == 3.2 and p["seq"] == 42


def test_opcionales_invalidos_se_ignoran_sin_descartar():
    p = parsear_paquete(paquete(acc="x", spd=-5, seq=True))
    assert p["acc"] is None and p["spd"] is None and p["seq"] is None


def test_hora_sin_cero_se_normaliza():
    ahora = ahora_colombia()
    p = parsear_paquete(paquete(date=ahora.strftime("%Y-%m-%d"), hour="1:02:03"))
    assert p["hora"] == "01:02:03"


@pytest.mark.parametrize("crudo", [
    b"\xff\xfe\x00",                 # no es UTF-8
    b"no es json",
    b"[1, 2, 3]",                    # JSON válido pero no objeto (antes tumbaba el listener)
    b'"texto"',
    b"123",
    b"null",
    b"[" * 600,                      # anidamiento extremo
    b'{"lat": NaN, "lng": 1, "date": "2026-10-15", "hour": "10:00:00"}',
    b'{"lat": Infinity, "lng": 1, "date": "2026-10-15", "hour": "10:00:00"}',
    b'{"lat": 1}',                   # faltan campos
])
def test_paquetes_malformados(crudo):
    with pytest.raises(PaqueteInvalido):
        parsear_paquete(crudo)


@pytest.mark.parametrize("campos", [
    {"lat": 91},
    {"lat": -91},
    {"lng": 181},
    {"lat": True},
    {"lat": None},
    {"lat": "abc"},
    {"lat": "nan"},
    {"lat": [1]},
    {"date": "<img src=x onerror=alert(1)>"},
    {"hour": "<script>"},
    {"date": "2026-13-45"},
    {"hour": "25:61:61"},
    {"date": 20261015},
    {"date": "2019-12-31"},
    {"date": "2999-01-01"},
])
def test_campos_invalidos(campos):
    with pytest.raises(PaqueteInvalido):
        parsear_paquete(paquete(**campos))
