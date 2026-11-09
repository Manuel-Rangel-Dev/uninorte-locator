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
    ultimaPosicionValida: null,
    instanteUltimaPosicionValida: 0,
    candidatoSalto: null,

    // Históricos: recorridos y reproductor
    modoHistoricoActivo: false,
    panelMinimizado: false,
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
    modoSeleccion: 'desde',

    // Históricos: filtro por zona
    recorridosBase: [],
    mostrarTodasLasRutas: false,
    zonaActiva: false,
    submodoFiltroZona: 'mapa',
    centroZona: null,
    radioZona: 300,
    circuloZona: null,
    marcadorCentroZona: null,
    modoSeleccionCentro: false,
    arrastrandoZona: false,

    // Kia en vivo (P3-S3)
    kiaMarcador: null,
    kiaTraza: null,              // L.featureGroup con la traza del recorrido en curso
    kiaRecorridoTraza: null,     // recorrido_id de la traza dibujada
    kiaUltimoPuntoTraza: null,   // último punto agregado a la traza ({lat, lng, hora, lph})
    kiaPanelMinimizado: false,

    // Kia en el histórico (P3-S3)
    pestanaHistoricos: 'app',    // 'app' o 'kia'
    kiaMostrarTodos: false,      // false: solo los recorridos con estimado del modelo
    kiaRecorridos: [],
    kiaSeleccionado: null,       // recorrido_id dibujado en el mapa
    kiaCapasHistorico: null      // L.featureGroup con traza, puntos e inicio/fin
};