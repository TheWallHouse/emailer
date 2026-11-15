import { useState } from "react"
import { CirclePlus, KeyRound, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Trans, useTranslation } from "react-i18next"

import { AddAccountDialog } from "@/components/accounts/add-account-dialog"
import { ReauthDialog } from "@/components/accounts/reauth-dialog"
import { RemoveAccountDialog } from "@/components/accounts/remove-account-dialog"
import {
  ALL_HISTORY_VALUE,
  historyWindowLabel,
} from "@/services/sync/history-window"
import { i18next } from "@/i18n"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ProviderIcon } from "@/components/providers/provider-icon"
import { providerBrandName } from "@/components/providers/provider-brands"
import { ProfilesEditor } from "@/components/settings/profiles-editor"
import { brandForAccount } from "@/services/account-flows"
import { getExecutor } from "@/services/db/executor"
import {
  setAccountReminderLeadMinutes,
  updateHistoryWindow,
} from "@/services/db/accounts"
import { enqueueHistoryBackfill } from "@/services/queue/operation"
import {
  HISTORY_WINDOWS,
  historyWindowBoundary,
  windowIsWider,
  type HistoryWindow,
  type HistoryWindowSetting,
} from "@/services/sync/history-window"
import type { AccountInfo } from "@/stores/account-store"
import { useAccountStore } from "@/stores/account-store"

/**
 * Settings "Accounts" section (task 11.1, accounts capability): lists the
 * stored accounts (email, provider type, sign-in status, unread badge)
 * with the same management flows the account switcher hosts — Add Account
 * opens the shared chooser dialog, and each row offers Remove (confirm
 * dialog) plus Re-authenticate for accounts paused as auth-error. All
 * three dialogs are reused as-is from components/accounts; this section
 * only hosts them, exactly like the switcher does.
 *
 * Each row also carries the history-window pick (parity-round-3 task 3.1,
 * design D6) — the per-account FIRST-sync download boundary. Changing a
 * stored account's window persists immediately; WIDENING it additionally
 * offers the targeted backfill (task 3.3): on confirm, a
 * `history_backfill` op lands in the offline queue with the newly covered
 * range frozen, so the fetch survives restarts. Narrowing never deletes
 * anything — the boundary is download-only.
 *
 * Below the account list sits the Profiles editor (parity-round-2 task
 * 4.4, design D10): named local account groups with colors and per-account
 * overrides — a self-contained sub-section (./profiles-editor) so the
 * account rows above stay untouched.
 */

/** Select values are strings; "all" is the sentinel for the null setting. */
const WINDOW_ITEMS: Record<HistoryWindow | typeof ALL_HISTORY_VALUE, string> = {
  get "1m"() {
    return i18next.t("settings.accounts.window.1m")
  },
  get "3m"() {
    return i18next.t("settings.accounts.window.3m")
  },
  get "6m"() {
    return i18next.t("settings.accounts.window.6m")
  },
  get "1y"() {
    return i18next.t("settings.accounts.window.1y")
  },
  get all() {
    return i18next.t("settings.accounts.window.all")
  },
}

function settingToValue(window: HistoryWindowSetting): string {
  return window ?? ALL_HISTORY_VALUE
}

function valueToSetting(value: string): HistoryWindowSetting {
  return value === ALL_HISTORY_VALUE
    ? null
    : HISTORY_WINDOWS.includes(value as HistoryWindow)
      ? (value as HistoryWindow)
      : null
}

/** Meeting-reminder lead choices (parity-round-3 task 8.5, D5). */
const REMINDER_LEAD_ITEMS: Record<string, string> = {
  get off() {
    return i18next.t("settings.accounts.reminderLead.off")
  },
  get "5"() {
    return i18next.t("settings.accounts.reminderLead.minutes", { minutes: 5 })
  },
  get "10"() {
    return i18next.t("settings.accounts.reminderLead.minutes", { minutes: 10 })
  },
  get "15"() {
    return i18next.t("settings.accounts.reminderLead.minutes", { minutes: 15 })
  },
  get "30"() {
    return i18next.t("settings.accounts.reminderLead.minutes", { minutes: 30 })
  },
}

function leadToValue(minutes: number | null | undefined): string {
  return typeof minutes === "number" && minutes > 0
    ? String(Math.floor(minutes)) in REMINDER_LEAD_ITEMS
      ? String(Math.floor(minutes))
      : "off"
    : "off"
}

/** A widening awaiting its backfill confirmation. */
interface BackfillPrompt {
  accountId: string
  accountEmail: string
  /** The row's window before the change (the narrower one). */
  previous: HistoryWindowSetting
  /** The user's wider pick. */
  next: HistoryWindowSetting
}

function AccountRow({
  account,
  onRemove,
  onReauth,
  onWindowChange,
  onLeadChange,
}: {
  account: AccountInfo
  onRemove: (account: AccountInfo) => void
  onReauth: (account: AccountInfo) => void
  onWindowChange: (
    account: AccountInfo,
    next: HistoryWindowSetting
  ) => Promise<void>
  onLeadChange: (account: AccountInfo, next: number | null) => Promise<void>
}) {
  const { t } = useTranslation()
  const brand = brandForAccount(account.type, account.email)
  const [savingWindow, setSavingWindow] = useState(false)
  const [savingLead, setSavingLead] = useState(false)
  return (
    <div
      data-testid="settings-account-row"
      className="flex items-center gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ProviderIcon provider={brand} className="size-4" />
          <span className="truncate">{account.email}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {account.displayName ?? t("settings.accounts.noDisplayName")}
        </p>
      </div>
      {/* First-sync download window (task 3.1, D6): compact per-row pick;
          the widening-backfill offer opens from the shared dialog below. */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          {t("settings.accounts.firstSync")}
        </span>
        <Select
          items={WINDOW_ITEMS}
          value={settingToValue(account.historyWindow ?? null)}
          disabled={savingWindow}
          onValueChange={(next) => {
            if (typeof next !== "string") return
            const setting = valueToSetting(next)
            if (setting === account.historyWindow) return
            setSavingWindow(true)
            void onWindowChange(account, setting)
              .catch((error: unknown) => {
                console.warn(
                  `[accounts] history window change for ${account.id} failed`,
                  error
                )
              })
              .finally(() => setSavingWindow(false))
          }}
        >
          <SelectTrigger
            aria-label={t("settings.accounts.firstSyncAria", {
              email: account.email,
            })}
            data-testid={`history-window-${account.id}`}
            className="w-28"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              [...HISTORY_WINDOWS, ALL_HISTORY_VALUE] as (
                HistoryWindow | typeof ALL_HISTORY_VALUE
              )[]
            ).map((item) => (
              <SelectItem key={item} value={item}>
                {WINDOW_ITEMS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Meeting-reminder lead (task 8.5, D5): per-account, default Off;
          the scheduler reads the row directly each pass. */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          {t("settings.accounts.reminders")}
        </span>
        <Select
          items={REMINDER_LEAD_ITEMS}
          value={leadToValue(account.reminderLeadMinutes)}
          disabled={savingLead}
          onValueChange={(next) => {
            if (typeof next !== "string") return
            const minutes = next === "off" ? null : Number(next)
            if (minutes === account.reminderLeadMinutes) return
            setSavingLead(true)
            void onLeadChange(account, minutes)
              .catch((error: unknown) => {
                console.warn(
                  `[accounts] reminder lead change for ${account.id} failed`,
                  error
                )
              })
              .finally(() => setSavingLead(false))
          }}
        >
          <SelectTrigger
            aria-label={t("settings.accounts.remindersAria", {
              email: account.email,
            })}
            data-testid={`reminder-lead-${account.id}`}
            className="w-28"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(REMINDER_LEAD_ITEMS).map((item) => (
              <SelectItem key={item} value={item}>
                {REMINDER_LEAD_ITEMS[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {account.status === "auth-error" ? (
        <Badge variant="destructive">
          <TriangleAlert data-icon="inline-start" aria-hidden />
          {t("settings.accounts.signInError")}
        </Badge>
      ) : (
        account.unreadCount > 0 && (
          <Badge
            variant="secondary"
            aria-label={t("settings.accounts.unread", {
              count: account.unreadCount,
            })}
          >
            {t("settings.accounts.unread", { count: account.unreadCount })}
          </Badge>
        )
      )}
      {/* Brand name when the provider is known ("Outlook"), else the
          generic IMAP label. Gmail accounts always resolve to "Gmail". */}
      <Badge variant="outline">{providerBrandName(brand) ?? "IMAP"}</Badge>
      {account.status === "auth-error" && (
        <Button variant="ghost" size="sm" onClick={() => onReauth(account)}>
          <KeyRound />
          {t("settings.accounts.reauthenticate")}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => onRemove(account)}>
        <Trash2 />
        {t("settings.accounts.remove")}
      </Button>
    </div>
  )
}

export function AccountsSection() {
  const { t } = useTranslation()
  const accounts = useAccountStore((state) => state.accounts)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<AccountInfo | null>(null)
  const [reauthTarget, setReauthTarget] = useState<AccountInfo | null>(null)
  const [backfillPrompt, setBackfillPrompt] = useState<BackfillPrompt | null>(
    null
  )
  const [queuingBackfill, setQueuingBackfill] = useState(false)

  /**
   * Persist the row's new window, then offer the widening backfill
   * (task 3.3): the store reload makes the row show the saved value while
   * the confirm dialog is up — cancelling keeps the wider window but
   * skips the fetch (the boundary is download-only; nothing is deleted).
   */
  async function handleWindowChange(
    account: AccountInfo,
    next: HistoryWindowSetting
  ): Promise<void> {
    const executor = getExecutor()
    const previous = account.historyWindow ?? null
    await updateHistoryWindow(executor, account.id, next)
    await useAccountStore.getState().reload()
    if (windowIsWider(previous, next)) {
      setBackfillPrompt({
        accountId: account.id,
        accountEmail: account.email,
        previous,
        next,
      })
    }
  }

  /**
   * Persist the row's meeting-reminder lead (task 8.5, D5); null turns
   * reminders off. The scheduler picks the new value up on its next pass.
   */
  async function handleReminderLeadChange(
    account: AccountInfo,
    next: number | null
  ): Promise<void> {
    const executor = getExecutor()
    await setAccountReminderLeadMinutes(executor, account.id, next)
    await useAccountStore.getState().reload()
  }

  /**
   * Queue the targeted backfill with the newly covered range FROZEN
   * ([boundary(next), boundary(previous)), unix seconds). The old
   * boundary is always finite here — null (All) is the widest setting,
   * so a widening always starts from a bounded window. A null new
   * boundary (widening to All) is encoded as since 0 = the epoch, which
   * every driver reads as "down to the beginning of history".
   */
  async function handleBackfillConfirm(): Promise<void> {
    if (!backfillPrompt) return
    setQueuingBackfill(true)
    try {
      const now = Math.floor(Date.now() / 1000)
      await enqueueHistoryBackfill(getExecutor(), {
        accountId: backfillPrompt.accountId,
        since: historyWindowBoundary(backfillPrompt.next, now) ?? 0,
        until: historyWindowBoundary(backfillPrompt.previous, now),
      })
      setBackfillPrompt(null)
    } catch (error) {
      // The dialog stays open (the range choice is intact) and the user
      // learns the widening was NOT queued — a silent re-enabled button
      // would read as success.
      console.warn("[accounts] history backfill enqueue failed", error)
      toast.error(
        error instanceof Error
          ? error.message
          : i18next.t("settings.accounts.backfill.queueFailed")
      )
    } finally {
      setQueuingBackfill(false)
    }
  }

  const rangeLabel = backfillPrompt
    ? `${historyWindowLabel(backfillPrompt.previous)} → ${historyWindowLabel(backfillPrompt.next)}`
    : ""

  return (
    <section
      aria-label={t("settings.accounts.title")}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t("settings.accounts.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.accounts.description")}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <CirclePlus />
          {t("settings.accounts.add")}
        </Button>
      </div>
      <Separator />
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.accounts.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onRemove={setRemoveTarget}
              onReauth={setReauthTarget}
              onWindowChange={handleWindowChange}
              onLeadChange={handleReminderLeadChange}
            />
          ))}
        </div>
      )}
      {/* Profiles editor (parity-round-2 task 4.4): the named account
          groups with colors/overrides — self-contained sub-section. */}
      <Separator />
      <ProfilesEditor />
      {/* Shared account dialogs (5.3–5.6), keyed by target like the
          switcher: every open remounts a fresh dialog instance. Keys are
          prefixed per dialog so two dialogs open on the same account never
          collide. */}
      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />
      <ReauthDialog
        key={`reauth-${reauthTarget?.id ?? "closed"}`}
        account={reauthTarget}
        open={reauthTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReauthTarget(null)
        }}
      />
      <RemoveAccountDialog
        key={`remove-${removeTarget?.id ?? "closed"}`}
        account={removeTarget}
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
      />
      {/* Widening backfill offer (task 3.3, D6). */}
      <Dialog
        open={backfillPrompt !== null}
        onOpenChange={(open) => {
          if (!queuingBackfill && !open) setBackfillPrompt(null)
        }}
      >
        {backfillPrompt && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.accounts.backfill.title")}</DialogTitle>
              <DialogDescription>
                <Trans
                  i18nKey="settings.accounts.backfill.description"
                  values={{
                    email: backfillPrompt.accountEmail,
                    range: rangeLabel,
                  }}
                  components={{ email: <span className="font-medium" /> }}
                />
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setBackfillPrompt(null)}
                disabled={queuingBackfill}
              >
                {t("settings.accounts.backfill.notNow")}
              </Button>
              <Button
                onClick={() => {
                  void handleBackfillConfirm()
                }}
                disabled={queuingBackfill}
              >
                {t("settings.accounts.backfill.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}
