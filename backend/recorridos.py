"""
Resumen de los recorridos del Kia: consumo, distancia, velocidad media y costo.

Este módulo no importa db.py al cargarse a propósito: así se puede probar sin base
de datos ni variables de entorno, igual que validacion.py. Solo --rellenar lo usa.

Relleno de los datos que ya están en la base, incluido el modelo de ruta (se puede
correr varias veces):
    python backend/recorridos.py --rellenar
"""

import argparse
import math
from datetime import timedelta

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

# El nodo OBD solo está en el Kia: todo lo de consumo y recorridos es de este vehículo.
VID_KIA = "kia_k3"
NOMBRE_KIA = "Kia K3 GT Line 2025"
CILINDRADA_KIA_L = 1.6
AFR_GASOLINA = 14.7
DENSIDAD_COMBUSTIBLE_G_L = 745.0
DENSIDAD_AIRE_G_L = 1.184

# Es el vid que la app manda hoy. Este carro solo reporta ubicación.
VID_CARRO_2 = "celular"
NOMBRE_CARRO_2 = "Carro 2 (solo ubicación por app)"

PRECIO_INICIAL_COP_GALON = 15964.0
PRECIO_INICIAL_FUENTE = "Precio de referencia Barranquilla"
LITROS_POR_GALON = 3.785411784

LAMBDA_MINIMA = 0.5        # por debajo, la lectura del sensor no es creíble
MAX_HUECO_S = 30.0         # un tramo más largo no se integra: es un hueco en los datos
MIN_DURACION_UTIL_S = 60.0     # recorridos más cortos no sirven para el modelo
MIN_DISTANCIA_UTIL_KM = 0.1
MINUTOS_CIERRE = 10        # sin datos por este tiempo, el recorrido se cierra

RADIO_TIERRA_KM = 6371.0088


# ---------------------------------------------------------------------------
# Consumo
# ---------------------------------------------------------------------------

def constante_k(cilindrada_l, afr, densidad_comb_g_l, densidad_aire_g_l) -> float | None:
    """K de la ecuación de consumo. None si falta algún dato del vehículo."""
    if None in (cilindrada_l, afr, densidad_comb_g_l, densidad_aire_g_l):
        return None
    return 3600 * densidad_aire_g_l * cilindrada_l / (100 * 120 * afr * densidad_comb_g_l)


def fuel_lph_ecuacion(carga_abs, rpm, lambda_, k) -> float | None:
    """Q [L/h] = K · carga_abs · rpm / lambda. None si falta un dato o lambda < 0.5."""
    if None in (carga_abs, rpm, lambda_, k) or lambda_ < LAMBDA_MINIMA:
        return None
    return k * carga_abs * rpm / lambda_


def costo_en_pesos(litros, cop_por_galon) -> float | None:
    if litros is None or cop_por_galon is None:
        return None
    return litros / LITROS_POR_GALON * cop_por_galon


# ---------------------------------------------------------------------------
# Hora de cada fila (hora_pc)
# ---------------------------------------------------------------------------

def horas_pc(filas: list[dict]) -> list:
    """Hora Colombia de cada fila, en el mismo orden. Las filas deben venir ordenadas
    por t_ms, seq. Sin fix GNSS, la hora se estima con t_ms (reloj del ESP32):
    1. Si alguna fila tiene hora del GNSS, se usa como referencia.
    2. Si ninguna tiene, se usa la llegada al servidor, pero no fila por fila: las
       filas que esperaron en la cola del ESP32 (sin señal LTE) llegan juntas y
       con retraso. La fila que llegó más rápido fija el desfase mínimo
       (recibido_en - t_ms), y ese desfase se aplica a todas."""
    referencia = next((f for f in filas if f["ts"] is not None), None)
    desfase_min = min(f["recibido_en"] - timedelta(milliseconds=f["t_ms"]) for f in filas)

    def hora_fila(f):
        if f["ts"] is not None:
            return f["ts"]
        if referencia is not None:
            return referencia["ts"] + timedelta(milliseconds=f["t_ms"] - referencia["t_ms"])
        return desfase_min + timedelta(milliseconds=f["t_ms"])

    return [hora_fila(f) for f in filas]


# ---------------------------------------------------------------------------
# Resumen de un recorrido
# ---------------------------------------------------------------------------

def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    fi1, fi2 = math.radians(lat1), math.radians(lat2)
    d_fi = fi2 - fi1
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_fi / 2) ** 2 + math.cos(fi1) * math.cos(fi2) * math.sin(d_lambda / 2) ** 2
    return 2 * RADIO_TIERRA_KM * math.asin(math.sqrt(a))


def _integrar(filas: list[dict], columna: str) -> tuple[float | None, list]:
    """Integral por trapecio de una columna en unidades/hora. Devuelve (total, tramos
    sin dato): total es None si ningún tramo sumó, porque 'no hay dato' no es lo
    mismo que 'consumió 0 L'. Los tramos con Δt > MAX_HUECO_S no suman."""
    total = None
    tramos_sin_dato = []
    for anterior, actual in zip(filas, filas[1:]):
        delta_s = (actual["t_ms"] - anterior["t_ms"]) / 1000
        if delta_s > MAX_HUECO_S:
            continue
        q1, q2 = anterior[columna], actual[columna]
        if q1 is None and q2 is None:
            tramos_sin_dato.append((anterior, actual))
        elif q1 is not None and q2 is not None:
            total = (total or 0.0) + (q1 + q2) / 2 * delta_s / 3600
    return total, tramos_sin_dato


def _distancia_km(filas: list[dict]) -> float | None:
    """Trapecio de vel. Si falta vel a ambos lados de un tramo, usa el GNSS."""
    distancia, tramos_sin_vel = _integrar(filas, "vel")
    for anterior, actual in tramos_sin_vel:
        if None in (anterior["lat"], anterior["lng"], actual["lat"], actual["lng"]):
            continue
        distancia = (distancia or 0.0) + _haversine_km(
            anterior["lat"], anterior["lng"], actual["lat"], actual["lng"]
        )
    return distancia


def velocidad_media_kmh(distancia_km, tiempo_s) -> float | None:
    if distancia_km is None or not tiempo_s or tiempo_s <= 0:
        return None
    return distancia_km / (tiempo_s / 3600)


def resumir(filas: list[dict]) -> dict:
    """Resume un recorrido. Las filas deben venir ordenadas por t_ms, seq y no estar
    vacías. Devuelve las columnas de la tabla recorridos que salen de los datos; el
    precio y el costo los agrega db.actualizar_recorrido con costo_en_pesos."""
    horas = horas_pc(filas)
    inicio, fin = min(horas), max(horas)
    duracion_s = (fin - inicio).total_seconds()

    litros_pid, _ = _integrar(filas, "fuel_lph")
    litros_ecuacion, _ = _integrar(filas, "fuel_lph_ecuacion")
    distancia_km = _distancia_km(filas)

    segundos_sin_datos = 0.0
    for anterior, actual in zip(filas, filas[1:]):
        delta_s = (actual["t_ms"] - anterior["t_ms"]) / 1000
        if delta_s > MAX_HUECO_S:
            segundos_sin_datos += delta_s

    viaje_util = (
        distancia_km is not None
        and duracion_s >= MIN_DURACION_UTIL_S
        and distancia_km >= MIN_DISTANCIA_UTIL_KM
    )
    return {
        "vid": VID_KIA,
        "recorrido_id": filas[0]["recorrido_id"],
        "inicio": inicio,
        "fin": fin,
        "filas": len(filas),
        "filas_con_gps": sum(1 for f in filas if f["lat"] is not None),
        "duracion_s": duracion_s,
        "segundos_sin_datos": segundos_sin_datos,
        "distancia_km": distancia_km,
        "vel_media_kmh": velocidad_media_kmh(distancia_km, duracion_s) if viaje_util else None,
        "litros_pid": litros_pid,
        "litros_ecuacion": litros_ecuacion,
    }


# ---------------------------------------------------------------------------
# Métricas de validación (modelo y ecuación frente al PID 0x5E)
# ---------------------------------------------------------------------------

def error_pct(estimado, real) -> float | None:
    """Error con signo en %: positivo si el estimado sobreestima el real."""
    if estimado is None or not real:
        return None
    return (estimado / real - 1) * 100


def metricas_litros(pares: list[tuple]) -> dict:
    """Métricas de una lista de (litros_real, litros_estimado, distancia_km):
    n, mape_pct, error_total_pct (Σ estimado / Σ real − 1), mae_litros y r2_l100km
    (R² de los L/100 km ponderado por la distancia). None en lo que no se puede
    calcular (sin pares, o R² con menos de 2 recorridos o sin varianza)."""
    pares = [(r, e, d) for r, e, d in pares if r and e is not None and d]
    n = len(pares)
    if n == 0:
        return {"n": 0, "mape_pct": None, "error_total_pct": None, "mae_litros": None, "r2_l100km": None}
    mape = sum(abs(e - r) / r for r, e, _ in pares) / n * 100
    total = (sum(e for _, e, _ in pares) / sum(r for r, _, _ in pares) - 1) * 100
    mae = sum(abs(e - r) for r, e, _ in pares) / n

    r2 = None
    if n >= 2:
        pesos = [d for _, _, d in pares]
        y = [r / d * 100 for r, _, d in pares]
        y_est = [e / d * 100 for _, e, d in pares]
        media = sum(w * v for w, v in zip(pesos, y)) / sum(pesos)
        total_cuadrados = sum(w * (v - media) ** 2 for w, v in zip(pesos, y))
        residuo = sum(w * (v - ve) ** 2 for w, v, ve in zip(pesos, y, y_est))
        if total_cuadrados > 0:
            r2 = 1 - residuo / total_cuadrados
    return {"n": n, "mape_pct": mape, "error_total_pct": total, "mae_litros": mae, "r2_l100km": r2}


# ---------------------------------------------------------------------------
# Relleno de lo que ya hay en la base
# ---------------------------------------------------------------------------

def rellenar() -> None:
    import db  # aquí y no arriba: el resto de este módulo no debe necesitar la base

    db.init_db_p3()
    print(f"[relleno] fuel_lph_ecuacion calculado en {db.rellenar_fuel_lph_ecuacion()} fila(s)")

    # Todos y no solo los pendientes: si el hilo del listener ya resumió un recorrido
    # antes de este relleno, su litros_ecuacion debe recalcularse con las filas nuevas.
    # En orden de llegada (recorridos_pendientes ordena por la última fila): el factor del
    # modelo de cada recorrido sale de los recorridos anteriores ya cerrados.
    pendientes = db.recorridos_pendientes(todos=True)
    con_modelo = 0
    for pendiente in pendientes:
        resumen = db.actualizar_recorrido(pendiente["recorrido_id"], cerrar=pendiente["cerrar"])
        if resumen and resumen.get("modelo"):
            con_modelo += 1
            print(f"[relleno] {pendiente['recorrido_id']}: {resumen['modelo']}, "
                  f"{resumen['litros_modelo']:.3f} L (factor {resumen['factor_modelo']:.3f}), "
                  f"PID {resumen['litros_pid'] or 0:.3f} L")
    cerrados = sum(1 for p in pendientes if p["cerrar"])
    print(f"[relleno] {len(pendientes)} recorrido(s) actualizados, {cerrados} cerrados, "
          f"{con_modelo} con modelo de ruta")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Herramientas de la tabla recorridos")
    parser.add_argument("--rellenar", action="store_true",
                        help="calcula fuel_lph_ecuacion y crea o actualiza todos los recorridos (con el modelo)")
    argumentos = parser.parse_args()
    if argumentos.rellenar:
        rellenar()
    else:
        parser.print_help()
