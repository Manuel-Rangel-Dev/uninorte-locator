-- SQL para revisión; NO ejecutado. Nombres de tablas por defecto.
-- Adaptar a DB_TABLE_OBD / DB_TABLE_RECORRIDOS si se han configurado otros.
BEGIN;
ALTER TABLE telemetria_obd ADD COLUMN IF NOT EXISTS acc REAL;
ALTER TABLE recorridos ADD COLUMN IF NOT EXISTS emulado BOOLEAN NOT NULL DEFAULT FALSE;

-- Equivalente SQL del relleno que db.py hace con es_emulado() y parámetros.
UPDATE recorridos
SET emulado = (LEFT(COALESCE(recorrido_id, ''), 4) = 'emu_')
WHERE emulado IS DISTINCT FROM (LEFT(COALESCE(recorrido_id, ''), 4) = 'emu_');

CREATE OR REPLACE VIEW v_factor_correccion AS
SELECT vid,
       COUNT(*) AS recorridos,
       SUM(litros_pid) / NULLIF(SUM(litros_modelo), 0) AS factor,
       AVG((litros_modelo - litros_pid) / NULLIF(litros_pid, 0)) * 100 AS error_medio_pct
FROM recorridos
WHERE NOT emulado AND cerrado AND litros_pid IS NOT NULL AND litros_modelo IS NOT NULL
GROUP BY vid;

CREATE OR REPLACE VIEW v_factor_modelo AS
SELECT vid,
       modelo,
       COUNT(*) AS recorridos,
       SUM(litros_pid) / NULLIF(SUM(litros_modelo_sin_factor), 0) AS factor,
       AVG((litros_modelo_sin_factor - litros_pid) / NULLIF(litros_pid, 0)) * 100
           AS error_sin_factor_pct,
       AVG((litros_modelo - litros_pid) / NULLIF(litros_pid, 0)) * 100 AS error_con_factor_pct
FROM recorridos
WHERE NOT emulado AND cerrado AND litros_pid IS NOT NULL AND litros_modelo_sin_factor IS NOT NULL
GROUP BY vid, modelo;

COMMIT;

-- La consulta del factor previo (también usada por factor_modelo_actual) añade:
-- AND NOT emulado
-- Los INSERT/UPSERT de recorridos incluyen emulado, calculado con es_emulado().
-- No se cambian litros/costos por SQL: se recalculan con recorridos.py --rellenar.
