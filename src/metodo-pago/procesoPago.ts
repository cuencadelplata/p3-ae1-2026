import {type MetodoPago, type TipoPago} from "./metodoPago";
import { esPagoDuplicado } from "../5-pago-duplicado/verificaPagoDuplicado";
import { registrosDeEjemplo } from "../mock/registroPagoMock";

const metodosPago: MetodoPago[]=[]; //como una "BD"

function generarId():string{
    return Math.random().toString();
}

export function registrarMetodoPago(clienteId:string, viajeId: string, tipo: TipoPago): MetodoPago{

    if (clienteId||viajeId){
        throw new Error("clienteId y viajeId debe existir"); 
    }

const nuevoMetodo: MetodoPago={
    pagoId: generarId(),
    clienteId: clienteId,
    viajeId: viajeId,
    tipo: tipo,
    fecha: new Date().toLocaleDateString(),
    detalle: "",
    estado: "pendiente", 
};
metodosPago.push(nuevoMetodo);  //.push() agrega un elemento de metodoNuevo y lo coloca al final de la lista de MétododePago

    return nuevoMetodo;
};

//buscar el pago de in vieja seggun su id
export function buscarPagoPorViaje(viajeId: string): MetodoPago | undefined{ //la forma de pago de un viaje en particular 

   return metodosPago.find( (metodoPago) => metodoPago.viajeId === viajeId );
}

// .find()  busca dentro de un array un elemento en particular, es utiliza para BD 

export function autorizarPago(viajeId: string, idOrden: string): MetodoPago {

    const metodoPago = buscarPagoPorViaje(viajeId);

    if (!metodoPago) {
        throw new Error("no existe un tipo de pago registrado que este asociado para dicho viaje");
    }

    if (metodoPago.estado !== "pendiente") {
        throw new Error("El pago no fue procesado aún");
    }

    // RF-7.6: antes de autorizar el cobro, verificamos que esa orden
    // no haya sido procesada antes (idempotencia)
    if (esPagoDuplicado(idOrden, registrosDeEjemplo)) {
        throw new Error("Esta orden de pago ya fue procesada anteriormente");
    }

    metodoPago.estado = "autorizado";

    // Registramos la orden como procesada, para que futuras verificaciones
    // de idempotencia la detecten
    registrosDeEjemplo.push({
        idOrden,
        idViaje: viajeId,
        monto: 0, // placeholder: el monto real vendría de RF-7.1/7.4
        fecha: new Date(),
    });

    return metodoPago;

}

export function rechazarPago(viajeId: string): MetodoPago {

    const metodoPago = buscarPagoPorViaje(viajeId);

    if (!metodoPago) {
        throw new Error("no existe un tipo de pago registrado que este asociado para dicho viaje");
    }

    if (metodoPago.estado !== "pendiente") {
        throw new Error("El pago no fue procesado aún");
    }

    metodoPago.estado = "rechazado";

    return metodoPago;

}