import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { CalendarPlus } from "lucide-react"
import { toast } from "sonner"

import { i18next } from "@/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getExecutor } from "@/services/db/executor"
import {
  describeIcsEventTime,
  describeIcsPerson,
  isInvitationRequest,
  parseIcsCalendar,
  resolveIcsEventEnd,
  type IcsCalendar,
  type IcsEvent,
} from "@/services/calendar/ics"
import {
  addIcsEventToCalendar,
  listIcsCalendarSources,
  respondToInvitation,
  type CalendarSourceChoice,
  type InvitationResponse,
} from "@/services/calendar/ics-seam"

/**
 * The "Add to calendar" preview dialog (task 5.5 + 5.4, design D5;
 * calendar spec "iCalendar attachments"). Opened from an .ics /
 * text/calendar attachment row in the reading pane's attachment list, it
 * parses the attachment text with the pure parser (services/calendar/
 * ics.ts) and ALWAYS shows the parsed event details — summary, when,
 * where, description, organizer (the spec scenario's first half).
 *
 * METHOD:REQUEST invitations additionally show the Yes/No/Maybe row; a
 * response goes through the respondToInvitation seam.
 *
 * The WRITE half is real since task 5.4 (see services/calendar/
 * ics-seam.ts): confirming Add maps the parsed details onto the event
 * write service and adds it to the chosen source's default calendar —
 * respecting the online-write contract ("offline" means nothing was
 * written, surfaced below); RSVP answers are sent where the source
 * supports them (Google) and refused with the CalDAV limitation copy
 * otherwise. "no-source" keeps/raises the "Connect a calendar" note;
 * "unavailable" (degraded write layer) toasts the informational v1
 * message; provider failures surface their message inline. Parsing
 * failures (the parser never throws) render inline with a Retry
 * affordance; content-fetch failures render the same way.
 */

/** Informational v1 copy (frozen contract — see the seam module docs).
 * Getters, so the line follows the interface language. */
const addUnavailableToast = () => i18next.t("calendar.ics.addUnavailable")
const rsvpUnavailableToast = () => i18next.t("calendar.ics.rsvpUnavailable")
const noSourcesNote = () => i18next.t("calendar.ics.noSources")
const addOfflineNote = () => i18next.t("calendar.ics.addOffline")
const rsvpOfflineNote = () => i18next.t("calendar.ics.rsvpOffline")

/** Map a seam failure to its inline status line (task 5.4 reasons). */
function failureStatus(message: string | undefined, fallback: string): string {
  if (message) return message
  return fallback
}

interface ParsedIcs {
  ics: string
  calendar: IcsCalendar
  warnings: string[]
}

export interface IcsPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Loads the raw .ics text (usually readIcsAttachmentText over the
   * exact attachment row; message-level flows can use
   * readFirstCalendarIcs). Called on every open and on Retry.
   */
  loadIcs: () => Promise<string>
}

type Phase = "loading" | "ready" | "error"

export function IcsPreviewDialog({
  open,
  onOpenChange,
  loadIcs,
}: IcsPreviewDialogProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedIcs | null>(null)
  /** null = the source list is still loading; [] = none connected. */
  const [sources, setSources] = useState<CalendarSourceChoice[] | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [eventIndex, setEventIndex] = useState(0)
  const [busy, setBusy] = useState<null | "add" | "rsvp">(null)
  const [status, setStatus] = useState<string | null>(null)
  const [rsvpSent, setRsvpSent] = useState<InvitationResponse | null>(null)
  const [added, setAdded] = useState(false)

  const run = useCallback(() => {
    setPhase("loading")
    setErrorMessage(null)
    setParsed(null)
    setSources(null)
    setSourceId(null)
    setEventIndex(0)
    setStatus(null)
    setRsvpSent(null)
    setAdded(false)
    setBusy(null)
    void (async () => {
      let text: string
      try {
        text = await loadIcs()
      } catch (error) {
        console.warn("[ics-preview] attachment content failed", error)
        setErrorMessage(i18next.t("calendar.ics.loadFailed"))
        setPhase("error")
        return
      }
      const result = parseIcsCalendar(text)
      if (!result.ok) {
        setErrorMessage(result.message)
        setPhase("error")
        return
      }
      setParsed({
        ics: text,
        calendar: result.calendar,
        warnings: result.warnings,
      })
      setPhase("ready")
      try {
        const executor = getExecutor()
        const choices = await listIcsCalendarSources(executor)
        setSources(choices)
        setSourceId(choices[0]?.id ?? null)
      } catch (error) {
        // No db / outside Tauri — degrade to "no calendar connected".
        console.warn("[ics-preview] calendar source lookup failed", error)
        setSources([])
      }
    })()
  }, [loadIcs])

  useEffect(() => {
    if (open) {
      // Sanctioned set-state-in-effect escape (task-extraction-dialog
      // precedent): fresh load on every open, no stale-review flash.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      run()
    }
  }, [open, run])

  const event =
    parsed?.calendar.events[eventIndex] ?? parsed?.calendar.events[0] ?? null
  const invitation = parsed !== null && isInvitationRequest(parsed.calendar)

  async function handleAdd(): Promise<void> {
    if (!parsed || !sourceId || busy) return
    setBusy("add")
    setStatus(null)
    try {
      const result = await addIcsEventToCalendar(getExecutor(), {
        ics: parsed.ics,
        preferredSourceId: sourceId,
      })
      if (result.ok) {
        setAdded(true)
        setStatus(t("calendar.ics.added"))
        toast.success(t("calendar.ics.addedToast"))
      } else if (result.reason === "no-source") {
        setStatus(noSourcesNote())
        toast.info(noSourcesNote())
      } else if (result.reason === "offline") {
        setStatus(addOfflineNote())
        toast.info(addOfflineNote())
      } else if (result.reason === "unavailable") {
        setStatus(addUnavailableToast())
        toast.info(addUnavailableToast())
      } else {
        // invalid / no-event / config / unsupported / failed: the seam's
        // message is the honest line (CalDAV RSVP-style limitations,
        // provider rejections); a generic fallback keeps it readable.
        const note = failureStatus(result.message, t("calendar.ics.addFailed"))
        setStatus(note)
        toast.info(note)
      }
    } catch (error) {
      console.warn("[ics-preview] add-to-calendar failed", error)
      setStatus(t("calendar.ics.addFailed"))
    } finally {
      setBusy(null)
    }
  }

  async function handleRespond(response: InvitationResponse): Promise<void> {
    if (!parsed || busy || rsvpSent) return
    setBusy("rsvp")
    setStatus(null)
    try {
      const result = await respondToInvitation(getExecutor(), {
        ics: parsed.ics,
        response,
      })
      if (result.ok) {
        setRsvpSent(response)
        setStatus(t("calendar.ics.responseSent"))
        toast.success(t("calendar.ics.responseSentToast"))
      } else if (result.reason === "no-source") {
        setStatus(noSourcesNote())
        toast.info(noSourcesNote())
      } else if (result.reason === "offline") {
        setStatus(rsvpOfflineNote())
        toast.info(rsvpOfflineNote())
      } else if (result.reason === "unavailable") {
        setStatus(rsvpUnavailableToast())
        toast.info(rsvpUnavailableToast())
      } else {
        const note = failureStatus(result.message, t("calendar.ics.sendFailed"))
        setStatus(note)
        toast.info(note)
      }
    } catch (error) {
      console.warn("[ics-preview] invitation response failed", error)
      setStatus(t("calendar.ics.sendFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="ics-preview-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {event?.summary ?? t("calendar.ics.fallbackTitle")}
          </DialogTitle>
          <DialogDescription>
            {invitation
              ? t("calendar.ics.invitationDescription")
              : t("calendar.ics.attachmentDescription")}
          </DialogDescription>
        </DialogHeader>
        {phase === "loading" && (
          <div
            data-testid="ics-preview-loading"
            className="py-6 text-center text-sm text-muted-foreground"
          >
            {t("calendar.ics.reading")}
          </div>
        )}
        {phase === "error" && (
          <div
            data-testid="ics-preview-error"
            className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <span className="text-destructive">
              {errorMessage ?? t("calendar.ics.unreadable")}
            </span>
            <Button
              variant="outline"
              size="sm"
              data-testid="ics-preview-retry"
              onClick={run}
            >
              {t("calendar.ics.retry")}
            </Button>
          </div>
        )}
        {phase === "ready" && parsed !== null && (
          <>
            {parsed.calendar.events.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {t("calendar.ics.event")}
                <select
                  data-testid="ics-event-picker"
                  className="h-8 w-full flex-1 rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={eventIndex}
                  onChange={(change) =>
                    setEventIndex(Number(change.target.value))
                  }
                >
                  {parsed.calendar.events.map((item, index) => (
                    <option key={index} value={index}>
                      {item.summary ??
                        t("calendar.ics.eventNumber", { number: index + 1 })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <EventDetails event={event} />
            {parsed.warnings.length > 0 && (
              <div
                data-testid="ics-preview-warnings"
                className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground"
              >
                {parsed.warnings[0]}
              </div>
            )}
            {invitation && (
              <InvitationRow
                busy={busy === "rsvp"}
                sent={rsvpSent}
                onRespond={(response) => void handleRespond(response)}
              />
            )}
            <SourcePicker
              sources={sources}
              sourceId={sourceId}
              onSelect={setSourceId}
            />
            {status !== null && (
              <p
                data-testid="ics-add-status"
                role="status"
                className="text-xs text-muted-foreground"
              >
                {status}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("calendar.ics.close")}
              </Button>
              <Button
                data-testid="ics-add"
                className="gap-1"
                disabled={busy !== null || added || !sourceId || event === null}
                onClick={() => void handleAdd()}
              >
                <CalendarPlus className="size-3.5" />
                {added
                  ? t("calendar.ics.addedButton")
                  : busy === "add"
                    ? t("calendar.ics.adding")
                    : t("calendar.ics.addToCalendar")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The parsed details grid (the spec scenario's first half). */
function EventDetails({ event }: { event: IcsEvent | null }) {
  const { t } = useTranslation()
  if (!event) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("calendar.ics.noEvent")}
      </p>
    )
  }
  const when = describeIcsEventTime(event.start, resolveIcsEventEnd(event))
  const organizer = describeIcsPerson(event.organizer)
  return (
    <dl className="grid gap-1.5 text-sm">
      {when !== null && (
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-xs text-muted-foreground">
            {t("calendar.ics.when")}
          </dt>
          <dd data-testid="ics-preview-when" className="min-w-0 flex-1">
            {when}
          </dd>
        </div>
      )}
      {event.location !== null && (
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-xs text-muted-foreground">
            {t("calendar.ics.where")}
          </dt>
          <dd data-testid="ics-preview-where" className="min-w-0 flex-1">
            {event.location}
          </dd>
        </div>
      )}
      {organizer !== null && (
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-xs text-muted-foreground">
            {t("calendar.ics.organizer")}
          </dt>
          <dd data-testid="ics-preview-organizer" className="min-w-0 flex-1">
            {organizer}
          </dd>
        </div>
      )}
      {event.description !== null && (
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-xs text-muted-foreground">
            {t("calendar.ics.notes")}
          </dt>
          <dd
            data-testid="ics-preview-description"
            className="min-w-0 flex-1 break-words whitespace-pre-wrap"
          >
            {event.description}
          </dd>
        </div>
      )}
    </dl>
  )
}

/** The Yes/No/Maybe row for METHOD:REQUEST invitations. */
function InvitationRow({
  busy,
  sent,
  onRespond,
}: {
  busy: boolean
  sent: InvitationResponse | null
  onRespond: (response: InvitationResponse) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="ics-rsvp-row"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5"
    >
      <span className="text-xs font-medium text-muted-foreground">
        {t("calendar.ics.going")}
      </span>
      <div className="ml-auto flex gap-1.5">
        {(
          [
            ["yes", t("calendar.ics.yes")],
            ["maybe", t("calendar.ics.maybe")],
            ["no", t("calendar.ics.no")],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={sent === value ? "default" : "outline"}
            size="sm"
            className="h-7"
            data-testid={`ics-rsvp-${value}`}
            disabled={busy || sent !== null}
            onClick={() => onRespond(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * The destination picker over the lazy calendar-sources read. Empty (or
 * still unloaded) shows the connect-a-calendar note — the parsed details
 * above remain visible regardless (v1 contract: details first, write
 * path lands with task 5.4). A native select keeps the picker robust in
 * tests; it upgrades to the settings Select when the calendar settings
 * UI lands.
 */
function SourcePicker({
  sources,
  sourceId,
  onSelect,
}: {
  sources: CalendarSourceChoice[] | null
  sourceId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  if (sources === null) {
    return (
      <p
        data-testid="ics-sources-loading"
        className="text-xs text-muted-foreground"
      >
        {t("calendar.ics.lookingForCalendars")}
      </p>
    )
  }
  if (sources.length === 0) {
    return (
      <p
        data-testid="ics-no-sources"
        className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground"
      >
        {noSourcesNote()}
      </p>
    )
  }
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {t("calendar.ics.addTo")}
      <select
        data-testid="ics-source-picker"
        className="h-8 w-full flex-1 rounded-lg border border-input bg-transparent px-2 text-sm"
        value={sourceId ?? ""}
        onChange={(change) => onSelect(change.target.value)}
      >
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
    </label>
  )
}
