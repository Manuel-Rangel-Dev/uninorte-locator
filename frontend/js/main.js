// Importaciones de módulos necesarios para la aplicación
import { API_BASE } from './constantes.js';
import { estado } from './estado.js';
import { formatearFechaISO } from './utilidades.js';
import { segmentarRecorridos } from './historico/segmentacion.js';
import {
    mostrarListaRecorridos,
    iniciarReproduccion,
    detenerReproduccion,
    actualizarPuntoReproduccion,
    removerCapasHistoricas
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
    minimizarPanelHistoricos,
    restaurarPanelHistoricos,
    actualizarVisibilidadTiempoReal,
    limpiarRecorridoHistorico
} from './historico/calendario.js';
import { initMap } from './mapa-vivo.js';
import {
    initFiltroZona,
    activarModoFiltroZonaUI,
    desactivarModoFiltroZonaUI,
    limpiarZona
} from './historico/filtro-zona.js';

// Configura el título de la página con el nombre del integrante si está disponible
if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.integrante) {
    document.title = APP_CONFIG.integrante;
}

// Función que inicializa todos los eventos y filtros del modo histórico
function initHistoricos() {
    // Inicia la funcionalidad de filtro por zona
    initFiltroZona();

    // Configura el botón para abrir o cerrar el filtro por zona
    const btnFiltrarPorZona = document.getElementById('btnFiltrarPorZona');
    const vistaFiltroZona = document.getElementById('vistaFiltroZona');
    if (btnFiltrarPorZona) {
        btnFiltrarPorZona.addEventListener('click', () => {
            estado.zonaActiva = !estado.zonaActiva;
            btnFiltrarPorZona.classList.toggle('activo', estado.zonaActiva);
            if (vistaFiltroZona) {
                vistaFiltroZona.style.display = estado.zonaActiva ? 'flex' : 'none';
            }
            if (estado.zonaActiva) {
                activarModoFiltroZonaUI();
            } else {
                desactivarModoFiltroZonaUI();
                limpiarZona();
            }
        });
    }

    // Configura el botón para reproducir o pausar el recorrido
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

    // Configura el botón para reiniciar el recorrido desde el inicio
    const btnReiniciarRecorrido = document.getElementById('btnReiniciarRecorrido');
    if (btnReiniciarRecorrido) {
        btnReiniciarRecorrido.addEventListener('click', () => {
            detenerReproduccion();
            // Reinicia el índice de reproducción a cero
            estado.indiceReproduccion = 0;
            actualizarPuntoReproduccion(0);
        });
    }

    // Configura el slider para controlar manualmente la posición del recorrido
    const sliderRecorrido = document.getElementById('sliderRecorrido');
    if (sliderRecorrido) {
        sliderRecorrido.addEventListener('input', () => {
            const indice = parseInt(sliderRecorrido.value, 10);
            // Detiene la reproducción al mover el slider
            detenerReproduccion();
            actualizarPuntoReproduccion(indice);
        });
    }

    // Listener para alternar entre modo histórico y modo en vivo
    document.getElementById('btnHistoricos').addEventListener('click', alternarModoHistorico);

    // Listeners para minimizar y restaurar el panel sin salir del modo histórico
    const btnMinimizarPanel = document.getElementById('btnMinimizarPanel');
    if (btnMinimizarPanel) {
        btnMinimizarPanel.addEventListener('click', minimizarPanelHistoricos);
    }

    const btnRestaurarPanel = document.getElementById('btnRestaurarPanel');
    if (btnRestaurarPanel) {
        btnRestaurarPanel.addEventListener('click', restaurarPanelHistoricos);
    }

    // Listener para seleccionar la fecha inicial del rango
    document.getElementById('tabDesde').addEventListener('click', () => {
        estado.modoSeleccion = 'desde';
        // Posiciona el calendario en el mes de la fecha seleccionada
        if (estado.fechaDesde) {
            estado.fechaCalendario = new Date(estado.fechaDesde.getFullYear(), estado.fechaDesde.getMonth(), 1);
        }
        actualizarPillsFecha();
        renderCalendario();
    });

    // Listener para seleccionar la fecha final del rango
    document.getElementById('tabHasta').addEventListener('click', () => {
        estado.modoSeleccion = 'hasta';
        // Posiciona el calendario en el mes de la fecha seleccionada
        if (estado.fechaHasta) {
            estado.fechaCalendario = new Date(estado.fechaHasta.getFullYear(), estado.fechaHasta.getMonth(), 1);
        }
        actualizarPillsFecha();
        renderCalendario();
    });

    // Listeners para navegar entre meses en el calendario
    document.getElementById('btnMesAnterior').addEventListener('click', () => cambiarMes(-1));
    document.getElementById('btnMesSiguiente').addEventListener('click', () => cambiarMes(1));

    // Limita los inputs de hora para que no superen los valores máximos
    limitarInputHora(document.getElementById('horaDesdeHH'), 12);
    limitarInputHora(document.getElementById('horaDesdeMM'), 59);
    limitarInputHora(document.getElementById('horaDesdeSS'), 59);
    limitarInputHora(document.getElementById('horaHastaHH'), 12);
    limitarInputHora(document.getElementById('horaHastaMM'), 59);
    limitarInputHora(document.getElementById('horaHastaSS'), 59);

    // Configura los toggles de AM/PM para ambas horas
    configurarToggleAmPm('toggleDesde');
    configurarToggleAmPm('toggleHasta');

    // Listener principal para buscar y mostrar recorridos históricos
    document.getElementById('btnVerRecorrido').addEventListener('click', async () => {
        // Valida que ambas fechas estén seleccionadas
        if (!estado.fechaDesde || !estado.fechaHasta) {
            mostrarEstadoHistorico('Selecciona las fechas en el calendario.', '#ff6b6b');
            return;
        }

        // Convierte las fechas a formato ISO
        const fechaDesdeISO = formatearFechaISO(estado.fechaDesde);
        const fechaHastaISO = formatearFechaISO(estado.fechaHasta);
        // Obtiene las horas en formato 24 horas
        const horaDesde = obtenerHora24('horaDesdeHH', 'horaDesdeMM', 'horaDesdeSS', 'toggleDesde');
        const horaHasta = obtenerHora24('horaHastaHH', 'horaHastaMM', 'horaHastaSS', 'toggleHasta');

        // Crea objetos Date para validar el rango de tiempo
        const dtInicio = new Date(`${fechaDesdeISO}T${horaDesde}`);
        const dtFin = new Date(`${fechaHastaISO}T${horaHasta}`);

        // Valida que la fecha final sea posterior a la inicial
        if (dtFin < dtInicio) {
            mostrarEstadoHistorico('La fecha/hora final debe ser posterior a la inicial.', '#ff6b6b');
            return;
        }

        // Muestra mensaje de carga y desactiva el botón
        mostrarEstadoHistorico('Cargando recorrido...', '#B3B3B3');
        document.getElementById('btnVerRecorrido').disabled = true;
        estado.zonaActiva = false;
        estado.mostrarTodasLasRutas = false;
        limpiarZona();

        try {
            // Construye la URL de la API con los parámetros de fecha y hora
            const url = `${API_BASE}/api/historico?fecha_desde=${fechaDesdeISO}&hora_desde=${horaDesde}&fecha_hasta=${fechaHastaISO}&hora_hasta=${horaHasta}`;
            const respuesta = await fetch(url);
            // Verifica si la respuesta fue exitosa
            if (!respuesta.ok) {
                const errData = await respuesta.json().catch(() => null);
                throw new Error(errData && errData.error ? errData.error : `HTTP ${respuesta.status}`);
            }
            // Obtiene los puntos del recorrido histórico
            const puntos = await respuesta.json();
            // Si no hay puntos, muestra un mensaje y sale
            if (!puntos || puntos.length === 0) {
                limpiarRecorridoHistorico();
                mostrarEstadoHistorico('No hay recorridos en este rango.', '#e5a50a');
                return;
            }

            // Segmenta los puntos en recorridos separados
            const recorridos = segmentarRecorridos(puntos);

            // Si no hay recorridos después de segmentar, muestra un mensaje y sale
            if (recorridos.length === 0) {
                limpiarRecorridoHistorico();
                mostrarEstadoHistorico('No hay recorridos en este rango.', '#e5a50a');
                return;
            }

            // Actualiza el estado con los recorridos encontrados
            estado.hayRecorridoHistorico = true;
            estado.recorridosBase = recorridos;
            estado.recorridosHistoricos = recorridos;

            // Elimina todas las capas históricas anteriores del mapa
            removerCapasHistoricas();

            // Elimina la línea del recorrido seleccionado si existe
            if (estado.lineaRecorridoSeleccionado) {
                estado.mapa.removeLayer(estado.lineaRecorridoSeleccionado);
                estado.lineaRecorridoSeleccionado = null;
            }

            // Reinicia los índices de reproducción
            estado.recorridoSeleccionado = null;
            estado.indiceReproduccion = 0;

            // Muestra la lista de recorridos encontrados
            mostrarListaRecorridos(estado.recorridosHistoricos);

            const botonZona = document.getElementById('btnFiltrarPorZona');
            if (botonZona) {
                botonZona.style.display = 'block';
                botonZona.classList.remove('activo');
            }
            const vistaZona = document.getElementById('vistaFiltroZona');
            if (vistaZona) vistaZona.style.display = 'none';

            // Muestra mensaje de éxito con la cantidad de recorridos encontrados
            mostrarEstadoHistorico(`${recorridos.length} recorrido(s) encontrado(s)`, '#4cd964');

            // Actualiza la visibilidad del modo en vivo
            actualizarVisibilidadTiempoReal();

        } catch (error) {
            // Maneja errores en la solicitud
            console.error('Error al obtener histórico:', error);
            mostrarEstadoHistorico(error.message || 'Error al cargar histórico', '#ff6b6b');
        } finally {
            // Re-activa el botón independientemente del resultado
            document.getElementById('btnVerRecorrido').disabled = false;
        }
    });

    // Inicializa la interfaz del calendario al cargar la página
    actualizarPillsFecha();
    renderCalendario();
}

// Función principal de inicialización de la aplicación
async function bootstrap() {
    console.log('[Locator] Inicializando aplicación (v11)...');
    // Intenta inicializar el mapa
    try {
        await initMap();
    } catch (err) {
        console.error('[Locator] Error al inicializar el mapa:', err);
    }
    // Intenta inicializar los históricos
    try {
        initHistoricos();
    } catch (err) {
        console.error('[Locator] Error al inicializar históricos:', err);
    }
}

// Espera a que el DOM esté completamente cargado antes de ejecutar bootstrap
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    // Si el DOM ya está cargado, ejecuta bootstrap inmediatamente
    bootstrap();
}
