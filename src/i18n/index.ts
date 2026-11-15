/**
 * Interface localization (i18next + react-i18next).
 *
 * - Strings live in `src/i18n/locales/<lang>/<area>.json` (one file per app
 *   area, combined by that folder's index.ts) and are addressed as
 *   `<area>.<key>`. The English catalog is the source of truth: its shape
 *   types every `t()` key (see `i18next.d.ts`), and a unit test
 *   checks every other locale carries exactly the same keys.
 * - The user's choice is a *preference* ("system" | a language code) kept in
 *   localStorage, because it must be known before React mounts in every
 *   window (main shell and pop-outs share the origin, so they share it).
 *   "system" follows the OS/webview language and falls back to English.
 * - Changing language also switches the date-fns default locale and the
 *   `<html lang>` attribute, so relative dates and screen readers follow.
 *
 * - Module-level constants (menus, folder lists) must not freeze a string at
 *   import time: expose it as a getter that calls `i18next.t(...)` (see
 *   `components/layout/folders.ts`). Components still call `useTranslation()`
 *   so they re-render when the language changes.
 *
 * Adding a language: copy `locales/en/` to `locales/<code>/`, translate, and
 * register it in `RESOURCES`/`LANGUAGES` below and in `DATE_LOCALES`.
 */
import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import { setDefaultOptions, type Locale } from "date-fns"
// Per-locale paths: the "date-fns/locale" barrel would pull in ~100 locales.
import { enUS } from "date-fns/locale/en-US"
import { es as esDate } from "date-fns/locale/es"

import en from "./locales/en"
import es from "./locales/es"

export const LANGUAGE_STORAGE_KEY = "emailer-language"

export const SUPPORTED_LANGUAGES = ["en", "es"] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export type LanguagePreference = Language | "system"

export const DEFAULT_LANGUAGE: Language = "en"

/** Native names: a language is always listed in its own language. */
export const LANGUAGES: readonly { id: Language; name: string }[] = [
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
]

const RESOURCES = {
  en: { translation: en },
  es: { translation: es },
} as const

const DATE_LOCALES: Record<Language, Locale> = {
  en: enUS,
  es: esDate,
}

function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

/** Best supported match for the OS/webview languages, else English. */
export function detectSystemLanguage(): Language {
  const candidates =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
  for (const tag of candidates) {
    const base = tag?.toLowerCase().split("-")[0]
    if (isLanguage(base)) return base
  }
  return DEFAULT_LANGUAGE
}

export function getLanguagePreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === "system" || isLanguage(stored)) return stored
  } catch {
    // localStorage unavailable (hardened webview) — follow the system.
  }
  return "system"
}

export function resolveLanguage(preference: LanguagePreference): Language {
  return preference === "system" ? detectSystemLanguage() : preference
}

/** date-fns locale for the active interface language. */
export function getDateLocale(): Locale {
  const lang = isLanguage(i18next.language) ? i18next.language : DEFAULT_LANGUAGE
  return DATE_LOCALES[lang]
}

function applyLanguageSideEffects(lang: Language): void {
  setDefaultOptions({ locale: DATE_LOCALES[lang] })
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang
  }
}

/** Persist the preference and switch the UI live. */
export async function setLanguagePreference(
  preference: LanguagePreference
): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference)
  } catch {
    // Not persisted; still applies for this session.
  }
  const lang = resolveLanguage(preference)
  applyLanguageSideEffects(lang)
  await i18next.changeLanguage(lang)
}

const initialLanguage = resolveLanguage(getLanguagePreference())

// Resources are bundled, so init is synchronous (initAsync: false) and the
// very first render already has its strings.
void i18next.use(initReactI18next).init({
  resources: RESOURCES,
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  initAsync: false,
  interpolation: { escapeValue: false }, // React already escapes.
  returnNull: false,
})
applyLanguageSideEffects(initialLanguage)

export { i18next }
