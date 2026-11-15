import { useEffect, useState } from "react"
import { SparklesIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { isAiConfigured, isSurfaceEnabled } from "@/services/ai/settings"
import { translateQuestion } from "@/services/ai/ask-inbox"
import { getExecutor } from "@/services/db/executor"
import { useUiStore } from "@/stores/ui-store"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * "Ask My Inbox" entry point (task 4.7, design D3): a ghost button beside
 * the search field (mounted by search-field.tsx, the same pattern as the
 * save-search/create-filter buttons) opening a compact dialog. The user
 * types a natural-language question; `translateQuestion` turns it into an
 * operator query which is shown EDITABLE (spec "Ask My Inbox": "showing
 * the interpreted query so the user can correct it") — Search runs the
 * corrected query through the exact seam a typed search-field submit uses
 * (`setView({ kind: "search", query })` in ui-store, so results render in
 * the standard search view); "Ask again" returns to the question for a
 * fresh translation. A clarification loops in place: the model's question
 * is shown above the still-mounted input for refining. Provider errors
 * render inline with a retry affordance (spec "AI caching and failure
 * handling", "Provider outage").
 *
 * Gating (spec "No provider configured" / "Disable a single surface"):
 * the button renders only when a provider is configured AND the askInbox
 * surface toggle is on — a best-effort async load that fails toward
 * hidden (outside Tauri / before the DB is up, the entry point stays
 * invisible rather than erroring).
 */

/** The dialog state after (and between) translations. Errors are a UI
 * phase of their own — distinct from the service's clarification result,
 * which is a legitimate model answer. */
type AskPhase =
  | { phase: "idle" }
  | { phase: "query"; draft: string }
  | { phase: "clarify"; question: string }
  | { phase: "error"; message: string }

/** Whether the entry point may appear: configured AND surface enabled.
 * Best-effort — any error (no DB, non-Tauri test env) reads as hidden. */
function useAskInboxAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const executor = getExecutor()
        const ok =
          (await isAiConfigured(executor)) &&
          (await isSurfaceEnabled(executor, "askInbox"))
        if (!cancelled) setAvailable(ok)
      } catch {
        // Fail toward hidden — the affordance must not break the search row.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return available
}

/**
 * The gated entry point: null while AI is unconfigured or the surface is
 * disabled; otherwise the button plus the dialog it opens (unmounted
 * while closed, so each open starts a fresh conversation state — the
 * save-search-button pattern).
 */
export function AskInboxButton() {
  const { t } = useTranslation()
  const available = useAskInboxAvailable()
  const [open, setOpen] = useState(false)
  if (!available) return null
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("search.askInbox.title")}
        title={t("search.askInbox.title")}
        data-testid="ask-inbox-button"
        onClick={() => setOpen(true)}
      >
        <SparklesIcon />
      </Button>
      {open && <AskInboxDialog onOpenChange={setOpen} />}
    </>
  )
}

/**
 * The dialog body. The question input drives the loop and stays mounted
 * through every phase (so a clarification can be refined in place); the
 * last translation outcome decides what renders above it.
 */
function AskInboxDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState("")
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<AskPhase>({ phase: "idle" })

  async function ask(): Promise<void> {
    const trimmed = question.trim()
    if (trimmed === "" || busy) return
    setBusy(true)
    setPhase({ phase: "idle" })
    try {
      const result = await translateQuestion(trimmed)
      setPhase(
        result.kind === "query"
          ? { phase: "query", draft: result.query }
          : { phase: "clarify", question: result.question }
      )
    } catch (error) {
      // AiProviderError / AiUnavailableError (and anything unexpected):
      // inline in the dialog with a retry affordance, never a toast
      // elsewhere — the spec's "reported inline on the surface that
      // invoked them".
      setPhase({
        phase: "error",
        message:
          error instanceof Error
            ? error.message
            : t("search.askInbox.providerUnreachable"),
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Run the (possibly corrected) interpreted query: the exact seam the
   * search field's submit uses — ui-store records the prior view, the
   * thread list switches to the search scope, and the field mirrors the
   * query from the store. A blank query is a no-op, matching the field.
   */
  function runSearch(draft: string): void {
    const query = draft.trim()
    if (!query) return
    useUiStore.getState().setView({ kind: "search", query })
    onOpenChange(false)
  }

  const queryActive = phase.phase === "query"

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="ask-inbox-dialog">
        <DialogHeader>
          <DialogTitle>{t("search.askInbox.title")}</DialogTitle>
          <DialogDescription>
            {t("search.askInbox.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void ask()
          }}
        >
          {phase.phase === "error" && (
            <div
              role="alert"
              data-testid="ask-inbox-error"
              className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive"
            >
              <span>{phase.message}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="self-start"
                disabled={busy}
                onClick={() => void ask()}
              >
                {t("search.askInbox.retry")}
              </Button>
            </div>
          )}
          {phase.phase === "clarify" && (
            <p
              role="status"
              data-testid="ask-inbox-clarification"
              className="rounded-lg border bg-muted/40 p-2.5 text-sm text-muted-foreground"
            >
              {phase.question}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ask-inbox-question">
              {phase.phase === "clarify"
                ? t("search.askInbox.refineQuestion")
                : t("search.askInbox.yourQuestion")}
            </Label>
            <Textarea
              id="ask-inbox-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t("search.askInbox.questionPlaceholder")}
              rows={2}
              autoFocus
              disabled={busy}
            />
          </div>
          {queryActive && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ask-inbox-query">
                {t("search.askInbox.interpretedQuery")}
              </Label>
              <Input
                id="ask-inbox-query"
                value={phase.draft}
                onChange={(event) =>
                  setPhase({ phase: "query", draft: event.target.value })
                }
                placeholder="from:maria has:attachment after:2026-09-14"
                autoComplete="off"
                data-testid="ask-inbox-query-input"
              />
              <p className="text-xs text-muted-foreground">
                {t("search.askInbox.editHint")}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  data-testid="ask-inbox-search"
                  onClick={() => runSearch(phase.draft)}
                >
                  {t("search.askInbox.search")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPhase({ phase: "idle" })}
                >
                  {t("search.askInbox.askAgain")}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("search.askInbox.cancel")}
            </Button>
            <Button type="submit" disabled={busy || question.trim() === ""}>
              {busy ? t("search.askInbox.asking") : t("search.askInbox.ask")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
