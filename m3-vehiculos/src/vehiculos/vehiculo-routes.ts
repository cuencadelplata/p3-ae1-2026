import { Router, type Request, type Response } from "express";
import {
  registrarVehiculo,
  listarVehiculos,
  obtenerVehiculo,
  activarVehiculo,
} from "./vehiculo-service.js";

// mergeParams: true es necesario porque :driverId se define en el path
// de montaje (app.use("/api/v1/drivers/:driverId/vehicles", vehiculoRoutes)),
// no acá adentro. Sin esto, req.params.driverId siempre daría undefined.
export const vehiculoRoutes = Router({ mergeParams: true });

// POST /api/v1/drivers/:driverId/vehicles — RF-3.2: registrar un vehículo
vehiculoRoutes.post("/", async (req: Request, res: Response) => {
  const vehiculo = await registrarVehiculo(
    req.params.driverId as string,
    req.body,
  );
  res.status(201).json(vehiculo);
});

// GET /api/v1/drivers/:driverId/vehicles — listar los vehículos del conductor
vehiculoRoutes.get("/", async (req: Request, res: Response) => {
  const vehiculos = await listarVehiculos(req.params.driverId as string);
  res.status(200).json(vehiculos);
});

// GET /api/v1/drivers/:driverId/vehicles/:vehicleId — un vehículo puntual
vehiculoRoutes.get("/:vehicleId", async (req: Request, res: Response) => {
  const vehiculo = await obtenerVehiculo(
    req.params.driverId as string,
    req.params.vehicleId as string,
  );
  res.status(200).json(vehiculo);
});

// PATCH /api/v1/drivers/:driverId/vehicles/:vehicleId/activar — marcarlo activo
vehiculoRoutes.patch(
  "/:vehicleId/activar",
  async (req: Request, res: Response) => {
    const vehiculo = await activarVehiculo(
      req.params.driverId as string,
      req.params.vehicleId as string,
    );
    res.status(200).json(vehiculo);
  },
);