// =============================================================================
// CONSTANTES GLOBALES
// =============================================================================
export const API_BASE = '';
export const INTERVALO_MS = 5000;
export const CENTRO_DEFAULT = [11.019, -74.851]; // Barranquilla, fallback inicial
export const DECIMALES_COORDENADAS = 4; // ~11m de resolución: filtra el ruido GPS cuando el vehículo está detenido
export const ZOOM_CENTRADO = 17; // Nivel de zoom específico al centrar en el vehículo
export const UMBRAL_SEGMENTACION_MINUTOS = 30; // Diferencia mínima para considerar un nuevo recorrido (30 min)
export const UMBRAL_SEGMENTACION_METROS = 2000; // Salto de distancia para considerar un nuevo recorrido (2 km)
export const HISTORICO_MIN_ANIO = 2020;