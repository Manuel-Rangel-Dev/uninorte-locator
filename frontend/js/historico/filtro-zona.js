// =============================================================================
// HISTÓRICOS: FILTRO POR ZONA GEOGRÁFICA
// =============================================================================
import { estado } from '../estado.js';
import { API_BASE, RADIO_DEFAULT_METROS, NOMINATIM_URL } from '../constantes.js';
import {
    formatearRadio,
    formatearFechaHoraCard,
    formatearDistancia,
    distanciaSegmentoAPunto
} from '../utilidades.js';
import { segmentarRecorridos, calcularDistanciaRecorrido } from './segmentacion.js';
import { seleccionarRecorrido, detenerReproduccion } from './lista-slidebar.js';
import { actualizarVisibilidadTiempoReal } from './calendario.js';

const COLORES_BARRA = ['#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#8b5cf6', '#3b82f6'];

let debounceTimer = null;
let indiceSugerenciaSeleccionada = -1;
let sugerenciasActuales = [];

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

export function desactivarModoSeleccionCentro() {
    estado.modoSeleccionCentro = false;
    if (estado.mapa && estado.mapa.getContainer()) {
        estado.mapa.getContainer().style.cursor = '';
    }
}

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

export function desactivarModoFiltroZonaUI() {
    desactivarModoSeleccionCentro();
    ocultarBarraBusquedaLugar();
}

export function establecerCentroZona(latlng, centrarMapa = false) {
    console.log('[Locator] Estableciendo centro de zona en:', latlng);
    estado.centroZona = { lat: latlng.lat, lng: latlng.lng };

    const radio = estado.radioZona || 300;

    if (!estado.circuloZona) {
        estado.circuloZona = L.circle([latlng.lat, latlng.lng], {
            radius: radio,
            color: '#dc0303',
            weight: 2,
            fillColor: '#dc0303',
            fillOpacity: 0.15,
            dashArray: '5,5'
        }).addTo(estado.mapa);
    } else {
        estado.circuloZona.setLatLng(latlng);
        estado.circuloZona.setRadius(radio);
    }

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

export async function obtenerPuntosHistoricosCompletos() {
    if (estado.cachePuntosHistoricos && estado.cachePuntosHistoricos.length > 0) {
        return estado.cachePuntosHistoricos;
    }
    const url = `${API_BASE}/api/historico?fecha_desde=2020-01-01&hora_desde=00:00:00&fecha_hasta=2030-01-01&hora_hasta=23:59:59`;
    const res = await fetch(url);
    if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err && err.error ? err.error : `HTTP ${res.status}`);
    }
    const puntos = await res.json();
    estado.cachePuntosHistoricos = puntos;
    return puntos;
}

export async function buscarRutasEnZona() {
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
    const btnBuscar = document.getElementById('btnBuscarZona');
    const contenedorRutas = document.getElementById('contenedorRutasZona');
    const listaRutas = document.getElementById('listaRutasZona');

    if (estadoEl) {
        estadoEl.textContent = 'Buscando rutas en la zona...';
        estadoEl.style.color = '#B3B3B3';
    }
    if (btnBuscar) btnBuscar.disabled = true;

    try {
        const puntos = await obtenerPuntosHistoricosCompletos();
        if (!puntos || puntos.length === 0) {
            if (estadoEl) {
                estadoEl.textContent = 'No hay datos históricos disponibles.';
                estadoEl.style.color = '#e5a50a';
            }
            if (contenedorRutas) contenedorRutas.style.display = 'none';
            return;
        }

        const recorridos = segmentarRecorridos(puntos);
        const centro = L.latLng(estado.centroZona.lat, estado.centroZona.lng);
        const radio = estado.radioZona;

        const rutasFiltradas = recorridos.filter(recorrido => {
            const puntoDentro = recorrido.some(p => L.latLng(p.lat, p.lng).distanceTo(centro) <= radio);
            if (puntoDentro) return true;

            for (let i = 1; i < recorrido.length; i++) {
                if (distanciaSegmentoAPunto(recorrido[i - 1], recorrido[i], centro) <= radio) {
                    return true;
                }
            }
            return false;
        });

        estado.hayRecorridoHistorico = true;
        estado.recorridosHistoricos = rutasFiltradas;
        actualizarVisibilidadTiempoReal();

        if (rutasFiltradas.length === 0) {
            if (estadoEl) {
                estadoEl.textContent = 'No se encontraron rutas que pasen por esta zona.';
                estadoEl.style.color = '#e5a50a';
            }
            if (contenedorRutas) contenedorRutas.style.display = 'none';
            return;
        }

        if (estadoEl) {
            estadoEl.textContent = `${rutasFiltradas.length} ruta(s) encontrada(s) en la zona`;
            estadoEl.style.color = '#4cd964';
        }

        if (listaRutas) {
            listaRutas.innerHTML = '';
            rutasFiltradas.forEach((rec, idx) => {
                const inicio = rec[0];
                const fin = rec[rec.length - 1];
                const distancia = calcularDistanciaRecorrido(rec);
                const colorBarra = COLORES_BARRA[idx % COLORES_BARRA.length];

                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'cardRutaZona';
                card.dataset.indice = idx;
                card.style.borderLeft = `6px solid ${colorBarra}`;

                card.innerHTML = `
                    <div class="filaDatoZona">
                        <span class="lblRutaZona">DESDE</span>
                        <span class="valRutaZona">${formatearFechaHoraCard(inicio.fecha, inicio.hora)}</span>
                    </div>
                    <div class="filaDatoZona">
                        <span class="lblRutaZona">HASTA</span>
                        <span class="valRutaZona">${formatearFechaHoraCard(fin.fecha, fin.hora)}</span>
                    </div>
                    <div class="metaRutaZona">
                        <span>Recorrido ${idx + 1}</span> · <span>${rec.length} pts</span> · <span>${formatearDistancia(distancia)}</span>
                    </div>
                `;

                card.addEventListener('click', () => {
                    document.querySelectorAll('.cardRutaZona').forEach(c => c.classList.remove('seleccionada'));
                    card.classList.add('seleccionada');
                    seleccionarRecorrido(idx);
                });

                listaRutas.appendChild(card);
            });
        }

        if (contenedorRutas) {
            contenedorRutas.style.display = 'block';
        }

        // Ajustar mapa para englobar el círculo de búsqueda
        if (estado.circuloZona && estado.mapa) {
            estado.mapa.fitBounds(estado.circuloZona.getBounds(), {
                padding: [40, 40],
                maxZoom: 16
            });
        }

    } catch (error) {
        console.error('Error al buscar en zona:', error);
        if (estadoEl) {
            estadoEl.textContent = error.message || 'Error al buscar en la zona';
            estadoEl.style.color = '#ff6b6b';
        }
    } finally {
        if (btnBuscar) btnBuscar.disabled = false;
    }
}

export function limpiarZona() {
    detenerReproduccion();

    if (estado.circuloZona && estado.mapa) {
        estado.mapa.removeLayer(estado.circuloZona);
        estado.circuloZona = null;
    }
    if (estado.marcadorCentroZona && estado.mapa) {
        estado.mapa.removeLayer(estado.marcadorCentroZona);
        estado.marcadorCentroZona = null;
    }
    estado.centroZona = null;

    if (estado.lineaRecorridoSeleccionado && estado.mapa) {
        estado.mapa.removeLayer(estado.lineaRecorridoSeleccionado);
        estado.lineaRecorridoSeleccionado = null;
    }
    estado.marcadoresHistoricos.forEach(m => estado.mapa && estado.mapa.removeLayer(m));
    estado.marcadoresHistoricos = [];

    if (estado.marcadorReproduccion && estado.mapa) {
        estado.mapa.removeLayer(estado.marcadorReproduccion);
        estado.marcadorReproduccion = null;
    }

    const contenedorRutas = document.getElementById('contenedorRutasZona');
    if (contenedorRutas) contenedorRutas.style.display = 'none';

    const listaRutas = document.getElementById('listaRutasZona');
    if (listaRutas) listaRutas.innerHTML = '';

    const estadoEl = document.getElementById('estadoZona');
    if (estadoEl) estadoEl.textContent = '';

    const reproductor = document.getElementById('reproductorHistorico');
    if (reproductor) reproductor.style.display = 'none';

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
            activarModoSeleccionCentro();
        }
    } else {
        desactivarModoSeleccionCentro();
    }
}

export function registrarClickMapaZona() {
    if (estado.mapa && !estado.mapa._listenerZonaRegistrado) {
        estado.mapa.on('click', (e) => {
            console.log('[Locator] Clic en mapa detectado:', e.latlng);
            const vistaZonaVisible = document.getElementById('vistaFiltroZona') &&
                document.getElementById('vistaFiltroZona').style.display !== 'none';
            const enModoZona = estado.tipoFiltroHistorico === 'zona' || vistaZonaVisible;

            if (enModoZona) {
                if (estado.submodoFiltroZona === 'mapa' && (estado.modoSeleccionCentro || !estado.centroZona)) {
                    establecerCentroZona(e.latlng);
                }
            }
        });
        estado.mapa._listenerZonaRegistrado = true;
    }
}

export function mostrarBarraBusquedaLugar() {
    const contenedor = document.getElementById('contenedorBusquedaLugar');
    if (contenedor) {
        contenedor.style.display = 'flex';
        const input = document.getElementById('inputBusquedaLugar');
        if (input) input.focus();
    }
}

export function ocultarBarraBusquedaLugar() {
    const contenedor = document.getElementById('contenedorBusquedaLugar');
    if (contenedor) {
        contenedor.style.display = 'none';
    }
    cerrarSugerencias();
}

function cerrarSugerencias() {
    const sugerenciasEl = document.getElementById('sugerenciasBusquedaLugar');
    if (sugerenciasEl) {
        sugerenciasEl.style.display = 'none';
        sugerenciasEl.innerHTML = '';
    }
    indiceSugerenciaSeleccionada = -1;
    sugerenciasActuales = [];
}

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

function actualizarSeleccionVisualSugerencias(items) {
    items.forEach((it, idx) => {
        it.classList.toggle('activo', idx === indiceSugerenciaSeleccionada);
        if (idx === indiceSugerenciaSeleccionada) {
            it.scrollIntoView({ block: 'nearest' });
        }
    });
}

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
    if (btnBuscar) {
        btnBuscar.addEventListener('click', () => {
            buscarRutasEnZona();
        });
    }

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
