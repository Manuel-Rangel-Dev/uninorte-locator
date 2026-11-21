// =============================================================================
// UTILIDADES: COORDENADAS, TIEMPO Y FORMATEO
// =============================================================================
import { DECIMALES_COORDENADAS } from './constantes.js';

// Redondea coordenadas GPS para quitar ruido del sensor.
export function redondearCoord(coord, decimales = DECIMALES_COORDENADAS) {
    if (coord === null || coord === undefined || isNaN(Number(coord))) return coord;
    return Number(Number(coord).toFixed(decimales));
}

// Convierte fecha + hora de un punto a timestamp Unix.
export function obtenerTimestampPunto(punto) {
    if (!punto || !punto.fecha || !punto.hora) return null;
    const dt = new Date(`${punto.fecha.trim()}T${punto.hora.trim()}`);
    return isNaN(dt.getTime()) ? null : dt.getTime();
}

// Normaliza una fecha para comparar solo el día.
export function normalizarFecha(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Formatea fecha como "28 Sep 2026".
export function formatearFechaCorta(d) {
    if (!d) return '--';
    const nombresMes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${d.getDate()} ${nombresMes[d.getMonth()]} ${d.getFullYear()}`;
}

// Convierte Date a formato ISO YYYY-MM-DD.
export function formatearFechaISO(d) {
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

// Convierte Date a HH:MM:SS (hora local del Date recibido).
export function formatearHoraISO(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

// Formatea metros como "250 m" o "1.50 km".
export function formatearDistancia(metros) {
    if (metros < 1000) {
        return `${Math.round(metros)} m`;
    }
    return `${(metros / 1000).toFixed(2)} km`;
}

// Formatea radio como "300 M" o "1.5 KM".
export function formatearRadio(metros) {
    if (metros < 1000) {
        return `${Math.round(metros)} M`;
    }
    return `${(metros / 1000).toFixed(1)} KM`;
}

// Fecha de la API (YYYY-MM-DD HH:MM:SS) o fecha y hora de un punto GPS.
export function formatearFechaHoraRecorrido(fecha, hora) {
    if (!fecha) return '--';
    const [diaISO, horaAPI] = String(fecha).split(/[ T]/);
    const partes = diaISO.split('-');
    const fechaVisible = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : diaISO;
    return `${fechaVisible} · ${hora || horaAPI || '--'}`;
}

// Calcula la distancia de un punto a un segmento de línea.
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

// Escapa texto para insertarlo de forma segura dentro de HTML (innerHTML, popups de Leaflet).
export function escaparHtml(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Edad de la última señal, compartida por los paneles GPS y OBD.
export function textoEdad(segundos) {
    if (segundos < 90) return `hace ${Math.round(segundos)} s`;
    if (segundos < 5400) return `hace ${Math.round(segundos / 60)} min`;
    if (segundos < 172800) return `hace ${Math.round(segundos / 3600)} h`;
    return `hace ${Math.round(segundos / 86400)} días`;
}
