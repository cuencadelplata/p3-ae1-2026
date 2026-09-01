class valoracion {
    constructor( usuarioId, conductorId, valoracion, comentario) {
        this.usuarioId = usuarioId;
        this.conductorId = conductorId;
        this.valoracion = valoracion;
        this.comentario = comentario;
    }

    //Setters
    setUsuarioId(usuarioId) {
        this.usuarioId = usuarioId;
    }

    setConductorId(conductorId) {
        this.conductorId = conductorId;
    }

    setValoracion(valoracion) {
        this.valoracion = valoracion;
    }

    setComentario(comentario) {
        this.comentario = comentario;
    }

    //Getters
    getUsuarioId() {
        return this.usuarioId;
    }

    getConductorId() {
        return this.conductorId;
    }

    getValoracion() {
        return this.valoracion;
    }

    getComentario() {
        return this.comentario;
    }


}

module.exports = valoracion;