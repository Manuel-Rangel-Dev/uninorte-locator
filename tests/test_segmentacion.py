"""Segmentación y formato de recorridos sin importar Flask, db.py ni psycopg2."""

from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from filtros import filtrar_ruido
from segmentacion import (completar_rango, filtrar_vehiculo_2, memorizar_por_clave, preparar_segmentos,
                          recorrido_kia, recorrido_vehiculo_2, segmentar_recorridos)


class PruebasMemoriaConsultas(unittest.TestCase):
    def test_una_consulta_por_modelo_incluso_sin_factor(self):
        consulta = Mock(side_effect=[None, 1.05])
        obtener = memorizar_por_clave(consulta, lambda modelo: modelo)
        for _ in range(2):
            self.assertIsNone(obtener('base'))
        for _ in range(2):
            self.assertEqual(obtener('slope'), 1.05)
        self.assertEqual(consulta.call_args_list, [call('base'), call('slope')])

    def test_precio_por_dia_consulta_el_primer_inicio_completo(self):
        inicio = datetime(2026, 11, 15, 10, 23, 45, 123456)
        siguiente = inicio + timedelta(days=1)
        consulta = Mock(side_effect=[(1, 15964), (2, 16000)])
        obtener = memorizar_por_clave(consulta, lambda instante: instante.date())
        self.assertEqual(obtener(inicio), (1, 15964))
        self.assertEqual(obtener(inicio + timedelta(hours=3)), (1, 15964))
        self.assertEqual(obtener(siguiente), (2, 16000))
        self.assertEqual(obtener(siguiente + timedelta(hours=1)), (2, 16000))
        self.assertEqual(consulta.call_args_list, [call(inicio), call(siguiente)])

    def test_memoria_independiente_por_peticion(self):
        consulta = Mock(side_effect=[1.05, 1.06])
        primera = memorizar_por_clave(consulta, lambda modelo: modelo)
        segunda = memorizar_por_clave(consulta, lambda modelo: modelo)
        self.assertEqual(primera('slope'), 1.05)
        self.assertEqual(segunda('slope'), 1.06)
        self.assertEqual(primera('slope'), 1.05)
        self.assertEqual(consulta.call_count, 2)


class PruebasSegmentacion(unittest.TestCase):
    def setUp(self):
        self.inicio = datetime(2026, 11, 11, 13, 20, 11)

    def punto(self, minuto, lat=11.0, lng=-74.8):
        return {'lat': lat, 'lng': lng, 'ts': self.inicio + timedelta(minutes=minuto)}

    def test_continuo(self):
        registros = [self.punto(i, lat=11 + i * 0.001) for i in range(5)]
        self.assertEqual(segmentar_recorridos(registros), [registros])

    def test_hueco_exacto_y_menor(self):
        for minutos, cantidad in ((30, 2), (29, 1)):
            with self.subTest(minutos=minutos):
                self.assertEqual(len(segmentar_recorridos([self.punto(0), self.punto(minutos)])), cantidad)

    def test_salto(self):
        registros = [self.punto(0), self.punto(1, lat=11.02)]
        self.assertEqual(segmentar_recorridos(registros), [[registros[0]], [registros[1]]])

    def test_umbral_distancia_inclusivo(self):
        for distancia, cantidad in ((2000, 2), (1999.9, 1)):
            with self.subTest(distancia=distancia), patch('segmentacion.distancia_m', return_value=distancia):
                self.assertEqual(len(segmentar_recorridos([self.punto(0), self.punto(1)])), cantidad)

    def test_estacionado_con_jitter_corta_al_salir(self):
        registros = [self.punto(i * 10, lat=11 + (i % 2) * 0.0002) for i in range(4)]
        salida = self.punto(31, lat=11.001)
        self.assertEqual(segmentar_recorridos(registros + [salida]), [registros, [salida]])

    def test_estacionado_20_minutos_no_corta(self):
        registros = [self.punto(i * 10, lat=11 + (i % 2) * 0.0002) for i in range(3)]
        registros.append(self.punto(21, lat=11.001))
        self.assertEqual(segmentar_recorridos(registros), [registros])

    def test_ancla_se_reinicia_al_salir_y_al_cortar(self):
        registros = [self.punto(0), self.punto(20, lat=11.001),
                     self.punto(40, lat=11.0012), self.punto(50, lat=11.001),
                     self.punto(51, lat=11.002)]
        self.assertEqual(segmentar_recorridos(registros), [registros[:4], registros[4:]])

    def test_repetidos_conservan_horas_y_ancla_original(self):
        registros = [self.punto(i * 10) for i in range(4)] + [self.punto(31, lat=11.001)]
        copia = deepcopy(registros)
        segmentos = segmentar_recorridos(registros)
        self.assertEqual(segmentos, [registros[3:4], registros[4:]])
        self.assertEqual(registros, copia)
        for original, resultado in zip(registros[3:], sum(segmentos, [])):
            self.assertIs(original, resultado)

    def test_tres_repetidos_iniciales_redondeados_y_movimiento(self):
        registros = [self.punto(i, lat=11 + i * 0.00001, lng=-74.8 + i * 0.00001)
                     for i in range(3)]
        registros += [self.punto(3, lat=11.001), self.punto(4, lat=11.001),
                      self.punto(5, lat=11.002), self.punto(6, lat=11.002)]
        copia = deepcopy(registros)
        self.assertEqual(segmentar_recorridos(registros), [registros[2:]])
        self.assertEqual(registros, copia)

    def test_repetidos_iniciales_despues_de_corte(self):
        registros = [self.punto(0), self.punto(1, lat=11.001)]
        registros += [self.punto(i, lat=11.002) for i in (31, 32, 33)]
        registros.append(self.punto(34, lat=11.003))
        self.assertEqual(segmentar_recorridos(registros), [registros[:2], registros[4:]])

    def test_racha_unica_conserva_solo_el_ultimo_original(self):
        registros = [self.punto(i) for i in range(3)]
        segmentos = segmentar_recorridos(registros)
        self.assertEqual(segmentos, [[registros[-1]]])
        self.assertIs(segmentos[0][0], registros[-1])

    def test_invalidos_y_vacio(self):
        self.assertEqual(segmentar_recorridos([]), [])
        invalidos = [{**self.punto(1), campo: None} for campo in ('lat', 'lng', 'ts')]
        self.assertEqual(segmentar_recorridos(invalidos), [])
        valido = self.punto(0)
        self.assertEqual(segmentar_recorridos([valido] + invalidos), [[valido]])

    def test_redondea_solo_para_decidir(self):
        registros = [self.punto(0, lat=11.000049), self.punto(1, lat=11.000051)]
        with patch('segmentacion.distancia_m', return_value=0) as distancia:
            self.assertEqual(segmentar_recorridos(registros), [registros])
        self.assertEqual(distancia.call_args_list[0].args, (11.0, -74.8, 11.0001, -74.8))
        self.assertEqual(registros[0]['lat'], 11.000049)

    def test_redondeo_empate_como_to_fixed_del_navegador(self):
        registros = [self.punto(0, lat=11.03125, lng=-74.78125), self.punto(1)]
        with patch('segmentacion.distancia_m', return_value=0) as distancia:
            segmentar_recorridos(registros)
        self.assertEqual(distancia.call_args_list[0].args[:2], (11.0313, -74.7813))


class PruebasPrepararSegmentos(unittest.TestCase):
    def setUp(self):
        self.inicio = datetime(2026, 11, 4, 17, 50, 52)

    def punto(self, segundos, lat):
        return {'lat': lat, 'lng': -74.8, 'ts': self.inicio + timedelta(seconds=segundos)}

    def test_refiltra_salto_inicial_como_consumo_de_la_pagina(self):
        anteriores = [self.punto(-1900, 11.0), self.punto(-1890, 11.001)]
        recorrido = [self.punto(0, 11.0), self.punto(4, 11.0135),
                     self.punto(14, 11.014), self.punto(24, 11.015)]
        registros = anteriores + recorrido
        copia = deepcopy(registros)
        self.assertEqual(segmentar_recorridos(filtrar_ruido(registros))[-1], recorrido)
        preparados = preparar_segmentos(registros)
        self.assertEqual(preparados, [(anteriores, anteriores[-1]['ts'], False),
                                      (filtrar_ruido(recorrido), recorrido[-1]['ts'], True)])
        self.assertEqual(preparados[-1][0], recorrido[1:])
        self.assertEqual(preparados[-1][0][0]['ts'].strftime('%H:%M:%S'), '17:50:56')
        self.assertEqual(registros, copia)
        self.assertIs(preparados[-1][0][0], recorrido[1])

    def test_descarta_si_segundo_filtro_deja_menos_de_dos(self):
        anteriores = [self.punto(-1900, 11.0), self.punto(-1890, 11.001)]
        # Ambos saltos son imposibles: el ancla del segundo filtro queda en el último punto.
        recorrido = [self.punto(0, 11.0), self.punto(4, 11.0135), self.punto(8, 11.027)]
        self.assertEqual(segmentar_recorridos(filtrar_ruido(anteriores + recorrido))[-1], recorrido)
        self.assertEqual(preparar_segmentos(anteriores + recorrido),
                         [(anteriores, anteriores[-1]['ts'], False)])

    def test_conserva_ultimo_ts_del_segmento_antes_del_segundo_filtro(self):
        registros = [self.punto(0, 11.0), self.punto(10, 11.001), self.punto(20, 11.002)]
        with patch('segmentacion.filtrar_ruido', side_effect=[registros, registros[:-1]]):
            self.assertEqual(preparar_segmentos(registros),
                             [(registros[:-1], registros[-1]['ts'], True)])

    def test_vacio(self):
        self.assertEqual(preparar_segmentos([]), [])


class PruebasFiltroVehiculo2(unittest.TestCase):
    def test_incluye_null_y_celular_excluye_otros_sin_modificar(self):
        registros = [{'vid': vid} for vid in (None, 'celular', 'kia_k3', '', 'otro')]
        copia = deepcopy(registros)
        salida = filtrar_vehiculo_2(registros)
        self.assertEqual(salida, registros[:2])
        self.assertEqual(registros, copia)
        for original, resultado in zip(registros, salida):
            self.assertIs(original, resultado)

    def test_vacio(self):
        self.assertEqual(filtrar_vehiculo_2([]), [])


class PruebasFormatoRecorridos(unittest.TestCase):
    def setUp(self):
        self.ahora = datetime(2026, 11, 15, 10)
        self.semana = timedelta(days=7)

    def test_rango_por_defecto(self):
        self.assertEqual(completar_rango(None, None, self.ahora), (self.ahora - self.semana, self.ahora))

    def test_solo_desde(self):
        self.assertEqual(completar_rango(self.ahora, None, self.ahora), (self.ahora, self.ahora + self.semana))

    def test_solo_hasta(self):
        self.assertEqual(completar_rango(None, self.ahora, self.ahora), (self.ahora - self.semana, self.ahora))

    def test_tope_31_dias(self):
        desde = self.ahora - timedelta(days=31)
        self.assertEqual(completar_rango(desde, self.ahora, self.ahora), (desde, self.ahora))
        desde -= timedelta(microseconds=1)
        self.assertEqual(completar_rango(desde, self.ahora, self.ahora), (desde, self.ahora))
        with self.assertRaises(ValueError):
            completar_rango(self.ahora, desde, self.ahora)

    def test_tope_31_dias_con_hasta_al_final_del_dia(self):
        desde = datetime(2026, 10, 15)
        hasta = datetime(2026, 11, 15, 23, 59, 59, 999999)
        self.assertEqual(completar_rango(desde, hasta, self.ahora), (desde, hasta))

    def test_rechaza_32_dias_entre_fechas(self):
        with self.assertRaises(ValueError):
            completar_rango(datetime(2026, 10, 14), datetime(2026, 11, 15, 23, 59, 59, 999999),
                            self.ahora)

    def test_conversion_kia(self):
        fila = {'recorrido_id': 'emu_prueba', 'inicio': self.ahora - self.semana,
                'fin': self.ahora, 'duracion_s': 3600.0, 'distancia_km': 10.0,
                'vel_media_kmh': 10.0, 'litros_modelo': 0.8, 'costo_modelo_cop': 3400.0,
                'litros_pid': 0.75, 'costo_cop': 3200.0, 'modelo': 'slope/linear_physics',
                'factor_modelo': 1.05, 'cerrado': False}
        copia = deepcopy(fila)
        esperado = {'id': 'emu_prueba', 'inicio': '2026-11-08 10:00:00', 'fin': '2026-11-15 10:00:00',
                    'duracion_s': 3600.0, 'distancia_km': 10.0, 'vel_media_kmh': 10.0,
                    'litros': 0.8, 'costo_cop': 3400.0, 'litros_medidos': 0.75,
                    'costo_medido_cop': 3200.0, 'modelo': 'slope/linear_physics',
                    'factor': 1.05, 'en_curso': True, 'emulado': True}
        self.assertEqual(recorrido_kia(fila), esperado)
        self.assertEqual(fila, copia)
        fila.update(recorrido_id='kia_prueba', cerrado=True, litros_modelo=None, factor_modelo=None)
        salida = recorrido_kia(fila)
        self.assertFalse(salida['en_curso'])
        self.assertFalse(salida['emulado'])
        self.assertIsNone(salida['litros'])
        self.assertIsNone(salida['factor'])

    def test_conversion_vehiculo_2(self):
        estimado = {'inicio': '2026-11-15 09:30:11', 'fin': '2026-11-15 09:59:00',
                    'duracion_s': 1729.0, 'distancia_km': 6.21, 'vel_media_kmh': 12.93,
                    'litros': 0.561, 'costo_cop': 2366.0, 'modelo': 'slope/linear_physics',
                    'factor': 1.047, 'puntos': 20, 'subida_m_km': 3}
        copia = deepcopy(estimado)
        salida = recorrido_vehiculo_2(estimado, self.ahora - timedelta(minutes=1), self.ahora, True)
        esperado = {c: estimado[c] for c in ('inicio', 'fin', 'duracion_s', 'distancia_km',
                                            'vel_media_kmh', 'litros', 'costo_cop', 'modelo', 'factor')}
        esperado.update(id='v2_20261115_093011', litros_medidos=None, costo_medido_cop=None,
                        emulado=False, en_curso=True)
        self.assertEqual(salida, esperado)
        self.assertEqual(estimado, copia)
        for minutos, reciente in ((10, True), (11, True), (1, False)):
            with self.subTest(minutos=minutos, reciente=reciente):
                salida = recorrido_vehiculo_2(estimado, self.ahora - timedelta(minutes=minutos),
                                             self.ahora, reciente)
                self.assertFalse(salida['en_curso'])
        estimado.update(litros=None, costo_cop=None, modelo=None, factor=None)
        self.assertIsNone(recorrido_vehiculo_2(estimado, self.ahora, self.ahora, True)['litros'])


if __name__ == '__main__':
    unittest.main()
