import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, Loader2, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { getExecutor } from "@/services/db/executor"
import type {
  NotificationRuleAction,
  NotificationRuleMatchType,
  NotificationRuleRow,
} from "@/services/db/notification-rules"
import {
  addNotificationRule,
  listNotificationRules,
  removeNotificationRule,
} from "@/services/db/notification-rules"
import {
  getNewMailSoundEnabled,
  getSentSoundEnabled,
  setNewMailSoundPreference,
  setSentSoundPreference,
} from "@/services/settings/preferences"
import { useActiveAccount } from "@/stores/account-store"

/**
 * Settings "Notifications" section (task 8.2, design D16): manages the
 * per-sender / per-label notification rules of the ACTIVE account (the
 * account-store selection — rules are per-account rows, and the settings
 * page has no other account scoping). Lists the active overrides and adds
 * or removes them; the evaluation itself lives at the sync engines' count
 * seam (notification-rules.ts).
 *
 * Sound toggles (task 1.5, settings spec, design D12): the new-mail
 * chime (default on) and the sent-confirmation chime (default off),
 * persisted through the preferences service. The new-mail sound plays
 * only when the notification itself is shown — a "never notify" rule, a
 * muted thread or a disabled notifications setting silences banner and
 * sound together; disabling desktop notifications disables their sound.
 *
 * Copy note (D16): the rules gate only the new-mail announcement. A
 * suppressed message is still delivered, unread and shown in the thread
 * list, and it still counts toward the OS unread badge — the badge/
 * notification disagreement is the accepted trade-off documented here.
 * Delete is immediate (no confirm dialog): a rule is trivially re-added
 * and removing one can only resume notifications.
 */

const MATCH_TYPE_LABELS: Record<NotificationRuleMatchType, string> = {
  get sender() {
    return i18next.t("settings.notifications.matchType.sender")
  },
  get label() {
    return i18next.t("settings.notifications.matchType.label")
  },
}

const ACTION_LABELS: Record<NotificationRuleAction, string> = {
  get always() {
    return i18next.t("settings.notifications.action.always")
  },
  get never() {
    return i18next.t("settings.notifications.action.never")
  },
}

function RuleRowItem({
  rule,
  onDelete,
}: {
  rule: NotificationRuleRow
  onDelete: (rule: NotificationRuleRow) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="settings-notification-rule-row"
      className="flex items-center gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {rule.match_value}
        </p>
        <p className="text-xs text-muted-foreground">
          {rule.match_type === "sender"
            ? t("settings.notifications.bySender")
            : t("settings.notifications.byLabel")}
        </p>
      </div>
      <Badge variant="outline">{MATCH_TYPE_LABELS[rule.match_type]}</Badge>
      <Badge variant={rule.action === "never" ? "secondary" : "default"}>
        {ACTION_LABELS[rule.action]}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settings.notifications.deleteRule", {
          value: rule.match_value,
        })}
        onClick={() => onDelete(rule)}
      >
        <Trash2 />
        {t("settings.notifications.delete")}
      </Button>
    </div>
  )
}

function AddRuleDialog({
  accountId,
  onOpenChange,
  onSaved,
}: {
  accountId: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [matchType, setMatchType] =
    useState<NotificationRuleMatchType>("sender")
  const [matchValue, setMatchValue] = useState("")
  const [action, setAction] = useState<NotificationRuleAction>("never")
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canSave = matchValue.trim() !== "" && !saving

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setErrorMessage(null)
    try {
      await addNotificationRule(getExecutor(), {
        accountId,
        matchType,
        matchValue: matchValue.trim(),
        action,
      })
      onSaved()
      onOpenChange(false)
    } catch {
      // Most commonly the table's UNIQUE(account_id, match_type,
      // match_value) rejecting an exact duplicate.
      setErrorMessage(i18next.t("settings.notifications.addDialog.saveFailed"))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("settings.notifications.addDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.notifications.addDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="notification-rule-match-type">
              {t("settings.notifications.addDialog.matchBy")}
            </Label>
            <Select
              value={matchType}
              items={{
                sender: t("settings.notifications.addDialog.senderAddress"),
                label: t("settings.notifications.matchType.label"),
              }}
              onValueChange={(value) =>
                setMatchType(String(value) as NotificationRuleMatchType)
              }
            >
              <SelectTrigger id="notification-rule-match-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sender">
                  {t("settings.notifications.addDialog.senderAddress")}
                </SelectItem>
                <SelectItem value="label">
                  {t("settings.notifications.matchType.label")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notification-rule-match-value">
              {matchType === "sender"
                ? t("settings.notifications.addDialog.senderAddress")
                : t("settings.notifications.addDialog.labelName")}
            </Label>
            <Input
              id="notification-rule-match-value"
              value={matchValue}
              onChange={(event) => setMatchValue(event.target.value)}
              placeholder={
                matchType === "sender"
                  ? t("settings.notifications.addDialog.senderPlaceholder")
                  : t("settings.notifications.addDialog.labelPlaceholder")
              }
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notification-rule-action">
              {t("settings.notifications.addDialog.then")}
            </Label>
            <Select
              value={action}
              items={{
                never: t("settings.notifications.action.never"),
                always: t("settings.notifications.action.always"),
              }}
              onValueChange={(value) =>
                setAction(String(value) as NotificationRuleAction)
              }
            >
              <SelectTrigger id="notification-rule-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">
                  {t("settings.notifications.action.never")}
                </SelectItem>
                <SelectItem value="always">
                  {t("settings.notifications.action.always")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("settings.notifications.addDialog.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {t("settings.notifications.addRule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function NotificationsSection() {
  const { t } = useTranslation()
  const account = useActiveAccount()
  const [rules, setRules] = useState<NotificationRuleRow[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [newMailSound, setNewMailSound] = useState(true)
  const [sentSound, setSentSound] = useState(false)
  // Set as soon as the user toggles: the async initial load must never
  // clobber a change with a stale DB read (same ref pattern as the
  // reading section's toggles).
  const newMailSoundDirtyRef = useRef(false)
  const sentSoundDirtyRef = useRef(false)

  const reload = useCallback(() => {
    // Without an active account there is nothing to load — the render
    // below shows the no-account state, so the stale list stays hidden.
    if (!account) return
    try {
      void listNotificationRules(getExecutor(), account.id)
        .then(setRules)
        .catch((error) => {
          console.warn("[settings] failed to load notification rules", error)
        })
    } catch (error) {
      console.warn("[settings] failed to load notification rules", error)
    }
  }, [account])

  // The shell only mounts settings after bootstrap(), so the executor is
  // available (same assumption as the other sections).
  useEffect(reload, [reload])

  // Load the sound toggles once (failures keep the defaults). The sound
  // toggles are GLOBAL — they do not depend on the active account.
  useEffect(() => {
    try {
      void getNewMailSoundEnabled(getExecutor())
        .then((enabled) => {
          if (!newMailSoundDirtyRef.current) setNewMailSound(enabled)
        })
        .catch(() => {})
      void getSentSoundEnabled(getExecutor())
        .then((enabled) => {
          if (!sentSoundDirtyRef.current) setSentSound(enabled)
        })
        .catch(() => {})
    } catch (error) {
      console.warn("[settings] failed to load sound toggles", error)
    }
  }, [])

  async function changeNewMailSound(enabled: boolean): Promise<void> {
    const previous = newMailSound
    newMailSoundDirtyRef.current = true
    setNewMailSound(enabled)
    try {
      await setNewMailSoundPreference(getExecutor(), enabled)
    } catch (error) {
      setNewMailSound(previous)
      console.warn("[settings] failed to persist new-mail sound", error)
    }
  }

  async function changeSentSound(enabled: boolean): Promise<void> {
    const previous = sentSound
    sentSoundDirtyRef.current = true
    setSentSound(enabled)
    try {
      await setSentSoundPreference(getExecutor(), enabled)
    } catch (error) {
      setSentSound(previous)
      console.warn("[settings] failed to persist sent sound", error)
    }
  }

  async function handleDelete(rule: NotificationRuleRow): Promise<void> {
    try {
      await removeNotificationRule(getExecutor(), rule.id)
      reload()
    } catch (error) {
      console.warn("[settings] failed to delete notification rule", error)
    }
  }

  return (
    <section
      aria-label={t("settings.notifications.title")}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t("settings.notifications.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {account
              ? t("settings.notifications.descriptionFor", {
                  email: account.email,
                })
              : t("settings.notifications.description")}
          </p>
        </div>
        <Button size="sm" disabled={!account} onClick={() => setAddOpen(true)}>
          <Bell />
          {t("settings.notifications.addRule")}
        </Button>
      </div>
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="notifications-new-mail-sound">
              {t("settings.notifications.newMailSound.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.notifications.newMailSound.hint")}
            </p>
          </div>
          <Switch
            id="notifications-new-mail-sound"
            checked={newMailSound}
            onCheckedChange={(checked) => {
              void changeNewMailSound(checked)
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="notifications-sent-sound">
              {t("settings.notifications.sentSound.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.notifications.sentSound.hint")}
            </p>
          </div>
          <Switch
            id="notifications-sent-sound"
            checked={sentSound}
            onCheckedChange={(checked) => {
              void changeSentSound(checked)
            }}
          />
        </div>
      </div>
      <Separator />
      <p className="text-xs text-muted-foreground">
        {t("settings.notifications.rulesNote")}
      </p>
      {!account ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.notifications.noAccount")}
        </p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.notifications.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {rules.map((rule) => (
            <RuleRowItem
              key={rule.id}
              rule={rule}
              onDelete={(target) => {
                void handleDelete(target)
              }}
            />
          ))}
        </div>
      )}
      {/* Remounted on every open so the form always starts fresh. */}
      {addOpen && account && (
        <AddRuleDialog
          key="add-rule"
          accountId={account.id}
          onOpenChange={(open) => {
            if (!open) setAddOpen(false)
          }}
          onSaved={reload}
        />
      )}
    </section>
  )
}
