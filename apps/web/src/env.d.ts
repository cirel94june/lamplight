/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OWNER_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
