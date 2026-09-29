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

export function formatearRadio(metros) {
    if (metros < 1000) {
        return `${Math.round(metros)} M`;
    }
    return `${(metros / 1000).toFixed(1)} KM`;
}

export function formatearFechaHoraCard(fechaStr, horaStr) {
    if (!fechaStr) return '--';
    const partesFecha = fechaStr.split('-');
    let fechaFmt = fechaStr;
    if (partesFecha.length === 3) {
        const [yyyy, mm, dd] = partesFecha;
        const yy = yyyy.slice(-2);
        fechaFmt = `${dd}/${mm}/${yy}`;
    }
    const horaFmt = horaStr ? horaStr.slice(0, 5) : '';
    return horaFmt ? `${fechaFmt} - ${horaFmt}` : fechaFmt;
}

export function distanciaSegmentoAPunto(p1, p2, centro) {
    const latRad = (centro.lat * Math.PI) / 180;
    const mPorGradoLat = 111132.92;
    const mPorGradoLng = 111412.84 * Math.cos(latRad);

    const x1 = (p1.lng - centro.lng) * mPorGradoLng;
    const y1 = (p1.lat - centro.lat) * mPorGradoLat;
    const x2 = (p2.lng - centro.lng) * mPorGradoLng;
    const y2 = (p2.lat - centro.lat) * mPorGradoLat;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
        return Math.hypot(x1, y1);
    }

    let t = -(x1 * dx + y1 * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return Math.hypot(projX, projY);
}