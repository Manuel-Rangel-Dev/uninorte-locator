"""Ejercita funciones reales de db.py con cursor falso, sin importar sus dependencias.

Se cargan solo las funciones necesarias mediante AST: no se abre una conexión ni se
requieren credenciales, Flask o psycopg2. Esto no valida el SQL en PostgreSQL.
"""
import ast
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import modelo_ruta
from recorridos import costo_en_pesos, es_emulado


class CursorFalso:
    def __init__(self, resultado=(3, 9.0, 6.0)):
        self.consultas = []
        self.resultado = resultado

    def execute(self, consulta, parametros=None):
        self.consultas.append((consulta, parametros))

    def fetchone(self):
        return self.resultado


def funciones_db():
    ruta = Path(__file__).resolve().parents[1] / 'backend' / 'db.py'
    arbol = ast.parse(ruta.read_text())
    nombres = {'_factor_previo', '_columnas_modelo', '_crear_vista_factor', '_crear_vista_factor_modelo'}
    funciones = ast.Module(body=[n for n in arbol.body if isinstance(n, ast.FunctionDef)
                                and n.name in nombres], type_ignores=[])
    entorno = {'sql': SimpleNamespace(SQL=str, Identifier=str), 'modelo_ruta': modelo_ruta,
               'datetime': datetime, 'VID_KIA': 'kia_k3', 'DB_TABLE_RECORRIDOS': 'recorridos',
               'VISTA_FACTOR_CORRECCION': 'v_factor_correccion', 'VISTA_FACTOR_MODELO': 'v_factor_modelo',
               'es_emulado': es_emulado, 'costo_en_pesos': costo_en_pesos}
    exec(compile(funciones, str(ruta), 'exec'), entorno)
    return entorno


class PruebasFactor(unittest.TestCase):
    def setUp(self):
        self.funciones = funciones_db()

    def test_emulado_no_consulta_factor_kia(self):
        cursor = CursorFalso()
        resumen = {'recorrido_id': 'emu_prueba', 'distancia_km': 10.0, 'duracion_s': 1200,
                   'inicio': datetime(2026, 11, 9)}
        with patch.object(modelo_ruta, 'pendiente_por_km', return_value={'subida_m_km': 5, 'bajada_m_km': 4}):
            columnas = self.funciones['_columnas_modelo'](cursor, [], resumen, 15964)
        self.assertEqual(columnas['factor_modelo'], 1.0)
        self.assertEqual(columnas['litros_modelo'], columnas['litros_modelo_sin_factor'])
        self.assertGreater(columnas['costo_modelo_cop'], 0)
        self.assertEqual(cursor.consultas, [])

    def test_real_usa_factor_previo_y_excluye_emulados(self):
        cursor = CursorFalso()
        resumen = {'recorrido_id': 'kia_prueba', 'distancia_km': 10.0, 'duracion_s': 1200,
                   'inicio': datetime(2026, 11, 9)}
        with patch.object(modelo_ruta, 'pendiente_por_km', return_value={'subida_m_km': 5, 'bajada_m_km': 4}):
            columnas = self.funciones['_columnas_modelo'](cursor, [], resumen, 15964)
        self.assertEqual(columnas['factor_modelo'], 1.5)
        self.assertAlmostEqual(columnas['litros_modelo'], columnas['litros_modelo_sin_factor'] * 1.5)
        self.assertIn('NOT emulado', cursor.consultas[0][0])

    def test_vistas_excluyen_emulados(self):
        cursor = CursorFalso()
        for nombre in ('_crear_vista_factor', '_crear_vista_factor_modelo'):
            self.funciones[nombre](cursor)
        self.assertTrue(all('WHERE NOT emulado AND cerrado' in consulta for consulta, _ in cursor.consultas))
