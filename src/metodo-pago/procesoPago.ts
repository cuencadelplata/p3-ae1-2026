import { randomUUID } from "crypto"; //funcion para no intalar node.js y genera un id random para pago 
import {type MetodoPago, type TipoPago} from "./metodoPago";

const metodosPago: MetodoPago[]=[]; //como una "BD"

/*interface registrarMetodoPago{
    clienteId: string; 
    viajeId: string;
    tipo:TipoPago;

}*/

export function registrarMetodoPago(clienteId:string, viajeId: string, tipo: TipoPago): MetodoPago{

    if (clienteId==""||viajeId==""|| tipo==""){
        throw new Error("clienteId, tripId y tipo debe existir"); 
    }
}

const nuevoMetodo: MetodoPago={
   pagoId: randomUUID(), 
   clienteId: clienteId, 
   viajeId: viajeId,
   tipo: TipoPago, 
    fecha: new Date().toLocaleDateString()
};

