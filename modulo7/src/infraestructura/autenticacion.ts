import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { config } from "../config";

export function exigirApiKey(req: Request, res: Response, next: NextFunction) {
  const recibida = Buffer.from(req.header("x-api-key") ?? "");
  const esperada = Buffer.from(config.apiKey);

  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
    res.status(401).json({ mensaje: "API key inválida o ausente" });
    return;
  }
  next();
}