// =============================================================================
// PUNTO DE ENTRADA: EVENTOS DE HISTÓRICOS Y BOOTSTRAP DE LA APP
// =============================================================================
import { API_BASE } from './constantes.js';
import { estado } from './estado.js';
import { formatearFechaISO } from './utilidades.js';
import { segmentarRecorridos } from './historico/segmentacion.js';
import {
    mostrarListaRecorridos,
    iniciarReproduccion,
    detenerReproduccion,
    actualizarPuntoReproduccion
} from './historico/lista-slidebar.js';
import {
    renderCalendario,
    actualizarPillsFecha,
    cambiarMes,
    limitarInputHora,
    configurarToggleAmPm,
    obtenerHora24,
    mostrarEstadoHistorico,
    alternarModoHistorico,
    actualizarVisibilidadTiempoReal,
    limpiarRecorridoHistorico
} from './historico/calendario.js';
import { initMap } from './mapa-vivo.js';

if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.integrante) {
    document.title = APP_CONFIG.integrante;
}

function initHistoricos() {
    const btnPlayRecorrido = document.getElementById('btnPlayRecorrido');
    if (btnPlayRecorrido) {
        btnPlayRecorrido.addEventListener('click', () => {
            if (estado.reproduciendo) {
                detenerReproduccion();
            } else {
                iniciarReproduccion();
            }
        });
    }

    const btnReiniciarRecorrido = document.getElementById('btnReiniciarRecorrido');
    if (btnReiniciarRecorrido) {
        btnReiniciarRecorrido.addEventListener('click', () => {
            detenerReproduccion();
            estado.indiceReproduccion = 0;
            actualizarPuntoReproduccion(0);
        });
    }

    const sliderRecorrido = document.getElementById('sliderRecorrido');
    if (sliderRecorrido) {
        sliderRecorrido.addEventListener('input', () => {
            const indice = parseInt(sliderRecorrido.value, 10);
            detenerReproduccion();
            actualizarPuntoReproduccion(indice);
        });
    }

    document.getElementById('btnHistoricos').addEventListener('click', alternarModoHistorico);

    document.getElementById('tabDesde').addEventListener('click', () => {
        estado.modoSeleccion = 'desde';
        if (estado.fechaDesde) {
            estado.fechaCalendario = new Date(estado.fechaDesde.getFullYear(), estado.fechaDesde.getMonth(), 1);
        }
        actualizarPillsFecha();
        renderCalendario();
    });

    document.getElementById('tabHasta').addEventListener('click', () => {
        estado.modoSeleccion = 'hasta';
        if (estado.fechaHasta) {
            estado.fechaCalendario = new Date(estado.fechaHasta.getFullYear(), estado.fechaHasta.getMonth(), 1);
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
        if (!estado.fechaDesde || !estado.fechaHasta) {
            mostrarEstadoHistorico('Selecciona las fechas en el calendario.', '#ff6b6b');
            return;
        }

        const fechaDesdeISO = formatearFechaISO(estado.fechaDesde);
        const fechaHastaISO = formatearFechaISO(estado.fechaHasta);
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

            estado.hayRecorridoHistorico = true;
            estado.recorridosHistoricos = recorridos;

            estado.lineasHistoricas.forEach(linea => estado.mapa.removeLayer(linea));
            estado.lineasHistoricas = [];

            estado.marcadoresHistoricos.forEach(marcador => estado.mapa.removeLayer(marcador));
            estado.marcadoresHistoricos = [];

            if (estado.lineaRecorridoSeleccionado) {
                estado.mapa.removeLayer(estado.lineaRecorridoSeleccionado);
                estado.lineaRecorridoSeleccionado = null;
            }

            if (estado.marcadorReproduccion) {
                estado.mapa.removeLayer(estado.marcadorReproduccion);
                estado.marcadorReproduccion = null;
            }

            detenerReproduccion();

            estado.recorridoSeleccionado = null;
            estado.indiceReproduccion = 0;

            mostrarListaRecorridos(estado.recorridosHistoricos);

            const reproductor = document.getElementById('reproductorHistorico');
            if (reproductor) {
                reproductor.style.display = 'none';
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

document.addEventListener('DOMContentLoaded', async () => {
    await initMap();
    initHistoricos();
});