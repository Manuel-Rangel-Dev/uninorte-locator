// =============================================================================
// HISTÓRICOS: FILTRO POR ZONA GEOGRÁFICA
// =============================================================================
import { estado } from '../estado.js';
import { API_BASE, RADIO_DEFAULT_METROS } from '../constantes.js';
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

export function activarModoSeleccionCentro() {
    estado.modoSeleccionCentro = true;
    if (estado.mapa && estado.mapa.getContainer()) {
        estado.mapa.getContainer().style.cursor = 'crosshair';
    }
    const instruccion = document.getElementById('instruccionZona');
    if (instruccion) {
        instruccion.textContent = 'Haz clic en el mapa para colocar el centro de búsqueda.';
        instruccion.style.color = '#38bdf8';
    }
}

export function desactivarModoSeleccionCentro() {
    estado.modoSeleccionCentro = false;
    if (estado.mapa && estado.mapa.getContainer()) {
        estado.mapa.getContainer().style.cursor = '';
    }
}

export function establecerCentroZona(latlng) {
    estado.centroZona = { lat: latlng.lat, lng: latlng.lng };

    if (!estado.circuloZona) {
        estado.circuloZona = L.circle([latlng.lat, latlng.lng], {
            radius: estado.radioZona,
            color: '#38bdf8',
            weight: 2,
            fillColor: '#38bdf8',
            fillOpacity: 0.18,
            dashArray: '5,5'
        }).addTo(estado.mapa);
    } else {
        estado.circuloZona.setLatLng(latlng);
        estado.circuloZona.setRadius(estado.radioZona);
    }

    if (!estado.marcadorCentroZona) {
        estado.marcadorCentroZona = L.marker([latlng.lat, latlng.lng], {
            draggable: true,
            icon: L.divIcon({
                className: '',
                html: `<div style="width:16px;height:16px;border-radius:50%;background:#0284c7;border:3px solid #ffffff;box-shadow:0 0 10px rgba(56,189,248,0.9);transform:translate(-5px,-5px);"></div>`,
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

    const instruccion = document.getElementById('instruccionZona');
    if (instruccion) {
        instruccion.textContent = 'Centro colocado. Ajusta el radio y presiona “Buscar en esta zona”.';
        instruccion.style.color = '#cbd5e1';
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
            instruccion.textContent = '⚠️ Primero haz clic en el mapa para colocar el centro de búsqueda.';
            instruccion.style.color = '#ff6b6b';
        }
        activarModoSeleccionCentro();
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

    const instruccion = document.getElementById('instruccionZona');
    if (instruccion) {
        instruccion.textContent = 'Haz clic en el mapa para colocar el centro de búsqueda.';
        instruccion.style.color = '#cbd5e1';
    }

    desactivarModoSeleccionCentro();
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

    if (estado.mapa) {
        estado.mapa.on('click', (e) => {
            if (estado.tipoFiltroHistorico === 'zona' && (estado.modoSeleccionCentro || !estado.centroZona)) {
                establecerCentroZona(e.latlng);
            }
        });
    }
}
