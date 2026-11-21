"""Edad GPS y contrato de los endpoints, sin Flask ni PostgreSQL.

Carga por AST las funciones reales de api.py, como las pruebas de factor.
"""
import ast
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
import unittest


def funciones_api():
    ruta = Path(__file__).resolve().parents[1] / 'backend' / 'api.py'
    arbol = ast.parse(ruta.read_text())
    nombres = {'edad_registro', '_parsear_param_fecha_hora', 'registro_o_vacio',
               'ultimo_completo', 'solo_lat', 'solo_lng', 'solo_fecha', 'solo_hora'}
    funciones = [n for n in arbol.body if isinstance(n, ast.FunctionDef) and n.name in nombres]
    for funcion in funciones:
        funcion.decorator_list = []
    entorno = {'datetime': datetime, 'EDAD_EN_VIVO_S': 30, 'jsonify': lambda datos: datos,
               'request': SimpleNamespace(args={})}
    exec(compile(ast.Module(body=funciones, type_ignores=[]), str(ruta), 'exec'), entorno)
    return entorno


class PruebasEdadRegistro(unittest.TestCase):
    def setUp(self):
        self.api = funciones_api()
        self.ahora = datetime(2026, 11, 21, 13, 0, 0, 240000)
        self.registro = {'lat': 11.0195, 'lng': -74.8516, 'fecha': '2026-11-21',
                         'hora': '12:59:50', 'vid': 'celular'}
        self.api['ahora_colombia'] = lambda: self.ahora
        self.api['obtener_ultimo_registro'] = lambda vid: self.registro

    def edad(self, registro):
        return self.api['edad_registro'](registro, self.ahora)

    def test_ts_tiene_prioridad(self):
        self.registro['ts'] = self.ahora - timedelta(seconds=20.36)
        self.assertAlmostEqual(self.edad(self.registro), 20.36)
        self.assertEqual(self.api['ultimo_completo']()['edad_s'], 20.4)

    def test_sin_ts_usa_formato_listener(self):
        for ts in ({}, {'ts': None}):
            with self.subTest(ts=ts):
                self.assertAlmostEqual(self.edad({**self.registro, **ts}), 10.24)

    def test_sin_registro(self):
        self.assertIsNone(self.edad(None))
        self.registro = None
        self.assertEqual(self.api['ultimo_completo'](), {
            'lat': None, 'lng': None, 'fecha': None, 'hora': None, 'vid': None,
            'edad_s': None, 'en_vivo': False})

    def test_fecha_futura_no_da_edad_negativa(self):
        self.assertEqual(self.edad({'ts': self.ahora + timedelta(seconds=10)}), 0)
        self.assertEqual(self.edad({'fecha': '2026-11-22', 'hora': '13:00:00'}), 0)

    def test_fecha_invalida_no_tiene_edad(self):
        self.assertIsNone(self.edad({'fecha': 'invalida', 'hora': '13:00:00'}))

    def test_umbral_en_vivo_sin_redondear(self):
        for segundos, esperado in [(0, True), (30, True), (30.04, False), (90, False)]:
            with self.subTest(segundos=segundos):
                self.registro['ts'] = self.ahora - timedelta(seconds=segundos)
                self.assertEqual(self.api['ultimo_completo']()['en_vivo'], esperado)

    def test_endpoints_individuales_conservan_solo_su_campo(self):
        for campo in ('lat', 'lng', 'fecha', 'hora'):
            with self.subTest(campo=campo):
                self.assertEqual(self.api[f'solo_{campo}'](), {campo: self.registro[campo]})
                self.assertNotIn('edad_s', self.api['registro_o_vacio']())


if __name__ == '__main__':
    unittest.main()
