// =============================================================================
// HISTÓRICOS: LISTA DE RECORRIDOS Y REPRODUCTOR
// =============================================================================
import { estado } from '../estado.js';
import { calcularDistanciaRecorrido } from './segmentacion.js';
import { formatearDistancia } from '../utilidades.js';

const PALETA_RECORRIDOS = ['#4A90D9', '#2ecc71', '#e67e22', '#9b59b6', '#e74c3c', '#1abc9c', '#f1c40f', '#e84393'];

function obtenerColorRecorrido(indice) {
    return PALETA_RECORRIDOS[indice % PALETA_RECORRIDOS.length];
}

function buscarEntradaVisible(indice) {
    return estado.lineasHistoricas.find(entrada => entrada.indice === indice);
}

export function mostrarListaRecorridos(recorridos) {
    const contenedor = document.getElementById('selectorRecorridos');
    const lista = document.getElementById('listaRecorridos');

    if (!contenedor || !lista) return;

    lista.innerHTML = '';

    if (!recorridos || recorridos.length === 0) {
        contenedor.style.display = 'none';
        return;
    }

    contenedor.style.display = 'block';

    recorridos.forEach((recorridoActual, index) => {
        const numero = index + 1;
        const inicio = recorridoActual[0];
        const fin = recorridoActual[recorridoActual.length - 1];
        const distancia = calcularDistanciaRecorrido(recorridoActual);

        const elemento = document.createElement('div');
        elemento.className = 'itemRecorrido';
        elemento.dataset.indice = index;

        elemento.innerHTML = `
            <label class="checkRecorridoWrapper">
                <input type="checkbox" class="checkRecorrido" data-indice="${index}">
            </label>
            <button type="button" class="infoRecorridoBtn" data-indice="${index}">
                <div class="numeroRecorrido">
                    Recorrido ${numero}
                </div>
                <div class="datosRecorrido">
                    <div>
                        ${inicio.fecha || '--'}
                        ·
                        ${inicio.hora || '--'}
                    </div>
                    <div>
                        →
                        ${fin.fecha || '--'}
                        ·
                        ${fin.hora || '--'}
                    </div>
                    <div>
                        ${recorridoActual.length} puntos
                        ·
                        ${formatearDistancia(distancia)}
                    </div>
                </div>
            </button>
        `;

        elemento.querySelector('.checkRecorrido').addEventListener('change', () => {
            alternarVisibilidadRecorrido(index);
        });

        elemento.querySelector('.infoRecorridoBtn').addEventListener('click', () => {
            seleccionarRecorrido(index);
        });

        lista.appendChild(elemento);
    });
}

export function alternarVisibilidadRecorrido(indice) {
    const entradaExistente = buscarEntradaVisible(indice);

    if (entradaExistente) {
        estado.mapa.removeLayer(entradaExistente.linea);
        estado.mapa.removeLayer(entradaExistente.marcadorInicio);
        estado.mapa.removeLayer(entradaExistente.marcadorFin);
        estado.lineasHistoricas = estado.lineasHistoricas.filter(entrada => entrada.indice !== indice);

        if (estado.recorridoSeleccionado === estado.recorridosHistoricos[indice]) {
            detenerReproduccion();
            estado.recorridoSeleccionado = null;
            if (estado.marcadorReproduccion) {
                estado.mapa.removeLayer(estado.marcadorReproduccion);
                estado.marcadorReproduccion = null;
            }
            const reproductor = document.getElementById('reproductorHistorico');
            if (reproductor) reproductor.style.display = 'none';
            const itemActual = document.querySelector(`.itemRecorrido[data-indice="${indice}"]`);
            if (itemActual) itemActual.classList.remove('enReproduccion');
        }
        return;
    }

    dibujarRecorridoEnMapa(indice);
    marcarCheckbox(indice, true);
}

function marcarCheckbox(indice, valor) {
    const checkbox = document.querySelector(`.checkRecorrido[data-indice="${indice}"]`);
    if (checkbox) checkbox.checked = valor;
}

function dibujarRecorridoEnMapa(indice) {
    const recorrido = estado.recorridosHistoricos[indice];
    if (!recorrido) return;

    const coordenadas = recorrido.map(punto => [punto.lat, punto.lng]);
    const color = obtenerColorRecorrido(indice);

    const linea = L.polyline(coordenadas, {
        color,
        weight: 5,
        opacity: 0.9
    }).addTo(estado.mapa).on('click', () => seleccionarRecorrido(indice));

    const numero = indice + 1;
    const puntoInicio = recorrido[0];
    const puntoFin = recorrido[recorrido.length - 1];

    const distInicioFin = L.latLng(puntoInicio.lat, puntoInicio.lng).distanceTo(L.latLng(puntoFin.lat, puntoFin.lng));
    const direccionFin = distInicioFin < 30 ? 'bottom' : 'top';
    const offsetFin = distInicioFin < 30 ? [0, 14] : [0, -14];

    const marcadorInicio = L.marker([puntoInicio.lat, puntoInicio.lng], {
        icon: crearIconoInicio(numero),
        zIndexOffset: 500
    })
        .addTo(estado.mapa)
        .bindTooltip(`Inicio recorrido ${numero}`, {
            permanent: true,
            direction: 'top',
            offset: [0, -14],
            className: 'tooltipRecorrido tooltipInicio'
        })
        .bindPopup(`Inicio recorrido ${numero}${puntoInicio.fecha ? ' — ' + puntoInicio.fecha + ' ' + (puntoInicio.hora || '') : ''}`)
        .on('click', () => seleccionarRecorrido(indice));

    const marcadorFin = L.marker([puntoFin.lat, puntoFin.lng], {
        icon: crearIconoFin(numero),
        zIndexOffset: 500
    })
        .addTo(estado.mapa)
        .bindTooltip(`Fin recorrido ${numero}`, {
            permanent: true,
            direction: direccionFin,
            offset: offsetFin,
            className: 'tooltipRecorrido tooltipFin'
        })
        .bindPopup(`Fin recorrido ${numero}${puntoFin.fecha ? ' — ' + puntoFin.fecha + ' ' + (puntoFin.hora || '') : ''}`)
        .on('click', () => seleccionarRecorrido(indice));

    estado.lineasHistoricas.push({ indice, linea, marcadorInicio, marcadorFin });
}

export function seleccionarRecorrido(indice) {
    detenerReproduccion();

    if (!estado.recorridosHistoricos || !estado.recorridosHistoricos[indice]) {
        return;
    }

    let entrada = buscarEntradaVisible(indice);
    if (!entrada) {
        dibujarRecorridoEnMapa(indice);
        marcarCheckbox(indice, true);
        entrada = buscarEntradaVisible(indice);
    }

    estado.recorridoSeleccionado = estado.recorridosHistoricos[indice];
    estado.indiceReproduccion = 0;

    document.querySelectorAll('.itemRecorrido').forEach(item => {
        item.classList.remove('enReproduccion');
    });

    const itemActual = document.querySelector(`.itemRecorrido[data-indice="${indice}"]`);
    if (itemActual) {
        itemActual.classList.add('enReproduccion');
    }

    const slider = document.getElementById('sliderRecorrido');
    if (slider) {
        slider.min = 0;
        slider.max = Math.max(0, estado.recorridoSeleccionado.length - 1);
        slider.value = 0;
    }

    if (!estado.marcadorReproduccion) {
        estado.marcadorReproduccion = L.marker(
            [estado.recorridoSeleccionado[0].lat, estado.recorridoSeleccionado[0].lng],
            { zIndexOffset: 1000 }
        ).addTo(estado.mapa);
    } else {
        estado.marcadorReproduccion.setLatLng([
            estado.recorridoSeleccionado[0].lat,
            estado.recorridoSeleccionado[0].lng
        ]);
        estado.marcadorReproduccion.setOpacity(1);
    }

    const reproductor = document.getElementById('reproductorHistorico');
    if (reproductor) {
        reproductor.style.display = 'block';
    }

    actualizarPuntoReproduccion(0);

    if (entrada) {
        estado.mapa.fitBounds(entrada.linea.getBounds(), {
            padding: [60, 50],
            maxZoom: 17
        });
    }
}

export function actualizarPuntoReproduccion(indice) {
    if (!estado.recorridoSeleccionado || estado.recorridoSeleccionado.length === 0) {
        return;
    }

    indice = Math.max(0, Math.min(indice, estado.recorridoSeleccionado.length - 1));
    estado.indiceReproduccion = indice;

    const punto = estado.recorridoSeleccionado[indice];
    const posicion = [punto.lat, punto.lng];

    if (estado.marcadorReproduccion) {
        estado.marcadorReproduccion.setLatLng(posicion);
    }

    const slider = document.getElementById('sliderRecorrido');
    if (slider) {
        slider.value = indice;
    }

    const fechaHora = document.getElementById('fechaHoraReproduccion');
    if (fechaHora) {
        fechaHora.textContent = `${punto.fecha || '--'} ${punto.hora || '--'}`;
    }

    const infoRecorrido = document.getElementById('infoRecorridoSeleccionado');
    if (infoRecorrido) {
        const indiceRecorrido = estado.recorridosHistoricos.indexOf(estado.recorridoSeleccionado) + 1;
        infoRecorrido.textContent = `Recorrido ${indiceRecorrido}`;
    }

    const primerPunto = estado.recorridoSeleccionado[0];
    const ultimoPunto = estado.recorridoSeleccionado[estado.recorridoSeleccionado.length - 1];

    const tiempoInicio = document.getElementById('tiempoInicioRecorrido');
    const tiempoFin = document.getElementById('tiempoFinRecorrido');

    if (tiempoInicio) {
        tiempoInicio.textContent = primerPunto.hora || '--:--';
    }
    if (tiempoFin) {
        tiempoFin.textContent = ultimoPunto.hora || '--:--';
    }
}

export function iniciarReproduccion() {
    if (!estado.recorridoSeleccionado || estado.recorridoSeleccionado.length === 0) {
        return;
    }
    if (estado.reproduciendo) {
        return;
    }

    if (estado.indiceReproduccion >= estado.recorridoSeleccionado.length - 1) {
        estado.indiceReproduccion = 0;
        actualizarPuntoReproduccion(estado.indiceReproduccion);
    }

    estado.reproduciendo = true;
    actualizarBotonReproduccion();

    const velocidad = obtenerVelocidadReproduccion();

    estado.timerReproduccion = setInterval(() => {
        if (!estado.recorridoSeleccionado || estado.indiceReproduccion >= estado.recorridoSeleccionado.length - 1) {
            detenerReproduccion();
            return;
        }
        estado.indiceReproduccion++;
        actualizarPuntoReproduccion(estado.indiceReproduccion);
    }, velocidad);
}

export function detenerReproduccion() {
    estado.reproduciendo = false;

    if (estado.timerReproduccion) {
        clearInterval(estado.timerReproduccion);
        estado.timerReproduccion = null;
    }

    actualizarBotonReproduccion();
}

function actualizarBotonReproduccion() {
    const boton = document.getElementById('btnPlayRecorrido');
    if (!boton) return;
    boton.textContent = estado.reproduciendo ? '❚❚' : '▶';
}

function obtenerVelocidadReproduccion() {
    const selector = document.getElementById('velocidadRecorrido');
    if (!selector) {
        return 1000;
    }
    return parseInt(selector.value, 10);
}

export function crearIconoInicio(num) {
    return L.divIcon({
        className: '',
        html: `<div style="width:24px;height:24px;border-radius:50%;background:#2ecc71;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;">
                <span style="color:#ffffff;font-weight:bold;font-size:${num > 9 ? '10px' : '11px'};font-family:monospace;">${num}</span>
            </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -14]
    });
}

export function crearIconoFin(num) {
    return L.divIcon({
        className: '',
        html: `<div style="width:24px;height:24px;border-radius:50%;background:#dc0303;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;">
                <span style="color:#ffffff;font-weight:bold;font-size:${num > 9 ? '10px' : '11px'};font-family:monospace;">${num}</span>
            </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -14]
    });
}