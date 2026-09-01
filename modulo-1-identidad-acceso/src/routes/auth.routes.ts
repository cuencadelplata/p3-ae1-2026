import { Router } from "express";
import {
    login,
    register,
    validateToken
} from "../controllers/auth.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();

router.post(
    "/registrar-usuario",
    register
);

router.post(
    "/iniciar-sesion",
    login
);

router.get(
    "/validar-identidad-y-rol",
    authenticateToken,
    validateToken
);

export default router;