import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { getExecutor } from "@/services/db/executor"
import {
  DEFAULT_AUTO_ARCHIVE_DAYS,
  getAutoArchiveSetting,
  setAutoArchiveSetting,
} from "@/services/email-actions/auto-archive"

/**
 * Settings "Auto-archive" section (task 12.3): the global on/off toggle
 * plus the staleness threshold (days) for the background batch that
 * archives read, untouched inbox threads. Reads and writes the single
 * `mail.autoArchive` settings row through the service accessors (the same
 * row the due-job reads every tick, so a flip takes effect on the next
 * pass without restarting). The threshold is a closed set of day choices
 * — the service clamps 1–365, so every option here is storable as-is.
 */

const DAY_OPTIONS = [7, 14, 30, 60, 90, 180, 365]

export function AutoArchiveSection() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [days, setDays] = useState(DEFAULT_AUTO_ARCHIVE_DAYS)
  // Set as soon as the user changes anything: the async initial load must
  // never clobber a change with a stale DB read (reading-section pattern).
  const dirtyRef = useRef(false)

  useEffect(() => {
    try {
      void getAutoArchiveSetting(getExecutor())
        .then((setting) => {
          if (!dirtyRef.current) {
            setEnabled(setting.enabled)
            setDays(setting.days)
          }
        })
        .catch(() => {})
    } catch (error) {
      console.warn("[auto-archive] setting load failed", error)
    }
  }, [])

  async function persist(next: { enabled?: boolean; days?: number }) {
    const previous = { enabled, days }
    dirtyRef.current = true
    const merged = {
      enabled: next.enabled ?? enabled,
      days: next.days ?? days,
    }
    setEnabled(merged.enabled)
    setDays(merged.days)
    try {
      await setAutoArchiveSetting(getExecutor(), merged)
    } catch (error) {
      setEnabled(previous.enabled)
      setDays(previous.days)
      console.warn("[auto-archive] failed to persist setting", error)
    }
  }

  return (
    <section
      aria-label={t("settingsMail.autoArchive.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settingsMail.autoArchive.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.autoArchive.subtitle")}
        </p>
      </div>
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="auto-archive-enabled">
              {t("settingsMail.autoArchive.enable")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settingsMail.autoArchive.enableHelp")}
            </p>
          </div>
          <Switch
            id="auto-archive-enabled"
            checked={enabled}
            onCheckedChange={(checked) => {
              void persist({ enabled: checked })
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="auto-archive-days">
              {t("settingsMail.autoArchive.after")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settingsMail.autoArchive.afterHelp")}
            </p>
          </div>
          <Select
            value={String(days)}
            onValueChange={(value) => {
              void persist({ days: Number(value) })
            }}
          >
            <SelectTrigger id="auto-archive-days" className="w-32">
              <SelectValue>
                {(value: string) =>
                  t("settingsMail.autoArchive.days", { count: Number(value) })
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {t("settingsMail.autoArchive.days", { count: option })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  )
}
