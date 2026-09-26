// =============================================================================
// 1. CONFIGURACIÓN Y CONSTANTES GLOBALES
// =============================================================================
const API_BASE = '';
const INTERVALO_MS = 5000;
const CENTRO_DEFAULT = [11.019, -74.851]; // Barranquilla, fallback inicial
const DECIMALES_COORDENADAS = 4; // ~11m de resolución: filtra el ruido GPS cuando el vehículo está detenido
const ZOOM_CENTRADO = 17; // Nivel de zoom específico al centrar en el vehículo
const UMBRAL_SEGMENTACION_MINUTOS = 30; // Diferencia mínima para considerar un nuevo recorrido (30 min)
const UMBRAL_SEGMENTACION_METROS = 2000; // Salto de distancia para considerar un nuevo recorrido (2 km)

// =============================================================================
// 2. UTILIDADES Y FILTRO DE COORDENADAS
// =============================================================================
function redondearCoord(coord, decimales = DECIMALES_COORDENADAS) {
    if (coord === null || coord === undefined || isNaN(Number(coord))) return coord;
    return Number(Number(coord).toFixed(decimales));
}

function obtenerTimestampPunto(punto) {
    if (!punto || !punto.fecha || !punto.hora) return null;
    const dt = new Date(`${punto.fecha.trim()}T${punto.hora.trim()}`);
    return isNaN(dt.getTime()) ? null : dt.getTime();
}

// =============================================================================
// 3. METADATOS Y TÍTULO DE LA PÁGINA
// =============================================================================
if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.integrante) {
    document.title = APP_CONFIG.integrante;
}

// =============================================================================
// 4. ESTADO GLOBAL DEL MAPA Y TELEMETRÍA
// =============================================================================
let mapa;
let marcador;
let recorrido;
let hayRecorridoHistorico = false;
let ultimaPosicionRecorrido = null;
let lineasHistoricas = [];
let marcadoresHistoricos = [];
let mapaCentradoInicial = false;

// =============================================================================
// 5. SEGMENTACIÓN Y ESTILOS DE RUTAS HISTÓRICAS
// =============================================================================
function segmentarRecorridos(puntos) {
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

function crearIconoInicio(num) {
    return L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#2ecc71;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
                <span style="transform:rotate(45deg);color:#ffffff;font-weight:bold;font-size:${num > 9 ? '10px' : '12px'};font-family:sans-serif;">${num}</span>
            </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -26]
    });
}

function crearIconoFin(num) {
    return L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#dc0303;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
                <span style="transform:rotate(45deg);color:#ffffff;font-weight:bold;font-size:${num > 9 ? '10px' : '12px'};font-family:sans-serif;">${num}</span>
            </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -26]
    });
}

// =============================================================================
// 6. TELEMETRÍA EN TIEMPO REAL (FETCH Y POLLING)
// =============================================================================
async function refrescarCampo(nombreCampo, idElemento) {
    const elemento = document.getElementById(idElemento);
    try {
        const respuesta = await fetch(`${API_BASE}/api/${nombreCampo}`);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const datos = await respuesta.json();
        const valor = datos[nombreCampo];
        elemento.textContent = (valor === null || valor === undefined) ? '--' : valor;
        return valor;
    } catch (error) {
        elemento.textContent = 'Error';
        console.error(`Error al refrescar ${nombreCampo}:`, error);
        return null;
    }
}

async function actualizarMarcador() {
    const lat = await refrescarCampo('lat', 'valorLat');
    const lng = await refrescarCampo('lng', 'valorLng');
    refrescarCampo('fecha', 'valorFecha');
    refrescarCampo('hora', 'valorHora');

    if (lat === null || lng === null || isNaN(Number(lat)) || isNaN(Number(lng))) return;

    const posicion = [redondearCoord(lat), redondearCoord(lng)];
    marcador.setLatLng(posicion);

    if (!mapaCentradoInicial && !document.body.classList.contains('modoHistorico')) {
        mapa.setView(posicion, mapa.getZoom());
        mapaCentradoInicial = true;
    }

    const esPosicionNueva = !ultimaPosicionRecorrido
        || ultimaPosicionRecorrido[0] !== posicion[0]
        || ultimaPosicionRecorrido[1] !== posicion[1];

    if (esPosicionNueva) {
        recorrido.addLatLng(posicion);
        ultimaPosicionRecorrido = posicion;
        if (document.body.classList.contains('modoHistorico')) {
            recorrido.setStyle({ opacity: 0 });
        }
    }
}

// =============================================================================
// 7. INICIALIZACIÓN DEL MAPA (LEAFLET)
// =============================================================================
async function initMap() {
    let centroInicial = CENTRO_DEFAULT;
    try {
        const res = await fetch(`${API_BASE}/api/ultimo`);
        if (res.ok) {
            const datos = await res.json();
            if (datos.lat !== null && datos.lng !== null && !isNaN(Number(datos.lat)) && !isNaN(Number(datos.lng))) {
                centroInicial = [redondearCoord(datos.lat), redondearCoord(datos.lng)];
                mapaCentradoInicial = true;
            }
        }
    } catch (e) {
        console.warn('No se pudo obtener la posición inicial desde /api/ultimo, usando centro por defecto:', e);
    }

    mapa = L.map('mapa').setView(centroInicial, 15);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapa);

    marcador = L.marker(centroInicial).addTo(mapa)
        .bindPopup('Vehículo');
    document.getElementById('btnCentrar').addEventListener('click', () => {
        mapa.setView(marcador.getLatLng(), ZOOM_CENTRADO);
    });

    recorrido = L.polyline([], { color: '#C8102E', weight: 3 }).addTo(mapa);

    initHistoricos();

    actualizarMarcador();
    setInterval(actualizarMarcador, INTERVALO_MS);
}

// =============================================================================
// 8. HISTÓRICOS: ESTADO Y UTILIDADES DE FECHA
// =============================================================================
const HISTORICO_MIN_ANIO = 2020;
let fechaCalendario = new Date();
let fechaDesde = new Date();
let fechaHasta = new Date();
let modoSeleccion = 'desde';

function normalizarFecha(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatearFechaCorta(d) {
    if (!d) return '--';
    const nombresMes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${d.getDate()} ${nombresMes[d.getMonth()]} ${d.getFullYear()}`;
}

function formatearFechaISO(d) {
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

function mostrarEstadoHistorico(mensaje, color = '#B3B3B3') {
    const el = document.getElementById('estadoHistorico');
    if (el) {
        el.textContent = mensaje;
        el.style.color = color;
    }
}

function actualizarPillsFecha() {
    document.getElementById('txtFechaDesde').textContent = formatearFechaCorta(fechaDesde);
    document.getElementById('txtFechaHasta').textContent = formatearFechaCorta(fechaHasta);
    document.getElementById('tabDesde').classList.toggle('activo', modoSeleccion === 'desde');
    document.getElementById('tabHasta').classList.toggle('activo', modoSeleccion === 'hasta');
}

// =============================================================================
// 9. HISTÓRICOS: CALENDARIO INTERACTIVO
// =============================================================================
function renderCalendario() {
    const anio = fechaCalendario.getFullYear();
    const mes = fechaCalendario.getMonth();
    const nombresMes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    document.getElementById('tituloMesAnio').textContent = `${nombresMes[mes]} ${anio}`;

    const grid = document.getElementById('gridCalendario');
    grid.innerHTML = '';

    const primerDiaSemana = new Date(anio, mes, 1).getDay();
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();

    for (let i = 0; i < primerDiaSemana; i++) {
        grid.appendChild(document.createElement('span'));
    }

    const tDesde = fechaDesde ? normalizarFecha(fechaDesde) : null;
    const tHasta = fechaHasta ? normalizarFecha(fechaHasta) : null;

    for (let dia = 1; dia <= diasEnMes; dia++) {
        const celda = document.createElement('span');
        celda.textContent = dia;
        celda.classList.add('diaCalendario');

        const tActual = new Date(anio, mes, dia).getTime();
        const esInicio = tDesde && tActual === tDesde;
        const esFin = tHasta && tActual === tHasta;
        const enRango = tDesde && tHasta && tActual > tDesde && tActual < tHasta;

        if (esInicio) celda.classList.add('diaInicio');
        if (esFin) celda.classList.add('diaFin');
        if (enRango) celda.classList.add('diaEnRango');

        celda.addEventListener('click', () => {
            const diaClick = new Date(anio, mes, dia);
            if (modoSeleccion === 'desde') {
                fechaDesde = diaClick;
                if (fechaHasta && normalizarFecha(fechaHasta) < normalizarFecha(fechaDesde)) {
                    fechaHasta = new Date(fechaDesde);
                }
                modoSeleccion = 'hasta';
            } else {
                if (fechaDesde && normalizarFecha(diaClick) < normalizarFecha(fechaDesde)) {
                    fechaDesde = diaClick;
                } else {
                    fechaHasta = diaClick;
                }
            }
            actualizarPillsFecha();
            renderCalendario();
        });

        grid.appendChild(celda);
    }

    document.getElementById('btnMesAnterior').disabled = (anio === HISTORICO_MIN_ANIO && mes === 0);
}

function cambiarMes(delta) {
    const nuevaFecha = new Date(fechaCalendario.getFullYear(), fechaCalendario.getMonth() + delta, 1);
    if (nuevaFecha.getFullYear() < HISTORICO_MIN_ANIO) return;
    fechaCalendario = nuevaFecha;
    renderCalendario();
}

// =============================================================================
// 10. HISTÓRICOS: CONTROLES DE HORA (FORMATO 12H / 24H)
// =============================================================================
function limitarInputHora(input, max) {
    input.addEventListener('input', () => {
        input.value = input.value.replace(/[^0-9]/g, '').slice(0, 2);
    });
    input.addEventListener('blur', () => {
        let valor = parseInt(input.value, 10);
        if (isNaN(valor)) valor = 0;
        valor = Math.max(0, Math.min(max, valor));
        input.value = String(valor).padStart(2, '0');
    });
}

function configurarToggleAmPm(idToggle) {
    const toggle = document.getElementById(idToggle);
    toggle.addEventListener('click', () => {
        const nuevoValor = toggle.dataset.valor === 'AM' ? 'PM' : 'AM';
        toggle.dataset.valor = nuevoValor;
        toggle.classList.toggle('activoPM', nuevoValor === 'PM');
    });
}

function obtenerHora24(idHH, idMM, idSS, idToggle) {
    let hh = parseInt(document.getElementById(idHH).value, 10);
    if (isNaN(hh)) hh = 0;
    const mm = (document.getElementById(idMM).value || '00').padStart(2, '0');
    const ss = (document.getElementById(idSS).value || '00').padStart(2, '0');
    const esPM = document.getElementById(idToggle).dataset.valor === 'PM';

    if (hh === 12) hh = 0;
    if (esPM) hh += 12;

    return `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
}

// =============================================================================
// 11. HISTÓRICOS: CONTROL DE VISTAS Y MODOS (EN VIVO VS HISTÓRICO)
// =============================================================================
function actualizarBotonModo(enModoHistorico) {
    const btn = document.getElementById('btnHistoricos');
    const txt = document.getElementById('textoBtnHistoricos');
    const iconoHist = document.getElementById('iconoHistoricos');
    const iconoVivo = document.getElementById('iconoEnVivo');

    if (enModoHistorico) {
        if (txt) txt.textContent = 'Recorrido en vivo';
        if (btn) btn.title = 'Volver al recorrido en vivo';
        if (iconoHist) iconoHist.style.display = 'none';
        if (iconoVivo) iconoVivo.style.display = 'block';
    } else {
        if (txt) txt.textContent = 'Históricos';
        if (btn) btn.title = 'Ver histórico de recorrido';
        if (iconoHist) iconoHist.style.display = 'block';
        if (iconoVivo) iconoVivo.style.display = 'none';
    }
}

function actualizarVisibilidadTiempoReal() {
    const panelHistoricos = document.getElementById('panelHistoricos');
    const panelAbierto = panelHistoricos && panelHistoricos.classList.contains('abierto');
    const debeOcultar = panelAbierto || hayRecorridoHistorico;

    document.body.classList.toggle('modoHistorico', debeOcultar);

    if (marcador) {
        marcador.setOpacity(debeOcultar ? 0 : 1);
    }
    if (recorrido) {
        recorrido.setStyle({ opacity: debeOcultar ? 0 : 1 });
    }
}

function abrirHistoricos() {
    const panel = document.getElementById('panelHistoricos');
    if (panel) panel.classList.add('abierto');
    actualizarBotonModo(true);
    actualizarVisibilidadTiempoReal();
}

function volverARecorridoEnVivo() {
    const panel = document.getElementById('panelHistoricos');
    if (panel) panel.classList.remove('abierto');
    limpiarRecorridoHistorico();
    actualizarBotonModo(false);
    actualizarVisibilidadTiempoReal();
    if (marcador && marcador.getLatLng()) {
        mapa.setView(marcador.getLatLng(), ZOOM_CENTRADO);
    }
}

function alternarModoHistorico() {
    const panel = document.getElementById('panelHistoricos');
    const enModoHistorico = (panel && panel.classList.contains('abierto')) || hayRecorridoHistorico;

    if (enModoHistorico) {
        volverARecorridoEnVivo();
    } else {
        abrirHistoricos();
    }
}

function limpiarRecorridoHistorico() {
    hayRecorridoHistorico = false;
    lineasHistoricas.forEach(l => mapa.removeLayer(l));
    lineasHistoricas = [];
    marcadoresHistoricos.forEach(m => mapa.removeLayer(m));
    marcadoresHistoricos = [];
    mostrarEstadoHistorico('');
}

// =============================================================================
// 12. HISTÓRICOS: EVENTOS Y CONSULTA DE RECORRIDOS (API)
// =============================================================================
function initHistoricos() {
    document.getElementById('btnHistoricos').addEventListener('click', alternarModoHistorico);

    document.getElementById('tabDesde').addEventListener('click', () => {
        modoSeleccion = 'desde';
        if (fechaDesde) {
            fechaCalendario = new Date(fechaDesde.getFullYear(), fechaDesde.getMonth(), 1);
        }
        actualizarPillsFecha();
        renderCalendario();
    });

    document.getElementById('tabHasta').addEventListener('click', () => {
        modoSeleccion = 'hasta';
        if (fechaHasta) {
            fechaCalendario = new Date(fechaHasta.getFullYear(), fechaHasta.getMonth(), 1);
        }
        actualizarPillsFecha();
        renderCalendario();
    });

    document.getElementById('btnMesAnterior').addEventListener('click', () => cambiarMes(-1));
    document.getElementById('btnMesSiguiente').addEventListener('click', () => cambiarMes(1));

    limitarInputHora(document.getElementById('horaDesdeHH'), 12);
    limitarInputHora(document.getElementById('horaDesdeMM'), 59);
    limitarInputHora(document.getElementById('horaDesdeSS'), 59);
    limitarInputHora(document.getElementById('horaHastaHH'), 12);
    limitarInputHora(document.getElementById('horaHastaMM'), 59);
    limitarInputHora(document.getElementById('horaHastaSS'), 59);

    configurarToggleAmPm('toggleDesde');
    configurarToggleAmPm('toggleHasta');

    document.getElementById('btnVerRecorrido').addEventListener('click', async () => {
        if (!fechaDesde || !fechaHasta) {
            mostrarEstadoHistorico('Selecciona las fechas en el calendario.', '#ff6b6b');
            return;
        }

        const fechaDesdeISO = formatearFechaISO(fechaDesde);
        const fechaHastaISO = formatearFechaISO(fechaHasta);
        const horaDesde = obtenerHora24('horaDesdeHH', 'horaDesdeMM', 'horaDesdeSS', 'toggleDesde');
        const horaHasta = obtenerHora24('horaHastaHH', 'horaHastaMM', 'horaHastaSS', 'toggleHasta');

        const dtInicio = new Date(`${fechaDesdeISO}T${horaDesde}`);
        const dtFin = new Date(`${fechaHastaISO}T${horaHasta}`);

        if (dtFin < dtInicio) {
            mostrarEstadoHistorico('La fecha/hora final debe ser posterior a la inicial.', '#ff6b6b');
            return;
        }

        mostrarEstadoHistorico('Cargando recorrido...', '#B3B3B3');
        document.getElementById('btnVerRecorrido').disabled = true;

        try {
            const url = `${API_BASE}/api/historico?fecha_desde=${fechaDesdeISO}&hora_desde=${horaDesde}&fecha_hasta=${fechaHastaISO}&hora_hasta=${horaHasta}`;
            const respuesta = await fetch(url);
            if (!respuesta.ok) {
                const errData = await respuesta.json().catch(() => null);
                throw new Error(errData && errData.error ? errData.error : `HTTP ${respuesta.status}`);
            }
            const puntos = await respuesta.json();

            if (!puntos || puntos.length === 0) {
                limpiarRecorridoHistorico();
                mostrarEstadoHistorico('No hay recorridos en este rango.', '#e5a50a');
                return;
            }

            const recorridos = segmentarRecorridos(puntos);

            if (recorridos.length === 0) {
                limpiarRecorridoHistorico();
                mostrarEstadoHistorico('No hay recorridos en este rango.', '#e5a50a');
                return;
            }

            hayRecorridoHistorico = true;

            // Limpiar trazos y pines históricos previos si existían
            lineasHistoricas.forEach(l => mapa.removeLayer(l));
            lineasHistoricas = [];
            marcadoresHistoricos.forEach(m => mapa.removeLayer(m));
            marcadoresHistoricos = [];

            const todosPuntos = [];

            recorridos.forEach((rec, idx) => {
                const num = idx + 1;
                const coords = rec.map(p => [p.lat, p.lng]);
                coords.forEach(c => todosPuntos.push(c));

                // Polilínea para el recorrido segmentado
                const linea = L.polyline(coords, {
                    color: '#4A90D9',
                    weight: 3,
                    dashArray: '6,4'
                }).addTo(mapa);
                linea.bindPopup(`Recorrido ${num} (${rec.length} punto${rec.length === 1 ? '' : 's'})`);
                lineasHistoricas.push(linea);

                const puntoInicio = rec[0];
                const puntoFin = rec[rec.length - 1];

                // Pin verde de inicio recorrido #
                const marcadorInicio = L.marker([puntoInicio.lat, puntoInicio.lng], { icon: crearIconoInicio(num) })
                    .addTo(mapa)
                    .bindTooltip(`Inicio recorrido ${num}`, {
                        permanent: true,
                        direction: 'top',
                        offset: [0, -28],
                        className: 'tooltipRecorrido tooltipInicio'
                    })
                    .bindPopup(`Inicio recorrido ${num}${puntoInicio.fecha ? ' — ' + puntoInicio.fecha + ' ' + (puntoInicio.hora || '') : ''}`);
                marcadoresHistoricos.push(marcadorInicio);

                // Pin rojo de fin recorrido #
                const marcadorFin = L.marker([puntoFin.lat, puntoFin.lng], { icon: crearIconoFin(num) })
                    .addTo(mapa)
                    .bindTooltip(`Fin recorrido ${num}`, {
                        permanent: true,
                        direction: 'top',
                        offset: [0, -28],
                        className: 'tooltipRecorrido tooltipFin'
                    })
                    .bindPopup(`Fin recorrido ${num}${puntoFin.fecha ? ' — ' + puntoFin.fecha + ' ' + (puntoFin.hora || '') : ''}`);
                marcadoresHistoricos.push(marcadorFin);
            });

            if (todosPuntos.length > 0) {
                const bounds = L.latLngBounds(todosPuntos);
                mapa.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
            }

            mostrarEstadoHistorico(`${recorridos.length} recorrido(s) encontrado(s)`, '#4cd964');

            actualizarVisibilidadTiempoReal();

        } catch (error) {
            console.error('Error al obtener histórico:', error);
            mostrarEstadoHistorico(error.message || 'Error al cargar histórico', '#ff6b6b');
        } finally {
            document.getElementById('btnVerRecorrido').disabled = false;
        }
    });

    actualizarPillsFecha();
    renderCalendario();
}

// =============================================================================
// 13. PUNTO DE ENTRADA (BOOTSTRAP)
// =============================================================================
document.addEventListener('DOMContentLoaded', initMap);
