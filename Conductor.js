class Conductor {
    constructor(nombre, apellido, ciudad, dni, telefono, tipovehiculo, licenciaId, vehiculoId) {
        this.nombre = nombre;
        this.apellido = apellido;
        this.ciudad = ciudad;
        this.dni = dni;
        this.telefono = telefono;
        this.tipovehiculo = tipovehiculo;

        //Se trae de la API de licencias y vehiculos
        this.licenciaId = licenciaId;
        this.vehiculoId = vehiculoId;
        this.habilitado = "pendiente";
    }

    // Getters
    getnombre() { return this._nombre; }
    getapellido() { return this._apellido; }
    getciudad() { return this._ciudad; }
    getdni() { return this._dni; }
    gettelefono() { return this._telefono; }
    gettipovehiculo() { return this._tipovehiculo; }
    getlicenciaId() { return this._licenciaId; }
    getvehiculoId() { return this._vehiculoId; }
    gethabilitado() { return this._habilitado; }

    // Setters
    setnombre(nombre) { this._nombre = nombre; }
    setapellido(apellido) { this._apellido = apellido; }
    setciudad(ciudad) { this._ciudad = ciudad; }
    setdni(dni) { this._dni = dni; }
    settelefono(telefono) { this._telefono = telefono; }
    settipovehiculo(tipovehiculo) { this._tipovehiculo = tipovehiculo; }
    setlicenciaId(licenciaId) { this._licenciaId = licenciaId; }
    setvehiculoId(vehiculoId) { this._vehiculoId = vehiculoId; }
    sethabilitado(habilitado) { this._habilitado = habilitado; }
}

module.exports = Conductor;