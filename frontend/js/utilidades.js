// =============================================================================
// UTILIDADES: COORDENADAS, TIEMPO Y FORMATEO
// =============================================================================
import { DECIMALES_COORDENADAS } from './constantes.js';

export function redondearCoord(coord, decimales = DECIMALES_COORDENADAS) {
    if (coord === null || coord === undefined || isNaN(Number(coord))) return coord;
    return Number(Number(coord).toFixed(decimales));
}

export function obtenerTimestampPunto(punto) {
    if (!punto || !punto.fecha || !punto.hora) return null;
    const dt = new Date(`${punto.fecha.trim()}T${punto.hora.trim()}`);
    return isNaN(dt.getTime()) ? null : dt.getTime();
}

export function normalizarFecha(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatearFechaCorta(d) {
    if (!d) return '--';
    const nombresMes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${d.getDate()} ${nombresMes[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatearFechaISO(d) {
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

export function formatearDistancia(metros) {
    if (metros < 1000) {
        return `${Math.round(metros)} m`;
    }
    return `${(metros / 1000).toFixed(2)} km`;
}