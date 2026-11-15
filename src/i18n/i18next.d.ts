import "i18next"

import type en from "./locales/en"

// Types every t() key against the English catalog: a typo or a key missing
// from en.json is a compile error.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: { translation: typeof en }
    returnNull: false
  }
}
