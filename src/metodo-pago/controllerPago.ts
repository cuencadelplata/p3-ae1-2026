import{Request, Response} from "express"; 
import { registrarMetodoPago, buscarPagoPorViaje, autorizarPago, rechazarPago } from "./procesoPago.js";
import { procesarPagoMercadoPago } from "./PagoCliente.js";

export function crearMetodoPago(req: Request, res: Response) {

  try {
        const clienteId = req.body.clienteId;
        const viajeId = req.body.viajeId;
        const tipo = req.body.tipo;

        const metodoPago = registrarMetodoPago(
            clienteId,
            viajeId,
            tipo
        );

        res.status(201).json(metodoPago);

    } catch (error) {

        res.status(400).json({ //status= fija la peticion http 
            mensaje: "No se pudo registrar el método de pago"
        });
    }
}

// BUSCAR PAGO DE UN VIAJE
 export function obtenerMetodoPago(req: Request, res: Response) { 
   try 
   { 
      const viajeId = String(req.params.viajeId); 
      
      const metodoPago = buscarPagoPorViaje(viajeId); 
    if (!metodoPago) { 
        res.status(404).json({ 
            mensaje: "No se encontró un pago para ese viaje" }); 
    return; 
     } 
     res.status(200).json(metodoPago); 


 } catch (error) {
     res.status(400).json({
         mensaje: "No se pudo buscar el método de pago" 
        }); 
    } 
}

// AUTORIZAR PAGO DE UN VIAJE
export async function autorizarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const idOrden = req.body.idOrden;
    const total = req.body.total;

    if (!idOrden) {
      res.status(400).json({ mensaje: "idOrden es requerido" });
      return;
    }
    if (typeof total !== "number") {
      res.status(400).json({ mensaje: "total es requerido" });
      return;
    }

    const resultadoPago = await procesarPagoMercadoPago(viajeId, total);

    if (resultadoPago.status !== "approved") {
      res.status(402).json({ mensaje: "El pago fue rechazado por Mercado Pago" });
      return;
    }


    const metodoPago = autorizarPago(viajeId, idOrden);
    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo autorizar el pago"
    });
  }
}

// RECHAZAR PAGO DE UN VIAJE
export function rechazarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const metodoPago = rechazarPago(viajeId);
    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo rechazar el pago"
    });
  }
}