// =============================================================================
// MAPA EN VIVO: INICIALIZACIÓN Y TELEMETRÍA EN TIEMPO REAL
// =============================================================================
// Este archivo maneja todo lo relacionado con el mapa en vivo:
// - Crear el mapa base con OpenStreetMap
// - Obtener la ubicación actual del vehículo desde el backend
// - Actualizar el marcador en el mapa cada 5 segundos
// - Dibujar la ruta en vivo (línea roja)
// - Manejar el modo de seguimiento automático del mapa
// - Actualizar el panel de información (LAT, LONG, FECHA, HORA)
// =============================================================================

import { API_BASE, INTERVALO_MS, CENTRO_DEFAULT, ZOOM_CENTRADO } from './constantes.js';
import { redondearCoord } from './utilidades.js';
import { estado } from './estado.js';

// =============================================================================
// FUNCIÓN: refrescarCampo
// =============================================================================
// Propósito: Conectar el backend con el HTML
// 
// Esta función hace lo siguiente:
// 1. Toma un nombre de campo (ej: 'lat', 'lng', 'fecha', 'hora')
// 2. Busca ese dato en el backend (/api/{nombreCampo})
// 3. Inserta el valor en el elemento HTML correspondiente
// 
// Ejemplo:
//   refrescarCampo('lat', 'valorLat')
//   → Hace fetch a /api/lat
//   → Obtiene respuesta: { lat: 11.0195 }
//   → Actualiza <span id="valorLat">11.0195</span>
// =============================================================================
export async function refrescarCampo(nombreCampo, idElemento) {
    // Busca el elemento HTML donde se mostrará el valor
    const elemento = document.getElementById(idElemento);
    
    try {
        // Hace una petición al backend para obtener el valor del campo
        // Si API_BASE está vacío, usa /api/{nombreCampo} en el mismo servidor
        const respuesta = await fetch(`${API_BASE}/api/${nombreCampo}`);
        
        // Si el servidor devuelve un error HTTP, lanza una excepción
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        
        // Convierte la respuesta a JSON
        // Ejemplo: { "lat": 11.0195 } → datos = { lat: 11.0195 }
        const datos = await respuesta.json();
        
        // Extrae el valor específico del objeto JSON
        // Ejemplo: si nombreCampo = 'lat', extrae datos.lat
        const valor = datos[nombreCampo];
        
        // Inserta el valor en el HTML
        // Si el valor es null o undefined, muestra '--' en lugar de error
        elemento.textContent = (valor === null || valor === undefined) ? '--' : valor;
        
        // Devuelve el valor para que otras funciones lo usen
        return valor;
        
    } catch (error) {
        // Si hay error (sin conexión, servidor caído, etc), muestra "Error"
        elemento.textContent = 'Error';
        console.error(`Error al refrescar ${nombreCampo}:`, error);
        return null;
    }
}

// =============================================================================
// FUNCIÓN: actualizarMarcador
// =============================================================================
// Propósito: Actualizar la posición del vehículo cada 5 segundos
// 
// Esta función es la "función del corazón" del mapa en vivo. Se ejecuta cada
// 5 segundos (INTERVALO_MS) y hace lo siguiente:
// 1. Obtiene lat, lng, fecha y hora actuales del backend
// 2. Valida que los datos sean correctos
// 3. Redondea las coordenadas para filtrar ruido GPS
// 4. Mueve el marcador (punto rojo) a la nueva posición
// 5. Centra el mapa si es la primera vez o está activo el tracking
// 6. Evita duplicar puntos si la posición no cambió
// 7. Dibuja la línea del recorrido en vivo
// 8. Oculta la ruta en vivo si se está viendo un histórico
// =============================================================================
export async function actualizarMarcador() {
    // ─────────────────────────────────────────────────────────────────────
    // PASO 1: Obtener datos del backend
    // ─────────────────────────────────────────────────────────────────────
    
    // Trae la latitud actual del vehículo
    // Ejemplo: 11.0195
    const lat = await refrescarCampo('lat', 'valorLat');
    
    // Trae la longitud actual del vehículo
    // Ejemplo: -74.8516
    const lng = await refrescarCampo('lng', 'valorLng');
    
    // Actualiza la fecha mostrada en el panel (sin esperar respuesta)
    // Esto se hace en paralelo con lo anterior
    refrescarCampo('fecha', 'valorFecha');
    
    // Actualiza la hora mostrada en el panel (sin esperar respuesta)
    refrescarCampo('hora', 'valorHora');
    
    // ─────────────────────────────────────────────────────────────────────
    // PASO 2: Validar datos antes de usar
    // ─────────────────────────────────────────────────────────────────────
    
    // Verifica que:
    // - lat no sea null
    // - lng no sea null
    // - lat sea un número válido (no NaN = Not a Number)
    // - lng sea un número válido
    // Si falla alguna validación, sale de la función sin actualizar nada
    if (lat === null || lng === null || isNaN(Number(lat)) || isNaN(Number(lng))) return;
    
    // ─────────────────────────────────────────────────────────────────────
    // PASO 3: Preparar la posición (redondear coordenadas)
    // ─────────────────────────────────────────────────────────────────────
    
    // Redondea las coordenadas a 4 decimales
    // Esto filtra el "ruido" del GPS (pequeñas variaciones cuando está parado)
    // Ejemplo: 11.01901234 → 11.0190
    // Con esto evitamos que la línea parpadee cuando el vehículo está quieto
    const posicion = [redondearCoord(lat), redondearCoord(lng)];
    
    // ─────────────────────────────────────────────────────────────────────
    // PASO 4: Mover el marcador (punto rojo del vehículo)
    // ─────────────────────────────────────────────────────────────────────
    
    // Actualiza la posición del marcador en el mapa
    // El marcador es el punto que representa al vehículo
    estado.marcador.setLatLng(posicion);
    
    // ─────────────────────────────────────────────────────────────────────
    // PASO 5: Centrar el mapa (si es necesario)
    // ─────────────────────────────────────────────────────────────────────
    
    // Condición 1: Primera vez que se centra el mapa
    if (!estado.mapaCentradoInicial && !document.body.classList.contains('modoHistorico')) {
        // Si es la primera actualización Y no estamos viendo un histórico:
        // Centra el mapa en la posición actual del vehículo
        // Esto hace que la app abra directamente donde está el vehículo
        estado.mapa.setView(posicion, estado.mapa.getZoom());
        
        // Marca que ya se centró una vez (para no hacerlo cada 5 segundos)
        estado.mapaCentradoInicial = true;
    } 
    // Condición 2: Modo tracking activo
    else if (estado.modoTracking && !document.body.classList.contains('modoHistorico')) {
        // Si el usuario activó el modo "seguimiento" Y no estamos viendo un histórico:
        // El mapa se mueve continuamente con el vehículo
        // Esto crea el efecto de que el vehículo siempre está centrado
        estado.mapa.setView(posicion, estado.mapa.getZoom());
    }
    // Si estamos en modo histórico, no hace seguimiento en vivo
    
    // ─────────────────────────────────────────────────────────────────────
    // PASO 6: Detectar si la posición es nueva
    // ─────────────────────────────────────────────────────────────────────
    
    // Verifica si la posición cambió respecto a la última vez
    // Esto evita agregar puntos duplicados a la ruta
    // 
    // Lógica:
    // - Si NO hay una posición anterior: es nueva
    // - Si lat es diferente: es nueva
    // - Si lng es diferente: es nueva
    // - Si ambas son iguales: es la misma, no es nueva
    const esPosicionNueva = !estado.ultimaPosicionRecorrido
        || estado.ultimaPosicionRecorrido[0] !== posicion[0]
        || estado.ultimaPosicionRecorrido[1] !== posicion[1];
    
    // ─────────────────────────────────────────────────────────────────────
    // PASO 7: Dibujar la ruta en vivo
    // ─────────────────────────────────────────────────────────────────────
    
    // Si la posición es nueva, agrega el punto a la línea del recorrido
    if (esPosicionNueva) {
        // Añade el nuevo punto a la ruta (línea roja)
        // Con cada actualización, la línea se hace más larga
        estado.recorrido.addLatLng(posicion);
        
        // Guarda esta posición como la "última posición"
        // Esto se usa para la próxima iteración para detectar cambios
        estado.ultimaPosicionRecorrido = posicion;
        
        // ─────────────────────────────────────────────────────────────────
        // PASO 8: Ocultar ruta en vivo cuando se ve un histórico
        // ─────────────────────────────────────────────────────────────────
        
        // Si estamos viendo un recorrido histórico en el mapa:
        if (document.body.classList.contains('modoHistorico')) {
            // Oculta la línea roja del recorrido en vivo
            // Esto evita confusión: el usuario ve solo el histórico, no ambas rutas
            estado.recorrido.setStyle({ opacity: 0 });
        }
    }
}

// =============================================================================
// FUNCIÓN: initMap
// =============================================================================
// Propósito: Inicializar completamente el mapa cuando carga la app
// 
// Esta es la primera función que se ejecuta. Hace lo siguiente:
// 1. Crea el mapa de Leaflet con OpenStreetMap
// 2. Coloca el marcador inicial del vehículo
// 3. Crea la línea roja del recorrido en vivo
// 4. Configura el botón "Centrar" con el evento de click
// 5. Obtiene la última posición conocida del backend
// 6. Inicia el ciclo de actualizaciones cada 5 segundos
// =============================================================================
export async function initMap() {
    // ─────────────────────────────────────────────────────────────────────
    // PARTE 1: Crear el mapa base
    // ─────────────────────────────────────────────────────────────────────
    
    // Crea una instancia del mapa de Leaflet
    // L.map('mapa') = busca el elemento HTML con id="mapa"
    // .setView(CENTRO_DEFAULT, 15) = centra el mapa en Barranquilla, zoom 15
    // Guarda el mapa en el estado global para usarlo en toda la app
    estado.mapa = L.map('mapa').setView(CENTRO_DEFAULT, 15);
    
    // Añade la capa de tiles de OpenStreetMap
    // Los "tiles" son pequeñas imágenes que forman el mapa visual
    // {z}/{x}/{y}.png son las coordenadas del tile en diferentes zoom levels
    // maxZoom: 19 = permite hacer zoom hasta nivel 19 (muy cercano)
    // attribution = créditos a OpenStreetMap (requerido por licencia)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(estado.mapa);
    
    // ─────────────────────────────────────────────────────────────────────
    // PARTE 2: Crear el marcador del vehículo
    // ─────────────────────────────────────────────────────────────────────
    
    // Crea un marcador (pin) en el mapa
    // L.marker(CENTRO_DEFAULT) = coloca un pin en Barranquilla inicialmente
    // .addTo(estado.mapa) = lo añade al mapa
    // .bindPopup('Vehículo') = cuando hagas clic, muestra "Vehículo" en un popup
    // Se guarda en estado.marcador para poder moverlo después
    estado.marcador = L.marker(CENTRO_DEFAULT).addTo(estado.mapa)
        .bindPopup('Vehículo');
    
    // ─────────────────────────────────────────────────────────────────────
    // PARTE 3: Configurar el botón "Centrar"
    // ─────────────────────────────────────────────────────────────────────
    
    // Busca el botón de centrado en el HTML
    const btnCentrar = document.getElementById('btnCentrar');
    
    // Si el botón existe, le añade un evento al hacer clic
    if (btnCentrar) {
        btnCentrar.addEventListener('click', () => {
            // Alterna el modo tracking (true ↔ false)
            // Si estaba off, se enciende. Si estaba on, se apaga.
            estado.modoTracking = !estado.modoTracking;
            
            // Añade o quita la clase CSS 'activo' al botón
            // Esto cambia el estilo visual para mostrar si está activo
            btnCentrar.classList.toggle('activo', estado.modoTracking);
            
            // Cambia el texto del tooltip del botón
            // Si tracking está on: "Desactivar modo seguimiento"
            // Si tracking está off: "Activar modo seguimiento"
            btnCentrar.title = estado.modoTracking 
                ? 'Desactivar modo seguimiento' 
                : 'Activar modo seguimiento';
            
            // Si el tracking se acaba de activar:
            if (estado.modoTracking && estado.marcador && estado.marcador.getLatLng()) {
                // Centra el mapa en la posición actual del vehículo
                // Usa ZOOM_CENTRADO (17) para un buen nivel de acercamiento
                estado.mapa.setView(estado.marcador.getLatLng(), ZOOM_CENTRADO);
            }
        });
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // PARTE 4: Crear la línea del recorrido en vivo
    // ─────────────────────────────────────────────────────────────────────
    
    // Crea una polilínea (línea con múltiples puntos)
    // [] = comienza vacía, se irá llenando con coordenadas
    // color: '#C8102E' = rojo (color de Uninorte)
    // weight: 3 = grosor de la línea en píxeles
    // .addTo(estado.mapa) = la añade al mapa
    estado.recorrido = L.polyline([], { color: '#C8102E', weight: 3 }).addTo(estado.mapa);
    
    // ─────────────────────────────────────────────────────────────────────
    // PARTE 5: Obtener la última posición conocida
    // ─────────────────────────────────────────────────────────────────────
    
    // Intenta cargar la última posición desde el backend
    // Esto hace que el mapa abra en la ubicación correcta sin esperar 5 segundos
    try {
        // Hace fetch a /api/ultimo para obtener la posición anterior guardada
        const res = await fetch(`${API_BASE}/api/ultimo`);
        
        // Si la respuesta es exitosa
        if (res.ok) {
            // Convierte la respuesta a JSON
            // Ejemplo: { "lat": 11.0195, "lng": -74.8516 }
            const datos = await res.json();
            
            // Valida que los datos sean válidos (no null, números reales)
            if (datos.lat !== null && datos.lng !== null && 
                !isNaN(Number(datos.lat)) && !isNaN(Number(datos.lng))) {
                
                // Redondea las coordenadas
                const pos = [redondearCoord(datos.lat), redondearCoord(datos.lng)];
                
                // Mueve el marcador a la última posición conocida
                estado.marcador.setLatLng(pos);
                
                // Centra el mapa en esa posición
                estado.mapa.setView(pos, 15);
                
                // Marca que el mapa ya está centrado
                estado.mapaCentradoInicial = true;
            }
        }
    } catch (e) {
        // Si hay error (sin conexión, API no disponible, etc):
        // Simplemente advierte en la consola y continúa
        // El mapa seguirá funcionando con el centro por defecto
        console.warn('No se pudo obtener la posición inicial desde /api/ultimo, usando centro por defecto:', e);
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // PARTE 6: Iniciar el ciclo de actualizaciones
    // ─────────────────────────────────────────────────────────────────────
    
    // Ejecuta la actualización una vez inmediatamente
    // Esto asegura que el mapa muestre datos lo más pronto posible
    actualizarMarcador();
    
    // Luego ejecuta actualizarMarcador cada INTERVALO_MS milisegundos (5000 = 5 segundos)
    // setInterval = repetir indefinidamente hasta que se llame clearInterval
    // Esto crea el efecto de "tiempo real" donde el marcador se actualiza constantemente
    setInterval(actualizarMarcador, INTERVALO_MS);
}
