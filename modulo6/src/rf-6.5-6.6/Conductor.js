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
    getusuarioID() { return this._usuarioID; }
    getciudad() { return this._ciudad; }
    gettipovehiculo() { return this._tipovehiculo; }
    getlicenciaId() { return this._licenciaId; }
    getvehiculoId() { return this._vehiculoId; }
    gethabilitado() { return this._habilitado; }
    getestado_conexion() { return this._estado_conexion; }

    // Setters
    setusuarioID(usuarioID) { this._usuarioID = usuarioID; }
    setciudad(ciudad) { this._ciudad = ciudad; }
    settipovehiculo(tipovehiculo) { this._tipovehiculo = tipovehiculo; }
    setlicenciaId(licenciaId) { this._licenciaId = licenciaId; }
    setvehiculoId(vehiculoId) { this._vehiculoId = vehiculoId; }
    sethabilitado(habilitado) { this._habilitado = habilitado; }
    setestado_conexion(estado_conexion) { this._estado_conexion = estado_conexion; }
}

module.exports = Conductor;