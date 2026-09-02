import { Router } from "express";
import { calculoReintegro } from "./calculoReintegro";

const router = Router();

router.post("/reintegro", (req, res) => {
  const { montoCancelacion, viajeId } = req.body; //recibe el monto y el id del viaje
  const monto = calculoReintegro(montoCancelacion); //monto calculado para reintegrar

  res.json({ monto, viajeId });
});

export default router;