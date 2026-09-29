// =============================================================================
// MAPA EN VIVO: INICIALIZACIÓN Y TELEMETRÍA EN TIEMPO REAL
// =============================================================================
import { API_BASE, INTERVALO_MS, CENTRO_DEFAULT, ZOOM_CENTRADO } from './constantes.js';
import { redondearCoord } from './utilidades.js';
import { estado } from './estado.js';

export async function refrescarCampo(nombreCampo, idElemento) {
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

export async function actualizarMarcador() {
    const lat = await refrescarCampo('lat', 'valorLat');
    const lng = await refrescarCampo('lng', 'valorLng');
    refrescarCampo('fecha', 'valorFecha');
    refrescarCampo('hora', 'valorHora');

    if (lat === null || lng === null || isNaN(Number(lat)) || isNaN(Number(lng))) return;

    const posicion = [redondearCoord(lat), redondearCoord(lng)];
    estado.marcador.setLatLng(posicion);

    if (!estado.mapaCentradoInicial && !document.body.classList.contains('modoHistorico')) {
        estado.mapa.setView(posicion, estado.mapa.getZoom());
        estado.mapaCentradoInicial = true;
    } else if (estado.modoTracking && !document.body.classList.contains('modoHistorico')) {
        estado.mapa.setView(posicion, estado.mapa.getZoom());
    }

    const esPosicionNueva = !estado.ultimaPosicionRecorrido
        || estado.ultimaPosicionRecorrido[0] !== posicion[0]
        || estado.ultimaPosicionRecorrido[1] !== posicion[1];

    if (esPosicionNueva) {
        estado.recorrido.addLatLng(posicion);
        estado.ultimaPosicionRecorrido = posicion;
        if (document.body.classList.contains('modoHistorico')) {
            estado.recorrido.setStyle({ opacity: 0 });
        }
    }
}

export async function initMap() {
    // 1. Inicializar el mapa de Leaflet inmediatamente con el centro por defecto
    estado.mapa = L.map('mapa').setView(CENTRO_DEFAULT, 15);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(estado.mapa);

    estado.marcador = L.marker(CENTRO_DEFAULT).addTo(estado.mapa)
        .bindPopup('Vehículo');

    const btnCentrar = document.getElementById('btnCentrar');
    if (btnCentrar) {
        btnCentrar.addEventListener('click', () => {
            estado.modoTracking = !estado.modoTracking;
            btnCentrar.classList.toggle('activo', estado.modoTracking);
            btnCentrar.title = estado.modoTracking ? 'Desactivar modo seguimiento' : 'Activar modo seguimiento';

            if (estado.modoTracking && estado.marcador && estado.marcador.getLatLng()) {
                estado.mapa.setView(estado.marcador.getLatLng(), ZOOM_CENTRADO);
            }
        });
    }

    estado.recorrido = L.polyline([], { color: '#C8102E', weight: 3 }).addTo(estado.mapa);

    // 2. Intentar obtener la última posición para centrar el mapa sin bloquear
    try {
        const res = await fetch(`${API_BASE}/api/ultimo`);
        if (res.ok) {
            const datos = await res.json();
            if (datos.lat !== null && datos.lng !== null && !isNaN(Number(datos.lat)) && !isNaN(Number(datos.lng))) {
                const pos = [redondearCoord(datos.lat), redondearCoord(datos.lng)];
                estado.marcador.setLatLng(pos);
                estado.mapa.setView(pos, 15);
                estado.mapaCentradoInicial = true;
            }
        }
    } catch (e) {
        console.warn('No se pudo obtener la posición inicial desde /api/ultimo, usando centro por defecto:', e);
    }

    // 3. Iniciar telemetría en tiempo real
    actualizarMarcador();
    setInterval(actualizarMarcador, INTERVALO_MS);
}