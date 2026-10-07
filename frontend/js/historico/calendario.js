// =============================================================================
// HISTÓRICOS: CALENDARIO, CONTROLES DE HORA Y MODOS DE VISTA
// =============================================================================
import { HISTORICO_MIN_ANIO, ZOOM_CENTRADO } from '../constantes.js';
import { normalizarFecha, formatearFechaCorta } from '../utilidades.js';
import { estado } from '../estado.js';
import { removerCapasHistoricas } from './lista-slidebar.js';

// Muestra el mensaje de estado del histórico en la interfaz
export function mostrarEstadoHistorico(mensaje, color = '#B3B3B3') {
    const el = document.getElementById('estadoHistorico');
    if (el) {
        el.textContent = mensaje;
        el.style.color = color;
    }
}

// Actualiza los textos y el estado visual de los tabs de fecha
export function actualizarPillsFecha() {
    document.getElementById('txtFechaDesde').textContent = formatearFechaCorta(estado.fechaDesde);
    document.getElementById('txtFechaHasta').textContent = formatearFechaCorta(estado.fechaHasta);
    document.getElementById('tabDesde').classList.toggle('activo', estado.modoSeleccion === 'desde');
    document.getElementById('tabHasta').classList.toggle('activo', estado.modoSeleccion === 'hasta');
}

// Dibuja el calendario mensual con los días seleccionados y los rangos
export function renderCalendario() {
    const anio = estado.fechaCalendario.getFullYear();
    const mes = estado.fechaCalendario.getMonth();
    const nombresMes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    // Título del mes visible en la UI
    document.getElementById('tituloMesAnio').textContent = `${nombresMes[mes]} ${anio}`;

    const grid = document.getElementById('gridCalendario');
    grid.innerHTML = '';

    // Calcula la posición inicial según el día de la semana
    const primerDiaSemana = new Date(anio, mes, 1).getDay();
    const diasEnMes = new Date(anio, mes + 1, 0).getDate();

    // Agrega espacios vacíos para alinear los días del calendario
    for (let i = 0; i < primerDiaSemana; i++) {
        grid.appendChild(document.createElement('span'));
    }

    const tDesde = estado.fechaDesde ? normalizarFecha(estado.fechaDesde) : null;
    const tHasta = estado.fechaHasta ? normalizarFecha(estado.fechaHasta) : null;

    const hoy = new Date();
    const tiempoHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();

    // Dibuja cada día del mes
    for (let dia = 1; dia <= diasEnMes; dia++) {
        const celda = document.createElement('span');
        celda.textContent = dia;
        celda.classList.add('diaCalendario');

        const tActual = new Date(anio, mes, dia).getTime();

        // Marca los días futuros para impedir seleccionar fechas posteriores a hoy
        const esFuturo = tActual > tiempoHoy;
        if (esFuturo) {
            celda.classList.add('diaFuturo');
        }

        const esInicio = tDesde && tActual === tDesde;
        const esFin = tHasta && tActual === tHasta;
        const enRango = tDesde && tHasta && tActual > tDesde && tActual < tHasta;

        if (esInicio) celda.classList.add('diaInicio');
        if (esFin) celda.classList.add('diaFin');
        if (enRango) celda.classList.add('diaEnRango');

        // Al hacer clic en un día se selecciona la fecha de inicio o fin según el modo
        celda.addEventListener('click', () => {
            if (esFuturo) return;
            const diaClick = new Date(anio, mes, dia);

            if (estado.modoSeleccion === 'desde') {
                estado.fechaDesde = diaClick;
                if (estado.fechaHasta && normalizarFecha(estado.fechaHasta) < normalizarFecha(estado.fechaDesde)) {
                    estado.fechaHasta = new Date(estado.fechaDesde);
                }
                estado.modoSeleccion = 'hasta';
            } else {
                if (estado.fechaDesde && normalizarFecha(diaClick) < normalizarFecha(estado.fechaDesde)) {
                    estado.fechaDesde = diaClick;
                } else {
                    estado.fechaHasta = diaClick;
                }
            }

            actualizarPillsFecha();
            renderCalendario();
        });

        grid.appendChild(celda);
    }

    // Desactiva el botón para ir al mes anterior si ya llegó al mínimo permitido
    document.getElementById('btnMesAnterior').disabled = (anio === HISTORICO_MIN_ANIO && mes === 0);
}

// Cambia de mes en el calendario
export function cambiarMes(delta) {
    const nuevaFecha = new Date(estado.fechaCalendario.getFullYear(), estado.fechaCalendario.getMonth() + delta, 1);
    if (nuevaFecha.getFullYear() < HISTORICO_MIN_ANIO) return;

    estado.fechaCalendario = nuevaFecha;
    renderCalendario();
}

// Limita el valor máximo de un input de hora
export function limitarInputHora(input, max) {
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

// Configura el toggle de AM/PM para cambiar el valor del botón
export function configurarToggleAmPm(idToggle) {
    const toggle = document.getElementById(idToggle);
    toggle.addEventListener('click', () => {
        const nuevoValor = toggle.dataset.valor === 'AM' ? 'PM' : 'AM';
        toggle.dataset.valor = nuevoValor;
        toggle.classList.toggle('activoPM', nuevoValor === 'PM');
    });
}

// Convierte la hora de entrada a formato 24 horas
export function obtenerHora24(idHH, idMM, idSS, idToggle) {
    let hh = parseInt(document.getElementById(idHH).value, 10);
    if (isNaN(hh)) hh = 0;

    const mm = (document.getElementById(idMM).value || '00').padStart(2, '0');
    const ss = (document.getElementById(idSS).value || '00').padStart(2, '0');
    const esPM = document.getElementById(idToggle).dataset.valor === 'PM';

    if (hh === 12) hh = 0;
    if (esPM) hh += 12;

    return `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
}

// Cambia el texto e ícono del botón principal según el modo actual
export function actualizarBotonModo(enModoHistorico) {
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

// Controla la visibilidad del recorrido en vivo y del modo histórico
export function actualizarVisibilidadTiempoReal() {
    const panelHistoricos = document.getElementById('panelHistoricos');
    const panelAbierto = panelHistoricos && panelHistoricos.classList.contains('abierto');
    const debeOcultar = panelAbierto || estado.hayRecorridoHistorico;

    document.body.classList.toggle('modoHistorico', debeOcultar);

    if (estado.marcador) {
        estado.marcador.setOpacity(debeOcultar ? 0 : 1);
    }
    if (estado.recorrido) {
        estado.recorrido.setStyle({ opacity: debeOcultar ? 0 : 1 });
    }
}

// Abre el panel de históricos
export function abrirHistoricos() {
    const panel = document.getElementById('panelHistoricos');
    if (panel) panel.classList.add('abierto');
    actualizarBotonModo(true);
    actualizarVisibilidadTiempoReal();
}

// Vuelve al modo de recorrido en vivo y limpia todo lo histórico
export function volverARecorridoEnVivo() {
    const panel = document.getElementById('panelHistoricos');
    if (panel) panel.classList.remove('abierto');
    limpiarRecorridoHistorico();
    actualizarBotonModo(false);
    actualizarVisibilidadTiempoReal();

    if (estado.marcador && estado.marcador.getLatLng()) {
        estado.mapa.setView(estado.marcador.getLatLng(), ZOOM_CENTRADO);
    }
}

// Alterna entre vista histórica y vista en vivo
export function alternarModoHistorico() {
    const panel = document.getElementById('panelHistoricos');
    const enModoHistorico = (panel && panel.classList.contains('abierto')) || estado.hayRecorridoHistorico;

    if (enModoHistorico) {
        volverARecorridoEnVivo();
    } else {
        abrirHistoricos();
    }
}

// Limpia completamente el recorrido histórico y reinicia la interfaz
export function limpiarRecorridoHistorico() {
    estado.hayRecorridoHistorico = false;
    removerCapasHistoricas();

    // Elimina marcadores asociados
    estado.marcadoresHistoricos.forEach(marcador => estado.mapa.removeLayer(marcador));
    estado.marcadoresHistoricos = [];

    if (estado.lineaRecorridoSeleccionado) {
        estado.mapa.removeLayer(estado.lineaRecorridoSeleccionado);
        estado.lineaRecorridoSeleccionado = null;
    }

    // Quita la zona de búsqueda del mapa
    if (estado.circuloZona && estado.mapa) {
        estado.mapa.removeLayer(estado.circuloZona);
        estado.circuloZona = null;
    }
    if (estado.marcadorCentroZona && estado.mapa) {
        estado.mapa.removeLayer(estado.marcadorCentroZona);
        estado.marcadorCentroZona = null;
    }
    estado.centroZona = null;
    estado.modoSeleccionCentro = false;

    if (estado.mapa && estado.mapa.getContainer()) {
        estado.mapa.getContainer().style.cursor = '';
    }

    const contenedorRutasZona = document.getElementById('contenedorRutasZona');
    if (contenedorRutasZona) {
        contenedorRutasZona.style.display = 'none';
    }
    const listaRutasZona = document.getElementById('listaRutasZona');
    if (listaRutasZona) {
        listaRutasZona.innerHTML = '';
    }
    const estadoZona = document.getElementById('estadoZona');
    if (estadoZona) {
        estadoZona.textContent = '';
    }

    estado.recorridosHistoricos = [];
    estado.recorridoSeleccionado = null;
    estado.indiceReproduccion = 0;

    const selector = document.getElementById('selectorRecorridos');
    if (selector) {
        selector.style.display = 'none';
    }
    const reproductor = document.getElementById('reproductorHistorico');
    if (reproductor) {
        reproductor.style.display = 'none';
    }
    mostrarEstadoHistorico('');

    // Reinicia los filtros de fecha y zona a su estado base
    estado.tipoFiltroHistorico = 'fecha';
    estado.submodoFiltroZona = 'mapa';

    const btnFiltroFecha = document.getElementById('btnFiltroFecha');
    const btnFiltroZona = document.getElementById('btnFiltroZona');
    const vistaFiltroFecha = document.getElementById('vistaFiltroFecha');
    const vistaFiltroZona = document.getElementById('vistaFiltroZona');

    if (btnFiltroFecha) btnFiltroFecha.classList.add('activo');
    if (btnFiltroZona) btnFiltroZona.classList.remove('activo');
    if (vistaFiltroFecha) vistaFiltroFecha.style.display = 'flex';
    if (vistaFiltroZona) vistaFiltroZona.style.display = 'none';

    // Oculta la barra de búsqueda por lugar
    const contenedorBusqueda = document.getElementById('contenedorBusquedaLugar');
    if (contenedorBusqueda) contenedorBusqueda.style.display = 'none';

    const inputBusqueda = document.getElementById('inputBusquedaLugar');
    if (inputBusqueda) inputBusqueda.value = '';

    const sugerencias = document.getElementById('sugerenciasBusquedaLugar');
    if (sugerencias) {
        sugerencias.style.display = 'none';
        sugerencias.innerHTML = '';
    }

    const btnLimpiarBusqueda = document.getElementById('btnLimpiarBusquedaLugar');
    if (btnLimpiarBusqueda) btnLimpiarBusqueda.style.display = 'none';

    const btnSubmodoMapa = document.getElementById('btnSubmodoMapa');
    const btnSubmodoLugar = document.getElementById('btnSubmodoLugar');
    if (btnSubmodoMapa) btnSubmodoMapa.classList.add('activo');
    if (btnSubmodoLugar) btnSubmodoLugar.classList.remove('activo');

    const btnMoverCentro = document.getElementById('btnMoverCentroZona');
    if (btnMoverCentro) btnMoverCentro.style.display = '';
}
