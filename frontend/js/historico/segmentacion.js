// =============================================================================
// HISTÓRICOS: SEGMENTACIÓN Y CÁLCULO DE DISTANCIA
// =============================================================================
import { UMBRAL_SEGMENTACION_MINUTOS, UMBRAL_SEGMENTACION_METROS } from '../constantes.js';
import { redondearCoord, obtenerTimestampPunto } from '../utilidades.js';

export function segmentarRecorridos(puntos) {
    if (!puntos || puntos.length === 0) return [];

    const puntosValidos = [];
    for (const p of puntos) {
        if (p.lat === null || p.lng === null || isNaN(Number(p.lat)) || isNaN(Number(p.lng))) continue;
        puntosValidos.push({
            lat: redondearCoord(p.lat),
            lng: redondearCoord(p.lng),
            fecha: p.fecha,
            hora: p.hora,
            timestamp: obtenerTimestampPunto(p)
        });
    }

    if (puntosValidos.length === 0) return [];

    const recorridos = [];
    let recorridoActual = [puntosValidos[0]];
    let primerTimestampEnPosicion = puntosValidos[0].timestamp;

    for (let i = 1; i < puntosValidos.length; i++) {
        const puntoAnterior = puntosValidos[i - 1];
        const puntoActual = puntosValidos[i];

        let cortaRecorrido = false;

        // Criterio 1: Tiempo entre datos consecutivos (>= 30 minutos)
        if (puntoAnterior.timestamp && puntoActual.timestamp) {
            const diffMinutos = (puntoActual.timestamp - puntoAnterior.timestamp) / (1000 * 60);
            if (diffMinutos >= UMBRAL_SEGMENTACION_MINUTOS) {
                cortaRecorrido = true;
            }
        }

        // Criterio 2: Distancia excesiva entre datos consecutivos (>= 2 km)
        if (!cortaRecorrido) {
            const distMetros = L.latLng(puntoAnterior.lat, puntoAnterior.lng)
                               .distanceTo(L.latLng(puntoActual.lat, puntoActual.lng));
            if (distMetros >= UMBRAL_SEGMENTACION_METROS) {
                cortaRecorrido = true;
            }
        }

        const esMismaPosicion = puntoAnterior.lat === puntoActual.lat && puntoAnterior.lng === puntoActual.lng;

        // Criterio 3: Estacionado en la misma posición por >= 30 minutos antes de reiniciar marcha
        if (!cortaRecorrido && !esMismaPosicion && primerTimestampEnPosicion && puntoActual.timestamp) {
            const minutosEstacionado = (puntoActual.timestamp - primerTimestampEnPosicion) / (1000 * 60);
            if (minutosEstacionado >= UMBRAL_SEGMENTACION_MINUTOS) {
                cortaRecorrido = true;
            }
        }

        if (cortaRecorrido) {
            if (recorridoActual.length > 0) {
                recorridos.push(recorridoActual);
            }
            recorridoActual = [puntoActual];
            primerTimestampEnPosicion = puntoActual.timestamp;
        } else {
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

    if (recorridoActual.length > 0) {
        recorridos.push(recorridoActual);
    }

    return recorridos;
}

export function calcularDistanciaRecorrido(recorrido) {
    if (!recorrido || recorrido.length < 2) {
        return 0;
    }

    let distanciaTotal = 0;

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