import { useCallback, useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Loader2, MailX, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import type { BulkUnsubscribeResult } from "@/services/security/subscription-bulk"
import { bulkUnsubscribe } from "@/services/security/subscription-bulk"
import type {
  SubscriptionEntry,
  SubscriptionState,
} from "@/services/settings/subscriptions"
import {
  listSubscriptions,
  removeEntry,
} from "@/services/settings/subscriptions"
import { getExecutor } from "@/services/db/executor"
import { i18next } from "@/i18n"
import { useActiveAccount } from "@/stores/account-store"

/**
 * Settings "Subscriptions" section (task 3.6, design D13 — the
 * mail-security spec's "Subscription manager"): the ACTIVE account's
 * local list of senders detected as newsletters (mail carrying
 * List-Unsubscribe headers) and senders unsubscribed from. Each row shows
 * the sender, the state badge (unsubscribed / still subscribed / unknown,
 * plus the spec's "sender resumed" when mail arrives from an
 * unsubscribed sender) and the last interaction date, with per-entry
 * Unsubscribe / Remove and multi-select bulk unsubscribe reporting
 * per-sender results (the toast summarizes; failures surface inline via
 * the persisted lastError annotation). Detection itself is automatic —
 * the ingestion wiring records senders as their mail arrives (a later
 * task on top of the service transitions).
 *
 * Per-account scoping and the executor assumptions follow the
 * blocked-senders/delivery-schedules sections.
 */

/** Labels are getters, localized at read time. */
const STATE_BADGES: Record<
  SubscriptionState,
  { readonly label: string; variant: "default" | "secondary" | "outline" }
> = {
  subscribed: {
    get label() {
      return i18next.t("settingsMail.subscriptions.states.subscribed")
    },
    variant: "outline",
  },
  unsubscribed: {
    get label() {
      return i18next.t("settingsMail.subscriptions.states.unsubscribed")
    },
    variant: "secondary",
  },
  unknown: {
    get label() {
      return i18next.t("settingsMail.subscriptions.states.unknown")
    },
    variant: "outline",
  },
  resumed: {
    get label() {
      return i18next.t("settingsMail.subscriptions.states.resumed")
    },
    variant: "default",
  },
}

/** An entry can be (bulk-)unsubscribed unless it already is. */
function isActionable(entry: SubscriptionEntry): boolean {
  return entry.state !== "unsubscribed"
}

function lastSeenLabel(entry: SubscriptionEntry): string {
  return i18next.t("settingsMail.subscriptions.lastSeen", {
    when: formatDistanceToNow(new Date(entry.lastSeenAt * 1000), {
      addSuffix: true,
    }),
  })
}

/** Toast shape for a bulk run: one result set, one summary. */
function summarizeResults(results: BulkUnsubscribeResult[]): {
  kind: "success" | "warning" | "error"
  message: string
} {
  if (results.length === 1) {
    const result = results[0]!
    if (result.ok) {
      return {
        kind: "success",
        message: result.queued
          ? i18next.t("settingsMail.subscriptions.toasts.queuedOne", {
              sender: result.sender,
            })
          : i18next.t("settingsMail.subscriptions.toasts.unsubscribedOne", {
              sender: result.sender,
            }),
      }
    }
    return {
      kind: "error",
      message: i18next.t("settingsMail.subscriptions.toasts.failedOne", {
        sender: result.sender,
        error:
          result.error ??
          i18next.t("settingsMail.subscriptions.toasts.requestFailed"),
      }),
    }
  }
  const okResults = results.filter((result) => result.ok)
  const failed = results.filter((result) => !result.ok)
  const queued = okResults.filter((result) => result.queued).length
  const okCount = okResults.length
  const suffix =
    queued > 0
      ? i18next.t("settingsMail.subscriptions.toasts.queuedSuffix", {
          count: queued,
        })
      : ""
  if (failed.length === 0) {
    return {
      kind: "success",
      message: i18next.t("settingsMail.subscriptions.toasts.unsubscribedMany", {
        count: okCount,
        suffix,
      }),
    }
  }
  if (okResults.length === 0) {
    return {
      kind: "error",
      message: i18next.t("settingsMail.subscriptions.toasts.allFailed", {
        count: failed.length,
      }),
    }
  }
  return {
    kind: "warning",
    message: i18next.t("settingsMail.subscriptions.toasts.partial", {
      ok: okCount,
      failed: failed.length,
      suffix,
    }),
  }
}

export function SubscriptionsSection() {
  const { t } = useTranslation()
  const account = useActiveAccount()
  const [entries, setEntries] = useState<SubscriptionEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)

  const reload = useCallback(() => {
    // Without an active account there is nothing to load — the render
    // below shows the no-account state, so the stale list stays hidden.
    if (!account) return
    try {
      void listSubscriptions(getExecutor(), account.id)
        .then((loaded) => {
          setEntries(loaded)
          // Selection is always a subset of the displayed entries: keys
          // that vanished (removed rows, an account switch) drop out.
          setSelected((previous) => {
            const senders = new Set(loaded.map((entry) => entry.sender))
            const next = new Set(
              [...previous].filter((sender) => senders.has(sender))
            )
            return next.size === previous.size ? previous : next
          })
        })
        .catch((error) => {
          console.warn("[settings] failed to load subscriptions", error)
        })
    } catch (error) {
      console.warn("[settings] failed to load subscriptions", error)
    }
  }, [account])

  // The shell only mounts settings after bootstrap(), so the executor is
  // available (same assumption as the other sections).
  useEffect(reload, [reload])

  const actionable = entries.filter(isActionable)
  const allSelected =
    actionable.length > 0 &&
    actionable.every((entry) => selected.has(entry.sender))

  function toggle(sender: string, checked: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(sender)
      } else {
        next.delete(sender)
      }
      return next
    })
  }

  function toggleAll(checked: boolean): void {
    setSelected(
      checked ? new Set(actionable.map((entry) => entry.sender)) : new Set()
    )
  }

  /** The bulk path for one or many senders; the service reports
   * per-sender results and annotates failures on the entries, so the
   * reload surfaces them inline. */
  async function runUnsubscribe(senders: string[]): Promise<void> {
    if (!account || senders.length === 0 || running) return
    setRunning(true)
    try {
      const results = await bulkUnsubscribe(getExecutor(), account.id, senders)
      const summary = summarizeResults(results)
      if (summary.kind === "success") {
        toast.success(summary.message)
      } else if (summary.kind === "warning") {
        toast.warning(summary.message)
      } else {
        toast.error(summary.message)
      }
      setSelected(new Set())
      reload()
    } catch (error) {
      // bulkUnsubscribe resolves per-sender results; reaching here means
      // the call itself failed (executor gone) — surfaced via toast.
      console.warn("[settings] bulk unsubscribe failed", error)
      toast.error(t("settingsMail.subscriptions.toasts.bulkFailed"))
    } finally {
      setRunning(false)
    }
  }

  async function handleRemove(entry: SubscriptionEntry): Promise<void> {
    if (!account) return
    try {
      await removeEntry(getExecutor(), account.id, entry.sender)
      toast.success(
        t("settingsMail.subscriptions.toasts.removed", { sender: entry.sender })
      )
      reload()
    } catch (error) {
      console.warn("[settings] failed to remove subscription entry", error)
      toast.error(
        t("settingsMail.subscriptions.toasts.removeFailed", {
          sender: entry.sender,
        })
      )
    }
  }

  return (
    <section
      aria-label={t("settingsMail.subscriptions.title")}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t("settingsMail.subscriptions.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {account
              ? t("settingsMail.subscriptions.subtitleAccount", {
                  email: account.email,
                })
              : t("settingsMail.subscriptions.subtitle")}
          </p>
        </div>
        <Button
          size="sm"
          disabled={!account || running || selected.size === 0}
          onClick={() => {
            void runUnsubscribe([...selected])
          }}
        >
          {running && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          <MailX />
          {selected.size > 0
            ? t("settingsMail.subscriptions.unsubscribeSelectedCount", {
                n: selected.size,
              })
            : t("settingsMail.subscriptions.unsubscribeSelected")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settingsMail.subscriptions.help")}
      </p>
      <Separator />
      {!account ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.subscriptions.noAccount")}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.subscriptions.empty")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Checkbox
              aria-label={t("settingsMail.subscriptions.selectAll")}
              checked={allSelected}
              onCheckedChange={(checked) => {
                toggleAll(checked === true)
              }}
            />
            <span className="text-xs text-muted-foreground">
              {t("settingsMail.subscriptions.selectAll")}
            </span>
          </div>
          <div className="divide-y divide-border">
            {entries.map((entry) => {
              const badge = STATE_BADGES[entry.state]
              const isSelected = selected.has(entry.sender)
              return (
                <div
                  key={entry.sender}
                  data-testid="subscription-row"
                  className="flex items-start gap-3 py-2.5"
                >
                  <Checkbox
                    aria-label={t("settingsMail.subscriptions.selectSender", {
                      sender: entry.sender,
                    })}
                    className="mt-0.5"
                    disabled={!isActionable(entry)}
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      toggle(entry.sender, checked === true)
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-foreground">
                      {entry.sender}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge
                        variant={badge.variant}
                        data-testid={`subscription-state-${entry.state}`}
                      >
                        {badge.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {lastSeenLabel(entry)}
                      </span>
                    </div>
                    {isActionable(entry) && entry.lastError && (
                      <p
                        role="alert"
                        data-testid="subscription-row-error"
                        className="mt-1 text-xs text-destructive"
                      >
                        {entry.lastError}
                      </p>
                    )}
                  </div>
                  {isActionable(entry) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t(
                        "settingsMail.subscriptions.unsubscribeAria",
                        {
                          sender: entry.sender,
                        }
                      )}
                      disabled={running}
                      onClick={() => {
                        void runUnsubscribe([entry.sender])
                      }}
                    >
                      {t("settingsMail.subscriptions.unsubscribe")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("settingsMail.subscriptions.removeAria", {
                      sender: entry.sender,
                    })}
                    disabled={running}
                    onClick={() => {
                      void handleRemove(entry)
                    }}
                  >
                    <Trash2 />
                    {t("settingsMail.subscriptions.remove")}
                  </Button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
