Cambios OBD Android y emulados
=============================

`generar_recortes_srtm.py` genera Barranquilla y Ann Arbor sin numpy, copiando
exactamente los nodos de las celdas originales. Ejecución desde el repositorio:

```sh
python3 backend/herramientas/generar_recortes_srtm.py
```

El exportador externo `2_modelo_ruta/export_ec2_model.py` no se modificó porque está
fuera de las rutas con permiso de escritura. Para integrarlo, copiar esta función
`generar_recortes` con sus constantes/imports al exportador y sustituir la llamada
`meta = export_crop(args.out)` y su impresión específica de Barranquilla por
`generar_recortes(args.out, SRTM_DIR)`. Añadir `"max_precision_m": 20` a `data`.
Así se exportan ambos recortes junto con los coeficientes. Las dimensiones nuevas
son 577 × 1009, int16 big-endian (1.164.386 bytes).

El factor del Kia se calcula exclusivamente con recorridos reales. Los emulados
se estiman con los mismos coeficientes y cilindrada de referencia del modelo
(1,6 L), pero con factor 1.0; no se supone que su vehículo sea el Kia. Se conservan
el PID de referencia, el estimado y los costos para compararlos.

Revisión/despliegue
------------------

El SQL nuevo está en `backend/sql/obd_android_emulados.sql`, con los nombres por
defecto. No se ejecutó contra ninguna base. `init_db_obd()` añade `acc`;
`init_db_p3()` añade/rellena `emulado` y actualiza ambas vistas. En el código el
relleno usa `es_emulado()`; el archivo SQL muestra su equivalente para revisión.

Tras revisar/aplicar el esquema y desplegar, ejecutar con el entorno del servidor:

```sh
python3 backend/recorridos.py --rellenar
```

Esto recalcula también los recorridos ya guardados: aplica la cobertura nueva de
Ann Arbor, elimina el factor del Kia de los emulados y corrige los factores/costos
reales históricos que pudieran haberse calculado incluyendo emulados. El listener
actualiza por sí solo los recorridos nuevos y los emulados que aún tengan factor
distinto de 1. No se ejecutó este relleno aquí porque requiere PostgreSQL.

Si `SRTM_RECORTE` está definido, conserva su significado anterior: selecciona un
solo recorte. Para descubrir ambos se debe dejar sin definir. Los archivos se
mapean en modo lectura (`mmap`) sin cargar copias completas en RAM.

Las etiquetas Emulado se muestran en las tarjetas históricas y en el panel en
vivo. El panel en vivo conserva su contenido de PID y ecuación; las comparaciones
del modelo y sus costos se muestran en las tarjetas históricas, igual que para
los recorridos reales.

Pruebas sin PostgreSQL:

```sh
python3 -m unittest discover -s tests -v
```

Las pruebas de factor cargan mediante AST las funciones reales de `db.py` y usan
un cursor falso. No validan la sintaxis ni el comportamiento de PostgreSQL. No
había pruebas existentes ni un cursor falso previo. Flask/psycopg2 no están
instalados en este entorno y la red impidió instalarlos; la API completa y la
apariencia del frontend no se comprobaron en ejecución.
