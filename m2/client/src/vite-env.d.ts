/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Orígenes a los que se puede volver después de completar el perfil, separados por coma. */
  readonly VITE_VOLVER_PERMITIDOS?: string;
}
