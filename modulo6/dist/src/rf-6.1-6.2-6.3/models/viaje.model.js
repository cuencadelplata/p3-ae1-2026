// src/models/viaje.model.ts
// Este archivo define el modelo de datos para los viajes, incluyendo la interfaz Viaje y el enum EstadoViaje. La interfaz Viaje representa un viaje con sus propiedades, mientras que el enum EstadoViaje define los posibles estados de un viaje.
export var EstadoViaje;
(function (EstadoViaje) {
    EstadoViaje["SOLICITADO"] = "SOLICITADO";
    EstadoViaje["ASIGNADO"] = "ASIGNADO";
    EstadoViaje["CONDUCTOR_EN_CAMINO"] = "CONDUCTOR_EN_CAMINO";
    EstadoViaje["ARRIBADO"] = "ARRIBADO";
    EstadoViaje["EN_CURSO"] = "EN_CURSO";
    EstadoViaje["COMPLETADO"] = "COMPLETADO";
    EstadoViaje["CANCELADO"] = "CANCELADO";
})(EstadoViaje || (EstadoViaje = {}));
