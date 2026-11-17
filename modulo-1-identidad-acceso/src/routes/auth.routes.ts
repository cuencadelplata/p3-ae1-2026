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
import { authenticateToken, authorizeRoles } from "../middleware/auth.middleware";
import { loginRateLimit } from "../middleware/login-rate-limit.middleware";
import { obtenerMiPerfil } from "../controllers/me.controller";

const router = Router();

// ============ RF-1.1, RF-1.2, RF-1.3: Autenticación Básica ============
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

// RF-1.2: datos del propio usuario a partir de su token (lo usan M2 y otros módulos)
router.get(
    "/me",
    authenticateToken,
    obtenerMiPerfil
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

// ============ Demostración RF-1.3 (Roles) ============
router.get(
    "/admin-panel",
    authenticateToken,
    authorizeRoles("OPERADOR"),
    (req, res) => { res.json({ message: "Bienvenido al panel de Operadores" }); }
);

router.get(
    "/portal-conductor",
    authenticateToken,
    authorizeRoles("CONDUCTOR"),
    (req, res) => { res.json({ message: "Bienvenido al portal de Conductores" }); }
);

export default router;
