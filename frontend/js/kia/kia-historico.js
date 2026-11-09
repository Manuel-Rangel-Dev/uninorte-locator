// =============================================================================
// KIA EN EL HISTÓRICO: PESTAÑA, MÉTRICAS DEL MODELO, LISTA, TRAZA Y REPRODUCTOR (P3-S3)
// La pestaña "Kia K3" del panel de históricos muestra las métricas de /api/kia/metricas y
// los recorridos de /api/kia/recorridos con lo medido (PID) frente al modelo y la ecuación.
// La pestaña "App" es la de siempre: este módulo solo la oculta con una clase en el panel,
// sin tocar su estado (rango, zona, rutas dibujadas ni reproductor).
// =============================================================================
import { API_BASE } from '../constantes.js';
import { estado } from '../estado.js';
import { distanciaSegmentoAPunto, escaparHtml } from '../utilidades.js';
import { crearIconoInicio, crearIconoFin } from '../historico/lista-slidebar.js';
import { crearIconoKia } from './kia-vivo.js';
import {
    colorLph,
    crearTrazaConsumo,
    formatearDuracion,
    formatearError,
    formatearLitros,
    formatearNumero,
    formatearPesos,
    lphDePunto
} from './colores-consumo.js';

function mostrarEstadoKia(mensaje, color = '#B3B3B3') {
    const elemento = document.getElementById('estadoKia');
    if (!elemento) return;
    elemento.textContent = mensaje;
    elemento.style.color = color;
}

async function pedirJson(ruta) {
    const respuesta = await fetch(`${API_BASE}${ruta}`);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    return respuesta.json();
}

// -----------------------------------------------------------------------------
// Capas del mapa
// -----------------------------------------------------------------------------

// Oculta (o vuelve a mostrar) las rutas de la app dibujadas en el mapa mientras se ve la
// pestaña Kia. Solo quita y pone las capas: estado.lineasHistoricas y la selección no cambian.
function mostrarCapasApp(visibles) {
    const capas = estado.lineasHistoricas
        .flatMap(entrada => [entrada.linea, entrada.marcadorInicio, entrada.marcadorFin]);
    if (estado.marcadorReproduccion) capas.push(estado.marcadorReproduccion);
    capas.forEach(capa => {
        if (!capa) return;
        if (visibles && !estado.mapa.hasLayer(capa)) capa.addTo(estado.mapa);
        if (!visibles && estado.mapa.hasLayer(capa)) estado.mapa.removeLayer(capa);
    });
}
// -----------------------------------------------------------------------------
// Reproductor del Kia: slider, play/pausa, reinicio y velocidad, como el de la app.
// Un marcador con el icono del Kia recorre los puntos y se muestra la hora, la
// velocidad y el L/h de cada uno. Es independiente del reproductor de la app.
// -----------------------------------------------------------------------------
const reproduccionKia = { puntos: [], indice: 0, timer: null, marcador: null, numero: null };

function elementoReproductor() {
    return document.getElementById('reproductorKia');
}

function detenerReproduccionKia() {
    if (reproduccionKia.timer) clearInterval(reproduccionKia.timer);
    reproduccionKia.timer = null;
    const boton = document.getElementById('btnPlayKia');
    if (boton) boton.textContent = '▶';
}

function mostrarPuntoKia(indice) {
    const puntos = reproduccionKia.puntos;
    if (puntos.length === 0) return;
    indice = Math.max(0, Math.min(indice, puntos.length - 1));
    reproduccionKia.indice = indice;
    const punto = puntos[indice];
    if (reproduccionKia.marcador) reproduccionKia.marcador.setLatLng([punto.lat, punto.lng]);

    const slider = document.getElementById('sliderKia');
    if (slider) slider.value = indice;
    const fechaHora = document.getElementById('fechaHoraKiaReproduccion');
    if (fechaHora) fechaHora.textContent = punto.hora || '--';
    const datos = document.getElementById('datosKiaReproduccion');
    if (datos) {
        datos.textContent = `${formatearNumero(punto.vel_kmh, 0, ' km/h')} · PID ${formatearNumero(punto.lph_pid, 2, ' L/h')}`
            + ` · Ec. ${formatearNumero(punto.lph_ecuacion, 2, ' L/h')}`;
    }
}

function iniciarReproduccionKia() {
    const puntos = reproduccionKia.puntos;
    if (puntos.length === 0 || reproduccionKia.timer) return;
    if (reproduccionKia.indice >= puntos.length - 1) mostrarPuntoKia(0);  // al final, reinicia
    const selector = document.getElementById('velocidadKia');
    const intervalo = selector ? parseInt(selector.value, 10) : 1000;
    const boton = document.getElementById('btnPlayKia');
    if (boton) boton.textContent = '❚❚';
    reproduccionKia.timer = setInterval(() => {
        if (reproduccionKia.indice >= reproduccionKia.puntos.length - 1) {
            detenerReproduccionKia();
            return;
        }
        mostrarPuntoKia(reproduccionKia.indice + 1);
    }, intervalo);
}

// Ubica el reproductor: debajo de la tarjeta elegida, o flotando si el panel está minimizado.
function ubicarReproductorKia() {
    const reproductor = elementoReproductor();
    if (!reproductor || reproduccionKia.puntos.length === 0) return;
    const panel = document.getElementById('panelHistoricos');
    if (panel && panel.classList.contains('minimizado')) {
        document.body.appendChild(reproductor);
        reproductor.classList.add('flotante');
        return;
    }
    reproductor.classList.remove('flotante');
    const tarjeta = document.querySelector('.itemKia.enReproduccion');
    if (tarjeta) tarjeta.after(reproductor);
}

// Devuelve el reproductor a #vistaKia (antes de vaciar la lista, para no borrarlo).
function guardarReproductorKia() {
    const reproductor = elementoReproductor();
    const vista = document.getElementById('vistaKia');
    if (reproductor && vista && reproductor.parentElement !== vista) {
        vista.appendChild(reproductor);
        reproductor.classList.remove('flotante');
    }
}

function abrirReproductorKia(puntos, numero) {
    reproduccionKia.puntos = puntos;
    reproduccionKia.numero = numero;
    reproduccionKia.marcador = L.marker([puntos[0].lat, puntos[0].lng], {
        icon: crearIconoKia(true), zIndexOffset: 1000
    });
    estado.kiaCapasHistorico.addLayer(reproduccionKia.marcador);

    const slider = document.getElementById('sliderKia');
    if (slider) {
        slider.min = 0;
        slider.max = Math.max(0, puntos.length - 1);
    }
    const hora = punto => (punto.hora || '--:--').slice(11, 19);
    document.getElementById('infoKiaReproduccion').textContent = `Kia ${numero}`;
    document.getElementById('tiempoInicioKia').textContent = hora(puntos[0]);
    document.getElementById('tiempoFinKia').textContent = hora(puntos[puntos.length - 1]);
    mostrarPuntoKia(0);

    const reproductor = elementoReproductor();
    ubicarReproductorKia();
    reproductor.style.display = 'block';
    reproductor.classList.remove('visible');
    void reproductor.offsetWidth;  // reinicia la transición
    reproductor.classList.add('visible');
    if (!reproductor.classList.contains('flotante')) reproductor.scrollIntoView({ block: 'nearest' });
}

function cerrarReproductorKia() {
    detenerReproduccionKia();
    reproduccionKia.puntos = [];
    reproduccionKia.indice = 0;
    reproduccionKia.marcador = null;  // se quita con el grupo de capas
    const reproductor = elementoReproductor();
    if (reproductor) {
        guardarReproductorKia();
        reproductor.style.display = 'none';
        reproductor.classList.remove('visible');
    }
}

function initReproductorKia() {
    document.getElementById('btnPlayKia')?.addEventListener('click', () => {
        if (reproduccionKia.timer) detenerReproduccionKia(); else iniciarReproduccionKia();
    });
    document.getElementById('btnReiniciarKia')?.addEventListener('click', () => {
        detenerReproduccionKia();
        mostrarPuntoKia(0);
    });
    document.getElementById('sliderKia')?.addEventListener('input', evento => {
        detenerReproduccionKia();
        mostrarPuntoKia(parseInt(evento.target.value, 10));
    });
    // Cambiar la velocidad durante la reproducción la aplica de inmediato
    document.getElementById('velocidadKia')?.addEventListener('change', () => {
        if (reproduccionKia.timer) {
            detenerReproduccionKia();
            iniciarReproduccionKia();
        }
    });
    // Minimizar o restaurar el panel de históricos mueve el reproductor (flotante o en la lista)
    const panel = document.getElementById('panelHistoricos');
    if (panel) {
        new MutationObserver(ubicarReproductorKia).observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
}

export function limpiarCapasKia() {
    cerrarReproductorKia();
    if (estado.kiaCapasHistorico) estado.mapa.removeLayer(estado.kiaCapasHistorico);
    estado.kiaCapasHistorico = null;
    estado.kiaSeleccionado = null;
    document.querySelectorAll('.itemKia.enReproduccion').forEach(item => item.classList.remove('enReproduccion'));
}

function popupPunto(punto) {
    return `
        ${escaparHtml(punto.hora)}<br>
        ${escaparHtml(formatearNumero(punto.vel_kmh, 0, ' km/h'))}<br>
        PID: ${escaparHtml(formatearNumero(punto.lph_pid, 2, ' L/h'))}
        · Ecuación: ${escaparHtml(formatearNumero(punto.lph_ecuacion, 2, ' L/h'))}
    `;
}

function dibujarRecorridoKia(recorrido, puntos, numero) {
    const grupo = L.featureGroup();
    grupo.addLayer(crearTrazaConsumo(puntos));

    // Un círculo transparente por punto: no tapa los colores de la línea, pero al hacer clic
    // abre el popup del punto (hora, velocidad y L/h). Se resalta al pasar el mouse.
    puntos.forEach(punto => {
        const color = colorLph(lphDePunto(punto));
        const circulo = L.circleMarker([punto.lat, punto.lng], {
            radius: 7, stroke: false, fillColor: color, fillOpacity: 0
        }).bindPopup(popupPunto(punto));
        circulo.on('mouseover', () => circulo.setStyle({ fillOpacity: 0.9 }));
        circulo.on('mouseout', () => circulo.setStyle({ fillOpacity: 0 }));
        grupo.addLayer(circulo);
    });

    const inicio = puntos[0];
    const fin = puntos[puntos.length - 1];
    grupo.addLayer(L.marker([inicio.lat, inicio.lng], { icon: crearIconoInicio(numero), zIndexOffset: 500 })
        .bindTooltip(`Inicio Kia ${numero}`, { permanent: true, direction: 'top', offset: [0, -14],
            className: 'tooltipRecorrido tooltipInicio' })
        .bindPopup(escaparHtml(`Inicio Kia ${numero} — ${recorrido.inicio || '--'}`)));

    const cerca = L.latLng(inicio.lat, inicio.lng).distanceTo(L.latLng(fin.lat, fin.lng)) < 30;
    grupo.addLayer(L.marker([fin.lat, fin.lng], { icon: crearIconoFin(numero), zIndexOffset: 500 })
        .bindTooltip(`Fin Kia ${numero}`, { permanent: true, direction: cerca ? 'bottom' : 'top',
            offset: cerca ? [0, 14] : [0, -14], className: 'tooltipRecorrido tooltipFin' })
        .bindPopup(`
            ${escaparHtml(`Fin Kia ${numero} — ${recorrido.fin || '--'}`)}<br>
            PID: ${escaparHtml(`${formatearLitros(recorrido.litros_pid)} · ${formatearPesos(recorrido.costo_cop)}`)}<br>
            Modelo: ${escaparHtml(`${formatearLitros(recorrido.litros_modelo)} · ${formatearPesos(recorrido.costo_modelo_cop)}`)}
        `));

    grupo.addTo(estado.mapa);
    estado.kiaCapasHistorico = grupo;
    const limites = grupo.getBounds();
    if (limites.isValid()) estado.mapa.fitBounds(limites, { padding: [60, 50], maxZoom: 17 });
}

async function alternarRecorridoKia(recorrido, numero, elemento) {
    const yaElegido = estado.kiaSeleccionado === recorrido.recorrido_id;
    limpiarCapasKia();
    if (yaElegido) return;
    if (!recorrido.con_traza) {
        mostrarEstadoKia(`Kia ${numero} no tiene GNSS: no hay traza para dibujar.`, '#e5a50a');
        return;
    }
    estado.kiaSeleccionado = recorrido.recorrido_id;
    elemento.classList.add('enReproduccion');
    mostrarEstadoKia('Cargando traza…');
    try {
        const datos = { puntos: await pedirPuntos(recorrido.recorrido_id) };
        // Si mientras cargaba se eligió otro o se salió de la pestaña, no se dibuja.
        if (estado.kiaSeleccionado !== recorrido.recorrido_id || estado.pestanaHistoricos !== 'kia') return;
        if (!datos.puntos || datos.puntos.length === 0) {
            mostrarEstadoKia(`Kia ${numero} no tiene puntos con GNSS.`, '#e5a50a');
            return;
        }
        dibujarRecorridoKia(recorrido, datos.puntos, numero);
        abrirReproductorKia(datos.puntos, numero);
        mostrarEstadoKia(`Kia ${numero}: ${datos.puntos.length} puntos, coloreados por L/h.`);
    } catch (error) {
        console.error('[Kia] Error cargando el recorrido:', error);
        mostrarEstadoKia('No se pudo cargar la traza del recorrido.', '#e74c3c');
        limpiarCapasKia();
    }
}

// -----------------------------------------------------------------------------
// Métricas y lista
// -----------------------------------------------------------------------------
function renderMetricas(m) {
    const contenedor = document.getElementById('metricasKia');
    if (!contenedor) return;
    if (!m || !m.modelo || m.modelo.n === 0) {
        contenedor.innerHTML = '<div class="tituloMetricas">MODELO FRENTE AL PID</div>'
            + '<div>Sin recorridos cerrados con PID en este rango.</div>';
        return;
    }
    const fila = (nombre, x, clase = '') => `
        <div class="filaMetrica ${clase}"><span>${escaparHtml(nombre)} (${escaparHtml(x.n)})</span>
        <span>MAPE ${escaparHtml(formatearNumero(x.mape_pct, 1, ' %'))} · R² ${escaparHtml(formatearNumero(x.r2_l100km, 2))}</span></div>`;
    const porModelo = m.por_modelo || {};
    const nombreSlope = Object.keys(porModelo).find(n => n.startsWith('slope/'));
    const nombreBase = Object.keys(porModelo).find(n => n.startsWith('base/'));
    // Primero el modelo elegido (con pendiente); el respaldo sin GNSS y el total van aparte
    contenedor.innerHTML = `
        <div class="tituloMetricas">MODELO FRENTE AL PID</div>
        ${nombreSlope ? fila('Pendiente', porModelo[nombreSlope]) : ''}
        ${nombreSlope ? `<div class="filaMetrica secundaria"><span></span>
            <span>total ${escaparHtml(formatearError(porModelo[nombreSlope].error_total_pct))}
            · MAE ${escaparHtml(formatearLitros(porModelo[nombreSlope].mae_litros))}</span></div>` : ''}
        ${nombreBase ? fila('Sin GNSS', porModelo[nombreBase], 'secundaria') : ''}
        ${fila('Todos', m.modelo, 'secundaria')}
        ${fila('Ecuación', m.ecuacion)}
    `;
    contenedor.title = 'Con pendiente: slope/linear_physics (recorridos con GNSS). '
        + 'Sin GNSS: respaldo base/linear_physics. Todos: lo que muestra la página. '
        + 'R² de L/100 km ponderado por distancia.';
}

function filaConsumo(nombre, litros, pesos, error) {
    return `
        <div class="filaConsumoKia">
            <span>${escaparHtml(nombre)}</span>
            <span>${escaparHtml(formatearLitros(litros))}${pesos === undefined ? '' : ' · ' + escaparHtml(formatearPesos(pesos))}</span>
            <span class="errorConsumo">${escaparHtml(formatearError(error))}</span>
        </div>`;
}

// Por defecto, como en la app: solo los recorridos de la última semana (7 días antes del fin
// del más reciente) y, de esos, solo los que tienen estimado del modelo. "Ver todos" quita ambos filtros.
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
function recorridosListadosKia(todos) {
    if (estado.kiaMostrarTodos) return todos;
    const instante = r => new Date(String(r.fin || r.inicio).replace(' ', 'T')).getTime();
    const conModelo = todos.filter(r => r.litros_modelo !== null);
    if (conModelo.length === 0) return [];
    const corte = Math.max(...conModelo.map(instante)) - SEMANA_MS;
    return conModelo.filter(r => instante(r) >= corte);
}

function renderLista() {
    const lista = document.getElementById('listaKia');
    if (!lista) return;
    guardarReproductorKia();
    lista.innerHTML = '';
    const todos = estado.kiaRecorridos;                 // todo el rango (para numerar)
    const base = kiaEnZona ?? todos;                    // con el filtro por zona, si hay
    const recorridos = recorridosListadosKia(base);     // y con el límite semanal

    const agregarEncabezado = texto => {
        const encabezado = document.createElement('div');
        encabezado.className = 'encabezadoSemana';
        encabezado.textContent = texto;
        lista.appendChild(encabezado);
    };
    if (todos.length === 0) {
        lista.textContent = 'No hay recorridos del Kia en este rango.';
    } else if (kiaEnZona && base.length === 0) {
        agregarEncabezado('Sin recorridos del Kia en esta zona (los que no tienen GNSS no se pueden ubicar).');
    } else if (recorridos.length < base.length) {
        agregarEncabezado(`Mostrando la última semana, con estimado del modelo (${recorridos.length} de ${base.length})`);
    } else if (estado.kiaMostrarTodos) {
        agregarEncabezado(`Mostrando todos los recorridos (${base.length})`);
    }

    recorridos.forEach(r => {
        // Número estable: posición en todo el rango, del más antiguo (1) al más reciente
        const numero = todos.length - todos.indexOf(r);
        const elemento = document.createElement('div');
        elemento.className = 'itemRecorrido itemKia';
        elemento.dataset.recorrido = r.recorrido_id;
        if (estado.kiaSeleccionado === r.recorrido_id) elemento.classList.add('enReproduccion');
        elemento.innerHTML = `
            <div class="numeroRecorrido">
                Kia ${numero}${r.con_traza ? '' : ' <span class="etiquetaSinGnss">sin GNSS</span>'}
            </div>
            <div class="datosRecorrido">
                <div>${escaparHtml((r.inicio || '--').slice(0, 16))} · ${escaparHtml(formatearDuracion(r.duracion_s))}
                    · ${escaparHtml(formatearNumero(r.distancia_km, 2, ' km'))}</div>
                ${filaConsumo('PID', r.litros_pid, r.costo_cop, null)}
                ${filaConsumo('Modelo', r.litros_modelo, r.costo_modelo_cop, r.error_modelo_pct)}
                ${filaConsumo('Ecuación', r.litros_ecuacion, undefined, r.error_ecuacion_pct)}
            </div>
        `;
        if (r.modelo) elemento.title = `Modelo ${r.modelo}, factor ${formatearNumero(r.factor, 3)}`;
        elemento.addEventListener('click', () => alternarRecorridoKia(r, numero, elemento));
        lista.appendChild(elemento);
    });

    // Si el recorrido elegido quedó fuera de la lista, se borra del mapa
    if (estado.kiaSeleccionado && !recorridos.some(r => r.recorrido_id === estado.kiaSeleccionado)) {
        limpiarCapasKia();
    }
    ubicarReproductorKia();

    const boton = document.getElementById('btnTodosKia');
    if (boton) {
        const ocultos = base.length > recorridos.length;
        boton.style.display = (ocultos || estado.kiaMostrarTodos) && base.length > 0 ? '' : 'none';
        boton.textContent = estado.kiaMostrarTodos
            ? 'Ver solo la última semana con estimado'
            : `Ver todos (${base.length})`;
    }
}

// -----------------------------------------------------------------------------
// Filtro por zona: el mismo círculo de la app (filtro-zona.js avisa con 'historico:zona').
// Un recorrido pasa si algún punto o tramo de su traza queda dentro del radio, como en la app.
// Los puntos de cada recorrido se piden una vez y quedan en caché.
// -----------------------------------------------------------------------------
let zonaKia = null;        // { lat, lng, radio } o null
let kiaEnZona = null;      // recorridos del rango que pasan por la zona (null = sin filtro)
let consultaZona = 0;
const puntosPorRecorrido = new Map();   // recorrido_id -> Promise<puntos>

function pedirPuntos(recorridoId) {
    if (!puntosPorRecorrido.has(recorridoId)) {
        const promesa = pedirJson(`/api/kia/recorridos/${encodeURIComponent(recorridoId)}`)
            .then(datos => datos.puntos || []);
        promesa.catch(() => puntosPorRecorrido.delete(recorridoId));  // se reintenta la próxima vez
        puntosPorRecorrido.set(recorridoId, promesa);
    }
    return puntosPorRecorrido.get(recorridoId);
}

function pasaPorZona(puntos, zona) {
    const centro = L.latLng(zona.lat, zona.lng);
    if (puntos.some(p => centro.distanceTo(L.latLng(p.lat, p.lng)) <= zona.radio)) return true;
    for (let i = 1; i < puntos.length; i++) {
        if (distanciaSegmentoAPunto(puntos[i - 1], puntos[i], centro) <= zona.radio) return true;
    }
    return false;
}

async function aplicarZonaKia() {
    const numero = ++consultaZona;
    if (!zonaKia || estado.kiaRecorridos.length === 0) {
        kiaEnZona = null;
        renderLista();
        if (estado.pestanaHistoricos === 'kia') mostrarEstadoKia('');
        return;
    }
    const zona = zonaKia;
    if (estado.pestanaHistoricos === 'kia') mostrarEstadoKia('Filtrando recorridos del Kia en la zona…');
    try {
        const conTraza = estado.kiaRecorridos.filter(r => r.con_traza);
        const trazas = await Promise.all(conTraza.map(r => pedirPuntos(r.recorrido_id)));
        if (numero !== consultaZona) return;  // la zona cambió mientras tanto
        const ids = new Set(conTraza.filter((r, i) => pasaPorZona(trazas[i], zona)).map(r => r.recorrido_id));
        kiaEnZona = estado.kiaRecorridos.filter(r => ids.has(r.recorrido_id));
        renderLista();
        mostrarEstadoKia(kiaEnZona.length ? `${kiaEnZona.length} recorrido(s) del Kia en la zona` : '',
            '#4cd964');
    } catch (error) {
        if (numero !== consultaZona) return;
        console.error('[Kia] Error filtrando por zona:', error);
        mostrarEstadoKia('No se pudo filtrar por zona.', '#e74c3c');
    }
}

function alCambiarZona(evento) {
    zonaKia = evento.detail;
    aplicarZonaKia();
}

// -----------------------------------------------------------------------------
// Búsqueda por rango: la misma del calendario ("Ver recorrido") para las dos pestañas
// -----------------------------------------------------------------------------
let rangoKia = null;      // { desde, hasta } de la última búsqueda
let consultaKia = 0;      // para descartar respuestas de búsquedas anteriores

function actualizarTitulosPestanas() {
    const app = document.getElementById('tabHistApp');
    const kia = document.getElementById('tabHistKia');
    if (app) app.textContent = `App (${estado.recorridosBase.length})`;
    if (kia) kia.textContent = rangoKia ? `Kia K3 (${estado.kiaRecorridos.length})` : 'Kia K3';
}

async function cargarVistaKia() {
    if (!rangoKia) return;
    const numero = ++consultaKia;
    const parametros = `desde=${encodeURIComponent(rangoKia.desde)}&hasta=${encodeURIComponent(rangoKia.hasta)}`;
    mostrarEstadoKia('Cargando recorridos del Kia…');
    try {
        const [metricas, recorridos] = await Promise.all([
            pedirJson(`/api/kia/metricas?${parametros}`),
            pedirJson(`/api/kia/recorridos?todos=1&${parametros}`)
        ]);
        if (numero !== consultaKia) return;  // llegó otra búsqueda mientras tanto
        estado.kiaRecorridos = recorridos;
        document.getElementById('panelHistoricos')?.classList.toggle('kiaConResultados', recorridos.length > 0);
        renderMetricas(metricas);
        aplicarZonaKia();  // pinta la lista (con la zona, si hay una)
        actualizarTitulosPestanas();
        mostrarEstadoKia('');
    } catch (error) {
        if (numero !== consultaKia) return;
        console.error('[Kia] Error cargando el histórico del Kia:', error);
        mostrarEstadoKia('No se pudieron cargar los recorridos del Kia.', '#e74c3c');
    }
}

function alBuscarRango(evento) {
    rangoKia = evento.detail;
    estado.kiaMostrarTodos = false;
    estado.kiaRecorridos = [];
    kiaEnZona = null;
    puntosPorRecorrido.clear();
    document.getElementById('panelHistoricos')?.classList.remove('kiaConResultados');
    limpiarCapasKia();
    document.getElementById('panelHistoricos')?.classList.add('conBusqueda');
    actualizarTitulosPestanas();
    cargarVistaKia();  // también si la pestaña abierta es App: así su título muestra cuántos hay
}

// -----------------------------------------------------------------------------
// Pestañas
// -----------------------------------------------------------------------------
function cambiarPestana(pestana) {
    estado.pestanaHistoricos = pestana;
    const panel = document.getElementById('panelHistoricos');
    if (panel) panel.classList.toggle('pestanaKia', pestana === 'kia');
    document.body.classList.toggle('pestanaKiaActiva', pestana === 'kia');
    document.getElementById('tabHistApp')?.classList.toggle('activo', pestana === 'app');
    document.getElementById('tabHistKia')?.classList.toggle('activo', pestana === 'kia');
    if (pestana === 'kia') {
        mostrarCapasApp(false);
    } else {
        limpiarCapasKia();
        mostrarCapasApp(true);
        mostrarEstadoKia('');
    }
}

// Al volver al modo en vivo, el panel queda como al principio: sin búsqueda y en la pestaña App.
function reiniciarHistoricoKia() {
    limpiarCapasKia();
    rangoKia = null;
    consultaKia++;
    estado.kiaRecorridos = [];
    estado.kiaMostrarTodos = false;
    zonaKia = null;
    kiaEnZona = null;
    consultaZona++;
    puntosPorRecorrido.clear();
    document.getElementById('panelHistoricos')?.classList.remove('conBusqueda', 'kiaConResultados');
    if (estado.pestanaHistoricos !== 'app') cambiarPestana('app');
    const lista = document.getElementById('listaKia');
    if (lista) lista.innerHTML = '';
    const metricas = document.getElementById('metricasKia');
    if (metricas) metricas.innerHTML = '';
}

export function initKiaHistorico() {
    initReproductorKia();
    document.getElementById('tabHistApp')?.addEventListener('click', () => cambiarPestana('app'));
    document.getElementById('tabHistKia')?.addEventListener('click', () => cambiarPestana('kia'));
    document.getElementById('btnTodosKia')?.addEventListener('click', () => {
        estado.kiaMostrarTodos = !estado.kiaMostrarTodos;
        renderLista();
    });
    document.addEventListener('historico:busqueda', alBuscarRango);
    document.addEventListener('historico:zona', alCambiarZona);

    // El título de la pestaña App muestra cuántos recorridos encontró su búsqueda (que corre
    // en main.js): se actualiza cuando cambia su lista o su mensaje de estado.
    const observarApp = new MutationObserver(actualizarTitulosPestanas);
    ['listaRecorridos', 'estadoHistorico'].forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) observarApp.observe(elemento, { childList: true, characterData: true, subtree: true });
    });

    // Al volver al modo en vivo se quitan las capas del Kia y se reinicia el panel.
    new MutationObserver(() => {
        if (!document.body.classList.contains('modoHistorico')) reiniciarHistoricoKia();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
