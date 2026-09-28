// =============================================================================
// HISTÓRICOS: LISTA DE RECORRIDOS Y REPRODUCTOR
// =============================================================================
import { estado } from '../estado.js';
import { calcularDistanciaRecorrido } from './segmentacion.js';
import { formatearDistancia } from '../utilidades.js';

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

        const elemento = document.createElement('button');
        elemento.type = 'button';
        elemento.className = 'itemRecorrido';
        elemento.dataset.indice = index;

        elemento.innerHTML = `
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
        `;

        elemento.addEventListener('click', () => {
            seleccionarRecorrido(index);
        });

        lista.appendChild(elemento);
    });
}

export function seleccionarRecorrido(indice) {
    detenerReproduccion();

    if (!estado.recorridosHistoricos || !estado.recorridosHistoricos[indice]) {
        return;
    }

    estado.recorridoSeleccionado = estado.recorridosHistoricos[indice];
    estado.indiceReproduccion = 0;

    document.querySelectorAll('.itemRecorrido').forEach(item => {
        item.classList.remove('seleccionado');
    });

    const itemSeleccionado = document.querySelector(`.itemRecorrido[data-indice="${indice}"]`);
    if (itemSeleccionado) {
        itemSeleccionado.classList.add('seleccionado');
    }

    if (estado.lineaRecorridoSeleccionado) {
        estado.mapa.removeLayer(estado.lineaRecorridoSeleccionado);
        estado.lineaRecorridoSeleccionado = null;
    }

    // Limpiar marcadores de inicio y fin previos si existían
    estado.marcadoresHistoricos.forEach(marcador => estado.mapa.removeLayer(marcador));
    estado.marcadoresHistoricos = [];

    const coordenadas = estado.recorridoSeleccionado.map(punto => [punto.lat, punto.lng]);

    estado.lineaRecorridoSeleccionado = L.polyline(coordenadas, {
        color: '#4A90D9',
        weight: 5,
        opacity: 0.9
    }).addTo(estado.mapa);

    const numero = indice + 1;
    const puntoInicio = estado.recorridoSeleccionado[0];
    const puntoFin = estado.recorridoSeleccionado[estado.recorridoSeleccionado.length - 1];

    const distInicioFin = L.latLng(puntoInicio.lat, puntoInicio.lng).distanceTo(L.latLng(puntoFin.lat, puntoFin.lng));
    const direccionFin = distInicioFin < 30 ? 'bottom' : 'top';
    const offsetFin = distInicioFin < 30 ? [0, 5] : [0, -28];

    // Pin verde de inicio recorrido
    const marcadorInicio = L.marker([puntoInicio.lat, puntoInicio.lng], {
        icon: crearIconoInicio(numero),
        zIndexOffset: 500
    })
        .addTo(estado.mapa)
        .bindTooltip(`Inicio recorrido ${numero}`, {
            permanent: true,
            direction: 'top',
            offset: [0, -28],
            className: 'tooltipRecorrido tooltipInicio'
        })
        .bindPopup(`Inicio recorrido ${numero}${puntoInicio.fecha ? ' — ' + puntoInicio.fecha + ' ' + (puntoInicio.hora || '') : ''}`);

    // Pin rojo de fin recorrido
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
        .bindPopup(`Fin recorrido ${numero}${puntoFin.fecha ? ' — ' + puntoFin.fecha + ' ' + (puntoFin.hora || '') : ''}`);

    estado.marcadoresHistoricos.push(marcadorInicio, marcadorFin);

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

    if (coordenadas.length > 0) {
        estado.mapa.fitBounds(estado.lineaRecorridoSeleccionado.getBounds(), {
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
        html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#2ecc71;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
                <span style="transform:rotate(45deg);color:#ffffff;font-weight:bold;font-size:${num > 9 ? '10px' : '12px'};font-family:sans-serif;">${num}</span>
            </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -26]
    });
}

export function crearIconoFin(num) {
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