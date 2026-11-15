import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { BlockedSenderRow } from "@/services/db/blocked-senders"
import {
  listBlockedSenders,
  unblockSender,
} from "@/services/db/blocked-senders"
import { getExecutor } from "@/services/db/executor"
import { i18next } from "@/i18n"
import { useActiveAccount } from "@/stores/account-store"

/**
 * Settings "Blocked senders" section (task 18.2, mail-security spec
 * "Block sender"): manages the ACTIVE account's blocklist rows (same
 * per-account scoping as the rules and notifications sections). Rows show
 * the lowercased address and an action chip — the action chosen at block
 * time that the ingestion hook applies to future mail — plus Unblock,
 * which deletes the row (no confirm: re-blocking is one menu action away,
 * and the deletion is the spec's "Unblock" scenario: future mail from the
 * sender arrives normally again).
 */

function actionChipLabel(action: BlockedSenderRow["action"]): string {
  return action === "trash"
    ? i18next.t("settingsMail.blockedSenders.autoTrash")
    : i18next.t("settingsMail.blockedSenders.autoArchive")
}

export function BlockedSendersSection() {
  const { t } = useTranslation()
  const account = useActiveAccount()
  const [rows, setRows] = useState<BlockedSenderRow[]>([])

  const reload = useCallback(() => {
    // Without an active account there is nothing to load — the render
    // below shows the no-account state, so the stale list stays hidden.
    if (!account) return
    try {
      void listBlockedSenders(getExecutor(), account.id)
        .then(setRows)
        .catch((error) => {
          console.warn("[settings] failed to load blocked senders", error)
        })
    } catch (error) {
      console.warn("[settings] failed to load blocked senders", error)
    }
  }, [account])

  // The shell only mounts settings after bootstrap(), so the executor is
  // available (same assumption as the other sections).
  useEffect(reload, [reload])

  async function handleUnblock(row: BlockedSenderRow): Promise<void> {
    try {
      await unblockSender(getExecutor(), row.id)
      toast.success(
        t("settingsMail.blockedSenders.unblocked", { sender: row.sender })
      )
      reload()
    } catch (error) {
      console.warn("[settings] failed to unblock sender", error)
    }
  }

  return (
    <section
      aria-label={t("settingsMail.blockedSenders.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settingsMail.blockedSenders.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {account
            ? t("settingsMail.blockedSenders.subtitleAccount", {
                email: account.email,
              })
            : t("settingsMail.blockedSenders.subtitle")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settingsMail.blockedSenders.help")}
      </p>
      <Separator />
      {!account ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.blockedSenders.noAccount")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.blockedSenders.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid="blocked-sender-row"
              className="flex items-center gap-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-foreground">
                  {row.sender}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="outline" className="font-normal">
                    {actionChipLabel(row.action)}
                  </Badge>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("settingsMail.blockedSenders.unblockAria", {
                  sender: row.sender,
                })}
                onClick={() => {
                  void handleUnblock(row)
                }}
              >
                {t("settingsMail.blockedSenders.unblock")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
