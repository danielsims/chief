/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Development only: stages a pretend update with this version. */
  readonly VITE_CHIEF_FAKE_UPDATE?: string;
}
