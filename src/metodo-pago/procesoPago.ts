import {type MetodoPago, type TipoPago} from "./metodoPago";

const metodosPago: MetodoPago[]=[]; //como una "BD"

function generarId():string{
    return Math.random().toString();
}

export function registrarMetodoPago(clienteId:string, viajeId: string, tipo: TipoPago): MetodoPago{

    if (clienteId==""||viajeId==""){
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
export function buscarPagoPorViaje(viajeId: string): MetodoPago | undefined{

   return metodosPago.find( (metodoPago) => metodoPago.viajeId === viajeId );
}

// .find()  busca dentro de un array un elemento en particular, es utiliza para BD 