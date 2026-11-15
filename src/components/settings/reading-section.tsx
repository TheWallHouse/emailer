import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { i18next } from "@/i18n"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { getNotificationsEnabled } from "@/services/db/settings"
import { getExecutor } from "@/services/db/executor"
import { setNotificationsEnabled } from "@/services/notifications/new-mail-notifier"
import {
  getMarkReadOnOpen,
  setMarkReadOnOpenPreference,
  setReadingPanePreference,
} from "@/services/settings/preferences"
import type { ReadingPanePosition } from "@/stores/ui-store"
import { useUiStore } from "@/stores/ui-store"

/**
 * Settings "Reading" section (tasks 11.2/11.3): the default reading-pane
 * position (persisted through the settings table and applied to the
 * ui-store live — the same API the shell's pane switcher uses), the
 * new-mail notification toggle (persisted via the notifier's
 * setNotificationsEnabled, which also invalidates its settings cache) and
 * the mark-as-read-on-open toggle (task 1.4, settings spec: persisted
 * through the preferences service; only gates the reading pane's open
 * seam — manual mark controls and rules keep marking read).
 * Unread counts are unaffected by the notification toggle — it only gates
 * the OS notification, not the badge computations.
 */

const PANE_OPTIONS: { value: ReadingPanePosition; label: string }[] = [
  {
    value: "right",
    get label() {
      return i18next.t("settings.reading.pane.right")
    },
  },
  {
    value: "bottom",
    get label() {
      return i18next.t("settings.reading.pane.bottom")
    },
  },
  {
    value: "hidden",
    get label() {
      return i18next.t("settings.reading.pane.hidden")
    },
  },
]

const PANE_HINTS: Record<ReadingPanePosition, string> = {
  get right() {
    return i18next.t("settings.reading.pane.hints.right")
  },
  get bottom() {
    return i18next.t("settings.reading.pane.hints.bottom")
  },
  get hidden() {
    return i18next.t("settings.reading.pane.hints.hidden")
  },
}

export function ReadingSection() {
  const { t } = useTranslation()
  const readingPane = useUiStore((state) => state.readingPane)
  const [notifications, setNotifications] = useState(true)
  const [markReadOnOpen, setMarkReadOnOpen] = useState(true)
  // Set as soon as the user toggles: the async initial load must never
  // clobber a change with a stale DB read.
  const dirtyRef = useRef(false)
  const markReadDirtyRef = useRef(false)

  // Load the persisted toggles once (the shell only mounts this page after
  // bootstrap(), so the executor is available). The pane position needs no
  // load — the ui-store is the live source, seeded at boot by
  // applyBootPreferences. Failures keep the defaults (both on).
  useEffect(() => {
    try {
      void getNotificationsEnabled(getExecutor())
        .then((enabled) => {
          if (!dirtyRef.current) setNotifications(enabled)
        })
        .catch(() => {})
      void getMarkReadOnOpen(getExecutor())
        .then((enabled) => {
          if (!markReadDirtyRef.current) setMarkReadOnOpen(enabled)
        })
        .catch(() => {})
    } catch (error) {
      console.warn("[reading] preference load failed", error)
    }
  }, [])

  function changePane(position: ReadingPanePosition): void {
    try {
      // Persists to the settings table, then updates the ui-store (live
      // re-layout; the shell's boot hook re-applies it on restart).
      void setReadingPanePreference(getExecutor(), position).catch((error) => {
        console.warn("[reading] failed to persist pane position", error)
      })
    } catch (error) {
      console.warn("[reading] failed to persist pane position", error)
    }
  }

  async function changeNotifications(enabled: boolean): Promise<void> {
    const previous = notifications
    dirtyRef.current = true
    setNotifications(enabled)
    try {
      // Persists AND refreshes the notifier's in-memory cache (30s TTL),
      // so the flip takes effect on the very next sync pass.
      await setNotificationsEnabled(enabled)
    } catch (error) {
      setNotifications(previous)
      console.warn("[reading] failed to persist notifications", error)
    }
  }

  async function changeMarkReadOnOpen(enabled: boolean): Promise<void> {
    const previous = markReadOnOpen
    markReadDirtyRef.current = true
    setMarkReadOnOpen(enabled)
    try {
      // Persists to the settings table; the open seam reads it fresh on
      // every open, so no cache invalidation is needed.
      await setMarkReadOnOpenPreference(getExecutor(), enabled)
    } catch (error) {
      setMarkReadOnOpen(previous)
      console.warn("[reading] failed to persist mark-as-read-on-open", error)
    }
  }

  return (
    <section
      aria-label={t("settings.reading.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settings.reading.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.reading.description")}
        </p>
      </div>
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="reading-pane-position">
              {t("settings.reading.pane.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {PANE_HINTS[readingPane]}.
            </p>
          </div>
          <Select
            value={readingPane}
            items={Object.fromEntries(
              PANE_OPTIONS.map((option) => [option.value, option.label])
            )}
            onValueChange={(value) =>
              changePane(String(value) as ReadingPanePosition)
            }
          >
            <SelectTrigger id="reading-pane-position" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PANE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="reading-notifications">
              {t("settings.reading.notifications.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.reading.notifications.hint")}
            </p>
          </div>
          <Switch
            id="reading-notifications"
            checked={notifications}
            onCheckedChange={(checked) => {
              void changeNotifications(checked)
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="reading-mark-read-on-open">
              {t("settings.reading.markReadOnOpen.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.reading.markReadOnOpen.hint")}
            </p>
          </div>
          <Switch
            id="reading-mark-read-on-open"
            checked={markReadOnOpen}
            onCheckedChange={(checked) => {
              void changeMarkReadOnOpen(checked)
            }}
          />
        </div>
      </div>
    </section>
  )
}
