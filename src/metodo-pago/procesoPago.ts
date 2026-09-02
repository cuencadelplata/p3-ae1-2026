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
    detalle: ""
};
metodosPago.push(nuevoMetodo);

    return nuevoMetodo;
};
