// =============================================================================
// KIA: COLORES POR CONSUMO Y FORMATO DE LITROS Y PESOS (P3-S3)
// Lo comparten la vista en vivo (kia-vivo.js) y el histórico del Kia (kia-historico.js).
// =============================================================================
import { ESCALA_LPH, COLOR_SIN_CONSUMO, UMBRAL_HUECO_SEGUNDOS } from '../constantes.js';

// L/h de un punto: el PID 0x5E (referencia) o, si falta, la ecuación.
export function lphDePunto(punto) {
    if (punto.lph_pid !== null && punto.lph_pid !== undefined) return Number(punto.lph_pid);
    if (punto.lph_ecuacion !== null && punto.lph_ecuacion !== undefined) return Number(punto.lph_ecuacion);
    return null;
}

// Color de la escala para un L/h; gris si no hay dato.
export function colorLph(lph) {
    if (lph === null || !Number.isFinite(lph)) return COLOR_SIN_CONSUMO;
    return ESCALA_LPH.find(rango => lph < rango.hasta).color;
}

// Instante (ms) de una hora 'YYYY-MM-DD HH:MM:SS' de la API, o null.
export function instanteDeHora(hora) {
    if (!hora) return null;
    const valor = new Date(String(hora).replace(' ', 'T')).getTime();
    return Number.isFinite(valor) ? valor : null;
}

// Tramo entre dos puntos: coloreado por el L/h del primero; punteado y gris si hay hueco.
export function crearTramoConsumo(previo, actual) {
    const t1 = instanteDeHora(previo.hora);
    const t2 = instanteDeHora(actual.hora);
    const hueco = t1 !== null && t2 !== null && (t2 - t1) / 1000 > UMBRAL_HUECO_SEGUNDOS;
    const estilo = hueco
        ? { color: COLOR_SIN_CONSUMO, weight: 3, opacity: 0.6, dashArray: '6,10' }
        : { color: colorLph(lphDePunto(previo)), weight: 6, opacity: 0.95 };
    return L.polyline([[previo.lat, previo.lng], [actual.lat, actual.lng]], estilo);
}

// Traza completa coloreada por consumo. Une los tramos seguidos del mismo color en una sola
// polilínea para no crear cientos de capas.
export function crearTrazaConsumo(puntos) {
    const grupo = L.featureGroup();
    if (!puntos || puntos.length < 2) return grupo;

    let tramo = [[puntos[0].lat, puntos[0].lng]];
    let estiloTramo = null;
    for (let i = 1; i < puntos.length; i++) {
        const capa = crearTramoConsumo(puntos[i - 1], puntos[i]);
        const estilo = capa.options;
        const mismoEstilo = estiloTramo && estilo.color === estiloTramo.color
            && estilo.dashArray === estiloTramo.dashArray;
        if (estiloTramo && !mismoEstilo) {
            grupo.addLayer(L.polyline(tramo, estiloTramo));
            tramo = [[puntos[i - 1].lat, puntos[i - 1].lng]];
        }
        estiloTramo = { color: estilo.color, weight: estilo.weight, opacity: estilo.opacity, dashArray: estilo.dashArray };
        tramo.push([puntos[i].lat, puntos[i].lng]);
    }
    grupo.addLayer(L.polyline(tramo, estiloTramo));
    return grupo;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
const FORMATO_PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function formatearLitros(litros, decimales = 3) {
    return (litros === null || litros === undefined) ? '--' : `${Number(litros).toFixed(decimales).replace('.', ',')} L`;
}

export function formatearPesos(pesos) {
    return (pesos === null || pesos === undefined) ? '--' : `$${FORMATO_PESOS.format(pesos)}`;
}

export function formatearNumero(valor, decimales = 1, sufijo = '') {
    return (valor === null || valor === undefined) ? '--' : `${Number(valor).toFixed(decimales).replace('.', ',')}${sufijo}`;
}

// Error con signo: "+2,1 %" o "−1,5 %".
export function formatearError(pct) {
    if (pct === null || pct === undefined) return '';
    const signo = pct > 0 ? '+' : (pct < 0 ? '−' : '');
    return `${signo}${Math.abs(pct).toFixed(1).replace('.', ',')} %`;
}

export function formatearDuracion(segundos) {
    if (segundos === null || segundos === undefined) return '--';
    const minutos = Math.round(segundos / 60);
    if (minutos < 60) return `${minutos} min`;
    return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
}
