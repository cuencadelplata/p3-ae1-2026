import { Router } from "express";
import { calculoReintegro } from "./calculoReintegro";

const router = Router();

// POST /reintegro
// recibe el monto cobrado por la cancelación y el id del viaje, valida que los datos esten bien y devuelve
router.post("/reintegro", (req, res) => {
  const { montoCancelacion, viajeId } = req.body; // recibe el monto y el id del viaje

  // validación: si falta algún dato, o montoCancelacion no es un número para y devulve un error
  if (typeof montoCancelacion !== "number" || !viajeId) {
    return res.status(400).json({ // da error 400 si falta algún dato
      error: "montoCancelacion y viajeId son requeridos"
    });
  }

  const monto = calculoReintegro(montoCancelacion); // monto calculado para reintegrar

  res.json({ monto, viajeId });
});

export default router;