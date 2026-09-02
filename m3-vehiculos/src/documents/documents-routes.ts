import { Routes, type Request, type Response } from "express";

import {
  registrarDocumento,
  listarDocumentos,
  obtenerDocumento,
} from "./documents-service.js";

export const documentoRoutes = Routes({ mergeParams: true });

// POST /api/v1/drivers/:driverId/documents
// RF-3.4: registrar documentación
documentoRoutes.post("/", async (req: Request, res: Response) => {
  const documento = await registrarDocumento(
    req.params.driverId as string,
    req.body,
  );

  res.status(201).json(documento);
});

// GET /api/v1/drivers/:driverId/documents
// RF-3.4: listar documentación del conductor
documentoRoutes.get("/", async (req: Request, res: Response) => {
  const documentos = await listarDocumentos(
    req.params.driverId as string,
  );

  res.status(200).json(documentos);
});

// GET /api/v1/drivers/:driverId/documents/:documentId
// RF-3.4: obtener documentación específica
documentoRoutes.get(
  "/:documentId",
  async (req: Request, res: Response) => {
    const documento = await obtenerDocumento(
      req.params.driverId as string,
      req.params.documentId as string,
    );

    res.status(200).json(documento);
  },
);