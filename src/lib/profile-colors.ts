/**
 * Profile color palette (parity-round-2 task 4.4, accounts spec "Account
 * profiles and colors") — kept out of the profiles-editor component file
 * so fast-refresh only sees components there (the src/lib/accent.ts
 * precedent for picker palettes).
 *
 * The editor renders these as swatch buttons; the picked value is stored
 * verbatim in account_profiles.color / accounts.color_override and
 * rendered as-is by the thread-list markers (the label.color convention:
 * user content, not component styling). Ordered for distinction between
 * adjacent profiles.
 */

import { i18next } from "@/i18n"

export type ProfileColor = {
  id: string
  /** Human-readable label for the picker's aria-labels (localized at
   * read time — a getter). */
  readonly label: string
  /** CSS hex value stored and rendered verbatim. */
  value: string
}

export const PROFILE_COLORS: readonly ProfileColor[] = [
  {
    id: "blue",
    get label() {
      return i18next.t("settingsMail.profiles.colors.blue")
    },
    value: "#3b82f6",
  },
  {
    id: "purple",
    get label() {
      return i18next.t("settingsMail.profiles.colors.purple")
    },
    value: "#8b5cf6",
  },
  {
    id: "green",
    get label() {
      return i18next.t("settingsMail.profiles.colors.green")
    },
    value: "#22c55e",
  },
  {
    id: "orange",
    get label() {
      return i18next.t("settingsMail.profiles.colors.orange")
    },
    value: "#f97316",
  },
  {
    id: "pink",
    get label() {
      return i18next.t("settingsMail.profiles.colors.pink")
    },
    value: "#ec4899",
  },
  {
    id: "teal",
    get label() {
      return i18next.t("settingsMail.profiles.colors.teal")
    },
    value: "#14b8a6",
  },
  {
    id: "red",
    get label() {
      return i18next.t("settingsMail.profiles.colors.red")
    },
    value: "#ef4444",
  },
  {
    id: "amber",
    get label() {
      return i18next.t("settingsMail.profiles.colors.amber")
    },
    value: "#f59e0b",
  },
]

/** A new profile starts on the first palette entry. */
export const DEFAULT_PROFILE_COLOR = PROFILE_COLORS[0].value
