import { useRef, useState } from "react"
import { ArchiveRestore, HardDriveDownload, Loader2 } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  BACKUP_MANIFEST_VERSION,
  BackupError,
  exportBackup,
  inspectBackupArchive,
  pickBackupArchive,
  restoreBackup,
  UnsupportedManifestVersionError,
  type BackupManifestInfo,
  type MergeSummary,
  type RestoreMode,
  type RestoreResult,
} from "@/services/settings/backup"
import { RestoreCancelledError } from "@/services/settings/backup-merge"
import { formatStorageSize } from "@/services/settings/storage"

/**
 * Settings "Backup & restore" section (parity-round-3 task 5.5, design
 * D4). Two rows, structured like the neighboring Storage section:
 *
 * - Export: one button runs the whole pipeline (destination save dialog →
 *   secret-free VACUUM INTO snapshot → Rust tar+gz) via exportBackup()
 *   and reports where the archive landed. A failure is a typed error and
 *   never leaves a partial archive (Rust stages as `.part`).
 * - Restore: the file picker hands the archive to inspectBackupArchive
 *   FIRST — checksums verify and the manifest version gates here, so an
 *   unknown-format or corrupt file refuses before anything else happens.
 *   The dialog then offers the two spec'd behaviors: replace (with the
 *   explicit everything-on-this-device warning) and merge (whose copy
 *   says message bodies are NOT restored). A merge restore stays
 *   cancellable while it runs; the transaction rolls back.
 */

interface RestoreFailure {
  title: string
  detail?: string
}

/** Map the typed errors onto settings-UI copy (kinds are stable). */
function backupFailure(cause: unknown): RestoreFailure {
  // The services' error messages are English (they double as log text);
  // the UI copy is localized here from the typed fields.
  if (cause instanceof UnsupportedManifestVersionError) {
    return {
      title:
        cause.manifestVersion > BACKUP_MANIFEST_VERSION
          ? i18next.t("settings.backup.errors.newerVersion", {
              version: cause.manifestVersion,
            })
          : i18next.t("settings.backup.errors.unreadableVersion", {
              version: cause.manifestVersion,
            }),
    }
  }
  if (cause instanceof RestoreCancelledError) {
    return {
      title: i18next.t("settings.backup.errors.cancelled"),
      detail: i18next.t("settings.backup.errors.cancelledDetail"),
    }
  }
  if (cause instanceof BackupError) {
    switch (cause.kind) {
      case "checksum_mismatch":
      case "corrupt_archive":
      case "missing_entry":
      case "bad_manifest":
        return {
          title: i18next.t("settings.backup.errors.unreadable"),
          detail: i18next.t("settings.backup.errors.unreadableDetail"),
        }
      case "io":
        return {
          title: i18next.t("settings.backup.errors.io"),
          detail: cause.message,
        }
    }
  }
  return {
    title: i18next.t("settings.backup.errors.generic"),
    detail: cause instanceof Error ? cause.message : String(cause),
  }
}

function mergeSummaryLines(summary: MergeSummary): string[] {
  const k = "settings.backup.mergeSummary"
  return [
    i18next.t(`${k}.accountsAdded`, { count: summary.accountsAdded }),
    ...(summary.accountsKept > 0
      ? [i18next.t(`${k}.accountsKept`, { count: summary.accountsKept })]
      : []),
    ...(summary.profilesAdded > 0
      ? [i18next.t(`${k}.profiles`, { count: summary.profilesAdded })]
      : []),
    ...(summary.rulesAdded > 0
      ? [i18next.t(`${k}.rules`, { count: summary.rulesAdded })]
      : []),
    ...(summary.snippetsAdded > 0
      ? [i18next.t(`${k}.snippets`, { count: summary.snippetsAdded })]
      : []),
    ...(summary.savedSearchesAdded > 0
      ? [
          i18next.t(`${k}.savedSearches`, {
            count: summary.savedSearchesAdded,
          }),
        ]
      : []),
    ...(summary.senderCategoriesAdded > 0
      ? [
          i18next.t(`${k}.categoryOverrides`, {
            count: summary.senderCategoriesAdded,
          }),
        ]
      : []),
    ...(summary.settingsAdded > 0
      ? [i18next.t(`${k}.settings`, { count: summary.settingsAdded })]
      : []),
  ]
}

/** The confirm dialog. Remounted per archive (keyed by the section), so
 * the mode choice and step always start fresh. */
function RestoreDialog({
  path,
  manifest,
  restoring,
  onOpenChange,
  onStart,
  onCancelRestore,
}: {
  path: string
  manifest: BackupManifestInfo
  restoring: boolean
  onOpenChange: (open: boolean) => void
  onStart: (mode: RestoreMode) => void
  onCancelRestore: () => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<RestoreMode>("replace")

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-testid="backup-restore-dialog">
        <DialogHeader>
          <DialogTitle>{t("settings.backup.restoreDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.backup.restoreDialog.verified")}
          </DialogDescription>
        </DialogHeader>

        <dl
          data-testid="backup-manifest-facts"
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
        >
          <dt className="text-muted-foreground">
            {t("settings.backup.restoreDialog.format")}
          </dt>
          <dd className="text-foreground">v{manifest.version}</dd>
          {manifest.createdAt && (
            <>
              <dt className="text-muted-foreground">
                {t("settings.backup.restoreDialog.exported")}
              </dt>
              <dd className="text-foreground">
                {new Date(manifest.createdAt).toLocaleString()}
              </dd>
            </>
          )}
          {manifest.appVersion && (
            <>
              <dt className="text-muted-foreground">
                {t("settings.backup.restoreDialog.madeWith")}
              </dt>
              <dd className="text-foreground">Emailer {manifest.appVersion}</dd>
            </>
          )}
        </dl>

        <div className="grid gap-1.5">
          <Label htmlFor="backup-restore-mode">
            {t("settings.backup.restoreDialog.modeLabel")}
          </Label>
          <Select
            value={mode}
            items={{
              replace: t("settings.backup.restoreDialog.replace"),
              merge: t("settings.backup.restoreDialog.merge"),
            }}
            onValueChange={(value) => setMode(value as RestoreMode)}
            disabled={restoring}
          >
            <SelectTrigger id="backup-restore-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="replace">
                {t("settings.backup.restoreDialog.replace")}
              </SelectItem>
              <SelectItem value="merge">
                {t("settings.backup.restoreDialog.merge")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "replace" ? (
          <p
            data-testid="backup-mode-warning"
            className="text-sm text-destructive"
          >
            {t("settings.backup.restoreDialog.replaceWarning")}
          </p>
        ) : (
          <p
            data-testid="backup-mode-warning"
            className="text-sm text-muted-foreground"
          >
            {t("settings.backup.restoreDialog.mergeWarning")}
          </p>
        )}

        <DialogFooter>
          {restoring ? (
            <>
              <span
                className="mr-auto inline-flex items-center gap-2 text-sm text-muted-foreground"
                aria-live="polite"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("settings.backup.restoreDialog.restoring")}
              </span>
              {mode === "merge" && (
                <Button
                  variant="outline"
                  data-testid="backup-cancel-restore"
                  onClick={onCancelRestore}
                >
                  {t("settings.backup.restoreDialog.cancelRestore")}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="backup-cancel"
              >
                {t("settings.backup.restoreDialog.cancel")}
              </Button>
              <Button
                variant={mode === "replace" ? "destructive" : "default"}
                data-testid="backup-start"
                onClick={() => onStart(mode)}
              >
                <ArchiveRestore />
                {t("settings.backup.restoreDialog.start", {
                  file: path.split("/").pop()?.split("\\").pop(),
                })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type RestoreStep =
  | { kind: "idle" }
  | { kind: "inspecting" }
  | { kind: "confirming"; path: string; manifest: BackupManifestInfo }
  | {
      kind: "restoring"
      path: string
      manifest: BackupManifestInfo
      mode: RestoreMode
    }
  | { kind: "done"; result: RestoreResult }
  | { kind: "failed"; failure: RestoreFailure }

export function BackupSection() {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<{
    path: string
    bytes: number
  } | null>(null)
  const [restore, setRestore] = useState<RestoreStep>({ kind: "idle" })
  // Merge restores run row-by-row inside one transaction; flipping this
  // flag makes the next check throw and the whole merge roll back.
  const cancelSignal = useRef({ aborted: false })

  async function handleExport(): Promise<void> {
    setExporting(true)
    setExported(null)
    try {
      const result = await exportBackup()
      if (result) {
        setExported({ path: result.path, bytes: result.bytes })
      }
    } catch (cause) {
      console.warn("[settings] backup export failed", cause)
      toast.error(i18next.t("settings.backup.exportFailed"), {
        description: backupFailure(cause).title,
      })
    } finally {
      setExporting(false)
    }
  }

  async function handleRestorePick(): Promise<void> {
    const path = await pickBackupArchive()
    if (!path) return
    setExported(null)
    setRestore({ kind: "inspecting" })
    try {
      // The typed gate: checksums verify and the manifest version is
      // refused HERE, before the restore dialog even opens.
      const manifest = await inspectBackupArchive(path)
      setRestore({ kind: "confirming", path, manifest })
    } catch (cause) {
      console.warn("[settings] backup inspect failed", cause)
      setRestore({ kind: "failed", failure: backupFailure(cause) })
    }
  }

  async function handleStartRestore(mode: RestoreMode): Promise<void> {
    if (restore.kind !== "confirming") return
    const { path, manifest } = restore
    cancelSignal.current = { aborted: false }
    setRestore({ kind: "restoring", path, manifest, mode })
    try {
      const result = await restoreBackup(path, mode, {
        signal: cancelSignal.current,
      })
      setRestore({ kind: "done", result })
    } catch (cause) {
      console.warn("[settings] backup restore failed", cause)
      setRestore({ kind: "failed", failure: backupFailure(cause) })
    }
  }

  return (
    <section
      aria-label={t("settings.backup.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settings.backup.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.backup.description")}
        </p>
      </div>

      <div className="flex items-center justify-between gap-6">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.backup.export.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.backup.export.hint")}
          </p>
          {exported && (
            <p
              data-testid="backup-export-status"
              className="text-xs text-foreground"
              aria-live="polite"
            >
              {t("settings.backup.export.done", {
                path: exported.path,
                size: formatStorageSize(exported.bytes),
              })}
            </p>
          )}
        </div>
        <Button
          size="sm"
          data-testid="backup-export"
          disabled={exporting}
          onClick={() => {
            void handleExport()
          }}
        >
          {exporting ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <HardDriveDownload />
          )}
          {t("settings.backup.export.button")}
        </Button>
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-6">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.backup.restore.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.backup.restore.hint")}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          data-testid="backup-restore"
          disabled={restore.kind === "inspecting"}
          onClick={() => {
            void handleRestorePick()
          }}
        >
          {restore.kind === "inspecting" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <ArchiveRestore />
          )}
          {t("settings.backup.restore.button")}
        </Button>
      </div>

      {restore.kind === "failed" && (
        <div role="alert" className="grid gap-0.5" data-testid="backup-error">
          <p className="text-sm text-destructive">{restore.failure.title}</p>
          {restore.failure.detail && (
            <p className="text-xs text-muted-foreground">
              {restore.failure.detail}
            </p>
          )}
        </div>
      )}

      {restore.kind === "done" && (
        <div
          data-testid="backup-result"
          className="grid gap-1"
          aria-live="polite"
        >
          {restore.result.mode === "replace" ? (
            <p className="text-sm text-foreground">
              {t("settings.backup.restore.replaceDone", {
                count: restore.result.accountsRequiringReauth,
              })}
            </p>
          ) : (
            <>
              <p className="text-sm text-foreground">
                {t("settings.backup.restore.mergeDone", {
                  items: mergeSummaryLines(restore.result.summary).join(", "),
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.backup.restore.mergeNote")}
              </p>
            </>
          )}
        </div>
      )}

      {/* Mounted from the confirm step THROUGH the restore: one dialog
          instance keeps the mode choice and the manifest facts while the
          footer flips to the in-flight state. */}
      {(restore.kind === "confirming" || restore.kind === "restoring") && (
        <RestoreDialog
          key={restore.path}
          path={restore.path}
          manifest={restore.manifest}
          restoring={restore.kind === "restoring"}
          onOpenChange={(open) => {
            if (!open && restore.kind === "confirming") {
              setRestore({ kind: "idle" })
            }
          }}
          onStart={(mode) => {
            void handleStartRestore(mode)
          }}
          onCancelRestore={() => {
            cancelSignal.current.aborted = true
          }}
        />
      )}
    </section>
  )
}
