// =============================================================================
// HISTÓRICOS: SEGMENTACIÓN Y CÁLCULO DE DISTANCIA
// =============================================================================

// Importa los umbrales configurados para decidir cuándo separar un recorrido
import { UMBRAL_SEGMENTACION_MINUTOS, UMBRAL_SEGMENTACION_METROS } from '../constantes.js';
// Importa utilidades para normalizar coordenadas y convertir fechas a timestamp
import { redondearCoord, obtenerTimestampPunto } from '../utilidades.js';

// Divide la lista de puntos en recorridos separados según tiempo, distancia y estacionamiento
export function segmentarRecorridos(puntos) {
    // Si no llega ninguna data, devuelve una lista vacía
    if (!puntos || puntos.length === 0) return [];

    // Filtra puntos inválidos antes de procesarlos
    const puntosValidos = [];
    for (const p of puntos) {
        // Ignora puntos sin latitud o longitud o con valores no numéricos
        if (p.lat === null || p.lng === null || isNaN(Number(p.lat)) || isNaN(Number(p.lng))) continue;

        // Guarda una versión limpia del punto para comparar y calcular separaciones
        puntosValidos.push({
            lat: redondearCoord(p.lat),
            lng: redondearCoord(p.lng),
            fecha: p.fecha,
            hora: p.hora,
            timestamp: obtenerTimestampPunto(p)
        });
    }

    // Si después del filtro no queda nada, no hay recorridos
    if (puntosValidos.length === 0) return [];

    // Arreglo final con los recorridos ya separados
    const recorridos = [];
    // Recorrido que se está armando en este momento
    let recorridoActual = [puntosValidos[0]];
    // Primer timestamp del tramo actual para detectar si el vehículo estuvo detenido
    let primerTimestampEnPosicion = puntosValidos[0].timestamp;

    // Recorre los puntos desde el segundo en adelante
    for (let i = 1; i < puntosValidos.length; i++) {
        const puntoAnterior = puntosValidos[i - 1];
        const puntoActual = puntosValidos[i];

        // Por defecto, no se corta el recorrido
        let cortaRecorrido = false;

        // Criterio 1: si hay más de 30 minutos entre dos puntos consecutivos, se considera un corte
        if (puntoAnterior.timestamp && puntoActual.timestamp) {
            const diffMinutos = (puntoActual.timestamp - puntoAnterior.timestamp) / (1000 * 60);
            if (diffMinutos >= UMBRAL_SEGMENTACION_MINUTOS) {
                cortaRecorrido = true;
            }
        }

        // Criterio 2: si la distancia entre dos puntos supera el límite, también se corta
        if (!cortaRecorrido) {
            const distMetros = L.latLng(puntoAnterior.lat, puntoAnterior.lng)
                               .distanceTo(L.latLng(puntoActual.lat, puntoActual.lng));
            if (distMetros >= UMBRAL_SEGMENTACION_METROS) {
                cortaRecorrido = true;
            }
        }

        // Se compara si la posición cambió o si el punto quedó igual
        const esMismaPosicion = puntoAnterior.lat === puntoActual.lat && puntoAnterior.lng === puntoActual.lng;

        // Criterio 3: si el vehículo estuvo parado en una posición por más de 30 minutos, se considera fin de recorrido
        if (!cortaRecorrido && !esMismaPosicion && primerTimestampEnPosicion && puntoActual.timestamp) {
            const minutosEstacionado = (puntoActual.timestamp - primerTimestampEnPosicion) / (1000 * 60);
            if (minutosEstacionado >= UMBRAL_SEGMENTACION_MINUTOS) {
                cortaRecorrido = true;
            }
        }

        // Si se cumple algún criterio de corte, guarda el recorrido actual y empieza uno nuevo
        if (cortaRecorrido) {
            if (recorridoActual.length > 0) {
                recorridos.push(recorridoActual);
            }
            recorridoActual = [puntoActual];
            primerTimestampEnPosicion = puntoActual.timestamp;
        } else {
            // Si el punto no cambió de posición, se actualiza la información del último punto del recorrido
            if (!esMismaPosicion) {
                recorridoActual.push(puntoActual);
                primerTimestampEnPosicion = puntoActual.timestamp;
            } else {
                const ultimoEnRecorrido = recorridoActual[recorridoActual.length - 1];
                ultimoEnRecorrido.fecha = puntoActual.fecha;
                ultimoEnRecorrido.hora = puntoActual.hora;
                ultimoEnRecorrido.timestamp = puntoActual.timestamp;
            }
        }
    }

    // Guarda el último recorrido si quedó incompleto al final
    if (recorridoActual.length > 0) {
        recorridos.push(recorridoActual);
    }

    return recorridos;
}

// Calcula la distancia total recorrida dentro de un tramo específico
export function calcularDistanciaRecorrido(recorrido) {
    // Si no hay recorrido o tiene menos de dos puntos, la distancia es cero
    if (!recorrido || recorrido.length < 2) {
        return 0;
    }

    let distanciaTotal = 0;

    // Recorre cada par de puntos consecutivos y suma la distancia entre ellos
    for (let i = 1; i < recorrido.length; i++) {
        const puntoAnterior = recorrido[i - 1];
        const puntoActual = recorrido[i];

        const distancia = L.latLng(
            puntoAnterior.lat,
            puntoAnterior.lng
        ).distanceTo(
            L.latLng(
                puntoActual.lat,
                puntoActual.lng
            )
        );

        distanciaTotal += distancia;
    }

    return distanciaTotal;
}
