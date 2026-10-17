"""
Filtro de ruido GPS para los recorridos históricos (sin dependencias externas).

Se aplica en /api/historico, sobre registros ya ordenados por tiempo. Cada
registro es un dict con al menos: lat, lng, ts (datetime) y opcionalmente acc.

Pasos:
  1. Descarta puntos con el mismo instante (ts) que el anterior (duplicados).
  2. Descarta puntos con precisión mala (acc > ACC_MAX_M). Si acc es None
     (filas antiguas, anteriores a la columna acc) este paso no los toca.
  3. Descarta "excursiones": puntos que obligarían a una velocidad imposible
     para un bus urbano y desde los cuales la ruta "vuelve" a una posición
     coherente con el último punto aceptado en los siguientes puntos.
"""

import math

ACC_MAX_M = 40.0  # precisión máxima aceptada (metros)
VEL_MAX_MS = 25.0  # 90 km/h: límite razonable para un bus urbano
DIST_MIN_SALTO_M = 60.0  # saltos menores a esto nunca se consideran ruido
MAX_OUTLIERS_CONSECUTIVOS = 3  # cuántos puntos malos seguidos se pueden saltar


def distancia_m(lat1, lng1, lat2, lng2) -> float:
    """Distancia haversine en metros."""
    radio = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * radio * math.asin(math.sqrt(a))


def _es_plausible(a, b, vel_max_ms) -> bool:
    """True si ir del punto a al punto b es físicamente razonable."""
    d = distancia_m(a["lat"], a["lng"], b["lat"], b["lng"])
    if d <= DIST_MIN_SALTO_M:
        return True
    dt = (b["ts"] - a["ts"]).total_seconds()
    if dt <= 0:
        return False
    return d / dt <= vel_max_ms


def filtrar_ruido(
    registros,
    acc_max_m=ACC_MAX_M,
    vel_max_ms=VEL_MAX_MS,
    max_outliers=MAX_OUTLIERS_CONSECUTIVOS,
):
    """Devuelve una lista nueva con los registros que pasan el filtro,
    conservando el orden. No modifica la lista de entrada."""
    # Pasos 1 y 2: duplicados y precisión
    base = []
    anterior = None
    for r in registros:
        if anterior is not None and r["ts"] == anterior["ts"]:
            continue
        acc = r.get("acc")
        if acc is not None and acc > acc_max_m:
            continue
        base.append(r)
        anterior = r

    n = len(base)
    if n < 3:
        return base

    # Punto ancla inicial: el primero cuyo siguiente sea coherente con él
    # (evita arrancar la ruta desde un punto basura).
    i0 = 0
    while i0 < n - 1 and not _es_plausible(base[i0], base[i0 + 1], vel_max_ms):
        i0 += 1

    resultado = [base[i0]]
    i = i0 + 1
    while i < n:
        ancla = resultado[-1]
        candidato = base[i]
        if _es_plausible(ancla, candidato, vel_max_ms):
            resultado.append(candidato)
            i += 1
            continue

        # Salto imposible: buscar en los siguientes puntos uno coherente con el ancla.
        retorno = None
        for k in range(1, max_outliers + 1):
            j = i + k
            if j >= n:
                break
            if _es_plausible(ancla, base[j], vel_max_ms):
                retorno = j
                break

        if retorno is None:
            # Ningún punto cercano "vuelve": es un desplazamiento real
            # (p. ej. el celular estuvo sin señal). Se acepta y se continúa.
            resultado.append(candidato)
            i += 1
        else:
            # Los puntos entre i y retorno-1 son ruido: se descartan.
            i = retorno
    return resultado
