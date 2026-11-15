import { useCallback, useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"

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
import { getExecutor } from "@/services/db/executor"
import { i18next } from "@/i18n"
import {
  createQuickStep,
  deleteQuickStep,
  listQuickSteps,
  QUICK_STEP_SHORTCUTS,
  reorderQuickSteps,
  SNOOZE_PRESET_IDS,
  updateQuickStep,
  type QuickStep,
  type QuickStepAction,
  type QuickStepResult,
  type QuickStepSnoozePresetId,
} from "@/services/settings/quick-steps"

/**
 * Settings "Quick steps" section (task 3.2, design D13): manages the
 * account-agnostic action chains stored under `organization.quickSteps`
 * (task 3.1's service — this section is the only writer). Rows show the
 * name, one chip per action in chain order, the optional digit shortcut,
 * up/down ordering controls (a neighbor swap through
 * reorderQuickSteps), edit and delete (no confirm — a quick step is a
 * recipe, trivially re-created, matching the rules section).
 *
 * The add/edit dialog holds the chain builder: actions are added IN
 * ORDER (order matters — the spec's "actions that remove mail from the
 * inbox execute in order", e.g. add-label before archive), each row
 * carrying a kind select plus the per-kind field (label NAME — resolved
 * per account at run time, folder path, snooze preset, read/unread).
 * The spec's chain shape (two or more actions) is enforced by the
 * service and mirrored here: Save stays disabled below two actions.
 * Shortcuts are plain digits 1–9 (see quick-steps.ts for why not the
 * fixed binding registry); digits taken by other steps are disabled in
 * the picker, and a collision that slips through is rejected by the
 * service ("shortcut-taken") and surfaced as a form error.
 */

type DialogTarget = { mode: "add" } | { mode: "edit"; step: QuickStep }

/** Human labels for the snooze preset ids (the run-time presets carry
 * the same names; here they are static builder copy). Getters reuse the
 * snooze menu's preset names, localized at read time. */
const SNOOZE_PRESET_LABELS: Readonly<Record<QuickStepSnoozePresetId, string>> =
  {
    get later_today() {
      return i18next.t("snooze.presets.laterToday")
    },
    get tomorrow() {
      return i18next.t("settingsMail.quickSteps.snoozeTomorrow")
    },
    get next_week() {
      return i18next.t("snooze.presets.nextWeek")
    },
  }

/** The builder's kind vocabulary: mark_read splits into read/unread (a
 * "Mark unread" entry is friendlier than a toggle field). */
type BuilderKind =
  | "archive"
  | "add_label"
  | "remove_label"
  | "star"
  | "mark_read"
  | "mark_unread"
  | "mark_done"
  | "trash"
  | "move_to_folder"
  | "snooze"

const BUILDER_KIND_LABELS: Readonly<Record<BuilderKind, string>> = {
  get archive() {
    return i18next.t("settingsMail.quickSteps.kinds.archive")
  },
  get add_label() {
    return i18next.t("settingsMail.quickSteps.kinds.addLabel")
  },
  get remove_label() {
    return i18next.t("settingsMail.quickSteps.kinds.removeLabel")
  },
  get star() {
    return i18next.t("settingsMail.quickSteps.kinds.star")
  },
  get mark_read() {
    return i18next.t("settingsMail.quickSteps.kinds.markRead")
  },
  get mark_unread() {
    return i18next.t("settingsMail.quickSteps.kinds.markUnread")
  },
  get mark_done() {
    return i18next.t("settingsMail.quickSteps.kinds.markDone")
  },
  get trash() {
    return i18next.t("settingsMail.quickSteps.kinds.trash")
  },
  get move_to_folder() {
    return i18next.t("settingsMail.quickSteps.kinds.moveToFolder")
  },
  get snooze() {
    return i18next.t("settingsMail.quickSteps.kinds.snooze")
  },
}

function builderKindOf(action: QuickStepAction): BuilderKind {
  if (action.kind === "mark_read")
    return action.read ? "mark_read" : "mark_unread"
  return action.kind
}

function defaultActionFor(kind: BuilderKind): QuickStepAction {
  switch (kind) {
    case "add_label":
    case "remove_label":
      return { kind, label: "" }
    case "move_to_folder":
      return { kind, folderPath: "" }
    case "snooze":
      return { kind, presetId: "tomorrow" }
    case "mark_read":
      return { kind, read: true }
    case "mark_unread":
      return { kind: "mark_read", read: false }
    default:
      return { kind }
  }
}

/** One-line chip text for an action (row display; the builder shows the
 * fields instead). */
function quickStepActionChip(action: QuickStepAction): string {
  switch (action.kind) {
    case "archive":
      return BUILDER_KIND_LABELS.archive
    case "star":
      return BUILDER_KIND_LABELS.star
    case "mark_done":
      return BUILDER_KIND_LABELS.mark_done
    case "trash":
      return BUILDER_KIND_LABELS.trash
    case "mark_read":
      return action.read
        ? BUILDER_KIND_LABELS.mark_read
        : BUILDER_KIND_LABELS.mark_unread
    case "add_label":
      return i18next.t("settingsMail.quickSteps.chips.addLabel", {
        label: action.label,
      })
    case "remove_label":
      return i18next.t("settingsMail.quickSteps.chips.removeLabel", {
        label: action.label,
      })
    case "move_to_folder":
      return `→ ${action.folderPath}`
    case "snooze":
      return i18next.t("settingsMail.quickSteps.chips.snooze", {
        preset: SNOOZE_PRESET_LABELS[action.presetId],
      })
  }
}

/** Typed mutation errors → dialog copy (the service owns the rules; the
 * dialog only renders them). */
const RESULT_ERRORS: Readonly<
  Record<Exclude<QuickStepResult, { ok: true }>["error"], string>
> = {
  get "name-required"() {
    return i18next.t("settingsMail.quickSteps.errors.nameRequired")
  },
  get "name-taken"() {
    return i18next.t("settingsMail.quickSteps.errors.nameTaken")
  },
  get "min-two-actions"() {
    return i18next.t("settingsMail.quickSteps.errors.minTwoActions")
  },
  get "not-found"() {
    return i18next.t("settingsMail.quickSteps.errors.notFound")
  },
  get "shortcut-invalid"() {
    return i18next.t("settingsMail.quickSteps.errors.shortcutInvalid")
  },
  get "shortcut-taken"() {
    return i18next.t("settingsMail.quickSteps.errors.shortcutTaken")
  },
}

function QuickStepDialog({
  target,
  steps,
  onOpenChange,
  onSaved,
}: {
  target: DialogTarget
  /** Every step in the list — the shortcut picker disables digits taken
   * by steps OTHER than the one being edited. */
  steps: QuickStep[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const editing = target.mode === "edit" ? target.step : null
  const [name, setName] = useState(editing?.name ?? "")
  const [actions, setActions] = useState<QuickStepAction[]>(
    editing?.actions ?? []
  )
  const [shortcut, setShortcut] = useState<string>(editing?.shortcut ?? "")
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // The "Add action" picker is remounted after each append so its value
  // resets — picking the same kind twice in a row must keep working.
  const [addKey, setAddKey] = useState(0)

  // Other steps' shortcuts — disabled in the picker so a collision is
  // unpickable (the service still rejects one that slips through).
  const takenShortcuts = new Map(
    steps
      .filter((step) => step.id !== editing?.id && step.shortcut)
      .map((step) => [step.shortcut!, step.name])
  )

  const paramsComplete = actions.every((action) => {
    if (action.kind === "add_label" || action.kind === "remove_label") {
      return action.label.trim() !== ""
    }
    if (action.kind === "move_to_folder") return action.folderPath.trim() !== ""
    return true
  })
  const canSave =
    name.trim() !== "" && actions.length >= 2 && paramsComplete && !saving

  function patchAction(index: number, next: QuickStepAction): void {
    setActions((previous) =>
      previous.map((action, i) => (i === index ? next : action))
    )
  }

  function moveAction(index: number, direction: -1 | 1): void {
    setActions((previous) => {
      const neighbor = index + direction
      if (neighbor < 0 || neighbor >= previous.length) return previous
      const next = [...previous]
      const [moved] = next.splice(index, 1)
      if (moved) next.splice(neighbor, 0, moved)
      return next
    })
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setErrorMessage(null)
    try {
      const executor = getExecutor()
      const result = editing
        ? await updateQuickStep(executor, editing.id, {
            name: name.trim(),
            actions,
            shortcut: shortcut === "" ? null : shortcut,
          })
        : await createQuickStep(executor, {
            name: name.trim(),
            actions,
            shortcut: shortcut === "" ? null : shortcut,
          })
      if (!result.ok) {
        setErrorMessage(RESULT_ERRORS[result.error])
        setSaving(false)
        return
      }
      onSaved()
      onOpenChange(false)
    } catch (error) {
      console.warn("[settings] failed to save quick step", error)
      setErrorMessage(t("settingsMail.quickSteps.saveFailed"))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t("settingsMail.quickSteps.editTitle")
              : t("settingsMail.quickSteps.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settingsMail.quickSteps.dialogDescription")}
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
            <Label htmlFor="quick-step-name">
              {t("settingsMail.quickSteps.name")}
            </Label>
            <Input
              id="quick-step-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settingsMail.quickSteps.namePlaceholder")}
              autoFocus
            />
          </div>
          <div className="grid gap-2" data-testid="quick-step-action-builder">
            <Label>{t("settingsMail.quickSteps.actions")}</Label>
            {actions.map((action, index) => {
              const kind = builderKindOf(action)
              return (
                <div
                  key={index}
                  data-testid={`quick-step-action-row-${index}`}
                  className="flex flex-col gap-2 rounded-lg border p-2"
                >
                  <div className="flex items-center gap-1">
                    <Select
                      value={kind}
                      onValueChange={(value) => {
                        patchAction(
                          index,
                          defaultActionFor(value as BuilderKind)
                        )
                      }}
                    >
                      <SelectTrigger
                        className="min-w-36 flex-1"
                        aria-label={t("settingsMail.quickSteps.actionType", {
                          index: index + 1,
                        })}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.keys(BUILDER_KIND_LABELS) as BuilderKind[]
                        ).map((candidate) => (
                          <SelectItem key={candidate} value={candidate}>
                            {BUILDER_KIND_LABELS[candidate]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("settingsMail.quickSteps.moveActionUp", {
                        index: index + 1,
                      })}
                      disabled={index === 0}
                      onClick={() => moveAction(index, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("settingsMail.quickSteps.moveActionDown", {
                        index: index + 1,
                      })}
                      disabled={index === actions.length - 1}
                      onClick={() => moveAction(index, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("settingsMail.quickSteps.removeAction", {
                        index: index + 1,
                      })}
                      onClick={() =>
                        setActions((previous) =>
                          previous.filter((_, i) => i !== index)
                        )
                      }
                    >
                      <X />
                    </Button>
                  </div>
                  {(action.kind === "add_label" ||
                    action.kind === "remove_label") && (
                    <Input
                      value={action.label}
                      onChange={(event) =>
                        patchAction(index, {
                          ...action,
                          label: event.target.value,
                        })
                      }
                      placeholder={t("settingsMail.quickSteps.labelName")}
                      aria-label={t("settingsMail.quickSteps.actionLabelName", {
                        index: index + 1,
                      })}
                    />
                  )}
                  {action.kind === "move_to_folder" && (
                    <Input
                      value={action.folderPath}
                      onChange={(event) =>
                        patchAction(index, {
                          ...action,
                          folderPath: event.target.value,
                        })
                      }
                      placeholder={t("settingsMail.quickSteps.folderPath")}
                      aria-label={t(
                        "settingsMail.quickSteps.actionFolderPath",
                        {
                          index: index + 1,
                        }
                      )}
                      className="font-mono"
                    />
                  )}
                  {action.kind === "snooze" && (
                    <Select
                      value={action.presetId}
                      onValueChange={(value) => {
                        patchAction(index, {
                          ...action,
                          presetId: value as QuickStepSnoozePresetId,
                        })
                      }}
                    >
                      <SelectTrigger
                        aria-label={t(
                          "settingsMail.quickSteps.actionSnoozePreset",
                          {
                            index: index + 1,
                          }
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SNOOZE_PRESET_IDS.map((presetId) => (
                          <SelectItem key={presetId} value={presetId}>
                            {SNOOZE_PRESET_LABELS[presetId]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )
            })}
            <Select
              key={addKey}
              onValueChange={(value) => {
                setActions((previous) => [
                  ...previous,
                  defaultActionFor(value as BuilderKind),
                ])
                setAddKey((key) => key + 1)
              }}
            >
              <SelectTrigger
                aria-label={t("settingsMail.quickSteps.addActionAria")}
                className="w-full"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Plus className="size-4" aria-hidden />
                  {t("settingsMail.quickSteps.addAction")}
                </span>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BUILDER_KIND_LABELS) as BuilderKind[]).map(
                  (candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {BUILDER_KIND_LABELS[candidate]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            {actions.length < 2 && (
              <p className="text-xs text-muted-foreground">
                {t("settingsMail.quickSteps.errors.minTwoActions")}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quick-step-shortcut">
              {t("settingsMail.quickSteps.shortcut")}
            </Label>
            <Select
              value={shortcut === "" ? "none" : shortcut}
              onValueChange={(value) => {
                setShortcut(value === "none" || value === null ? "" : value)
              }}
            >
              <SelectTrigger id="quick-step-shortcut" className="w-40">
                <SelectValue placeholder={t("settingsMail.quickSteps.none")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t("settingsMail.quickSteps.none")}
                </SelectItem>
                {QUICK_STEP_SHORTCUTS.map((digit) => {
                  const owner = takenShortcuts.get(digit)
                  return (
                    <SelectItem key={digit} value={digit} disabled={!!owner}>
                      {owner
                        ? t("settingsMail.quickSteps.shortcutUsedBy", {
                            digit,
                            owner,
                          })
                        : digit}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("settingsMail.quickSteps.shortcutHelp")}
            </p>
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
              {t("settingsMail.quickSteps.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {editing
                ? t("settingsMail.quickSteps.saveChanges")
                : t("settingsMail.quickSteps.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QuickStepRowItem({
  step,
  isFirst,
  isLast,
  onMove,
  onEdit,
  onDelete,
}: {
  step: QuickStep
  isFirst: boolean
  isLast: boolean
  onMove: (step: QuickStep, direction: -1 | 1) => void
  onEdit: (step: QuickStep) => void
  onDelete: (step: QuickStep) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="settings-quick-step-row"
      className="flex items-start gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {step.name}
          </p>
          {step.shortcut && (
            <kbd
              data-testid={`quick-step-shortcut-${step.shortcut}`}
              className="inline-flex min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground"
            >
              {step.shortcut}
            </kbd>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {step.actions.map((action, index) => (
            <Badge
              key={`${action.kind}-${index}`}
              variant="outline"
              className="font-normal"
            >
              {quickStepActionChip(action)}
            </Badge>
          ))}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("settingsMail.quickSteps.moveUp", { name: step.name })}
        disabled={isFirst}
        onClick={() => onMove(step, -1)}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("settingsMail.quickSteps.moveDown", { name: step.name })}
        disabled={isLast}
        onClick={() => onMove(step, 1)}
      >
        <ChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsMail.quickSteps.editAria", { name: step.name })}
        onClick={() => onEdit(step)}
      >
        <Pencil />
        {t("settingsMail.quickSteps.edit")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsMail.quickSteps.deleteAria", {
          name: step.name,
        })}
        onClick={() => onDelete(step)}
      >
        <Trash2 />
        {t("settingsMail.quickSteps.delete")}
      </Button>
    </div>
  )
}

export function QuickStepsSection() {
  const { t } = useTranslation()
  const [steps, setSteps] = useState<QuickStep[]>([])
  const [dialog, setDialog] = useState<DialogTarget | null>(null)

  const reload = useCallback(() => {
    try {
      void listQuickSteps(getExecutor())
        .then(setSteps)
        .catch((error) => {
          console.warn("[settings] failed to load quick steps", error)
        })
    } catch (error) {
      console.warn("[settings] failed to load quick steps", error)
    }
  }, [])

  // The shell only mounts settings after bootstrap(), so the executor is
  // available (same assumption as the other sections).
  useEffect(reload, [reload])

  /** Neighbor swap (the rules-section pattern) through the service's
   * partial reorder: two ids, everything else keeps its relative slot. */
  async function handleMove(step: QuickStep, direction: -1 | 1): Promise<void> {
    const index = steps.findIndex((candidate) => candidate.id === step.id)
    const neighborIndex = index + direction
    if (index === -1 || neighborIndex < 0 || neighborIndex >= steps.length) {
      return
    }
    const neighbor = steps[neighborIndex]!
    try {
      await reorderQuickSteps(
        getExecutor(),
        direction === -1 ? [step.id, neighbor.id] : [neighbor.id, step.id]
      )
      reload()
    } catch (error) {
      console.warn("[settings] failed to reorder quick steps", error)
    }
  }

  async function handleDelete(step: QuickStep): Promise<void> {
    try {
      await deleteQuickStep(getExecutor(), step.id)
      reload()
    } catch (error) {
      console.warn("[settings] failed to delete quick step", error)
    }
  }

  return (
    <section
      aria-label={t("settingsMail.quickSteps.title")}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t("settingsMail.quickSteps.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settingsMail.quickSteps.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog({ mode: "add" })}>
          <ListChecks />
          {t("settingsMail.quickSteps.add")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settingsMail.quickSteps.help")}
      </p>
      <Separator />
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.quickSteps.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {steps.map((step, index) => (
            <QuickStepRowItem
              key={step.id}
              step={step}
              isFirst={index === 0}
              isLast={index === steps.length - 1}
              onMove={(target, direction) => {
                void handleMove(target, direction)
              }}
              onEdit={(target) => setDialog({ mode: "edit", step: target })}
              onDelete={(target) => {
                void handleDelete(target)
              }}
            />
          ))}
        </div>
      )}
      {/* Remounted on every open so the form always starts fresh. */}
      {dialog && (
        <QuickStepDialog
          key={dialog.mode === "edit" ? `edit-${dialog.step.id}` : "add"}
          target={dialog}
          steps={steps}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onSaved={reload}
        />
      )}
    </section>
  )
}
