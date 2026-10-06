export default class Conductor {
    constructor(usuarioID, ciudad, tipovehiculo, licenciaId, vehiculoId) {
        this.usuarioID = usuarioID;
        this.ciudad = ciudad;
        this.tipovehiculo = tipovehiculo;
        this.licenciaId = licenciaId;
        this.vehiculoId = vehiculoId;
        this.habilitado = "pendiente";
        this.estado_conexion = "desconectado";
    }

    getusuarioID() { return this.usuarioID; }
    getciudad() { return this.ciudad; }
    gettipovehiculo() { return this.tipovehiculo; }
    getlicenciaId() { return this.licenciaId; }
    getvehiculoId() { return this.vehiculoId; }
    gethabilitado() { return this.habilitado; }
    getestado_conexion() { return this.estado_conexion; }

    setusuarioID(usuarioID) { this.usuarioID = usuarioID; }
    setciudad(ciudad) { this.ciudad = ciudad; }
    settipovehiculo(tipovehiculo) { this.tipovehiculo = tipovehiculo; }
    setlicenciaId(licenciaId) { this.licenciaId = licenciaId; }
    setvehiculoId(vehiculoId) { this.vehiculoId = vehiculoId; }
    sethabilitado(habilitado) { this.habilitado = habilitado; }
    setestado_conexion(estado_conexion) { this.estado_conexion = estado_conexion; }
}