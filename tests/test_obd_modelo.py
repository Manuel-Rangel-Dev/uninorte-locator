"""Pruebas sin PostgreSQL: python3 -m unittest discover -s tests -v."""
import json
import mmap
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import modelo_ruta
from recorridos import es_emulado
from validacion import clasificar_paquete


class PruebasObd(unittest.TestCase):
    def test_precision_validada(self):
        for valor, esperado in [(0, 0.0), (5.25, 5.25), (10000, 10000.0),
                                (-1, None), (10000.1, None), (True, None),
                                ('basura', None), ('NaN', None), (None, None)]:
            with self.subTest(valor=valor):
                paquete = {'tipo': 'obd', 'rid': 'emu_20261109_140000_ab12',
                           'seq': 0, 't_ms': 0, 'acc': valor}
                tipo, limpio = clasificar_paquete(json.dumps(paquete).encode())
                self.assertEqual(tipo, 'obd')
                self.assertEqual(limpio['acc'], esperado)
                self.assertIsNone(limpio['sat'])

    def test_paquete_esp32_sin_precision(self):
        _, limpio = clasificar_paquete(b'{"tipo":"obd","rid":"kia_antiguo","seq":1,"t_ms":0,"sat":8}')
        self.assertIsNone(limpio['acc'])
        self.assertEqual(limpio['sat'], 8)

    def test_regla_emulados(self):
        for rid, esperado in [('emu_20261109_140000_ab12', True), ('kia_123', False),
                              ('EMU_123', False), ('xemu_123', False), ('', False)]:
            with self.subTest(rid=rid):
                self.assertEqual(es_emulado(rid), esperado)

    def test_fixes_satelites_precision_y_compatibilidad(self):
        for sats, acc, esperado in [(6, None, True), (5, None, False), (5, 5, False),
                                   (6, 100, True), (None, 20, True), (None, 20.1, False),
                                   (None, 0, True), (None, None, True)]:
            with self.subTest(sats=sats, acc=acc):
                self.assertEqual(modelo_ruta.fix_util({'sats': sats, 'acc': acc}, 6), esperado)

    def test_traza_usa_precision_por_defecto_y_configurada(self):
        modelo = {'min_fraccion_gnss': 0.5, 'min_satelites': 6}
        filas = [{'lat': 42.3, 'lng': -83.7, 'vel': 40, 'acc': 21},
                 {'lat': 42.31, 'lng': -83.71, 'vel': 40, 'acc': 20},
                 {'lat': 42.32, 'lng': -83.72, 'vel': 40}]
        with patch.object(modelo_ruta, 'cargar_modelo', return_value=modelo):
            self.assertEqual(len(modelo_ruta.traza_obd(filas)), 2)
            modelo['max_precision_m'] = 25
            self.assertEqual(len(modelo_ruta.traza_obd(filas)), 3)

    def test_seleccion_srtm_y_altitud(self):
        recortes = modelo_ruta.cargar_srtm()
        for lat, lon, norte in [(10.98, -74.8, 11.2), (42.28, -83.74, 42.36)]:
            with self.subTest(lat=lat):
                recorte = recortes.seleccionar(lat, lon)
                self.assertAlmostEqual(recorte.lat_norte, norte)
                self.assertIsInstance(recorte.datos, mmap.mmap)
                self.assertIsNotNone(recortes.altitud(lat, lon))
        self.assertIsNone(recortes.seleccionar(0, 0))
        self.assertIsNone(recortes.altitud(0, 0))
        self.assertIsNone(modelo_ruta.subida_bajada([(0, 0), (0.01, 0.01)]))

    def test_bordes_del_recorte_ann_arbor(self):
        recortes = modelo_ruta.cargar_srtm()
        for lat in (42.20, 42.36):
            for lon in (-83.86, -83.58):
                with self.subTest(lat=lat, lon=lon):
                    self.assertIsNotNone(recortes.seleccionar(lat, lon))
                    self.assertIsNotNone(recortes.altitud(lat, lon))
        self.assertIsNone(recortes.altitud(42.19, -83.7))

    def test_altitud_ann_arbor_conserva_muestra_original(self):
        # Nodo exacto en la cuadrícula; prueba endianidad e índice del recorte.
        recorte = modelo_ruta.cargar_srtm().seleccionar(42.3, -83.7)
        self.assertAlmostEqual(recorte.altitud(42.3, -83.7), 267.0)


if __name__ == '__main__':
    unittest.main()
