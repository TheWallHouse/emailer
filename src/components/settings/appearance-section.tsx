import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import {
  ACCENTS,
  applyAccent,
  DEFAULT_ACCENT_ID,
  getStoredAccentId,
} from "@/lib/accent"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { clearAvatarCache } from "@/services/contacts/avatars"
import { getExecutor } from "@/services/db/executor"
import {
  DENSITY_PRESETS,
  FONT_SCALES,
  getDensity,
  getFontScale,
  getGravatarEnabled,
  getProfileColorMarkersEnabled,
  setAccentPreference,
  setDensityPreference,
  setFontScalePreference,
  setGravatarEnabledPreference,
  setProfileColorMarkersPreference,
  setThemeModePreference,
  type DensityPreset,
  type ThemeMode,
} from "@/services/settings/preferences"
import { useTheme } from "@/components/theme-provider"
import {
  getLanguagePreference,
  LANGUAGES,
  setLanguagePreference,
  type LanguagePreference,
} from "@/i18n"

/**
 * Settings "Appearance" section (task 11.2): theme mode (next-themes,
 * light/dark/system), accent color (src/lib/accent.ts), list density and
 * global font scale. Every control applies live and persists — mode and
 * accent through their own owners (next-themes localStorage; accent
 * localStorage + settings-table mirror), density and font scale through
 * the settings table feeding the --density/--font-scale tokens.
 *
 * Also hosts the opt-in contact-avatar toggle (task 2.5, design D12):
 * OFF by default because fetching a Gravatar discloses a one-way hash of
 * each contact's email address to gravatar.com — the privacy trade-off
 * is spelled out on the row (the spec's "documented as a privacy
 * trade-off at the toggle"). Flipping it clears the avatars service's
 * blob cache: OFF revokes the URLs so cached avatars leave display (the
 * spec's "disabling … SHALL remove cached avatars from display"); ON
 * wakes already-mounted avatars to run their now-permitted fetches.
 */

function SettingRow({
  controlId,
  label,
  hint,
  children,
}: {
  /** Form control the label names (omit for control groups that label
   * themselves via role/aria-label, e.g. the density ToggleGroup). */
  controlId?: string
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="grid gap-0.5">
        {controlId ? (
          <Label htmlFor={controlId}>{label}</Label>
        ) : (
          <p className="text-sm font-medium text-foreground">{label}</p>
        )}
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

const THEME_OPTIONS: ThemeMode[] = ["light", "dark", "system"]

export function AppearanceSection() {
  const { t } = useTranslation()
  const [language, setLanguage] = useState<LanguagePreference>(
    getLanguagePreference()
  )
  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: "system", label: t("common.system") },
    ...LANGUAGES.map((lang) => ({ value: lang.id, label: lang.name })),
  ]
  const themeLabel = (mode: ThemeMode) =>
    t(`settings.appearance.themeMode.${mode}`)
  const accentName = (id: string) =>
    t(`settings.appearance.accent.names.${id}` as "settings.appearance.accent.names.default")
  const { theme, setTheme } = useTheme()
  const [density, setDensity] = useState<DensityPreset>("default")
  const [fontScale, setFontScale] = useState(1)
  const [accentId, setAccentId] = useState(getStoredAccentId())
  // Contact avatars (Gravatar): default OFF — the privacy default (see
  // the module docstring); the persisted value replaces it after load.
  const [gravatarEnabled, setGravatarEnabled] = useState(false)
  // Profile color markers (task 4.5): default shown (the spec default);
  // the persisted value replaces it after load.
  const [profileColorMarkers, setProfileColorMarkers] = useState(true)
  // Set as soon as the user changes anything: the async initial load must
  // never clobber a change with a stale DB read.
  const dirtyRef = useRef(false)

  // Load the settings-table-backed values once; the section only renders
  // inside the shell, where bootstrap() has made the executor available.
  // Failures keep the defaults (already applied at boot).
  useEffect(() => {
    try {
      const executor = getExecutor()
      void getDensity(executor).then((value) => {
        if (!dirtyRef.current) setDensity(value)
      })
      void getFontScale(executor).then((value) => {
        if (!dirtyRef.current) setFontScale(value)
      })
      void getGravatarEnabled(executor)
        .then((value) => {
          if (!dirtyRef.current) setGravatarEnabled(value)
        })
        .catch(() => {})
      void getProfileColorMarkersEnabled(executor)
        .then((value) => {
          if (!dirtyRef.current) setProfileColorMarkers(value)
        })
        .catch(() => {})
    } catch (error) {
      console.warn("[appearance] preference load failed", error)
    }
  }, [])

  function changeLanguage(preference: LanguagePreference): void {
    setLanguage(preference)
    void setLanguagePreference(preference).catch((error) => {
      console.warn("[appearance] failed to switch language", error)
    })
  }

  function changeThemeMode(mode: ThemeMode): void {
    setTheme(mode)
    dirtyRef.current = true
    try {
      // Mirror only — next-themes owns persistence and boot application.
      void setThemeModePreference(getExecutor(), mode).catch((error) => {
        console.warn("[appearance] failed to persist theme mode", error)
      })
    } catch (error) {
      console.warn("[appearance] failed to persist theme mode", error)
    }
  }

  function changeAccent(id: string): void {
    // applyAccent applies live + writes the localStorage bootstrap copy;
    // the settings row is the DB mirror (see preferences.ts).
    applyAccent(id)
    setAccentId(id)
    dirtyRef.current = true
    try {
      void setAccentPreference(getExecutor(), id).catch((error) => {
        console.warn("[appearance] failed to persist accent", error)
      })
    } catch (error) {
      console.warn("[appearance] failed to persist accent", error)
    }
  }

  function changeDensity(preset: DensityPreset): void {
    setDensity(preset)
    dirtyRef.current = true
    try {
      void setDensityPreference(getExecutor(), preset).catch((error) => {
        console.warn("[appearance] failed to persist density", error)
      })
    } catch (error) {
      console.warn("[appearance] failed to persist density", error)
    }
  }

  function changeFontScale(scale: number): void {
    setFontScale(scale)
    dirtyRef.current = true
    try {
      void setFontScalePreference(getExecutor(), scale).catch((error) => {
        console.warn("[appearance] failed to persist font size", error)
      })
    } catch (error) {
      console.warn("[appearance] failed to persist font size", error)
    }
  }

  /**
   * Optimistic Gravatar toggle (the reading section's notification
   * pattern): flip immediately, persist, then clear the avatars service's
   * blob cache — OFF revokes every blob URL so cached avatars leave
   * display; ON wakes mounted avatars to fetch under the new permission.
   * A failed persist reverts the switch and skips the cache clear.
   */
  function changeGravatarAvatars(enabled: boolean): void {
    const previous = gravatarEnabled
    dirtyRef.current = true
    setGravatarEnabled(enabled)
    try {
      void setGravatarEnabledPreference(getExecutor(), enabled)
        .then(() => clearAvatarCache())
        .catch((error) => {
          setGravatarEnabled(previous)
          console.warn("[appearance] failed to persist avatars", error)
        })
    } catch (error) {
      setGravatarEnabled(previous)
      console.warn("[appearance] failed to persist avatars", error)
    }
  }

  /**
   * Toggle the profile color markers (task 4.5): flip immediately,
   * persist (default shown — see preferences.ts), revert on failure.
   * Cross-account thread lists re-read the value on their next mount, so
   * leaving settings re-renders them without markers everywhere.
   */
  function changeProfileColorMarkers(enabled: boolean): void {
    const previous = profileColorMarkers
    dirtyRef.current = true
    setProfileColorMarkers(enabled)
    try {
      void setProfileColorMarkersPreference(getExecutor(), enabled).catch(
        (error) => {
          setProfileColorMarkers(previous)
          console.warn(
            "[appearance] failed to persist profile color markers",
            error
          )
        }
      )
    } catch (error) {
      setProfileColorMarkers(previous)
      console.warn("[appearance] failed to persist profile color markers", error)
    }
  }

  return (
    <section
      aria-label={t("settings.appearance.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settings.appearance.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.appearance.description")}
        </p>
      </div>
      <div className="divide-y divide-border">
        <SettingRow
          controlId="appearance-language"
          label={t("settings.appearance.language.label")}
          hint={t("settings.appearance.language.hint")}
        >
          <Select
            value={language}
            items={Object.fromEntries(
              languageOptions.map((option) => [option.value, option.label])
            )}
            onValueChange={(value) =>
              changeLanguage(String(value) as LanguagePreference)
            }
          >
            <SelectTrigger id="appearance-language" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          controlId="appearance-theme-mode"
          label={t("settings.appearance.themeMode.label")}
          hint={t("settings.appearance.themeMode.hint")}
        >
          <Select
            value={theme ?? "system"}
            items={Object.fromEntries(
              THEME_OPTIONS.map((mode) => [mode, themeLabel(mode)])
            )}
            onValueChange={(value) =>
              changeThemeMode(String(value) as ThemeMode)
            }
          >
            <SelectTrigger id="appearance-theme-mode" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_OPTIONS.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {themeLabel(mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label={t("settings.appearance.accent.label")}
          hint={t("settings.appearance.accent.hint")}
        >
          <div
            role="group"
            aria-label={t("settings.appearance.accent.label")}
            className="flex items-center gap-1.5"
          >
            {ACCENTS.map((accent) => (
              <button
                key={accent.id}
                type="button"
                aria-label={t("settings.appearance.accent.item", {
                  name: accentName(accent.id),
                })}
                aria-pressed={accentId === accent.id}
                title={accentName(accent.id)}
                className={cn(
                  "rounded-full p-0.5",
                  accentId === accent.id &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-background"
                )}
                onClick={() => changeAccent(accent.id)}
              >
                {/* Token demo chip: the data-accent attribute scopes the
                    accent variables to this element, so bg-primary renders
                    the accent color — same mechanism as <html> (ui-guide
                    §4); token-only styling rule respected. */}
                <span
                  data-accent={
                    accent.id === DEFAULT_ACCENT_ID ? undefined : accent.id
                  }
                  aria-hidden
                  className="block size-6 rounded-full bg-primary ring-1 ring-border"
                />
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow
          label={t("settings.appearance.density.label")}
          hint={t("settings.appearance.density.hint")}
        >
          <ToggleGroup
            variant="outline"
            aria-label={t("settings.appearance.density.label")}
            value={[density]}
            onValueChange={(groupValue) => {
              const next = groupValue[0] as DensityPreset | undefined
              if (!next) return
              changeDensity(next)
            }}
          >
            {DENSITY_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset.id} value={preset.id}>
                {t(`settings.appearance.density.${preset.id}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingRow>
        <SettingRow
          controlId="appearance-font-scale"
          label={t("settings.appearance.fontScale.label")}
          hint={t("settings.appearance.fontScale.hint")}
        >
          <Select
            value={String(fontScale)}
            items={Object.fromEntries(
              FONT_SCALES.map((scale) => [String(scale.value), scale.label])
            )}
            onValueChange={(value) => {
              changeFontScale(Number(value))
            }}
          >
            <SelectTrigger id="appearance-font-scale" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SCALES.map((scale) => (
                <SelectItem key={scale.value} value={String(scale.value)}>
                  {scale.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          controlId="appearance-contact-avatars"
          label={t("settings.appearance.avatars.label")}
          hint={t("settings.appearance.avatars.hint")}
        >
          <Switch
            id="appearance-contact-avatars"
            checked={gravatarEnabled}
            onCheckedChange={(checked) => changeGravatarAvatars(checked)}
          />
        </SettingRow>
        <SettingRow
          controlId="appearance-profile-markers"
          label={t("settings.appearance.profileMarkers.label")}
          hint={t("settings.appearance.profileMarkers.hint")}
        >
          <Switch
            id="appearance-profile-markers"
            checked={profileColorMarkers}
            onCheckedChange={(checked) => changeProfileColorMarkers(checked)}
          />
        </SettingRow>
      </div>
    </section>
  )
}
