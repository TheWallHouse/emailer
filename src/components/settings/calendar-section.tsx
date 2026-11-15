import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  connectCaldavSource,
  discoverCaldavCalendars,
  testCaldavConnection,
} from "@/services/calendar/caldav"
import type { CaldavDiscoveredCalendar } from "@/services/calendar/caldav"
import {
  MicrosoftCalendarConnectCancelledError,
  connectMicrosoftCalendar,
} from "@/services/calendar/connect-microsoft"
import {
  listCalendarSources,
  removeCalendarSource,
} from "@/services/calendar/sources"
import type { CalendarSource } from "@/services/calendar/sources"
import { getExecutor } from "@/services/db/executor"
import { useAccountStore } from "@/stores/account-store"

/**
 * Settings "Calendar" section (task 5.2, spec "Calendar account
 * providers"; Outlook sources added by parity-round-2 task 3.6): the
 * source-management surface. Lists the connected calendar sources (each
 * removable independently — removal cascades its cached events and never
 * touches mail), hosts the CalDAV connect form: server URL + username +
 * app password, a connection test that reports success or a SPECIFIC
 * failure, discovery with per-calendar show/hide checkboxes, and connect
 * (which seals the credentials into the source's config envelope — the
 * plaintext never persists), and the Outlook connect block. The Outlook
 * block is offered ONLY while a Microsoft 365 account is connected (spec:
 * no Microsoft account → Graph is not offered as a source type) and its
 * consent round is a SECOND Entra sign-in dedicated to the calendar scope
 * (refresh tokens bind to their scope set — the help text says so).
 */

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string }

type DiscoverState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; calendars: CaldavDiscoveredCalendar[] }
  | { status: "error"; message: string }

const PROVIDER_LABEL: Record<CalendarSource["provider"], string> = {
  google: "Google",
  caldav: "CalDAV",
  microsoft: "Outlook",
}

type MicrosoftConnectState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "error"; message: string }

export function CalendarSection() {
  const { t } = useTranslation()
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [listError, setListError] = useState<string | null>(null)

  // Outlook connect state. The Graph source type is offered only when a
  // Microsoft account exists (spec scenario "No Microsoft account").
  const accounts = useAccountStore((state) => state.accounts)
  const microsoftAccounts = accounts.filter(
    (account) => account.type === "microsoft"
  )
  const [microsoftAccountId, setMicrosoftAccountId] = useState<string | null>(
    null
  )
  const [microsoftConnect, setMicrosoftConnect] =
    useState<MicrosoftConnectState>({ status: "idle" })
  const selectedMicrosoftAccountId = microsoftAccounts.some(
    (account) => account.id === microsoftAccountId
  )
    ? microsoftAccountId
    : (microsoftAccounts[0]?.id ?? null)

  // CalDAV connect form state.
  const [serverUrl, setServerUrl] = useState("")
  const [username, setUsername] = useState("")
  const [appPassword, setAppPassword] = useState("")
  const [testState, setTestState] = useState<TestState>({ status: "idle" })
  const [discoverState, setDiscoverState] = useState<DiscoverState>({
    status: "idle",
  })
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  // Set once the user edits anything: the async initial load must never
  // clobber in-progress form state (reading-section pattern).
  const touchedRef = useRef(false)

  async function refreshSources() {
    try {
      setSources(await listCalendarSources(getExecutor()))
      setListError(null)
    } catch {
      setListError(t("settingsMail.calendar.loadFailed"))
    }
  }

  useEffect(() => {
    // Initial load (the auto-archive-section pattern: every setState
    // happens inside promise callbacks, never synchronously in the
    // effect body — getExecutor() may throw before boot, so it is
    // deferred into the chain too).
    void Promise.resolve()
      .then(() => listCalendarSources(getExecutor()))
      .then((rows) => {
        setSources(rows)
        setListError(null)
      })
      .catch(() => {
        setListError(t("settingsMail.calendar.loadFailed"))
      })
  }, [t])

  function formCredentials() {
    return {
      serverUrl: serverUrl.trim(),
      username: username.trim(),
      appPassword,
    }
  }

  function formComplete(): boolean {
    const {
      serverUrl: url,
      username: user,
      appPassword: pass,
    } = formCredentials()
    return url !== "" && user !== "" && pass !== ""
  }

  async function handleTestConnection() {
    setTestState({ status: "testing" })
    try {
      await testCaldavConnection(formCredentials())
      setTestState({
        status: "ok",
        message: t("settingsMail.calendar.testSucceeded"),
      })
    } catch (error) {
      setTestState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : t("settingsMail.calendar.testFailed"),
      })
    }
  }

  async function handleDiscover() {
    setDiscoverState({ status: "loading" })
    try {
      const calendars = await discoverCaldavCalendars(formCredentials())
      setDiscoverState({ status: "ready", calendars })
      const allSelected: Record<string, boolean> = {}
      for (const calendar of calendars) allSelected[calendar.href] = true
      setSelected(allSelected)
    } catch (error) {
      setDiscoverState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : t("settingsMail.calendar.discoveryFailed"),
      })
    }
  }

  async function handleConnect() {
    if (discoverState.status !== "ready") return
    const calendars = discoverState.calendars.filter(
      (calendar) => selected[calendar.href]
    )
    if (calendars.length === 0) {
      setConnectError(t("settingsMail.calendar.selectOne"))
      return
    }
    setConnecting(true)
    try {
      await connectCaldavSource(getExecutor(), {
        ...formCredentials(),
        calendars,
      })
      // Connected: reset the form and show the new source.
      touchedRef.current = false
      setServerUrl("")
      setUsername("")
      setAppPassword("")
      setTestState({ status: "idle" })
      setDiscoverState({ status: "idle" })
      setSelected({})
      setConnectError(null)
      await refreshSources()
    } catch (error) {
      setConnectError(
        error instanceof Error
          ? error.message
          : t("settingsMail.calendar.connectFailed")
      )
    } finally {
      setConnecting(false)
    }
  }

  async function handleConnectMicrosoft() {
    if (!selectedMicrosoftAccountId) return
    setMicrosoftConnect({ status: "connecting" })
    try {
      // One fresh calendar-scope consent round through the Entra loopback
      // driver (see connect-microsoft.ts for the scope-set rationale);
      // the flow's own help text is rendered under the block's heading.
      await connectMicrosoftCalendar({
        accountId: selectedMicrosoftAccountId,
      })
      setMicrosoftConnect({ status: "idle" })
      await refreshSources()
    } catch (error) {
      // A cancelled consent is a quiet no-op (the add-account dialogs'
      // convention); every other failure shows its typed message.
      if (error instanceof MicrosoftCalendarConnectCancelledError) {
        setMicrosoftConnect({ status: "idle" })
        return
      }
      setMicrosoftConnect({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : t("settingsMail.calendar.connectFailed"),
      })
    }
  }

  async function handleRemove(source: CalendarSource) {
    try {
      // Removes the source AND its cached events; the mail account is
      // never touched (spec "Remove a calendar source").
      await removeCalendarSource(getExecutor(), source.id)
      await refreshSources()
    } catch {
      setListError(
        t("settingsMail.calendar.removeFailed", { name: source.name })
      )
    }
  }

  function calendarCount(source: CalendarSource): string {
    const count = Object.keys(source.syncState).length
    if (count === 0) return t("settingsMail.calendar.notSynced")
    return t("settingsMail.calendar.calendarCount", { count })
  }

  return (
    <section
      aria-label={t("settingsMail.calendar.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settingsMail.calendar.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.calendar.subtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {listError !== null && (
          <p role="alert" className="text-sm text-destructive">
            {listError}
          </p>
        )}
        {sources.length === 0 && listError === null && (
          <p className="text-sm text-muted-foreground">
            {t("settingsMail.calendar.empty")}
          </p>
        )}
        {sources.map((source) => (
          <div
            key={source.id}
            className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
          >
            <div className="grid gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {source.name}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {PROVIDER_LABEL[source.provider]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {calendarCount(source)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("settingsMail.calendar.removeAria", {
                name: source.name,
              })}
              onClick={() => {
                void handleRemove(source)
              }}
            >
              {t("settingsMail.calendar.remove")}
            </Button>
          </div>
        ))}
      </div>

      {/* Graph is offered ONLY while a Microsoft account is connected
          (spec "No Microsoft account" — existing sources are unaffected). */}
      {microsoftAccounts.length > 0 && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <div className="grid gap-0.5">
            <h3 className="text-sm font-semibold text-foreground">
              {t("settingsMail.calendar.outlookTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("settingsMail.calendar.outlookHelp")}
            </p>
          </div>
          {microsoftAccounts.length > 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor="microsoft-calendar-account">
                {t("settingsMail.calendar.account")}
              </Label>
              <Select
                value={selectedMicrosoftAccountId ?? undefined}
                onValueChange={setMicrosoftAccountId}
              >
                <SelectTrigger id="microsoft-calendar-account">
                  <SelectValue
                    placeholder={t("settingsMail.calendar.chooseAccount")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {microsoftAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Button
              size="sm"
              disabled={
                !selectedMicrosoftAccountId ||
                microsoftConnect.status === "connecting"
              }
              onClick={() => {
                void handleConnectMicrosoft()
              }}
            >
              {microsoftConnect.status === "connecting"
                ? t("settingsMail.calendar.connecting")
                : t("settingsMail.calendar.addOutlook")}
            </Button>
          </div>
          {microsoftConnect.status === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {microsoftConnect.message}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold text-foreground">
            {t("settingsMail.calendar.caldavTitle")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settingsMail.calendar.caldavHelp")}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="caldav-server-url">
            {t("settingsMail.calendar.serverUrl")}
          </Label>
          <Input
            id="caldav-server-url"
            placeholder="https://dav.example.com/"
            value={serverUrl}
            onChange={(event) => {
              touchedRef.current = true
              setServerUrl(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="caldav-username">
            {t("settingsMail.calendar.username")}
          </Label>
          <Input
            id="caldav-username"
            autoComplete="off"
            value={username}
            onChange={(event) => {
              touchedRef.current = true
              setUsername(event.target.value)
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="caldav-app-password">
            {t("settingsMail.calendar.appPassword")}
          </Label>
          <Input
            id="caldav-app-password"
            type="password"
            autoComplete="new-password"
            value={appPassword}
            onChange={(event) => {
              touchedRef.current = true
              setAppPassword(event.target.value)
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!formComplete() || testState.status === "testing"}
            onClick={() => {
              void handleTestConnection()
            }}
          >
            {t("settingsMail.calendar.testConnection")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!formComplete() || discoverState.status === "loading"}
            onClick={() => {
              void handleDiscover()
            }}
          >
            {t("settingsMail.calendar.discover")}
          </Button>
        </div>
        {testState.status === "ok" && (
          <p role="status" className="text-sm text-muted-foreground">
            {testState.message}
          </p>
        )}
        {testState.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {testState.message}
          </p>
        )}
        {discoverState.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {discoverState.message}
          </p>
        )}
        {discoverState.status === "ready" &&
          (discoverState.calendars.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settingsMail.calendar.noneFound")}
            </p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">
                {t("settingsMail.calendar.toShow")}
              </legend>
              {discoverState.calendars.map((calendar) => (
                <label
                  key={calendar.href}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  {/* The wrapping label's text is the checkbox's
                      accessible name (the calendar name) — no aria-label,
                      so screen readers read exactly what is shown. */}
                  <Checkbox
                    checked={selected[calendar.href] === true}
                    onCheckedChange={(checked) => {
                      setSelected((previous) => ({
                        ...previous,
                        [calendar.href]: checked === true,
                      }))
                    }}
                  />
                  {calendar.displayName ?? calendar.href}
                </label>
              ))}
            </fieldset>
          ))}
        {connectError !== null && (
          <p role="alert" className="text-sm text-destructive">
            {connectError}
          </p>
        )}
        <div>
          <Button
            size="sm"
            disabled={discoverState.status !== "ready" || connecting}
            onClick={() => {
              void handleConnect()
            }}
          >
            {t("settingsMail.calendar.connect")}
          </Button>
        </div>
      </div>
    </section>
  )
}
