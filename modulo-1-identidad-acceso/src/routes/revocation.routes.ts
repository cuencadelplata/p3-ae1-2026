import { Router } from "express";

import { revokeCredentials } from "../controllers/revocation.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { rechazarCredencialRevocada } from "../middleware/credential-revocation.middleware";

const router = Router();

// ============ RF-1.4: Revocación de credenciales ============
// Se aplica a todas las rutas de /auth: un token revocado no pasa a ninguna.
router.use(rechazarCredencialRevocada);

router.post(
    "/revocar-credenciales",
    authenticateToken,
    revokeCredentials
);

export default router;
