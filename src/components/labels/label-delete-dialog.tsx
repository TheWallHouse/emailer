import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"

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
import type { LabelRow } from "@/services/db/labels"
import type { AccountType } from "@/services/email/types"
import { deleteUserLabel } from "@/services/labels/label-admin"
import { notifyUserLabelsChanged } from "@/components/layout/use-sidebar-data"
import { refreshThreadList } from "@/stores/thread-list-store"

/**
 * Delete-label confirmation (task 10.4): names the label, states what the
 * delete removes, and only deletes on the destructive confirm. Runs the
 * local-first deleteUserLabel flow (row removed + server delete queued)
 * and notifies the sidebar's label hook afterwards. The host remounts
 * this component per open so error/in-flight state starts fresh.
 */
export function LabelDeleteDialog({
  label,
  account,
  onOpenChange,
}: {
  label: LabelRow | null
  account: { id: string; type: AccountType } | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleConfirm(): Promise<void> {
    if (!label || !account) return
    setDeleting(true)
    setErrorMessage(null)
    try {
      await deleteUserLabel({
        executor: getExecutor(),
        account,
        labelId: label.id,
      })
      notifyUserLabelsChanged()
      // The delete stripped this label from every local thread — the open
      // list's label chips are stale until a re-read (the sidebar notify
      // above covers only the label section).
      void refreshThreadList()
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("labels.deleteDialog.deleteFailed")
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog
      open={label !== null}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next)
      }}
    >
      {label && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("labels.deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey={
                  label.imap_folder_name
                    ? "labels.deleteDialog.descriptionFolder"
                    : "labels.deleteDialog.description"
                }
                values={{ name: label.name }}
                components={{ name: <span className="font-medium" /> }}
              />
            </DialogDescription>
          </DialogHeader>
          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={deleting}
            >
              {t("labels.deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirm()
              }}
              disabled={deleting}
            >
              {deleting && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {t("labels.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
