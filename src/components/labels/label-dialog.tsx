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
import { Input } from "@/components/ui/input"
import { Label as FormLabel } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { i18next } from "@/i18n"
import { getExecutor } from "@/services/db/executor"
import type { LabelRow } from "@/services/db/labels"
import type { AccountType } from "@/services/email/types"
import {
  createUserLabel,
  LABEL_SEPARATOR,
  recolorUserLabel,
  renameUserLabel,
} from "@/services/labels/label-admin"
import { notifyUserLabelsChanged } from "@/components/layout/use-sidebar-data"
import { refreshThreadList } from "@/stores/thread-list-store"
import { LabelColorPicker } from "./label-color-picker"

/**
 * Create / rename / recolor dialog for user labels (task 10.4). Every
 * submit runs the local-first label-admin flow (DB row first, server op
 * queued) and then notifies the sidebar's label hook so the list reloads.
 *
 * Create mode offers a parent select (naming the label "Parent/Child")
 * AND a free-form name — a name containing "/" is used as typed, so both
 * routes to a hierarchical label work (mail-organization spec). Rename
 * edits the full name; color mode is a quick palette-only variant.
 */

export type LabelDialogMode = "create" | "rename" | "color"

export interface LabelDialogState {
  mode: LabelDialogMode
  /** The label being edited (rename/color); null in create mode. */
  label?: LabelRow
}

interface LabelDialogProps {
  /** Non-null while the dialog is open (keyed by the sidebar). */
  state: LabelDialogState | null
  /** Active account the label belongs to; null disables the dialog. */
  account: { id: string; type: AccountType } | null
  /** Existing user labels offered as parents (create mode). */
  parentOptions: LabelRow[]
  onOpenChange: (open: boolean) => void
}

const NO_PARENT = "none"

function titleFor(state: LabelDialogState): string {
  switch (state.mode) {
    case "create":
      return i18next.t("labels.dialog.titles.create")
    case "rename":
      return i18next.t("labels.dialog.titles.rename")
    case "color":
      return i18next.t("labels.dialog.titles.color")
  }
}

export function LabelDialog({
  state,
  account,
  parentOptions,
  onOpenChange,
}: LabelDialogProps) {
  const { t } = useTranslation()
  const mode = state?.mode ?? "create"
  const edited = state?.label
  // Initial values come from the edited label; the sidebar keys this
  // component per open (mode + label), so state always starts fresh.
  const [name, setName] = useState(edited?.name ?? "")
  const [parentId, setParentId] = useState(NO_PARENT)
  const [color, setColor] = useState<string | null>(edited?.color ?? null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!state) return null

  const parent =
    parentId !== NO_PARENT
      ? (parentOptions.find((option) => option.id === parentId) ?? null)
      : null
  const fullName =
    parent && !name.includes(LABEL_SEPARATOR)
      ? `${parent.name}${LABEL_SEPARATOR}${name}`
      : name.trim()

  async function handleSubmit(): Promise<void> {
    if (!account) return
    setSaving(true)
    setErrorMessage(null)
    try {
      const executor = getExecutor()
      if (mode === "create") {
        await createUserLabel({
          executor,
          account,
          name,
          ...(parentId !== NO_PARENT ? { parentId } : {}),
          ...(color !== null ? { color } : {}),
        })
      } else if (edited) {
        if (mode === "rename") {
          await renameUserLabel({
            executor,
            account,
            labelId: edited.id,
            name,
          })
        } else {
          await recolorUserLabel({
            executor,
            account,
            labelId: edited.id,
            color,
          })
        }
      }
      notifyUserLabelsChanged()
      // A rename/recolor changes the chips rendered on thread rows — the
      // open list needs a re-read, same as the delete flow.
      void refreshThreadList()
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("labels.dialog.saveFailed")
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titleFor(state)}</DialogTitle>
          {mode === "create" && (
            <DialogDescription>
              {t("labels.dialog.createDescription")}
            </DialogDescription>
          )}
          {mode === "rename" && edited && (
            <DialogDescription>
              <Trans
                i18nKey="labels.dialog.renameDescription"
                values={{ name: edited.name }}
                components={{ name: <span className="font-medium" /> }}
              />
            </DialogDescription>
          )}
          {mode === "color" && edited && (
            <DialogDescription>
              <Trans
                i18nKey="labels.dialog.colorDescription"
                values={{ name: edited.name }}
                components={{ name: <span className="font-medium" /> }}
              />
            </DialogDescription>
          )}
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          {mode !== "color" && (
            <div className="flex flex-col gap-1.5">
              <FormLabel htmlFor="label-name">
                {t("labels.dialog.name")}
              </FormLabel>
              <Input
                id="label-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={mode === "rename" ? edited?.name : undefined}
                autoFocus
                disabled={saving}
              />
              {mode === "create" &&
                fullName.length > 0 &&
                fullName !== name && (
                  <p className="text-xs text-muted-foreground">
                    <Trans
                      i18nKey="labels.dialog.fullName"
                      values={{ name: fullName }}
                      components={{ name: <span className="font-medium" /> }}
                    />
                  </p>
                )}
            </div>
          )}

          {mode === "create" && (
            <div className="flex flex-col gap-1.5">
              <FormLabel htmlFor="label-parent">
                {t("labels.dialog.parent")}
              </FormLabel>
              <Select
                value={parentId}
                onValueChange={(value) => setParentId(String(value))}
                disabled={saving}
              >
                <SelectTrigger id="label-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>
                    {t("labels.dialog.noParent")}
                  </SelectItem>
                  {parentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode !== "rename" && (
            <div className="flex flex-col gap-1.5">
              <FormLabel>{t("labels.dialog.color")}</FormLabel>
              <LabelColorPicker
                value={color}
                onChange={setColor}
                disabled={saving}
              />
            </div>
          )}

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
              {t("labels.dialog.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={saving || (mode !== "color" && !name.trim())}
            >
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {mode === "create"
                ? t("labels.dialog.create")
                : t("labels.dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
