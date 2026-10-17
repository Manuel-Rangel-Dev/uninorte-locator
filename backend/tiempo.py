"""
Utilidades de tiempo. La telemetría que envía la app (campos `date` y `hour`)
está en hora de Colombia (UTC-5, sin horario de verano). El servidor EC2 corre
en UTC, así que NUNCA usar datetime.now() directamente para comparar con esos
datos: usar ahora_colombia().
"""

from datetime import datetime, timedelta, timezone

ZONA_COLOMBIA = timezone(timedelta(hours=-5))


def ahora_colombia() -> datetime:
    """Hora actual de Colombia como datetime 'naive' (sin tzinfo), para poder
    compararla con los timestamps de la tabla (columna ts, también naive)."""
    return datetime.now(ZONA_COLOMBIA).replace(tzinfo=None)
