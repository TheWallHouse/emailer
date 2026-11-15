import { useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"

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
  deriveRuleFromDescription,
  type RuleAssistCandidate,
  type RuleAssistFailureReason,
} from "@/services/ai/rule-assist"

/**
 * "Describe a rule…" dialog (parity-round-2 task 2.5, ai-assistance spec
 * "Natural-language rule creation"): the entry point next to the rules
 * section's Add Rule flow. The user types a plain-language description;
 * Translate sends EXACTLY that description to the provider (the fixed
 * prompt carries only the description and the rule vocabulary — no
 * mailbox content, spec scenario "Description only").
 *
 * Outcomes:
 * - A valid candidate NEVER creates anything here — it is handed to the
 *   caller (`onDerived`), which opens the existing rule editor prefilled
 *   with the translated name/query/actions; creation happens only on the
 *   editor's explicit save (spec scenario "Confirm before create").
 * - Unmappable output renders the "no rule could be derived" state and
 *   the dialog stays open for editing — nothing is written (spec
 *   scenario "Not mappable").
 * - AI unavailable / provider failure render inline copy with Retry;
 *   nothing is written either.
 */

interface DescribeRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the validated candidate — never on any failure. */
  onDerived: (candidate: RuleAssistCandidate) => void
}

/** The dialog flow in one object (the smart-reply dialog's pattern); the
 * typed description lives in its own input state, so the flow carries only
 * the stage and an error's message. */
type Flow =
  | { stage: "input" }
  | { stage: "translating" }
  | { stage: "not-mappable" }
  | { stage: "error"; message: string }

/** Human copy for the typed service failure reasons (provider carries its
 * own message and is handled separately). */
function failureCopy(reason: RuleAssistFailureReason): string {
  switch (reason) {
    case "not-configured":
      return i18next.t("settingsMail.describeRule.failures.notConfigured")
    case "surface-disabled":
      return i18next.t("settingsMail.describeRule.failures.surfaceDisabled")
    case "empty-description":
      return i18next.t("settingsMail.describeRule.failures.emptyDescription")
    case "not-mappable":
      return i18next.t("settingsMail.describeRule.failures.notMappable")
    case "provider":
      return i18next.t("settingsMail.describeRule.failures.provider")
  }
}

export function DescribeRuleDialog({
  open,
  onOpenChange,
  onDerived,
}: DescribeRuleDialogProps) {
  const { t } = useTranslation()
  const [flow, setFlow] = useState<Flow>({ stage: "input" })
  const [description, setDescription] = useState("")

  // Closing resets the flow (event-driven, not an effect): every close
  // path — Cancel, Esc, overlay, a successful derivation — funnels through
  // this handler, so a reopen always starts from a clean slate.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDescription("")
      setFlow({ stage: "input" })
    }
    onOpenChange(next)
  }

  const translate = () => {
    if (description.trim() === "") return
    setFlow({ stage: "translating" })
    try {
      void deriveRuleFromDescription(getExecutor(), description)
        .then((result) => {
          if (result.ok) {
            onDerived(result.candidate)
            handleOpenChange(false)
            return
          }
          if (result.reason === "provider") {
            setFlow({
              stage: "error",
              message: result.message ?? failureCopy("provider"),
            })
          } else if (result.reason === "not-mappable") {
            setFlow({ stage: "not-mappable" })
          } else {
            setFlow({
              stage: "error",
              message: failureCopy(result.reason),
            })
          }
        })
        .catch(() => {
          setFlow({
            stage: "error",
            message: failureCopy("provider"),
          })
        })
    } catch {
      // No executor (plain vite) — inline error, nothing written.
      setFlow({
        stage: "error",
        message: failureCopy("provider"),
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="describe-rule-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden />
            {t("settingsMail.describeRule.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settingsMail.describeRule.description")}
          </DialogDescription>
        </DialogHeader>

        <textarea
          data-testid="describe-rule-input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("settingsMail.describeRule.placeholder")}
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />

        {flow.stage === "translating" && (
          <div
            data-testid="describe-rule-busy"
            className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("settingsMail.describeRule.translating")}
          </div>
        )}

        {flow.stage === "not-mappable" && (
          <div
            data-testid="describe-rule-not-mappable"
            role="status"
            className="rounded-lg border border-border bg-muted/30 p-3 text-sm"
          >
            {failureCopy("not-mappable")}{" "}
            {t("settingsMail.describeRule.tryRephrasing")}
          </div>
        )}

        {flow.stage === "error" && (
          <div
            data-testid="describe-rule-error"
            role="status"
            className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <span className="text-destructive">{flow.message}</span>
            <Button
              variant="outline"
              size="sm"
              data-testid="describe-rule-retry"
              onClick={translate}
            >
              {t("settingsMail.describeRule.retry")}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            aria-label={t("settingsMail.describeRule.closeAria")}
          >
            {t("settingsMail.describeRule.cancel")}
          </Button>
          <Button
            data-testid="describe-rule-translate"
            disabled={description.trim() === "" || flow.stage === "translating"}
            onClick={translate}
          >
            <Sparkles aria-hidden />
            {t("settingsMail.describeRule.translate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
