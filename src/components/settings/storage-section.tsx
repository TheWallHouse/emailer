import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
import { Separator } from "@/components/ui/separator"
import {
  deleteAllLocalData,
  formatStorageSize,
  getStorageUsage,
  KIND_DESCRIPTIONS,
  KIND_LABELS,
  type StorageUsage,
} from "@/services/settings/storage"

/**
 * Settings "Storage" section (tasks 1.6/1.7, settings spec "Local
 * storage usage and reset", design D11): the per-kind usage breakdown
 * computed Rust-side by walking the app data/config dirs (no SQL
 * counting), a refresh action, the total, and the destructive
 * "Delete all local data" reset.
 *
 * The reset is a TWO-STEP dialog: the first step names exactly what is
 * removed and states that the mail servers are untouched; the second
 * step demands an explicit final confirmation. Only that second confirm
 * triggers the wipe (services/settings/storage.ts), which restarts the
 * app into first-run on success — the component just observes the
 * failure case (the process is gone before any success comes back).
 *
 * The `unreadableEntries` signal from the walk is surfaced as an
 * "approximate" note rather than hidden: a total that could not stat
 * some files must not present itself as exact.
 */

const REMOVED_ITEM_KEYS = [
  "mail",
  "attachments",
  "aiCache",
  "calendar",
  "contacts",
  "preferences",
  "credentials",
] as const

function DeleteAllDataDialog({
  deleting,
  onOpenChange,
  onConfirm,
}: {
  deleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  // Step 1 states the scope; step 2 is the explicit final confirm. The
  // dialog is mounted fresh for every open (keyed remount — the same
  // pattern as the rules' AddRuleDialog), so the step always starts at 1.
  const { t } = useTranslation()
  const [confirmedOnce, setConfirmedOnce] = useState(false)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-all-data-dialog">
        {confirmedOnce ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {t("settings.storage.deleteDialog.confirmTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("settings.storage.deleteDialog.confirmDescription")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmedOnce(false)}
                disabled={deleting}
              >
                {t("settings.storage.deleteDialog.back")}
              </Button>
              <Button
                variant="destructive"
                data-testid="delete-all-data-confirm"
                disabled={deleting}
                onClick={onConfirm}
              >
                {deleting && (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                )}
                {t("settings.storage.deleteDialog.deleteEverything")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {t("settings.storage.deleteDialog.title")}
              </DialogTitle>
              <DialogDescription>
                {t("settings.storage.deleteDialog.description")}
              </DialogDescription>
            </DialogHeader>
            <ul
              data-testid="delete-all-data-scope"
              className="list-disc space-y-1 pl-5 text-sm text-foreground"
            >
              {REMOVED_ITEM_KEYS.map((item) => (
                <li key={item}>
                  {t(`settings.storage.deleteDialog.items.${item}`)}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              {t("settings.storage.deleteDialog.serversNote")}
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={deleting}
              >
                {t("settings.storage.deleteDialog.cancel")}
              </Button>
              <Button
                data-testid="delete-all-data-continue"
                onClick={() => setConfirmedOnce(true)}
              >
                {t("settings.storage.deleteDialog.continue")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function StorageSection() {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // All state updates land in promise callbacks — the initial load runs
  // from an effect, and no state may be set synchronously within it.
  const load = useCallback((): void => {
    getStorageUsage()
      .then((next) => {
        setUsage(next)
        setError(null)
      })
      .catch((cause) => {
        console.warn("[settings] failed to load storage usage", cause)
        setError(i18next.t("settings.storage.loadFailed"))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  // Refresh re-runs the walk with the in-flight state visible.
  const refresh = useCallback((): void => {
    setLoading(true)
    load()
  }, [load])

  // The shell only mounts settings after bootstrap(), so mounting is a
  // complete state; the refresh button re-runs the walk on demand.
  useEffect(() => {
    load()
  }, [load])

  async function handleDeleteAll(): Promise<void> {
    setDeleting(true)
    try {
      // On success the app relaunches — this never resolves.
      await deleteAllLocalData()
    } catch (cause) {
      console.warn("[settings] delete all local data failed", cause)
      setDeleting(false)
      setDeleteOpen(false)
      toast.error(i18next.t("settings.storage.deleteFailed.title"), {
        description: i18next.t("settings.storage.deleteFailed.description"),
      })
    }
  }

  return (
    <section
      aria-label={t("settings.storage.title")}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t("settings.storage.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.storage.description")}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="storage-refresh"
          disabled={loading}
          onClick={() => {
            refresh()
          }}
        >
          {loading ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw />
          )}
          {t("settings.storage.refresh")}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : loading && !usage ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("settings.storage.calculating")}
        </p>
      ) : usage ? (
        <>
          <div className="divide-y divide-border" data-testid="storage-usage">
            {usage.kinds.map((kind) => (
              <div
                key={kind.kind}
                data-testid={`storage-kind-${kind.kind}`}
                className="flex items-center justify-between gap-6 py-3"
              >
                <div className="grid gap-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {KIND_LABELS[kind.kind] ?? kind.kind}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {KIND_DESCRIPTIONS[kind.kind] ?? ""}
                  </p>
                </div>
                <p className="shrink-0 pl-4 text-right text-sm whitespace-nowrap text-foreground tabular-nums">
                  {formatStorageSize(kind.bytes)}
                </p>
              </div>
            ))}
            <div className="flex items-center justify-between gap-6 py-3">
              <p className="text-sm font-semibold text-foreground">
                {t("settings.storage.total")}
              </p>
              <p
                className="text-sm font-semibold text-foreground tabular-nums"
                data-testid="storage-total"
              >
                {formatStorageSize(usage.total)}
              </p>
            </div>
          </div>
          {usage.unreadableEntries > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("settings.storage.approximate")}
            </p>
          )}
        </>
      ) : null}

      <Separator />

      <div className="flex items-center justify-between gap-6">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.storage.deleteAll.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.storage.deleteAll.hint")}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          data-testid="storage-delete-all"
          disabled={deleting}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 />
          {t("settings.storage.deleteAll.button")}
        </Button>
      </div>

      {/* Remounted on every open so the two-step flow always starts at
          the scope step (same pattern as the rules' AddRuleDialog). */}
      {deleteOpen && (
        <DeleteAllDataDialog
          key="delete-all-data"
          deleting={deleting}
          onOpenChange={(next) => {
            if (!deleting) setDeleteOpen(next)
          }}
          onConfirm={() => {
            void handleDeleteAll()
          }}
        />
      )}
    </section>
  )
}
