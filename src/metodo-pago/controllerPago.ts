import{Request, Response} from "express";
import{ registrarMetodoPago } from "./procesoPago";

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

