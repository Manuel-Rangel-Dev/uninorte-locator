// =============================================================================
// HISTÓRICOS DE LA APP: CONSUMO ESTIMADO POR EL MODELO (P3-S3)
// Cada recorrido segmentado en el navegador se manda a /api/historico/consumo con su
// primer y último punto. El backend toma los mismos puntos de /api/historico y estima los
// litros y el costo como si fuera el Kia. Las consultas van en cola (MAX_CONSULTAS_CONSUMO
// a la vez) y se guardan en caché por rango, así volver a pintar la lista no repite nada.
// =============================================================================
import { API_BASE, MAX_CONSULTAS_CONSUMO } from '../constantes.js';
import { escaparHtml } from '../utilidades.js';
import { formatearLitros, formatearPesos } from '../kia/colores-consumo.js';

const cache = new Map();     // "desde|hasta" -> Promise<datos | null>
const cola = [];
let enCurso = 0;

function rangoDe(recorrido) {
    const inicio = recorrido[0];
    const fin = recorrido[recorrido.length - 1];
    if (!inicio || !fin || !inicio.fecha || !inicio.hora || !fin.fecha || !fin.hora) return null;
    return { desde: `${inicio.fecha} ${inicio.hora}`, hasta: `${fin.fecha} ${fin.hora}` };
}

function siguienteEnCola() {
    while (enCurso < MAX_CONSULTAS_CONSUMO && cola.length > 0) {
        const { url, resolver } = cola.shift();
        enCurso++;
        fetch(url)
            .then(respuesta => (respuesta.ok ? respuesta.json() : null))
            .catch(() => null)
            .then(datos => {
                enCurso--;
                resolver(datos);
                siguienteEnCola();
            });
    }
}

// Promesa con la respuesta de /api/historico/consumo para el recorrido, o null si falló.
export function pedirConsumo(recorrido) {
    const rango = rangoDe(recorrido);
    if (!rango) return Promise.resolve(null);
    const clave = `${rango.desde}|${rango.hasta}`;
    if (!cache.has(clave)) {
        const url = `${API_BASE}/api/historico/consumo?desde=${encodeURIComponent(rango.desde)}`
            + `&hasta=${encodeURIComponent(rango.hasta)}`;
        const promesa = new Promise(resolver => cola.push({ url, resolver }));
        // Si falló, se borra de la caché para reintentar al volver a pintar la lista.
        promesa.then(datos => { if (datos === null) cache.delete(clave); });
        cache.set(clave, promesa);
        siguienteEnCola();
    }
    return cache.get(clave);
}

// Texto corto del estimado: "≈ 0,548 L · $2.310 (modelo)".
export function textoConsumo(datos) {
    if (!datos) return 'Consumo estimado no disponible';
    if (datos.litros === null || datos.litros === undefined) return 'Sin estimado (recorrido muy corto o lento)';
    return `≈ ${formatearLitros(datos.litros)} · ${formatearPesos(datos.costo_cop)} (modelo)`;
}

// Línea de consumo en la tarjeta de un recorrido. Se llena cuando llega la respuesta.
export function pintarConsumoEnTarjeta(elemento, recorrido) {
    const linea = elemento.querySelector('.consumoRecorrido');
    if (!linea) return;
    linea.textContent = 'Calculando consumo…';
    pedirConsumo(recorrido).then(datos => {
        linea.textContent = textoConsumo(datos);
        linea.classList.toggle('sinEstimado', !datos || datos.litros === null || datos.litros === undefined);
        if (datos && datos.modelo) linea.title = `Modelo ${datos.modelo}, factor ${datos.factor?.toFixed(3) ?? '--'}`;
    });
}

// Agrega el estimado al popup del marcador de fin (textoBase ya es el texto actual, sin HTML).
export function agregarConsumoAPopup(marcador, recorrido, textoBase) {
    pedirConsumo(recorrido).then(datos => {
        marcador.setPopupContent(`${escaparHtml(textoBase)}<br>${escaparHtml(textoConsumo(datos))}`);
    });
}
