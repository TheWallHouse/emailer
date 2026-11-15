import { useCallback, useEffect, useState } from "react"
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
import { getExecutor } from "@/services/db/executor"
import {
  applyRuleNow,
  countMatchingThreads,
  type ApplyRuleNowResult,
} from "@/services/rules/apply-now"
import type { RuleRow } from "@/services/rules/db"

/**
 * "Apply now" for one mail rule (task 11.4, design D5) — the confirmation
 * gate as a self-contained control: an "Apply now" button that opens a
 * dialog which counts the rule's matching STORED threads through
 * countMatchingThreads (the same compiled matcher the search runs,
 * thread-level), shows that number, and only then enables the confirm
 * button that calls applyRuleNow({ confirmed: true }) and toasts the
 * result summary ("Applied to N threads").
 *
 * Deliberately UNMOUNTED: the rules section (task 11.3) can render one per
 * rule row — <ApplyRuleDialog rule={rule} onDone={...} /> — and owns when.
 * The gate semantics live in the service (applyRuleNow refuses without the
 * literal confirmed flag); this component's discipline on top: the confirm
 * button stays disabled until the count resolves (never confirm an unknown
 * count) and at count 0 (nothing to apply).
 */

export interface ApplyRuleDialogProps {
  rule: RuleRow
  /** Called after a confirmed apply landed, with the service's counts —
   * never on cancel, refusal, or failure. */
  onDone?: (result: ApplyRuleNowResult) => void
}

export function ApplyRuleDialog({ rule, onDone }: ApplyRuleDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [matched, setMatched] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)

  // Count on every open; the count reset happens in the open event (a
  // user event, not this effect) so the dialog never shows a stale count.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    countMatchingThreads(getExecutor(), rule.account_id, rule.criteria_json)
      .then((count) => {
        if (!cancelled) setMatched(count)
      })
      .catch((error) => {
        console.error("[rules] apply-now: count failed", error)
        if (!cancelled) {
          toast.error(t("settingsMail.applyRule.countFailed"))
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, rule.account_id, rule.criteria_json, t])

  const handleConfirm = useCallback(async () => {
    if (applying) return
    setApplying(true)
    try {
      const result = await applyRuleNow(getExecutor(), rule.account_id, rule, {
        confirmed: true,
      })
      toast.success(
        t("settingsMail.applyRule.applied", {
          count: result.applied,
          n: result.applied.toLocaleString(),
        })
      )
      setOpen(false)
      onDone?.(result)
    } catch (error) {
      console.error("[rules] apply-now failed", error)
      toast.error(t("settingsMail.applyRule.applyFailed"))
    } finally {
      setApplying(false)
    }
  }, [applying, onDone, rule, t])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        data-testid="apply-rule-button"
        onClick={() => {
          setMatched(null)
          setOpen(true)
        }}
      >
        {t("settingsMail.applyRule.applyNow")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("settingsMail.applyRule.title", { name: rule.name })}
          </DialogTitle>
          <DialogDescription>
            {matched === null
              ? t("settingsMail.applyRule.counting")
              : matched === 0
                ? t("settingsMail.applyRule.noMatches")
                : t("settingsMail.applyRule.matches", {
                    count: matched,
                    n: matched.toLocaleString(),
                  })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={applying}
            onClick={() => setOpen(false)}
          >
            {t("settingsMail.applyRule.cancel")}
          </Button>
          <Button
            data-testid="apply-rule-confirm"
            disabled={matched === null || matched === 0 || applying}
            onClick={() => void handleConfirm()}
          >
            {applying
              ? t("settingsMail.applyRule.applying")
              : matched === null || matched === 0
                ? t("settingsMail.applyRule.apply")
                : t("settingsMail.applyRule.applyTo", {
                    count: matched,
                    n: matched.toLocaleString(),
                  })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
