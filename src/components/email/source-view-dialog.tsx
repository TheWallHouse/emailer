import { useCallback, useEffect, useRef, useState } from "react"
import { Copy } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { i18next } from "@/i18n"
import { renderPlainTextAsHtml } from "@/services/renderer"
import {
  getMessageSource,
  type MessageSourceDeps,
} from "@/services/email/message-source"
import type { EmailAccount } from "@/services/email/types"
import type { MessageRow } from "@/services/db/messages"
import { SafeEmailFrame } from "./safe-email-frame"

/**
 * The "View source" dialog (task 1.2, mail-reading spec "Raw message
 * source"): the message's raw RFC 822 source — transport headers plus
 * body source — fetched on demand through the provider seam
 * (services/email/message-source.ts; gmail format=raw, imap the
 * BODY.PEEK[] full-message fetch) and rendered READ-ONLY inside the
 * sandboxed frame. Inertness is structural: the source is HTML-escaped
 * before it enters the frame (renderPlainTextAsHtml — every <, &, quote
 * becomes text), so nothing in the message executes and no remote loads
 * are possible; the only network call is the source fetch itself, and
 * read state is untouched (BODY.PEEK[] / a pure REST read).
 *
 * The Copy affordance writes the EXACT fetched string to the clipboard —
 * never the escaped rendering — so copied diagnostics match the source
 * byte for byte (spec "Copy diagnostics").
 *
 * Mounted fresh per open (the block-sender dialog's pattern), so every
 * open refetches (D6: no cache) and the states always start clean. The
 * fetch seam is injectable (deps) like MailDisplay's attachment/unsubscribe
 * seams; failures render inline with the original message untouched.
 */

type SourceStage =
  | { stage: "loading" }
  | { stage: "shown"; source: string }
  | { stage: "error"; message: string }

interface SourceViewDialogProps {
  message: MessageRow
  /** Owning account (the provider identity the source is fetched from);
   * null disables the fetch and the dialog shows the error state. */
  account: EmailAccount | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Injectable source fetch (tests); production resolves the provider. */
  deps?: MessageSourceDeps
}

export function SourceViewDialog({
  message,
  account,
  open,
  onOpenChange,
  deps,
}: SourceViewDialogProps) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<SourceStage>({ stage: "loading" })
  const [copied, setCopied] = useState(false)
  // Monotonic request id: only the newest fetch may land (StrictMode's
  // double mount must not let a slow first fetch win — the ThreadSummary
  // panel's pattern).
  const requestRef = useRef(0)
  // The injectable seam lives in a ref: the dialog remounts per open, but
  // an inline deps object in a parent render must not re-trigger the load.
  const depsRef = useRef(deps)
  useEffect(() => {
    depsRef.current = deps
  })

  /** One source fetch WITHOUT touching the loading phase: the mount
   * effect below starts from the initial state; event handlers would go
   * through a `reload` that resets first. */
  const runFetch = useCallback(() => {
    const requestId = ++requestRef.current
    if (!account) {
      setStage({
        stage: "error",
        message: i18next.t("reader.sourceView.noAccount"),
      })
      return
    }
    getMessageSource(account, message, depsRef.current)
      .then((source) => {
        if (requestRef.current !== requestId) return
        setStage({ stage: "shown", source })
      })
      .catch((error) => {
        if (requestRef.current !== requestId) return
        console.warn("[source-view] source fetch failed", error)
        setStage({
          stage: "error",
          message:
            error instanceof Error
              ? error.message
              : i18next.t("reader.sourceView.loadFailed"),
        })
      })
  }, [account, message])

  useEffect(() => {
    if (!open) return
    // The synchronous reset is the sanctioned set-state-in-effect escape
    // hatch (smart-reply-dialog.tsx): the dialog remounts per open, so
    // this only guards an `open` flip on a kept-alive instance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStage({ stage: "loading" })
    setCopied(false)
    runFetch()
  }, [open, runFetch])

  /** The spec's exact-copy path: the clipboard receives the fetched
   * source string itself, not the (escaped, wrapped) rendered text. */
  async function handleCopy(): Promise<void> {
    if (stage.stage !== "shown") return
    try {
      await navigator.clipboard.writeText(stage.source)
      setCopied(true)
      toast.success(t("reader.sourceView.copiedToast"))
    } catch (error) {
      console.warn("[source-view] copy failed", error)
      toast.error(t("reader.sourceView.clipboardFailed"))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="source-view-dialog"
        className="flex max-h-[85vh] flex-col sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{t("reader.sourceView.title")}</DialogTitle>
          <DialogDescription className="line-clamp-1">
            {t("reader.sourceView.description", {
              subject: message.subject || t("threadList.noSubject"),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-muted/30">
          {stage.stage === "loading" && (
            <p
              data-testid="source-view-loading"
              className="p-4 text-sm text-muted-foreground"
            >
              {t("reader.sourceView.loading")}
            </p>
          )}
          {stage.stage === "error" && (
            <p
              data-testid="source-view-error"
              role="alert"
              className="p-4 text-sm text-destructive"
            >
              {stage.message}
            </p>
          )}
          {stage.stage === "shown" && (
            // variant="source": monospace, no find controller, and the
            // ESCAPED text is what enters the sandboxed frame.
            <SafeEmailFrame
              variant="source"
              html={renderPlainTextAsHtml(stage.source)}
            />
          )}
        </div>
        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {stage.stage === "shown" &&
              (copied
                ? t("reader.sourceView.copied")
                : t("reader.sourceView.characters", {
                    count: stage.source.length,
                  }))}
          </span>
          <Button
            variant="outline"
            data-testid="source-view-copy"
            disabled={stage.stage !== "shown"}
            onClick={() => void handleCopy()}
          >
            <Copy className="size-3.5" />
            {t("reader.sourceView.copy")}
          </Button>
          <Button
            variant="ghost"
            data-testid="source-view-close"
            onClick={() => onOpenChange(false)}
          >
            {t("reader.sourceView.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
