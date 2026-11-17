import { OAuth2Provider } from "../../types/user.types";
import { IOAuth2Adapter } from "./adapters/oauth2-adapter.interface";
import { MockOAuth2Adapter } from "./adapters/mock.adapter";
import { GoogleOAuth2Adapter } from "./adapters/google.adapter";
import { Auth0OAuth2Adapter } from "./adapters/auth0.adapter";
import { OAuth2Error, ProviderStatus } from "./oauth2.types";
import { config } from "../../config/env";

export class OAuth2AdapterFactory {
    private static adapters: Map<OAuth2Provider, IOAuth2Adapter> = new Map<OAuth2Provider, IOAuth2Adapter>([
        ["MOCK", new MockOAuth2Adapter()],
        ["GOOGLE", new GoogleOAuth2Adapter()],
        ["AUTH0", new Auth0OAuth2Adapter()]
    ]);

    static normalizeProvider(rawProvider?: string): OAuth2Provider {
        if (!rawProvider) {
            return config.defaultProvider;
        }

        const normalized = rawProvider.trim().toUpperCase();

        if (normalized === "GOOGLE" || normalized === "AUTH0" || normalized === "MOCK") {
            return normalized as OAuth2Provider;
        }

        throw new OAuth2Error(
            400,
            `Proveedor OAuth2 '${rawProvider}' no soportado. Proveedores válidos: GOOGLE, AUTH0, MOCK`,
            "unsupported_provider"
        );
    }

    static getAdapter(rawProvider?: string): IOAuth2Adapter {
        const provider = this.normalizeProvider(rawProvider);
        const adapter = this.adapters.get(provider);

        if (!adapter) {
            throw new OAuth2Error(
                400,
                `No hay un adaptador disponible para el proveedor ${provider}`,
                "adapter_not_found"
            );
        }

        return adapter;
    }

    static listProviders(): ProviderStatus[] {
        return Array.from(this.adapters.values()).map(adapter => ({
            provider: adapter.provider,
            configured: adapter.isConfigured(),
            isDefault: adapter.provider === config.defaultProvider,
            description: adapter.name
        }));
    }
}
