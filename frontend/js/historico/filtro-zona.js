// =============================================================================
// HISTÓRICOS: FILTRO POR ZONA GEOGRÁFICA
// =============================================================================
import { estado } from '../estado.js';
import { RADIO_DEFAULT_METROS, NOMINATIM_URL } from '../constantes.js';
import {
    formatearRadio,
    distanciaSegmentoAPunto
} from '../utilidades.js';
import {
    removerCapasHistoricas,
    mostrarListaRecorridos
} from './lista-slidebar.js';

let debounceTimer = null;
let indiceSugerenciaSeleccionada = -1;
let sugerenciasActuales = [];
let temporizadorArrastreZona = null;

function alTerminarMoverZona() {
    estado.arrastrandoZona = true;
    if (temporizadorArrastreZona) {
        clearTimeout(temporizadorArrastreZona);
    }
    temporizadorArrastreZona = setTimeout(() => {
        estado.arrastrandoZona = false;
        temporizadorArrastreZona = null;
    }, 150);
    console.log('[Locator] Centro de zona movido:', estado.centroZona);
}

function obtenerPuntoContenedorPuntero(evento) {
    const contenedor = estado.mapa.getContainer();
    const rectangulo = contenedor.getBoundingClientRect();
    return estado.mapa.containerPointToLatLng([
        evento.clientX - rectangulo.left,
        evento.clientY - rectangulo.top
    ]);
}

function configurarArrastreCirculo() {
    const elemento = estado.circuloZona && estado.circuloZona.getElement();
    if (!elemento || elemento.dataset.arrastreConfigurado === 'true') return;

    elemento.dataset.arrastreConfigurado = 'true';
    elemento.addEventListener('pointerdown', (evento) => {
        if (!estado.zonaActiva || !estado.mapa || !estado.circuloZona) return;

        evento.preventDefault();
        evento.stopPropagation();
        estado.arrastrandoZona = true;
        elemento.classList.add('arrastrando');

        const centroActual = estado.circuloZona.getLatLng();
        const puntoCentro = estado.mapa.latLngToContainerPoint(centroActual);
        const contenedor = estado.mapa.getContainer();
        const rectangulo = contenedor.getBoundingClientRect();
        const puntoPuntero = {
            x: evento.clientX - rectangulo.left,
            y: evento.clientY - rectangulo.top
        };
        const desplazamiento = {
            x: puntoPuntero.x - puntoCentro.x,
            y: puntoPuntero.y - puntoCentro.y
        };

        elemento.setPointerCapture(evento.pointerId);
        estado.mapa.dragging.disable();

        const moverCirculo = (movimiento) => {
            const puntoActual = obtenerPuntoContenedorPuntero(movimiento);
            const puntoActualContenedor = estado.mapa.latLngToContainerPoint(puntoActual);
            const nuevoCentro = estado.mapa.containerPointToLatLng([
                puntoActualContenedor.x - desplazamiento.x,
                puntoActualContenedor.y - desplazamiento.y
            ]);
            establecerCentroZona(nuevoCentro);
            estado.arrastrandoZona = true;
        };

        const finalizarArrastre = (movimiento) => {
            elemento.removeEventListener('pointermove', moverCirculo);
            elemento.removeEventListener('pointerup', finalizarArrastre);
            elemento.removeEventListener('pointercancel', finalizarArrastre);
            if (elemento.hasPointerCapture(movimiento.pointerId)) {
                elemento.releasePointerCapture(movimiento.pointerId);
            }
            elemento.classList.remove('arrastrando');
            estado.mapa.dragging.enable();
            alTerminarMoverZona();
        };

        elemento.addEventListener('pointermove', moverCirculo);
        elemento.addEventListener('pointerup', finalizarArrastre);
        elemento.addEventListener('pointercancel', finalizarArrastre);
    });
}

// Activa el modo para seleccionar el centro de la zona haciendo clic en el mapa
export function activarModoSeleccionCentro() {
    estado.modoSeleccionCentro = true;
    if (estado.mapa && estado.mapa.getContainer()) {
        estado.mapa.getContainer().style.cursor = 'crosshair';
    }
    const instruccion = document.getElementById('instruccionZona');
    if (instruccion) {
        instruccion.textContent = 'Haz clic en el mapa para colocar el centro de búsqueda.';
        instruccion.style.color = '#dc0303';
    }
    registrarClickMapaZona();
}

// Desactiva el modo de selección de centro
export function desactivarModoSeleccionCentro() {
    estado.modoSeleccionCentro = false;
    if (estado.mapa && estado.mapa.getContainer()) {
        estado.mapa.getContainer().style.cursor = '';
    }
}

// Activa la interfaz del filtro por zona según el submodo actual
export function activarModoFiltroZonaUI() {
    const btnMover = document.getElementById('btnMoverCentroZona');

    if (estado.submodoFiltroZona === 'lugar') {
        if (btnMover) btnMover.style.display = 'none';
        mostrarBarraBusquedaLugar();
        desactivarModoSeleccionCentro();
    } else {
        if (btnMover) btnMover.style.display = '';
        ocultarBarraBusquedaLugar();
        registrarClickMapaZona();
        if (!estado.centroZona) {
            activarModoSeleccionCentro();
        }
    }
}

// Cierra los elementos del filtro por zona
export function desactivarModoFiltroZonaUI() {
    desactivarModoSeleccionCentro();
    ocultarBarraBusquedaLugar();
}

// Guarda el centro de la zona y dibuja el círculo del radio en el mapa
export function establecerCentroZona(latlng, centrarMapa = false) {
    console.log('[Locator] Estableciendo centro de zona en:', latlng);
    estado.centroZona = { lat: latlng.lat, lng: latlng.lng };

    const radio = estado.radioZona || 300;

    // Crea el círculo si no existe
    if (!estado.circuloZona) {
        estado.circuloZona = L.circle([latlng.lat, latlng.lng], {
            radius: radio,
            color: '#dc0303',
            weight: 2,
            fillColor: '#dc0303',
            fillOpacity: 0.15,
            dashArray: '5,5',
            className: 'circulo-zona-arrastrable'
        }).addTo(estado.mapa);
        configurarArrastreCirculo();
    } else {
        estado.circuloZona.setLatLng(latlng);
        estado.circuloZona.setRadius(radio);
    }

    // Crea o mueve el marcador central
    if (!estado.marcadorCentroZona) {
        estado.marcadorCentroZona = L.marker([latlng.lat, latlng.lng], {
            draggable: true,
            icon: L.divIcon({
                className: 'marcador-centro-zona',
                html: `<div style="width:16px;height:16px;border-radius:50%;background:#dc0303;border:2px solid #ffffff;box-shadow:0 0 6px rgba(0,0,0,0.6), 0 0 10px rgba(220,3,3,0.8);box-sizing:border-box;"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            })
        }).addTo(estado.mapa);

        estado.marcadorCentroZona.on('drag', (e) => {
            const nuevaPos = e.target.getLatLng();
            estado.centroZona = { lat: nuevaPos.lat, lng: nuevaPos.lng };
            if (estado.circuloZona) {
                estado.circuloZona.setLatLng(nuevaPos);
            }
        });
        estado.marcadorCentroZona.on('dragstart', () => {
            estado.arrastrandoZona = true;
        });
        estado.marcadorCentroZona.on('dragend', () => {
            alTerminarMoverZona();
        });
    } else {
        estado.marcadorCentroZona.setLatLng(latlng);
    }

    if (centrarMapa && estado.mapa) {
        estado.mapa.setView([latlng.lat, latlng.lng], 15);
    }

    const instruccion = document.getElementById('instruccionZona');
    if (instruccion) {
        instruccion.textContent = 'Centro colocado. Ajusta el radio y presiona “Buscar en esta zona”.';
        instruccion.style.color = '#B3B3B3';
    }

    desactivarModoSeleccionCentro();
}

// Actualiza el radio de la zona y lo refleja en la interfaz
export function actualizarRadioZona(nuevoRadio) {
    estado.radioZona = nuevoRadio;
    const txt = document.getElementById('valorRadioZona');
    if (txt) {
        txt.textContent = formatearRadio(nuevoRadio);
    }
    if (estado.circuloZona) {
        estado.circuloZona.setRadius(nuevoRadio);
    }
}

// Busca rutas que pasen por la zona seleccionada
export function buscarRutasEnZona() {
    if (!estado.centroZona) {
        const instruccion = document.getElementById('instruccionZona');
        if (instruccion) {
            if (estado.submodoFiltroZona === 'lugar') {
                instruccion.textContent = '⚠️ Primero busca una dirección o lugar en la barra superior.';
                instruccion.style.color = '#ff6b6b';
                mostrarBarraBusquedaLugar();
            } else {
                instruccion.textContent = '⚠️ Primero haz clic en el mapa para colocar el centro de búsqueda.';
                instruccion.style.color = '#ff6b6b';
                activarModoSeleccionCentro();
            }
        }
        return;
    }

    const estadoEl = document.getElementById('estadoZona');

    if (estadoEl) {
        estadoEl.textContent = 'Filtrando rutas en la zona...';
        estadoEl.style.color = '#B3B3B3';
    }

    const centro = L.latLng(estado.centroZona.lat, estado.centroZona.lng);
    const radio = estado.radioZona;
    const rutasFiltradas = estado.recorridosBase.filter(recorrido => {
        const puntoDentro = recorrido.some(p => L.latLng(p.lat, p.lng).distanceTo(centro) <= radio);
        if (puntoDentro) return true;
        for (let i = 1; i < recorrido.length; i++) {
            if (distanciaSegmentoAPunto(recorrido[i - 1], recorrido[i], centro) <= radio) {
                return true;
            }
        }
        return false;
    });

    estado.recorridosHistoricos = rutasFiltradas;
    removerCapasHistoricas();
    mostrarListaRecorridos(rutasFiltradas);

    if (estadoEl) {
        estadoEl.textContent = rutasFiltradas.length
            ? `${rutasFiltradas.length} ruta(s) encontrada(s) en la zona`
            : 'No se encontraron rutas que pasen por esta zona.';
        estadoEl.style.color = rutasFiltradas.length ? '#4cd964' : '#e5a50a';
    }
}

// Limpia la zona de búsqueda y elimina los elementos del mapa
export function limpiarZona() {
    if (estado.circuloZona && estado.mapa) {
        estado.mapa.removeLayer(estado.circuloZona);
        estado.circuloZona = null;
    }
    if (estado.marcadorCentroZona && estado.mapa) {
        estado.mapa.removeLayer(estado.marcadorCentroZona);
        estado.marcadorCentroZona = null;
    }
    estado.centroZona = null;

    removerCapasHistoricas();
    estado.recorridosHistoricos = estado.recorridosBase;
    mostrarListaRecorridos(estado.recorridosHistoricos);

    const estadoEl = document.getElementById('estadoZona');
    if (estadoEl) estadoEl.textContent = '';

    const inputBusqueda = document.getElementById('inputBusquedaLugar');
    if (inputBusqueda) inputBusqueda.value = '';
    const btnLimpiarBusqueda = document.getElementById('btnLimpiarBusquedaLugar');
    if (btnLimpiarBusqueda) btnLimpiarBusqueda.style.display = 'none';
    cerrarSugerencias();

    const instruccion = document.getElementById('instruccionZona');
    const btnMover = document.getElementById('btnMoverCentroZona');
    if (instruccion) {
        if (estado.submodoFiltroZona === 'lugar') {
            if (btnMover) btnMover.style.display = 'none';
            instruccion.textContent = 'Usa la barra superior para buscar un lugar o dirección.';
            instruccion.style.color = '#B3B3B3';
            desactivarModoSeleccionCentro();
        } else {
            if (btnMover) btnMover.style.display = '';
            instruccion.textContent = 'Haz clic en el mapa para colocar el centro de búsqueda.';
            instruccion.style.color = '#B3B3B3';
            if (estado.zonaActiva) {
                activarModoSeleccionCentro();
            } else {
                desactivarModoSeleccionCentro();
            }
        }
    } else {
        desactivarModoSeleccionCentro();
    }
}

// Registra el clic en el mapa para elegir el centro de la zona
export function registrarClickMapaZona() {
    if (estado.mapa && !estado.mapa._listenerZonaRegistrado) {
        estado.mapa.on('click', (e) => {
            console.log('[Locator] Clic en mapa detectado:', e.latlng);
            if (estado.arrastrandoZona) return;
            if (estado.zonaActiva) {
                if (estado.submodoFiltroZona === 'mapa' && (estado.modoSeleccionCentro || !estado.centroZona)) {
                    establecerCentroZona(e.latlng);
                }
            }
        });
        estado.mapa._listenerZonaRegistrado = true;
    }
}

// Muestra la barra para buscar por lugar o dirección
export function mostrarBarraBusquedaLugar() {
    const contenedor = document.getElementById('contenedorBusquedaLugar');
    if (contenedor) {
        contenedor.style.display = 'flex';
        const input = document.getElementById('inputBusquedaLugar');
        if (input) input.focus();
    }
}

// Oculta la barra de búsqueda y cierra sugerencias
export function ocultarBarraBusquedaLugar() {
    const contenedor = document.getElementById('contenedorBusquedaLugar');
    if (contenedor) {
        contenedor.style.display = 'none';
    }
    cerrarSugerencias();
}

// Cierra las sugerencias actuales de búsqueda
function cerrarSugerencias() {
    const sugerenciasEl = document.getElementById('sugerenciasBusquedaLugar');
    if (sugerenciasEl) {
        sugerenciasEl.style.display = 'none';
        sugerenciasEl.innerHTML = '';
    }
    indiceSugerenciaSeleccionada = -1;
    sugerenciasActuales = [];
}

// Cambia entre buscar por mapa o por lugar
export function cambiarSubmodoZona(nuevoSubmodo) {
    estado.submodoFiltroZona = nuevoSubmodo;

    const btnMapa = document.getElementById('btnSubmodoMapa');
    const btnLugar = document.getElementById('btnSubmodoLugar');
    const instruccion = document.getElementById('instruccionZona');
    const btnMover = document.getElementById('btnMoverCentroZona');

    if (btnMapa) btnMapa.classList.toggle('activo', nuevoSubmodo === 'mapa');
    if (btnLugar) btnLugar.classList.toggle('activo', nuevoSubmodo === 'lugar');

    if (nuevoSubmodo === 'mapa') {
        if (btnMover) btnMover.style.display = '';
        ocultarBarraBusquedaLugar();
        if (!estado.centroZona) {
            activarModoSeleccionCentro();
        } else {
            desactivarModoSeleccionCentro();
            if (instruccion) {
                instruccion.textContent = 'Centro colocado. Ajusta el radio y presiona “Buscar en esta zona”.';
                instruccion.style.color = '#B3B3B3';
            }
        }
    } else {
        if (btnMover) btnMover.style.display = 'none';
        desactivarModoSeleccionCentro();
        mostrarBarraBusquedaLugar();
        if (instruccion) {
            if (!estado.centroZona) {
                instruccion.textContent = 'Usa la barra superior para buscar un lugar o dirección.';
                instruccion.style.color = '#B3B3B3';
            } else {
                instruccion.textContent = 'Centro colocado. Ajusta el radio y presiona “Buscar en esta zona”.';
                instruccion.style.color = '#B3B3B3';
            }
        }
    }
}

// Consulta lugares con Nominatim según el texto ingresado
async function buscarLugares(query) {
    const spinner = document.getElementById('spinnerBusquedaLugar');
    const sugerenciasEl = document.getElementById('sugerenciasBusquedaLugar');
    if (!sugerenciasEl) return;

    if (!query || query.trim().length < 3) {
        cerrarSugerencias();
        return;
    }

    if (spinner) spinner.style.display = 'block';

    try {
        const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query.trim())}&limit=5&addressdetails=1`;
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resultados = await res.json();

        sugerenciasEl.innerHTML = '';
        sugerenciasActuales = resultados;
        indiceSugerenciaSeleccionada = -1;

        if (!resultados || resultados.length === 0) {
            sugerenciasEl.innerHTML = '<div class="mensajeSugerencia">No se encontraron resultados</div>';
            sugerenciasEl.style.display = 'flex';
            return;
        }

        resultados.forEach((item, idx) => {
            const partes = item.display_name.split(',');
            const titulo = partes[0].trim();
            const subtitulo = partes.slice(1).join(',').trim();

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'itemSugerencia';
            btn.dataset.index = idx;
            btn.innerHTML = `
                <span class="tituloSugerencia">${titulo}</span>
                ${subtitulo ? `<span class="subtituloSugerencia">${subtitulo}</span>` : ''}
            `;

            btn.addEventListener('click', () => {
                seleccionarSugerencia(item);
            });

            sugerenciasEl.appendChild(btn);
        });

        sugerenciasEl.style.display = 'flex';
    } catch (err) {
        console.error('Error al geocodificar:', err);
        sugerenciasEl.innerHTML = '<div class="mensajeSugerencia">Error al buscar ubicación</div>';
        sugerenciasEl.style.display = 'flex';
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}

// Selecciona una sugerencia y centra la vista en ese lugar
function seleccionarSugerencia(item) {
    const input = document.getElementById('inputBusquedaLugar');
    if (input) {
        const partes = item.display_name.split(',');
        input.value = partes.slice(0, 2).join(',').trim();
    }
    cerrarSugerencias();

    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);

    if (!isNaN(lat) && !isNaN(lng)) {
        establecerCentroZona({ lat, lng }, true);
    }
}

// Marca visualmente la sugerencia activa en el teclado
function actualizarSeleccionVisualSugerencias(items) {
    items.forEach((it, idx) => {
        it.classList.toggle('activo', idx === indiceSugerenciaSeleccionada);
        if (idx === indiceSugerenciaSeleccionada) {
            it.scrollIntoView({ block: 'nearest' });
        }
    });
}

// Configura la búsqueda por lugar en el input
export function initBusquedaLugar() {
    const input = document.getElementById('inputBusquedaLugar');
    const btnLimpiar = document.getElementById('btnLimpiarBusquedaLugar');
    const contenedor = document.getElementById('contenedorBusquedaLugar');
    const sugerenciasEl = document.getElementById('sugerenciasBusquedaLugar');

    if (!input) return;

    input.addEventListener('input', () => {
        const val = input.value;
        if (btnLimpiar) btnLimpiar.style.display = val ? 'block' : 'none';

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            buscarLugares(val);
        }, 350);
    });

    if (btnLimpiar) {
        btnLimpiar.addEventListener('click', () => {
            input.value = '';
            btnLimpiar.style.display = 'none';
            cerrarSugerencias();
            input.focus();
        });
    }

    input.addEventListener('keydown', (e) => {
        const items = sugerenciasEl ? sugerenciasEl.querySelectorAll('.itemSugerencia') : [];
        if (!items || items.length === 0) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (debounceTimer) clearTimeout(debounceTimer);
                buscarLugares(input.value);
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            indiceSugerenciaSeleccionada = (indiceSugerenciaSeleccionada + 1) % items.length;
            actualizarSeleccionVisualSugerencias(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            indiceSugerenciaSeleccionada = (indiceSugerenciaSeleccionada - 1 + items.length) % items.length;
            actualizarSeleccionVisualSugerencias(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (indiceSugerenciaSeleccionada >= 0 && sugerenciasActuales[indiceSugerenciaSeleccionada]) {
                seleccionarSugerencia(sugerenciasActuales[indiceSugerenciaSeleccionada]);
            } else if (sugerenciasActuales.length > 0) {
                seleccionarSugerencia(sugerenciasActuales[0]);
            }
        } else if (e.key === 'Escape') {
            cerrarSugerencias();
        }
    });

    document.addEventListener('click', (e) => {
        if (contenedor && !contenedor.contains(e.target)) {
            cerrarSugerencias();
        }
    });
}

// Inicializa el filtro por zona y sus eventos
export function initFiltroZona() {
    const slider = document.getElementById('sliderRadioZona');
    if (slider) {
        slider.value = RADIO_DEFAULT_METROS;
        slider.addEventListener('input', () => {
            actualizarRadioZona(parseInt(slider.value, 10));
        });
    }

    const btnMover = document.getElementById('btnMoverCentroZona');
    if (btnMover) {
        btnMover.addEventListener('click', () => {
            activarModoSeleccionCentro();
        });
    }

    const btnLimpiar = document.getElementById('btnLimpiarZona');
    if (btnLimpiar) {
        btnLimpiar.addEventListener('click', () => {
            limpiarZona();
        });
    }

    const btnBuscar = document.getElementById('btnBuscarZona');
    if (btnBuscar) btnBuscar.addEventListener('click', buscarRutasEnZona);

    const btnSubmodoMapa = document.getElementById('btnSubmodoMapa');
    const btnSubmodoLugar = document.getElementById('btnSubmodoLugar');

    if (btnSubmodoMapa) {
        btnSubmodoMapa.addEventListener('click', () => {
            cambiarSubmodoZona('mapa');
        });
    }

    if (btnSubmodoLugar) {
        btnSubmodoLugar.addEventListener('click', () => {
            cambiarSubmodoZona('lugar');
        });
    }

    initBusquedaLugar();
    registrarClickMapaZona();
}
