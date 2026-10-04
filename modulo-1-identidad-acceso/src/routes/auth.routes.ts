import { Router } from "express";
import {
    login,
    register,
    validateToken
} from "../controllers/auth.controller";
import {
    requestRecovery,
    resetPasswordHandler,
    oauth2Authorize,
    oauth2Callback,
    oauth2LinkAccount
} from "../controllers/recovery.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { loginRateLimit } from "../middleware/login-rate-limit.middleware";

const router = Router();

// ============ Autenticación Básica ============
router.post(
    "/registrar-usuario",
    register
);

// RF-1.2: rate limiting con Redis antes de validar credenciales
router.post(
    "/iniciar-sesion",
    loginRateLimit,
    login
);

router.get(
    "/validar-identidad-y-rol",
    authenticateToken,
    validateToken
);

// ============ RF-1.4: Recuperación y Permiso ============
router.post(
    "/solicitar-recuperacion",
    requestRecovery
);

router.post(
    "/resetear-contrasena",
    resetPasswordHandler
);

// ============ RF-1.5: Integración Estándar OAuth2/OpenID Connect ============
router.get(
    "/oauth2/authorize",
    oauth2Authorize
);

router.get(
    "/oauth2/callback",
    oauth2Callback
);

router.post(
    "/oauth2/link",
    authenticateToken,
    oauth2LinkAccount
);

export default router;