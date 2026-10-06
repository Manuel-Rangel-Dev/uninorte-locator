// =============================================================================
// CONSTANTES GLOBALES
// =============================================================================
export const API_BASE = ''; //Donde esta el backend, vacio debido a que front y back estan en el mismo server
export const INTERVALO_MS = 5000; //cada cuando se actualiza la posición del vehiculo
export const CENTRO_DEFAULT = [11.019, -74.851]; // Barranquilla, fallback inicial
export const DECIMALES_COORDENADAS = 4; // ~11m de resolución: filtra el ruido GPS cuando el vehículo está detenido
export const ZOOM_CENTRADO = 17; // Nivel de zoom específico al centrar en el vehículo
export const UMBRAL_SEGMENTACION_MINUTOS = 30; // Diferencia mínima para considerar un nuevo recorrido (30 min)
export const UMBRAL_SEGMENTACION_METROS = 2000; // Salto de distancia para considerar un nuevo recorrido (2 km)
export const HISTORICO_MIN_ANIO = 2020; // Año minimo desde el que se pueden buscar recorridos
export const RADIO_DEFAULT_METROS = 300; //Radio default del area de busqueda por lugar
export const RADIO_MIN_METROS = 50; //Radio minimo del area de busqueda por lugar
export const RADIO_MAX_METROS = 3000; //Radio maximo del area de busqueda por lugar
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'; //Url del provedor de la info de busqueda escrita
