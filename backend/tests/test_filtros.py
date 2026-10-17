import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from filtros import filtrar_ruido  # noqa: E402

T0 = datetime(2026, 10, 15, 18, 0, 0)
# ~0.0001 grados de latitud = 11.1 m


def pt(seg, lat, lng, acc=None):
    return {"ts": T0 + timedelta(seconds=seg), "lat": lat, "lng": lng, "acc": acc}


def ruta_recta(n, paso_s=10, dlat=0.00009):
    """Ruta hacia el norte a ~1 m/s*dlat... (dlat=0.00009 => ~10 m cada punto => 1 m/s)."""
    return [pt(i * paso_s, 11.0 + i * dlat, -74.85) for i in range(n)]


def test_vacio_y_pocos_puntos():
    assert filtrar_ruido([]) == []
    dos = ruta_recta(2)
    assert filtrar_ruido(dos) == dos


def test_duplicados_por_instante():
    r = ruta_recta(5)
    con_dup = [r[0], r[0], r[1], r[1], r[2], r[3], r[3], r[4]]
    assert filtrar_ruido(con_dup) == r


def test_pico_aislado_se_elimina():
    r = ruta_recta(7)
    malo = pt(30, 11.0 + 3 * 0.00009 + 0.004, -74.85)  # ~440 m de salto en 10 s
    entrada = r[:3] + [malo] + r[4:]
    salida = filtrar_ruido(entrada)
    assert malo not in salida
    assert len(salida) == 6


def test_dos_picos_consecutivos_se_eliminan():
    r = ruta_recta(8)
    m1 = pt(30, 11.004, -74.85)
    m2 = pt(40, 11.005, -74.856)
    entrada = r[:3] + [m1, m2] + r[5:]
    salida = filtrar_ruido(entrada)
    assert m1 not in salida and m2 not in salida
    assert len(salida) == 6


def test_primer_punto_basura_se_descarta():
    r = ruta_recta(6)
    malo = pt(-10, 11.01, -74.86)
    salida = filtrar_ruido([malo] + r)
    assert malo not in salida
    assert salida == r


def test_movimiento_rapido_pero_real_se_conserva():
    # 15 m/s (54 km/h) sostenido: 150 m cada 10 s. Nada debe eliminarse.
    r = [pt(i * 10, 11.0 + i * 0.00135, -74.85) for i in range(10)]
    assert filtrar_ruido(r) == r


def test_hueco_largo_con_desplazamiento_real_se_conserva():
    # 5 km recorridos durante un hueco de 10 min (8 m/s): plausible.
    a = [pt(i * 10, 11.0, -74.85) for i in range(4)]
    b = [pt(630 + i * 10, 11.045, -74.85) for i in range(4)]
    assert filtrar_ruido(a + b) == a + b


def test_salto_real_sin_retorno_se_acepta():
    # Salto grande en poco tiempo pero la ruta continúa allí: no es ruido aislado.
    a = [pt(i * 10, 11.0, -74.85) for i in range(4)]
    b = [pt(40 + i * 10, 11.01, -74.85) for i in range(4)]  # ~1.1 km en 10 s, y se queda
    salida = filtrar_ruido(a + b)
    assert len(salida) >= 7  # se acepta el desplazamiento (no se pierde la ruta)


def test_precision_mala_se_descarta_y_none_se_conserva():
    r = ruta_recta(5)
    r[1]["acc"] = 80.0   # mala
    r[2]["acc"] = 12.0   # buena
    r[3]["acc"] = None   # fila antigua sin acc
    salida = filtrar_ruido(r)
    assert r[1] not in salida
    assert r[2] in salida and r[3] in salida


def test_no_modifica_la_entrada():
    r = ruta_recta(5)
    copia = list(r)
    filtrar_ruido(r)
    assert r == copia
