/**
 * Valoración de un viaje: el conductor (evaluador) califica al pasajero (evaluado).
 * Semántica alineada con valoracion.habilitada / valoracion.registrada.
 */
class Valoracion {
  constructor(evaluadorId, evaluadoId, valoracion, comentario) {
    this.evaluadorId = evaluadorId;
    this.evaluadoId = evaluadoId;
    this.valoracion = valoracion;
    this.comentario = comentario;
  }

  setEvaluadorId(evaluadorId) {
    this.evaluadorId = evaluadorId;
  }
  setEvaluadoId(evaluadoId) {
    this.evaluadoId = evaluadoId;
  }
  setValoracion(valoracion) {
    this.valoracion = valoracion;
  }
  setComentario(comentario) {
    this.comentario = comentario;
  }

  getEvaluadorId() {
    return this.evaluadorId;
  }
  getEvaluadoId() {
    return this.evaluadoId;
  }
  getValoracion() {
    return this.valoracion;
  }
  getComentario() {
    return this.comentario;
  }
}

module.exports = Valoracion;
