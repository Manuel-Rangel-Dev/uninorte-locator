#!/usr/bin/env python3
"""Genera ambos recortes con la misma cuadrícula y formato de export_ec2_model.py.

Alternativa local porque el exportador externo está fuera del sandbox. Para integrarlo
allí: sustituir export_crop por generar_recortes(args.out, SRTM_DIR) e importar esta
función; añadir también "max_precision_m": 20 al JSON exportado del modelo.
No requiere numpy: copia las filas originales sin cambiar muestras ni endianidad.
"""
import argparse
import json
import mmap
from pathlib import Path

POR_GRADO = 3600
TAMANO_CELDA = POR_GRADO + 1
CARPETA_CELDAS = Path('/home/manuel/Documents/Diseño_códigos_pruebas/datos/srtm')
RECORTES = (
    ('barranquilla', 11.20, 10.70, -75.00, -74.60),
    ('ann_arbor', 42.36, 42.20, -83.86, -83.58),
)


def generar_recortes(salida: Path, carpeta_celdas: Path = CARPETA_CELDAS):
    """Conserva los nodos SRTM originales, incluidos los bordes compartidos."""
    import math
    salida.mkdir(parents=True, exist_ok=True)
    for nombre, norte, sur, oeste, este in RECORTES:
        fila_inicial, fila_final = round(norte * POR_GRADO), round(sur * POR_GRADO)
        columna_inicial, columna_final = round(oeste * POR_GRADO), round(este * POR_GRADO)
        columnas = columna_final - columna_inicial + 1
        celdas = {}
        try:
            with (salida / f'srtm_{nombre}.hgt').open('wb') as destino:
                for fila_global in range(fila_inicial, fila_final - 1, -1):
                    lat = fila_global / POR_GRADO
                    lat_sur, lon_oeste = math.floor(lat), math.floor(oeste)
                    nombre_celda = f'N{lat_sur:02d}W{abs(lon_oeste):03d}.hgt'
                    if nombre_celda not in celdas:
                        with (carpeta_celdas / nombre_celda).open('rb') as origen:
                            celdas[nombre_celda] = mmap.mmap(origen.fileno(), 0, access=mmap.ACCESS_READ)
                    fila = (lat_sur + 1) * POR_GRADO - fila_global
                    columna = columna_inicial - lon_oeste * POR_GRADO
                    inicio = (fila * TAMANO_CELDA + columna) * 2
                    destino.write(celdas[nombre_celda][inicio:inicio + columnas * 2])
            meta = {'lat_norte': fila_inicial / POR_GRADO,
                    'lon_oeste': columna_inicial / POR_GRADO,
                    'muestras_por_grado': POR_GRADO,
                    'filas': fila_inicial - fila_final + 1, 'columnas': columnas,
                    'formato': 'int16 big-endian, fila 0 = borde norte',
                    'fuente': 'SRTM 1" ' + ' + '.join(sorted(celdas)) + ' (elevation-tiles-prod/skadi)'}
            (salida / f'srtm_{nombre}.json').write_text(json.dumps(meta, indent=2) + '\n')
            print(nombre, meta['filas'], columnas, (salida / f'srtm_{nombre}.hgt').stat().st_size)
        finally:
            for celda in celdas.values():
                celda.close()


if __name__ == '__main__':
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[1] / 'modelo')
    argumentos.add_argument('--celdas', type=Path, default=CARPETA_CELDAS)
    opciones = argumentos.parse_args()
    generar_recortes(opciones.out, opciones.celdas)
