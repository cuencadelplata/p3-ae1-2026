// Marca de tiempo en milisegundos que nunca se repite ni retrocede dentro del proceso.
//
// La usan la emisión de JWT (claim "iatMs") y la revocación de credenciales (RF-1.4).
// El "iat" estándar del JWT está en segundos enteros: un token emitido justo antes de
// revocar y otro emitido justo después pueden tener el mismo "iat". Con esta marca cada
// evento queda ordenado aunque ocurran en el mismo segundo, o incluso en el mismo
// milisegundo: si el reloj no avanzó, se suma 1 ms a la marca anterior.
let ultimaMarca = 0;

export function marcaDeTiempoMs(): number {
    const ahora = Date.now();

    ultimaMarca = ahora > ultimaMarca ? ahora : ultimaMarca + 1;

    return ultimaMarca;
}
