import { ESCALA_LPH, COLOR_SIN_CONSUMO, UMBRAL_HUECO_SEGUNDOS } from './constantes.js';

const formatear = valor => valor.toLocaleString('es-CO', { maximumFractionDigits: 20 });

export function textosRangos(escala) {
    return escala.map(({ hasta }, indice) => {
        if (hasta === Infinity) return `≥ ${formatear(escala[indice - 1].hasta)}`;
        if (indice === 0) return `< ${formatear(hasta)}`;
        return `${formatear(escala[indice - 1].hasta)} – ${formatear(hasta)}`;
    });
}

function crearFila(texto, color, hueco = false) {
    const fila = document.createElement('div');
    fila.className = 'filaLeyendaConsumo';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '8');
    svg.setAttribute('viewBox', '0 0 28 8');
    svg.setAttribute('aria-hidden', 'true');
    const linea = document.createElementNS(svg.namespaceURI, 'line');
    Object.entries({ x1: 3, y1: 4, x2: 25, y2: 4, stroke: color,
        'stroke-width': hueco ? 3 : 6, 'stroke-opacity': hueco ? 0.6 : 0.95,
        'stroke-linecap': 'round', ...(hueco ? { 'stroke-dasharray': '6,10' } : {})
    }).forEach(([nombre, valor]) => linea.setAttribute(nombre, valor));
    svg.append(linea);
    const etiqueta = document.createElement('span');
    etiqueta.textContent = texto;
    fila.append(svg, etiqueta);
    return fila;
}

export function initLeyendaConsumo() {
    const tarjeta = document.getElementById('leyendaConsumo');
    const boton = document.getElementById('btnLeyendaConsumo');
    const movil = window.matchMedia('(max-width: 600px)');
    const titulo = document.createElement('h2');
    titulo.textContent = 'Consumo (L/h)';
    const textos = textosRangos(ESCALA_LPH);
    tarjeta.replaceChildren(titulo,
        ...ESCALA_LPH.map(({ color }, indice) => crearFila(textos[indice], color)),
        crearFila('Sin dato', COLOR_SIN_CONSUMO),
        crearFila(`Sin datos por más de ${formatear(UMBRAL_HUECO_SEGUNDOS)} s`, COLOR_SIN_CONSUMO, true));

    let eleccion = null;
    try {
        const guardada = localStorage.getItem('leyendaConsumoAbierta');
        if (guardada === 'true' || guardada === 'false') eleccion = guardada === 'true';
    } catch { /* Sin almacenamiento se usa el estado inicial según la pantalla. */ }

    // Reserva únicamente el espacio que realmente ocupan las tarjetas inferiores.
    // ResizeObserver cubre los datos que llegan después y los dos reproductores.
    function ajustarEspacio() {
        if (!movil.matches || tarjeta.hidden) return;
        let base = 76;
        for (const selector of ['#panelInfo', '#reproductorHistorico', '#reproductorKia']) {
            const elemento = document.querySelector(selector);
            const estilo = getComputedStyle(elemento);
            const rect = elemento.getBoundingClientRect();
            if (estilo.visibility === 'hidden' || estilo.display === 'none' || Number(estilo.opacity) === 0) continue;
            if (selector !== '#panelInfo' && !elemento.matches('.flotante.visible')) continue;
            base = Math.max(base, window.innerHeight - rect.top + 8);
        }
        document.body.style.setProperty('--leyenda-base', `${base}px`);
        document.body.style.setProperty('--leyenda-reserva', `${base + tarjeta.getBoundingClientRect().height + 8}px`);
    }

    function actualizar() {
        const abierta = eleccion ?? !movil.matches;
        tarjeta.hidden = !abierta;
        boton.setAttribute('aria-expanded', String(abierta));
        boton.title = abierta ? 'Ocultar leyenda de consumo' : 'Mostrar leyenda de consumo';
        document.body.classList.toggle('leyendaConsumoAbierta', abierta);
        ajustarEspacio();
    }

    boton.addEventListener('click', () => {
        eleccion = tarjeta.hidden;
        try {
            localStorage.setItem('leyendaConsumoAbierta', String(eleccion));
        } catch { eleccion = null; }
        actualizar();
    });
    movil.addEventListener('change', actualizar);
    window.addEventListener('resize', ajustarEspacio);
    const observador = new ResizeObserver(ajustarEspacio);
    for (const id of ['panelInfo', 'reproductorHistorico', 'reproductorKia', 'leyendaConsumo']) {
        observador.observe(document.getElementById(id));
    }
    // Clases de pestaña/modo/visibilidad también cambian el espacio disponible.
    const cambios = new MutationObserver(ajustarEspacio);
    cambios.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
    document.body.addEventListener('transitionend', ajustarEspacio);
    actualizar();
}
