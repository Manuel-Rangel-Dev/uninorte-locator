// =============================================================================
// HISTÓRICOS: LISTA DE RECORRIDOS Y REPRODUCTOR
// =============================================================================
import { estado } from '../estado.js';
import { calcularDistanciaRecorrido } from './segmentacion.js';
import { formatearDistancia, obtenerTimestampPunto } from '../utilidades.js';

// Colores usados para distinguir cada recorrido en el mapa
const PALETA_RECORRIDOS = ['#4A90D9', '#2ecc71', '#e67e22', '#9b59b6', '#e74c3c', '#1abc9c', '#f1c40f', '#e84393'];

// Devuelve un color según el índice del recorrido
function obtenerColorRecorrido(indice) {
    return PALETA_RECORRIDOS[indice % PALETA_RECORRIDOS.length];
}

// Busca si un recorrido ya está visible en el mapa
function buscarEntradaVisible(indice) {
    return estado.lineasHistoricas.find(entrada => entrada.indice === indice);
}

function prepararReproductorParaRender() {
    const reproductor = document.getElementById('reproductorHistorico');
    const panel = document.getElementById('panelHistoricos');
    if (!reproductor || !panel) return;

    panel.appendChild(reproductor);
    reproductor.style.display = 'none';
    reproductor.classList.remove('visible');
}

function ocultarReproductor() {
    const reproductor = document.getElementById('reproductorHistorico');
    const panel = document.getElementById('panelHistoricos');
    if (!reproductor || !panel) return;

    panel.appendChild(reproductor);
    reproductor.style.display = 'none';
    reproductor.classList.remove('visible');
}

function obtenerRecorridosListados(recorridos) {
    if (estado.mostrarTodasLasRutas || recorridos.length === 0) {
        return recorridos.map((recorrido, indice) => ({ recorrido, indice }));
    }

    const ultimoRecorrido = recorridos[recorridos.length - 1];
    const ultimoPunto = ultimoRecorrido[ultimoRecorrido.length - 1];
    const timestampFinal = obtenerTimestampPunto(ultimoPunto);
    if (timestampFinal === null) {
        return recorridos.map((recorrido, indice) => ({ recorrido, indice }));
    }

    const corte = timestampFinal - (7 * 24 * 60 * 60 * 1000);
    return recorridos
        .map((recorrido, indice) => ({ recorrido, indice }))
        .filter(({ recorrido }) => {
            const puntoFinal = recorrido[recorrido.length - 1];
            const timestamp = obtenerTimestampPunto(puntoFinal);
            return timestamp !== null && timestamp >= corte;
        });
}

function removerEntradaVisible(indice) {
    const entrada = buscarEntradaVisible(indice);
    if (!entrada) return;

    estado.mapa.removeLayer(entrada.linea);
    estado.mapa.removeLayer(entrada.marcadorInicio);
    estado.mapa.removeLayer(entrada.marcadorFin);
    estado.lineasHistoricas = estado.lineasHistoricas.filter(item => item.indice !== indice);
}

function removerCapasFueraDeLista(recorridos) {
    const listados = new Set(obtenerRecorridosListados(recorridos).map(item => item.indice));
    estado.lineasHistoricas
        .filter(entrada => !listados.has(entrada.indice))
        .forEach(entrada => removerEntradaVisible(entrada.indice));

    if (estado.recorridoSeleccionado) {
        const indiceSeleccionado = recorridos.indexOf(estado.recorridoSeleccionado);
        if (!listados.has(indiceSeleccionado)) {
            detenerReproduccion();
            estado.recorridoSeleccionado = null;
            if (estado.marcadorReproduccion) {
                estado.mapa.removeLayer(estado.marcadorReproduccion);
                estado.marcadorReproduccion = null;
            }
            ocultarReproductor();
        }
    }
}

function limpiarSeleccionReproductor() {
    detenerReproduccion();
    estado.recorridoSeleccionado = null;

    if (estado.marcadorReproduccion) {
        estado.mapa.removeLayer(estado.marcadorReproduccion);
        estado.marcadorReproduccion = null;
    }

    ocultarReproductor();
    document.querySelectorAll('.itemRecorrido.enReproduccion').forEach(item => {
        item.classList.remove('enReproduccion');
    });
}

// Elimina todas las capas y el estado visual asociado a recorridos históricos
export function removerCapasHistoricas() {
    detenerReproduccion();

    estado.lineasHistoricas.forEach(entrada => {
        estado.mapa.removeLayer(entrada.linea);
        estado.mapa.removeLayer(entrada.marcadorInicio);
        estado.mapa.removeLayer(entrada.marcadorFin);
    });
    estado.lineasHistoricas = [];

    if (estado.marcadorReproduccion) {
        estado.mapa.removeLayer(estado.marcadorReproduccion);
        estado.marcadorReproduccion = null;
    }

    ocultarReproductor();
}

// Crea la lista de recorridos con su información resumida
export function mostrarListaRecorridos(recorridos) {
    const contenedor = document.getElementById('selectorRecorridos');
    const lista = document.getElementById('listaRecorridos');

    if (!contenedor || !lista) return;

    prepararReproductorParaRender();
    lista.innerHTML = '';

    // Si no hay recorridos, oculta el panel
    if (!recorridos || recorridos.length === 0) {
        contenedor.style.display = 'none';
        return;
    }

    contenedor.style.display = 'block';

    const recorridosListados = obtenerRecorridosListados(recorridos);
    const hayLimiteSemanal = recorridosListados.length < recorridos.length;
    let botonAlternar = null;
    const checkboxMaestro = document.createElement('input');
    checkboxMaestro.type = 'checkbox';
    checkboxMaestro.id = 'checkTodasLasRutas';
    checkboxMaestro.className = 'checkTodasLasRutas';

    const etiquetaMaestra = document.createElement('label');
    etiquetaMaestra.className = 'checkTodasLasRutasWrapper';
    etiquetaMaestra.htmlFor = checkboxMaestro.id;
    etiquetaMaestra.append(checkboxMaestro, document.createTextNode(
        `Seleccionar todas las rutas (${recorridosListados.length})`
    ));

    if (hayLimiteSemanal) {
        const encabezado = document.createElement('div');
        encabezado.className = 'encabezadoSemana';
        encabezado.textContent = estado.mostrarTodasLasRutas
            ? `Mostrando todas las rutas (${recorridos.length})`
            : `Mostrando solo las rutas de la última semana (${recorridosListados.length} de ${recorridos.length})`;
        lista.appendChild(encabezado);

        botonAlternar = document.createElement('button');
        botonAlternar.type = 'button';
        botonAlternar.className = 'btnAlternarListaRutas';
        botonAlternar.textContent = estado.mostrarTodasLasRutas
            ? `Ver solo la última semana`
            : `Ver todas las rutas (${recorridos.length})`;
        botonAlternar.addEventListener('click', () => {
            estado.mostrarTodasLasRutas = !estado.mostrarTodasLasRutas;
            if (!estado.mostrarTodasLasRutas) {
                removerCapasFueraDeLista(recorridos);
            }
            mostrarListaRecorridos(recorridos);
        });
    }
    lista.appendChild(etiquetaMaestra);
    checkboxMaestro.addEventListener('change', () => {
        alternarTodasLasRutas(recorridosListados, checkboxMaestro.checked);
    });

    recorridosListados.forEach(({ recorrido: recorridoActual, indice: indiceGlobal }, indiceVisible) => {
        const numero = indiceVisible + 1;
        const inicio = recorridoActual[0];
        const fin = recorridoActual[recorridoActual.length - 1];
        const distancia = calcularDistanciaRecorrido(recorridoActual);

        const elemento = document.createElement('div');
        elemento.className = 'itemRecorrido';
        elemento.dataset.indice = indiceGlobal;

        // Construye el contenido visual del recorrido
        elemento.innerHTML = `
            <label class="checkRecorridoWrapper">
                <input type="checkbox" class="checkRecorrido" data-indice="${indiceGlobal}">
            </label>
            <button type="button" class="infoRecorridoBtn" data-indice="${indiceGlobal}">
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

        // El checkbox controla la visibilidad y selecciona la ruta cuando se marca
        const checkbox = elemento.querySelector('.checkRecorrido');
        checkbox.addEventListener('click', (evento) => {
            evento.stopPropagation();
        });
        checkbox.checked = Boolean(buscarEntradaVisible(indiceGlobal));
        checkbox.addEventListener('change', () => {
            alternarVisibilidadRecorrido(indiceGlobal, checkbox.checked);
        });

        // Cualquier otra parte de la tarjeta selecciona el recorrido
        elemento.addEventListener('click', (evento) => {
            if (evento.target.closest('.checkRecorridoWrapper')) return;
            seleccionarRecorrido(indiceGlobal);
        });

        if (estado.recorridoSeleccionado === recorridoActual) {
            elemento.classList.add('enReproduccion');
        }
        lista.appendChild(elemento);
    });

    if (botonAlternar) {
        lista.appendChild(botonAlternar);
    }
    actualizarCheckboxMaestro();
}

// Sincroniza la casilla maestra con las rutas visibles actualmente en el mapa
export function actualizarCheckboxMaestro() {
    const checkboxMaestro = document.getElementById('checkTodasLasRutas');
    if (!checkboxMaestro) return;

    const checkboxes = [...document.querySelectorAll('.checkRecorrido')];
    const visibles = checkboxes.filter(checkbox => checkbox.checked);
    checkboxMaestro.checked = checkboxes.length > 0 && visibles.length === checkboxes.length;
    checkboxMaestro.indeterminate = visibles.length > 0 && visibles.length < checkboxes.length;
}

function alternarTodasLasRutas(recorridosListados, debeMostrar) {
    const indices = recorridosListados.map(({ indice }) => indice);

    if (debeMostrar) {
        const lineas = [];
        recorridosListados.forEach(({ indice }) => {
            if (!buscarEntradaVisible(indice)) {
                dibujarRecorridoEnMapa(indice, indices.length <= 20);
            }
            const entrada = buscarEntradaVisible(indice);
            if (entrada) lineas.push(entrada.linea);
            marcarCheckbox(indice, true);
        });

        if (lineas.length > 0) {
            const grupoLineas = L.featureGroup(lineas);
            const limites = grupoLineas.getBounds();
            if (limites.isValid()) {
                estado.mapa.fitBounds(limites, {
                    padding: [60, 50],
                    maxZoom: 17
                });
            }
        }
        actualizarCheckboxMaestro();
        return;
    }

    indices.forEach(indice => removerEntradaVisible(indice));
    if (estado.recorridoSeleccionado && indices.includes(
        estado.recorridosHistoricos.indexOf(estado.recorridoSeleccionado)
    )) {
        limpiarSeleccionReproductor();
    } else {
        ocultarReproductor();
    }

    indices.forEach(indice => marcarCheckbox(indice, false));
    actualizarCheckboxMaestro();
}

// Muestra u oculta un recorrido en el mapa según su estado actual
export function alternarVisibilidadRecorrido(indice, debeMostrar = null) {
    const entradaExistente = buscarEntradaVisible(indice);

    const quitarRecorrido = debeMostrar === false
        || (debeMostrar === null && Boolean(entradaExistente));

    // Si debe ocultarse y está visible, se elimina del mapa
    if (entradaExistente && quitarRecorrido) {
        estado.mapa.removeLayer(entradaExistente.linea);
        estado.mapa.removeLayer(entradaExistente.marcadorInicio);
        estado.mapa.removeLayer(entradaExistente.marcadorFin);
        estado.lineasHistoricas = estado.lineasHistoricas.filter(entrada => entrada.indice !== indice);

        // Si era el recorrido seleccionado, se cierra el reproductor
        if (estado.recorridoSeleccionado === estado.recorridosHistoricos[indice]) {
            detenerReproduccion();
            estado.recorridoSeleccionado = null;
            if (estado.marcadorReproduccion) {
                estado.mapa.removeLayer(estado.marcadorReproduccion);
                estado.marcadorReproduccion = null;
            }
            ocultarReproductor();
            const itemActual = document.querySelector(`.itemRecorrido[data-indice="${indice}"]`);
            if (itemActual) itemActual.classList.remove('enReproduccion');
        }
        actualizarCheckboxMaestro();
        return;
    }

    if (entradaExistente) {
        seleccionarRecorrido(indice);
        return;
    }

    // Si no está visible, se dibuja en el mapa
    dibujarRecorridoEnMapa(indice);
    marcarCheckbox(indice, true);
    seleccionarRecorrido(indice);

    const entradaNueva = buscarEntradaVisible(indice);
    if (entradaNueva) {
        estado.mapa.fitBounds(entradaNueva.linea.getBounds(), {
            padding: [60, 50],
            maxZoom: 17
        });
    }
    actualizarCheckboxMaestro();
}

// Actualiza el estado del checkbox de un recorrido
function marcarCheckbox(indice, valor) {
    const checkbox = document.querySelector(`.checkRecorrido[data-indice="${indice}"]`);
    if (checkbox) checkbox.checked = valor;
}

// Dibuja la línea y los marcadores de inicio y fin del recorrido
function dibujarRecorridoEnMapa(indice, mostrarTooltipsPermanentes = true) {
    const recorrido = estado.recorridosHistoricos[indice];
    if (!recorrido) return;

    const coordenadas = recorrido.map(punto => [punto.lat, punto.lng]);
    const color = obtenerColorRecorrido(indice);

    // Línea principal del recorrido
    const linea = L.polyline(coordenadas, {
        color,
        weight: 5,
        opacity: 0.9
    }).addTo(estado.mapa).on('click', () => seleccionarRecorrido(indice));

    const numero = indice + 1;
    const puntoInicio = recorrido[0];
    const puntoFin = recorrido[recorrido.length - 1];

    // Ajusta la posición del tooltip final dependiendo de la distancia entre inicio y fin
    const distInicioFin = L.latLng(puntoInicio.lat, puntoInicio.lng).distanceTo(L.latLng(puntoFin.lat, puntoFin.lng));
    const direccionFin = distInicioFin < 30 ? 'bottom' : 'top';
    const offsetFin = distInicioFin < 30 ? [0, 14] : [0, -14];

    // Marcador de inicio
    const marcadorInicio = L.marker([puntoInicio.lat, puntoInicio.lng], {
        icon: crearIconoInicio(numero),
        zIndexOffset: 500
    })
        .addTo(estado.mapa)
        .bindTooltip(`Inicio recorrido ${numero}`, {
            permanent: mostrarTooltipsPermanentes,
            direction: 'top',
            offset: [0, -14],
            className: 'tooltipRecorrido tooltipInicio'
        })
        .bindPopup(`Inicio recorrido ${numero}${puntoInicio.fecha ? ' — ' + puntoInicio.fecha + ' ' + (puntoInicio.hora || '') : ''}`)
        .on('click', () => seleccionarRecorrido(indice));

    // Marcador de fin
    const marcadorFin = L.marker([puntoFin.lat, puntoFin.lng], {
        icon: crearIconoFin(numero),
        zIndexOffset: 500
    })
        .addTo(estado.mapa)
        .bindTooltip(`Fin recorrido ${numero}`, {
            permanent: mostrarTooltipsPermanentes,
            direction: direccionFin,
            offset: offsetFin,
            className: 'tooltipRecorrido tooltipFin'
        })
        .bindPopup(`Fin recorrido ${numero}${puntoFin.fecha ? ' — ' + puntoFin.fecha + ' ' + (puntoFin.hora || '') : ''}`)
        .on('click', () => seleccionarRecorrido(indice));

    // Guarda la referencia del recorrido visible para poder manipularlo después
    estado.lineasHistoricas.push({ indice, linea, marcadorInicio, marcadorFin });
}

// Selecciona un recorrido para reproducirlo o revisarlo en detalle
export function seleccionarRecorrido(indice) {
    detenerReproduccion();

    if (!estado.recorridosHistoricos || !estado.recorridosHistoricos[indice]) {
        return;
    }

    // Si el recorrido aún no está visible en el mapa, lo dibuja
    let entrada = buscarEntradaVisible(indice);
    if (!entrada) {
        dibujarRecorridoEnMapa(indice);
        marcarCheckbox(indice, true);
        entrada = buscarEntradaVisible(indice);
    }

    estado.recorridoSeleccionado = estado.recorridosHistoricos[indice];
    estado.indiceReproduccion = 0;

    // Quita el estilo de reproducción del recorrido anterior
    document.querySelectorAll('.itemRecorrido').forEach(item => {
        item.classList.remove('enReproduccion');
    });

    const itemActual = document.querySelector(`.itemRecorrido[data-indice="${indice}"]`);
    if (itemActual) {
        itemActual.classList.add('enReproduccion');
    }

    // Configura el slider para que cubra todo el recorrido
    const slider = document.getElementById('sliderRecorrido');
    if (slider) {
        slider.min = 0;
        slider.max = Math.max(0, estado.recorridoSeleccionado.length - 1);
        slider.value = 0;
    }

    // Crea o mueve el marcador del punto en reproducción
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
        const panel = document.getElementById('panelHistoricos');
        if (panel && reproductor.parentElement !== panel) {
            panel.appendChild(reproductor);
        }
        if (itemActual) {
            itemActual.after(reproductor);
        }
        reproductor.style.display = 'block';
        reproductor.classList.remove('visible');
        void reproductor.offsetWidth;
        reproductor.classList.add('visible');
        reproductor.scrollIntoView({ block: 'nearest' });
    }

    // Muestra el primer punto del recorrido
    actualizarPuntoReproduccion(0);

    // Ajusta la vista del mapa al recorrido seleccionado
    if (entrada) {
        estado.mapa.fitBounds(entrada.linea.getBounds(), {
            padding: [60, 50],
            maxZoom: 17
        });
    }
}

// Actualiza la posición del marcador según el índice de reproducción actual
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

// Inicia la reproducción automatica del recorrido
export function iniciarReproduccion() {
    if (!estado.recorridoSeleccionado || estado.recorridoSeleccionado.length === 0) {
        return;
    }
    if (estado.reproduciendo) {
        return;
    }

    // Si ya llegó al final, reinicia desde el principio
    if (estado.indiceReproduccion >= estado.recorridoSeleccionado.length - 1) {
        estado.indiceReproduccion = 0;
        actualizarPuntoReproduccion(estado.indiceReproduccion);
    }

    estado.reproduciendo = true;
    actualizarBotonReproduccion();

    const velocidad = obtenerVelocidadReproduccion();

    // Avanza punto por punto con el intervalo configurado
    estado.timerReproduccion = setInterval(() => {
        if (!estado.recorridoSeleccionado || estado.indiceReproduccion >= estado.recorridoSeleccionado.length - 1) {
            detenerReproduccion();
            return;
        }
        estado.indiceReproduccion++;
        actualizarPuntoReproduccion(estado.indiceReproduccion);
    }, velocidad);
}

// Pausa la reproducción del recorrido
export function detenerReproduccion() {
    estado.reproduciendo = false;

    if (estado.timerReproduccion) {
        clearInterval(estado.timerReproduccion);
        estado.timerReproduccion = null;
    }

    actualizarBotonReproduccion();
}

// Cambia el ícono del botón de reproducción según su estado
function actualizarBotonReproduccion() {
    const boton = document.getElementById('btnPlayRecorrido');
    if (!boton) return;
    boton.textContent = estado.reproduciendo ? '❚❚' : '▶';
}

// Lee la velocidad seleccionada por el usuario
function obtenerVelocidadReproduccion() {
    const selector = document.getElementById('velocidadRecorrido');
    if (!selector) {
        return 1000;
    }
    return parseInt(selector.value, 10);
}

// Crea el marcador visual de inicio con número dentro
export function crearIconoInicio(num) {
    return L.divIcon({
        className: '',
        html: `
            <div style="width:24px;height:24px;border-radius:50%;background:#2ecc71;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;">
                <span style="color:#ffffff;font-weight:bold;font-size:${num > 9 ? '10px' : '11px'};font-family:monospace;">${num}</span>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -14]
    });
}

// Crea el marcador visual de fin con número dentro
export function crearIconoFin(num) {
    return L.divIcon({
        className: '',
        html: `
            <div style="width:24px;height:24px;border-radius:50%;background:#dc0303;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;">
                <span style="color:#ffffff;font-weight:bold;font-size:${num > 9 ? '10px' : '11px'};font-family:monospace;">${num}</span>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -14]
    });
}
