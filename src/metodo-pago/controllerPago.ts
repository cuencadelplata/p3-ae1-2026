import{Request, Response} from "express";
import{ registrarMetodoPago, buscarPagoPorViaje } from "./procesoPago";

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

        res.status(400).json({
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

