// =============================================================================
// CONSTANTES GLOBALES
// =============================================================================
export const API_BASE = ''; //Donde esta el backend, vacio debido a que front y back estan en el mismo server
export const INTERVALO_MS = 5000; //cada cuando se actualiza la posición del vehiculo
export const CENTRO_DEFAULT = [11.019, -74.851]; // Barranquilla, fallback inicial
export const DECIMALES_COORDENADAS = 4; // ~11m de resolución: filtra el ruido GPS cuando el vehículo está detenido
export const VEL_MAX_VIVO_MS = 25; // Velocidad máxima creíble en vivo (90 km/h)
export const DIST_MIN_SALTO_VIVO_M = 60; // Saltos menores a esto nunca se consideran ruido
export const MINUTOS_PRECARGA_RECORRIDO = 15; // Minutos de traza que se precargan al abrir la página
export const UMBRAL_HUECO_SEGUNDOS = 60; // Más de este tiempo sin datos se dibuja punteado
export const ZOOM_CENTRADO = 17; // Nivel de zoom específico al centrar en el vehículo
export const UMBRAL_SEGMENTACION_MINUTOS = 30; // Diferencia mínima para considerar un nuevo recorrido (30 min)
export const UMBRAL_SEGMENTACION_METROS = 2000; // Salto de distancia para considerar un nuevo recorrido (2 km)
export const UMBRAL_ESTACIONADO_METROS = 50; // Radio del área en que el vehículo se considera detenido (absorbe el jitter del GPS); si permanece dentro ≥ UMBRAL_SEGMENTACION_MINUTOS, al salir empieza otro recorrido
export const HISTORICO_MIN_ANIO = 2020; // Año minimo desde el que se pueden buscar recorridos
export const RADIO_DEFAULT_METROS = 300; //Radio default del area de busqueda por lugar
export const RADIO_MIN_METROS = 50; //Radio minimo del area de busqueda por lugar
export const RADIO_MAX_METROS = 3000; //Radio maximo del area de busqueda por lugar
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'; //Url del provedor de la info de busqueda escrita
export const INTERVALO_MIN_BUSQUEDA_MS = 1100; // Nominatim: máximo 1 petición por segundo

// =============================================================================
// CONSUMO DEL KIA (P3-S3)
// =============================================================================
export const INTERVALO_KIA_MS = 5000; // cada cuánto se consulta /api/kia/vivo
export const MAX_CONSULTAS_CONSUMO = 2; // consultas simultáneas a /api/historico/consumo
// Color de la traza según el L/h (PID 0x5E o ecuación): de ralentí (verde) a aceleración fuerte (rojo).
// "hasta" es el límite superior de cada rango, en L/h.
export const ESCALA_LPH = [
    { hasta: 1, color: '#2ecc71' },
    { hasta: 2, color: '#a3d65c' },
    { hasta: 4, color: '#f1c40f' },
    { hasta: 7, color: '#e67e22' },
    { hasta: Infinity, color: '#e74c3c' }
];
export const COLOR_SIN_CONSUMO = '#8a8a8a'; // punto sin L/h (sin PID ni ecuación)
