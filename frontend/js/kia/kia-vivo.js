// =============================================================================
// KIA EN VIVO: MARCADOR, PANEL DE CONSUMO Y TRAZA COLOREADA POR L/h (P3-S3)
// Ciclo propio sobre /api/kia/vivo, separado del de la app (mapa-vivo.js): el marcador
// del celular, su filtro de saltos y las pruebas con Lockito no dependen de este módulo.
// En vivo no hay modelo: solo la ecuación y el PID acumulados (decisión de P3-S3).
// =============================================================================
import { API_BASE, INTERVALO_KIA_MS, ZOOM_CENTRADO } from '../constantes.js';
import { estado } from '../estado.js';
import { escaparHtml } from '../utilidades.js';
import {
    crearTramoConsumo,
    crearTrazaConsumo,
    formatearDuracion,
    formatearLitros,
    formatearNumero,
    formatearPesos,
    instanteDeHora
} from './colores-consumo.js';

// -----------------------------------------------------------------------------
// Marcador
// -----------------------------------------------------------------------------
export function crearIconoKia(enVivo) {
    const fondo = enVivo ? '#dc0303' : '#6b6b6b';
    return L.divIcon({
        className: '',
        html: `
            <div class="iconoKia" style="background:${fondo};">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 16V11L7 6H17L19 11V16" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M3 16H21V19H3Z" fill="#ffffff"/>
                    <circle cx="7.5" cy="13" r="1.3" fill="#ffffff"/>
                    <circle cx="16.5" cy="13" r="1.3" fill="#ffffff"/>
                </svg>
            </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -16]
    });
}

function textoPopupKia(datos) {
    return `
        <strong>Kia K3</strong>${datos.en_vivo ? '' : ' (sin señal)'}<br>
        ${escaparHtml(formatearNumero(datos.vel_kmh, 0, ' km/h'))}
        · ${escaparHtml(formatearNumero(datos.lph_ecuacion, 2, ' L/h'))} (ecuación)<br>
        PID: ${escaparHtml(formatearNumero(datos.lph_pid, 2, ' L/h'))}<br>
        Última posición: ${escaparHtml(datos.hora_posicion || '--')}
        ${datos.recorrido_posicion && datos.recorrido_posicion !== datos.recorrido_id
            ? '<br><em>(de un recorrido anterior: el actual no tiene GNSS)</em>' : ''}
    `;
}

// -----------------------------------------------------------------------------
// Panel
// -----------------------------------------------------------------------------
function textoEdad(segundos) {
    if (segundos < 90) return `hace ${Math.round(segundos)} s`;
    if (segundos < 5400) return `hace ${Math.round(segundos / 60)} min`;
    if (segundos < 172800) return `hace ${Math.round(segundos / 3600)} h`;
    return `hace ${Math.round(segundos / 86400)} días`;
}

function escribir(id, texto) {
    const elemento = document.getElementById(id);
    if (elemento) elemento.textContent = texto;
}

function actualizarPanel(datos) {
    const panel = document.getElementById('panelKia');
    if (!panel) return;
    panel.classList.add('conDatos');

    if (!datos) {
        panel.classList.remove('enVivo');
        escribir('kiaEstado', 'SIN DATOS');
        return;
    }
    panel.classList.toggle('enVivo', datos.en_vivo);
    escribir('kiaEstado', datos.en_vivo ? 'EN VIVO' : `SIN SEÑAL · ${textoEdad(datos.edad_s)}`);
    escribir('kiaVelocidad', formatearNumero(datos.vel_kmh, 0, ' km/h'));
    escribir('kiaLphEcuacion', formatearNumero(datos.lph_ecuacion, 2, ' L/h'));
    escribir('kiaLphPid', formatearNumero(datos.lph_pid, 2, ' L/h'));

    const r = datos.recorrido || {};
    escribir('kiaRecorrido', `${formatearNumero(r.distancia_km, 2, ' km')} · ${formatearDuracion(r.duracion_s)}`);
    escribir('kiaLitrosPid', `${formatearLitros(r.litros_pid)} · ${formatearPesos(r.costo_pid_cop)}`);
    escribir('kiaLitrosEcuacion', `${formatearLitros(r.litros_ecuacion)} · ${formatearPesos(r.costo_ecuacion_cop)}`);
    escribir('kiaTituloRecorrido', datos.en_vivo ? 'RECORRIDO EN CURSO' : 'ÚLTIMO RECORRIDO');
}

function alternarPanel() {
    estado.kiaPanelMinimizado = !estado.kiaPanelMinimizado;
    const panel = document.getElementById('panelKia');
    if (panel) panel.classList.toggle('minimizado', estado.kiaPanelMinimizado);
    const boton = document.getElementById('btnMinimizarKia');
    if (boton) boton.textContent = estado.kiaPanelMinimizado ? '+' : '–';
}

// -----------------------------------------------------------------------------
// Traza del recorrido en curso
// -----------------------------------------------------------------------------
function quitarTraza() {
    if (estado.kiaTraza) estado.mapa.removeLayer(estado.kiaTraza);
    estado.kiaTraza = null;
    estado.kiaRecorridoTraza = null;
    estado.kiaUltimoPuntoTraza = null;
}

async function cargarTraza(recorridoId) {
    const respuesta = await fetch(`${API_BASE}/api/kia/recorridos/${encodeURIComponent(recorridoId)}`);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const datos = await respuesta.json();
    quitarTraza();
    estado.kiaTraza = crearTrazaConsumo(datos.puntos);
    if (!document.body.classList.contains('modoHistorico')) estado.kiaTraza.addTo(estado.mapa);
    estado.kiaRecorridoTraza = recorridoId;
    estado.kiaUltimoPuntoTraza = datos.puntos.length ? datos.puntos[datos.puntos.length - 1] : null;
}

// Agrega la última lectura a la traza si es una posición nueva (más reciente que la última).
function extenderTraza(datos) {
    if (datos.lat === null || datos.lng === null || !estado.kiaTraza) return;
    if (datos.recorrido_posicion !== datos.recorrido_id) return;  // posición de otro recorrido
    const punto = {
        lat: datos.lat, lng: datos.lng, hora: datos.hora_posicion,
        lph_pid: datos.lph_pid, lph_ecuacion: datos.lph_ecuacion
    };
    const previo = estado.kiaUltimoPuntoTraza;
    if (previo) {
        const nuevo = instanteDeHora(punto.hora) > instanteDeHora(previo.hora);
        const mismoLugar = previo.lat === punto.lat && previo.lng === punto.lng;
        if (!nuevo || mismoLugar) return;
        estado.kiaTraza.addLayer(crearTramoConsumo(previo, punto));
    }
    estado.kiaUltimoPuntoTraza = punto;
}

async function actualizarTraza(datos) {
    if (!datos || !datos.en_vivo) {
        quitarTraza();   // solo se dibuja el recorrido en curso
        return;
    }
    if (estado.kiaRecorridoTraza !== datos.recorrido_id) {
        await cargarTraza(datos.recorrido_id);
        return;
    }
    extenderTraza(datos);
}

// -----------------------------------------------------------------------------
// Visibilidad: en modo histórico se ocultan marcador y traza (como los de la app)
// -----------------------------------------------------------------------------
function sincronizarVisibilidad() {
    const enHistorico = document.body.classList.contains('modoHistorico');
    [estado.kiaMarcador, estado.kiaTraza].forEach(capa => {
        if (!capa) return;
        const visible = estado.mapa.hasLayer(capa);
        if (enHistorico && visible) estado.mapa.removeLayer(capa);
        if (!enHistorico && !visible && (capa !== estado.kiaMarcador || capa.getLatLng())) capa.addTo(estado.mapa);
    });
}

// -----------------------------------------------------------------------------
// Ciclo
// -----------------------------------------------------------------------------
async function actualizarKia() {
    const respuesta = await fetch(`${API_BASE}/api/kia/vivo`);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const datos = await respuesta.json();
    actualizarPanel(datos);

    if (datos && datos.lat !== null && datos.lng !== null) {
        const posicion = [datos.lat, datos.lng];
        if (!estado.kiaMarcador) {
            estado.kiaMarcador = L.marker(posicion, { icon: crearIconoKia(datos.en_vivo), zIndexOffset: 800 })
                .bindPopup('');
        } else {
            estado.kiaMarcador.setLatLng(posicion);
            estado.kiaMarcador.setIcon(crearIconoKia(datos.en_vivo));
        }
        estado.kiaMarcador.setPopupContent(textoPopupKia(datos));
        // Modo seguimiento del Kia: el mapa se mueve con él (como #btnCentrar con el celular)
        if (estado.kiaTracking && !document.body.classList.contains('modoHistorico')) {
            estado.mapa.setView(posicion, estado.mapa.getZoom());
        }
    }
    await actualizarTraza(datos);
    sincronizarVisibilidad();
}

// -----------------------------------------------------------------------------
// Botón de seguimiento del Kia (#btnSeguirKia). Es exclusivo con el del celular
// (#btnCentrar, mapa-vivo.js): activar uno apaga el otro, si no el mapa saltaría
// entre los dos vehículos.
// -----------------------------------------------------------------------------
function marcarBotonSeguirKia(activo) {
    const boton = document.getElementById('btnSeguirKia');
    if (!boton) return;
    boton.classList.toggle('activo', activo);
    boton.title = activo ? 'Seguir al Kia K3: desactivar modo seguimiento'
        : 'Seguir al Kia K3: activar modo seguimiento';
}

function apagarSeguimientoCelular() {
    if (!estado.modoTracking) return;
    estado.modoTracking = false;
    const boton = document.getElementById('btnCentrar');
    if (boton) {
        boton.classList.remove('activo');
        boton.title = 'Seguir al celular (app): activar modo seguimiento';
    }
}

function alternarSeguimientoKia() {
    const boton = document.getElementById('btnSeguirKia');
    if (!estado.kiaTracking && !estado.kiaMarcador) {
        // Sin ninguna posición GNSS del Kia no hay a dónde ir: aviso breve en el botón
        boton.classList.add('sinPosicion');
        boton.title = 'Sin posición GNSS del Kia';
        setTimeout(() => {
            boton.classList.remove('sinPosicion');
            marcarBotonSeguirKia(estado.kiaTracking);
        }, 2500);
        return;
    }
    estado.kiaTracking = !estado.kiaTracking;
    marcarBotonSeguirKia(estado.kiaTracking);
    if (estado.kiaTracking) {
        apagarSeguimientoCelular();
        // Centra en la última posición conocida (aunque sea de un recorrido anterior)
        estado.mapa.setView(estado.kiaMarcador.getLatLng(), ZOOM_CENTRADO);
    }
}

async function cicloKia() {
    try {
        await actualizarKia();
    } catch (error) {
        console.warn('[Kia] No se pudo actualizar el Kia en vivo:', error);
    }
    setTimeout(cicloKia, INTERVALO_KIA_MS);
}

export function initKiaVivo() {
    const botonMinimizar = document.getElementById('btnMinimizarKia');
    if (botonMinimizar) botonMinimizar.addEventListener('click', alternarPanel);

    document.getElementById('btnSeguirKia')?.addEventListener('click', alternarSeguimientoKia);
    // Si se activa el seguimiento del celular (su listener en mapa-vivo.js corre antes que
    // este), se apaga el del Kia.
    document.getElementById('btnCentrar')?.addEventListener('click', () => {
        if (estado.modoTracking && estado.kiaTracking) {
            estado.kiaTracking = false;
            marcarBotonSeguirKia(false);
        }
    });

    // Al entrar o salir del modo histórico (clase en body) se ocultan o muestran las capas.
    new MutationObserver(sincronizarVisibilidad).observe(document.body, {
        attributes: true, attributeFilter: ['class']
    });
    cicloKia();
}
