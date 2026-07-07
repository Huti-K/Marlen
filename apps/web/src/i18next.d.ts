import "i18next";
import type en from "./locales/en.json";

// Type t() against the English resources so unknown keys fail the typecheck.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}
