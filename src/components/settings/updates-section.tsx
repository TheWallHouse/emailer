import { useEffect, useRef, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { relaunch } from "@tauri-apps/plugin-process"
import { CircleCheck, Download, Loader2, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"

import { i18next } from "@/i18n"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getExecutor } from "@/services/db/executor"
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  getUpdateChannel,
  setUpdateChannel,
  UPDATE_DOWNLOAD_PROGRESS_EVENT,
  type UpdateChannel,
  type UpdateMetadata,
} from "@/services/updates/updater"

/**
 * Settings "Updates" section: the release channel (stable / beta) plus a
 * manual check-for-updates button. Checks go through the Rust updater
 * commands (src/services/updates/updater.ts) so the channel's manifest
 * endpoint is picked server-side; installing hands back to the plugin and
 * relaunches.
 *
 * Only the packaged desktop app can check — in the browser (mock mode)
 * there is no Tauri IPC, and the section says so instead of offering a
 * button that can only fail.
 */

const IS_DESKTOP_APP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; update: UpdateMetadata }
  | { kind: "downloading"; received: number; total: number | null }
  | { kind: "ready" }
  | { kind: "error"; message: string }

export function UpdatesSection() {
  const { t } = useTranslation()
  const [channel, setChannel] = useState<UpdateChannel>("stable")
  const [state, setState] = useState<CheckState>({ kind: "idle" })
  // Set as soon as the user changes the channel: the async initial load
  // must never clobber a change with a stale DB read (reading-section
  // pattern).
  const dirtyRef = useRef(false)

  useEffect(() => {
    try {
      void getUpdateChannel(getExecutor())
        .then((stored) => {
          if (!dirtyRef.current) setChannel(stored)
        })
        .catch(() => {})
    } catch (error) {
      console.warn("[updates] channel load failed", error)
    }
  }, [])

  function changeChannel(next: UpdateChannel) {
    dirtyRef.current = true
    setChannel(next)
    setState({ kind: "idle" })
    try {
      void setUpdateChannel(getExecutor(), next).catch(() => {})
    } catch {
      // Unpersisted channel (browser mock): the choice still holds for
      // this session's manual check.
    }
  }

  async function runCheck() {
    setState({ kind: "checking" })
    try {
      const update = await checkForUpdate(channel)
      if (!update) {
        setState({ kind: "up-to-date" })
        return
      }
      setState({ kind: "available", update })
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : i18next.t("settings.updates.checkFailed"),
      })
    }
  }

  async function downloadAndInstall() {
    setState({ kind: "downloading", received: 0, total: null })
    const unlisten = await listen<{
      received: number
      total: number | null
    }>(UPDATE_DOWNLOAD_PROGRESS_EVENT, (event) => {
      setState({
        kind: "downloading",
        received: event.payload.received,
        total: event.payload.total,
      })
    })
    try {
      await downloadAndInstallUpdate()
      setState({ kind: "ready" })
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : i18next.t("settings.updates.downloadFailed"),
      })
    } finally {
      unlisten()
    }
  }

  return (
    <section
      aria-label={t("settings.updates.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settings.updates.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {channel === "beta"
            ? t("settings.updates.runningBeta", { version: __APP_VERSION__ })
            : t("settings.updates.running", { version: __APP_VERSION__ })}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="update-channel">
          {t("settings.updates.channel.label")}
        </Label>
        <Select
          items={{
            stable: t("settings.updates.channel.stable"),
            beta: t("settings.updates.channel.beta"),
          }}
          value={channel}
          onValueChange={(value) => {
            if (value === "stable" || value === "beta") changeChannel(value)
          }}
        >
          <SelectTrigger id="update-channel" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stable">
              {t("settings.updates.channel.stableOption")}
            </SelectItem>
            <SelectItem value="beta">
              {t("settings.updates.channel.betaOption")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("settings.updates.channel.hint")}
        </p>
      </div>

      {IS_DESKTOP_APP ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            size="sm"
            onClick={() => void runCheck()}
            disabled={state.kind === "checking" || state.kind === "downloading"}
          >
            {state.kind === "checking" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw />
            )}
            {t("settings.updates.check")}
          </Button>
          <CheckStatus
            state={state}
            channel={channel}
            onInstall={() => void downloadAndInstall()}
            onRestart={() => void relaunch()}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("settings.updates.desktopOnly")}
        </p>
      )}
    </section>
  )
}

function CheckStatus({
  state,
  channel,
  onInstall,
  onRestart,
}: {
  state: CheckState
  channel: UpdateChannel
  onInstall: () => void
  onRestart: () => void
}) {
  const { t } = useTranslation()
  const channelName = t(`settings.updates.channelName.${channel}`)
  switch (state.kind) {
    case "idle":
      return null
    case "checking":
      return (
        <p className="text-sm text-muted-foreground">
          {t("settings.updates.checking", { channel: channelName })}
        </p>
      )
    case "up-to-date":
      return (
        <p
          role="status"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <CircleCheck className="size-4" aria-hidden />
          {t("settings.updates.upToDate")}
        </p>
      )
    case "available":
      return (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-sm text-foreground">
            {t("settings.updates.available", {
              version: state.update.version,
              channel: channelName,
              current: state.update.currentVersion,
            })}
          </p>
          <Button size="sm" onClick={() => onInstall()}>
            <Download />
            {t("settings.updates.install")}
          </Button>
        </div>
      )
    case "downloading": {
      const percent =
        state.total && state.total > 0
          ? Math.min(100, Math.round((state.received / state.total) * 100))
          : null
      return (
        <p
          role="status"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {percent !== null
            ? t("settings.updates.downloadingPercent", { percent })
            : t("settings.updates.downloading")}
        </p>
      )
    }
    case "ready":
      return (
        <div className="flex flex-col items-start gap-2">
          <p role="status" className="text-sm text-foreground">
            {t("settings.updates.ready")}
          </p>
          <Button size="sm" onClick={onRestart}>
            <RefreshCw />
            {t("settings.updates.restart")}
          </Button>
        </div>
      )
    case "error":
      return (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )
  }
}
