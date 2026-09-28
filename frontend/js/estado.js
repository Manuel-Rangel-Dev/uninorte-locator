// =============================================================================
// ESTADO GLOBAL COMPARTIDO
// Un solo objeto mutable para que todos los módulos lean/escriban las mismas
// variables, sin necesitar funciones getter/setter para cada una.
// =============================================================================
export const estado = {
    // Mapa y telemetría en vivo
    mapa: null,
    marcador: null,
    recorrido: null,
    ultimaPosicionRecorrido: null,
    mapaCentradoInicial: false,
    modoTracking: false,

    // Históricos: recorridos y reproductor
    hayRecorridoHistorico: false,
    lineasHistoricas: [],
    marcadoresHistoricos: [],
    recorridosHistoricos: [],
    recorridoSeleccionado: null,
    indiceReproduccion: 0,
    marcadorReproduccion: null,
    timerReproduccion: null,
    reproduciendo: false,
    lineaRecorridoSeleccionado: null,

    // Históricos: selección de fecha en el calendario
    fechaCalendario: new Date(),
    fechaDesde: new Date(),
    fechaHasta: new Date(),
    modoSeleccion: 'desde'
};