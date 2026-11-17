// Re-exporta desde cargoCancelacionClient para mantener compatibilidad
export { 
  ErrorTransitorio, 
  ErrorPermanente, 
  obtenerCargo, 
  cargoCancelacionBreaker,
  type CargoRequest 
} from "./cargoCancelacionClient";
