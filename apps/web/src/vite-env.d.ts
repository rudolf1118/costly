/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Costly API. Optional here because Vite substitutes
   * `undefined` when the variable is absent at build time. */
  readonly VITE_API_URL?: string;
}
