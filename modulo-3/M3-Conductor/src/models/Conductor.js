class Conductor {
    constructor(usuarioID,ciudad, tipovehiculo, licenciaId, vehiculoId) {
        //se trae de la API de M1
        this.usuarioID = usuarioID;
        this.ciudad = ciudad;
        this.tipovehiculo = tipovehiculo;

        //Se trae de la API de licencias y vehiculos
        this.licenciaId = licenciaId;
        this.vehiculoId = vehiculoId;
        this.habilitado = "pendiente";
        this.estado_conexion= "desconectado";
    }

    // Getters
    getusuarioID() { return this.usuarioID; }
    getciudad() { return this.ciudad; }
    gettipovehiculo() { return this.tipovehiculo; }
    getlicenciaId() { return this.licenciaId; }
    getvehiculoId() { return this.vehiculoId; }
    gethabilitado() { return this.habilitado; }
    getestado_conexion() { return this.estado_conexion; }

    // Setters
    setusuarioID(usuarioID) { this.usuarioID = usuarioID; }
    setciudad(ciudad) { this.ciudad = ciudad; }
    settipovehiculo(tipovehiculo) { this.tipovehiculo = tipovehiculo; }
    setlicenciaId(licenciaId) { this.licenciaId = licenciaId; }
    setvehiculoId(vehiculoId) { this.vehiculoId = vehiculoId; }
    sethabilitado(habilitado) { this.habilitado = habilitado; }
    setestado_conexion(estado_conexion) { this.estado_conexion = estado_conexion; }
}

module.exports = Conductor;