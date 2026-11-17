export class ApiError extends Error {
  constructor(status, message) { super(message); this.name = 'ApiError'; this.status = status; }
}

export function friendlyError(error) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Tu sesión no fue aceptada por M1. Revisá el token.';
    if (error.status === 403) return 'No tenés permiso para ver este recurso.';
    if (error.status === 404) return 'No encontramos ese registro.';
    if (error.status === 409) return 'Hay un conflicto con esta operación. Revisá el estado antes de repetirla.';
    if (error.status === 429) return 'Llegaste al límite de solicitudes. Intentá más tarde.';
    if (error.status === 503) return 'El servicio está temporalmente ocupado. Intentá nuevamente en unos minutos.';
    return error.message;
  }
  return 'No pudimos conectar con M8. Revisá que esté encendido e intentá de nuevo.';
}
