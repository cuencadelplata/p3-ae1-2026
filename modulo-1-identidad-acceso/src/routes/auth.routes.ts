import { Router } from "express";
import {
    login,
    register,
    validateToken
} from "../controllers/auth.controller";
import {
    requestRecovery,
    resetPasswordHandler
} from "../controllers/recovery.controller";
import {
    oauth2Authorize,
    oauth2Callback,
    oauth2LinkAccount,
    listProviders,
    getUserInfo
} from "../controllers/oauth2.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();

// ============ RF-1.1, RF-1.2, RF-1.3: Autenticación Básica ============
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

// ============ RF-1.4: Recuperación de Contraseña ============
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
    "/oauth2/providers",
    listProviders
);

router.get(
    "/oauth2/authorize",
    oauth2Authorize
);

router.get(
    "/oauth2/callback",
    oauth2Callback
);

router.post(
    "/oauth2/callback",
    oauth2Callback
);

router.post(
    "/oauth2/link",
    authenticateToken,
    oauth2LinkAccount
);

router.get(
    "/oauth2/userinfo",
    authenticateToken,
    getUserInfo
);

export default router;
