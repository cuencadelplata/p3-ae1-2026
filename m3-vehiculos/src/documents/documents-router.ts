import { Router, type Request, type Response } from "express";

import {
  registrarDocumento,
  listarDocumentos,
  obtenerDocumento,
} from "./documents-service.js";

export const documentoRouter = Router({ mergeParams: true });

// POST /api/v1/drivers/:driverId/documents
// RF-3.4: registrar documentación
documentoRouter.post("/", async (req: Request, res: Response) => {
  const documento = await registrarDocumento(
    req.params.driverId as string,
    req.body,
  );

  res.status(201).json(documento);
});

// GET /api/v1/drivers/:driverId/documents
// RF-3.4: listar documentación del conductor
documentoRouter.get("/", async (req: Request, res: Response) => {
  const documentos = await listarDocumentos(
    req.params.driverId as string,
  );

  res.status(200).json(documentos);
});

// GET /api/v1/drivers/:driverId/documents/:documentId
// RF-3.4: obtener documentación específica
documentoRouter.get(
  "/:documentId",
  async (req: Request, res: Response) => {
    const documento = await obtenerDocumento(
      req.params.driverId as string,
      req.params.documentId as string,
    );

    res.status(200).json(documento);
  },
);