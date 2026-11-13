import dotenv from "dotenv";
import path from "path";
import { OAuth2Provider } from "../types/user.types";

dotenv.config();

export interface AppConfig {
    port: number;
    nodeEnv: string;
    jwtSecret: string;
    jwtExpiresIn: string;
    databasePath: string;
    defaultProvider: OAuth2Provider;
    google: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        isConfigured: boolean;
    };
    auth0: {
        domain: string;
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        isConfigured: boolean;
    };
}

const defaultPort = parseInt(process.env.PORT || "3001", 10);
const rawDefaultProvider = (process.env.DEFAULT_OAUTH2_PROVIDER || "MOCK").toUpperCase();
const defaultProvider: OAuth2Provider =
    rawDefaultProvider === "GOOGLE" ? "GOOGLE" :
    rawDefaultProvider === "AUTH0" ? "AUTH0" : "MOCK";

const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleRedirectUri =
    process.env.GOOGLE_REDIRECT_URI || `http://localhost:${defaultPort}/auth/oauth2/callback`;

const auth0Domain = process.env.AUTH0_DOMAIN || "";
const auth0ClientId = process.env.AUTH0_CLIENT_ID || "";
const auth0ClientSecret = process.env.AUTH0_CLIENT_SECRET || "";
const auth0RedirectUri =
    process.env.AUTH0_REDIRECT_URI || `http://localhost:${defaultPort}/auth/oauth2/callback`;

export const INSECURE_DEFAULT_SECRETS = [
    "clave-local-desarrollo-m1-cambiar-en-produccion",
    "clave-desarrollo-m1",
    "reemplazar-por-una-clave-segura"
];

/**
 * Obtiene el secreto para firmar y validar JWTs aplicando política Fail-Closed.
 * En producción (NODE_ENV=production), si JWT_SECRET no está definido o utiliza
 * un valor inseguro/por defecto, lanza un error impidiendo que la aplicación corra de forma insegura.
 */
export function getJwtSecret(): string {
    const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
    const secret = process.env.JWT_SECRET;

    if (!secret || INSECURE_DEFAULT_SECRETS.includes(secret.trim())) {
        if (isProduction) {
            throw new Error(
                "[SEGURIDAD] En entorno de producción (NODE_ENV=production) es obligatorio configurar " +
                "la variable de entorno JWT_SECRET con una clave segura. No se permite el uso de secretos por defecto (Fail-Closed)."
            );
        }
        return "clave-local-desarrollo-m1-cambiar-en-produccion";
    }

    return secret;
}

export const config: AppConfig = {
    port: defaultPort,
    nodeEnv: process.env.NODE_ENV || "development",
    get jwtSecret(): string {
        return getJwtSecret();
    },
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
    databasePath: process.env.DATABASE_PATH || path.join("data", "identity.db"),
    defaultProvider,
    google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri,
        isConfigured: Boolean(googleClientId && googleClientSecret)
    },
    auth0: {
        domain: auth0Domain,
        clientId: auth0ClientId,
        clientSecret: auth0ClientSecret,
        redirectUri: auth0RedirectUri,
        isConfigured: Boolean(auth0Domain && auth0ClientId && auth0ClientSecret)
    }
};
