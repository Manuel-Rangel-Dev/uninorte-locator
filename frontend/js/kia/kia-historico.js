// =============================================================================
// KIA EN EL HISTÓRICO: PESTAÑA, MÉTRICAS DEL MODELO, LISTA, TRAZA Y REPRODUCTOR (P3-S3)
// La pestaña "Kia K3" del panel de históricos muestra las métricas de /api/kia/metricas y
// los recorridos de /api/kia/recorridos con lo medido (PID) frente al modelo y la ecuación.
// La pestaña "App" es la de siempre: este módulo solo la oculta con una clase en el panel,
// sin tocar su estado (rango, zona, rutas dibujadas ni reproductor).
// =============================================================================
import { API_BASE } from '../constantes.js';
import { estado } from '../estado.js';
import { escaparHtml } from '../utilidades.js';
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
        const datos = await pedirJson(`/api/kia/recorridos/${encodeURIComponent(recorrido.recorrido_id)}`);
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
        contenedor.innerHTML = '<div class="tituloMetricas">MODELO</div><div>Sin recorridos cerrados para medir.</div>';
        return;
    }
    const fila = (nombre, x) => `
        <div class="filaMetrica"><span>${escaparHtml(nombre)}</span>
        <span>MAPE ${escaparHtml(formatearNumero(x.mape_pct, 1, ' %'))} · R² ${escaparHtml(formatearNumero(x.r2_l100km, 2))}</span></div>`;
    contenedor.innerHTML = `
        <div class="tituloMetricas">MODELO FRENTE AL PID (${escaparHtml(m.modelo.n)} recorridos)</div>
        ${fila('Modelo', m.modelo)}
        <div class="filaMetrica secundaria"><span></span>
        <span>total ${escaparHtml(formatearError(m.modelo.error_total_pct))} · MAE ${escaparHtml(formatearLitros(m.modelo.mae_litros))}</span></div>
        ${Object.entries(m.por_modelo || {}).map(([nombre, x]) => fila(`  ${nombre.split('/')[0]}`, x)).join('')}
        ${fila('Ecuación', m.ecuacion)}
    `;
}

function filaConsumo(nombre, litros, pesos, error) {
    return `
        <div class="filaConsumoKia">
            <span>${escaparHtml(nombre)}</span>
            <span>${escaparHtml(formatearLitros(litros))}${pesos === undefined ? '' : ' · ' + escaparHtml(formatearPesos(pesos))}</span>
            <span class="errorConsumo">${escaparHtml(formatearError(error))}</span>
        </div>`;
}

function renderLista(todos) {
    const lista = document.getElementById('listaKia');
    if (!lista) return;
    guardarReproductorKia();
    lista.innerHTML = '';
    const recorridos = estado.kiaMostrarTodos ? todos : todos.filter(r => r.litros_modelo !== null);
    if (recorridos.length === 0) {
        lista.textContent = 'No hay recorridos del Kia.';
    }

    recorridos.forEach((r, i) => {
        const numero = recorridos.length - i;  // la lista va del más reciente al más antiguo
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

    ubicarReproductorKia();

    const boton = document.getElementById('btnTodosKia');
    if (boton) {
        const conModelo = todos.filter(r => r.litros_modelo !== null).length;
        boton.style.display = todos.length > conModelo ? '' : 'none';
        boton.textContent = estado.kiaMostrarTodos
            ? `Ver solo los que tienen estimado (${conModelo})`
            : `Ver todos (${todos.length})`;
    }
}

async function cargarVistaKia() {
    mostrarEstadoKia('Cargando recorridos del Kia…');
    try {
        const [metricas, recorridos] = await Promise.all([
            pedirJson('/api/kia/metricas'),
            pedirJson('/api/kia/recorridos?todos=1')
        ]);
        estado.kiaRecorridos = recorridos;
        renderMetricas(metricas);
        renderLista(recorridos);
        mostrarEstadoKia('');
    } catch (error) {
        console.error('[Kia] Error cargando el histórico del Kia:', error);
        mostrarEstadoKia('No se pudieron cargar los recorridos del Kia.', '#e74c3c');
    }
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
        cargarVistaKia();
    } else {
        limpiarCapasKia();
        mostrarCapasApp(true);
        mostrarEstadoKia('');
    }
}

export function initKiaHistorico() {
    initReproductorKia();
    document.getElementById('tabHistApp')?.addEventListener('click', () => cambiarPestana('app'));
    document.getElementById('tabHistKia')?.addEventListener('click', () => cambiarPestana('kia'));
    document.getElementById('btnTodosKia')?.addEventListener('click', () => {
        estado.kiaMostrarTodos = !estado.kiaMostrarTodos;
        renderLista(estado.kiaRecorridos);
    });
    // Al volver al modo en vivo se quitan las capas del Kia, como las de la app.
    new MutationObserver(() => {
        if (!document.body.classList.contains('modoHistorico')) limpiarCapasKia();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
