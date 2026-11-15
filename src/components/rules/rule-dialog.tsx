import { useState } from "react"
import { CirclePlus, Loader2, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { getExecutor } from "@/services/db/executor"
import type {
  Category,
  RuleAction,
  RuleActionType,
  RuleRow,
} from "@/services/rules"
import { CATEGORIES } from "@/services/rules"
import { createRule, parseActionsJson, updateRule } from "@/services/rules"

import {
  ACTION_TYPE_OPTIONS,
  CATEGORY_LABELS,
  criteriaHelp,
  queryFromCriteriaJson,
} from "./rule-actions-ui"
import {
  composeCriteriaQuery,
  criteriaFieldsFromQuery,
  emptyCriteriaFields,
  type CriteriaFields,
} from "./rule-criteria"

/**
 * The add/edit rule dialog, shared by the Settings rules section and the
 * search row's "create filter with this search" affordance. Criteria are
 * a Gmail-style FORM (design D10): labeled rows compose into the same
 * query language the search box takes (services/search/parser.ts is the
 * single source of truth — the form is a compiler on top of it), stored
 * unchanged in criteria_json. The raw query input remains behind the
 * "Advanced query" checkbox, and a query the form can't represent
 * (labels, is: flags, negated operators, multiple bounds, or values the
 * form would rewrite — see rule-criteria.ts) opens in advanced mode
 * with it verbatim. See the rules-section module comment for the row
 * semantics.
 */

/** "Newsletters, Receipts" → ["Newsletters", "Receipts"] — trimmed,
 * empties dropped. */
function splitLabels(input: string): string[] {
  return input
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
}

/** One action row in the dialog's local draft state — the type-specific
 * payloads (labels, folder, category) ride along as raw strings, split/
 * trimmed only at save time. */
interface ActionDraft {
  key: string
  type: RuleActionType
  labels: string
  folder: string
  category: string
}

let draftKeySequence = 0

function nextDraftKey(): string {
  draftKeySequence += 1
  return `action-${draftKeySequence}`
}

function newActionDraft(type: RuleActionType = "archive"): ActionDraft {
  return {
    key: nextDraftKey(),
    type,
    labels: "",
    folder: "",
    category: "primary",
  }
}

function draftsFromActions(actions: RuleAction[]): ActionDraft[] {
  if (actions.length === 0) return [newActionDraft()]
  return actions.map((action) => ({
    key: nextDraftKey(),
    type: action.type,
    labels: (action.labels ?? []).join(", "),
    folder: action.folder ?? "",
    // parseActionsJson only admits known categories; default for safety.
    category: action.category ?? "primary",
  }))
}

export type RuleDialogTarget = { mode: "add" } | { mode: "edit"; rule: RuleRow }

/** The dialog's initial criteria state: a query that maps onto the form
 * prefills the labeled rows; anything else (or nothing) is handled by the
 * caller — an unrepresentable query opens in advanced mode verbatim. */
function initialCriteriaState(rawQuery: string): {
  fields: CriteriaFields
  criteria: string
  advanced: boolean
} {
  if (rawQuery.trim() === "") {
    return { fields: emptyCriteriaFields(), criteria: "", advanced: false }
  }
  const { fields, unrepresentable } = criteriaFieldsFromQuery(rawQuery)
  return {
    fields,
    criteria: rawQuery,
    advanced: unrepresentable,
  }
}

export function RuleDialog({
  accountId,
  target,
  initialCriteria = "",
  initialName = "",
  initialActions,
  onOpenChange,
  onSaved,
}: {
  accountId: string
  target: RuleDialogTarget
  /** Criteria the form starts from in add mode — the search row prefills
   * it with the active query; Settings adds with it empty. */
  initialCriteria?: string
  /** Add-mode prefill for the rule name (parity-round-2 task 2.5: the
   * natural-language candidate's translated name). */
  initialName?: string
  /** Add-mode prefill for the action rows (task 2.5: the translated
   * candidate's actions, all pre-validated by the rule-assist service).
   * Empty/omitted starts with one default row, as before. */
  initialActions?: RuleAction[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const editing = target.mode === "edit" ? target.rule : null
  const [name, setName] = useState(editing?.name ?? initialName)
  const initial = initialCriteriaState(
    editing ? queryFromCriteriaJson(editing.criteria_json) : initialCriteria
  )
  const [fields, setFields] = useState<CriteriaFields>(initial.fields)
  const [criteria, setCriteria] = useState(initial.criteria)
  const [advanced, setAdvanced] = useState(initial.advanced)
  const [drafts, setDrafts] = useState<ActionDraft[]>(() =>
    draftsFromActions(
      editing ? parseActionsJson(editing.actions_json) : (initialActions ?? [])
    )
  )
  const [enabled, setEnabled] = useState(editing ? editing.enabled === 1 : true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const criteriaQuery = advanced
    ? criteria.trim()
    : composeCriteriaQuery(fields)
  const labelActionsFilled = drafts.every(
    (draft) =>
      (draft.type !== "add_labels" && draft.type !== "remove_labels") ||
      splitLabels(draft.labels).length > 0
  )
  const moveFoldersFilled = drafts.every(
    (draft) => draft.type !== "move" || draft.folder.trim() !== ""
  )
  const canSave =
    name.trim() !== "" &&
    criteriaQuery !== null &&
    criteriaQuery !== "" &&
    drafts.length > 0 &&
    labelActionsFilled &&
    moveFoldersFilled &&
    !saving

  function updateDraft(key: string, patch: Partial<ActionDraft>): void {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft
      )
    )
  }

  function removeDraft(key: string): void {
    setDrafts((current) => current.filter((draft) => draft.key !== key))
  }

  function updateFields(patch: Partial<CriteriaFields>): void {
    setFields((current) => ({ ...current, ...patch }))
  }

  /** form → advanced carries the composed query; advanced → form maps what
   * it can (unmappable tokens would be lost, so unmappable queries are the
   * mode the dialog already opened in and the checkbox is how the user
   * got here in the first place). */
  function toggleAdvanced(next: boolean): void {
    if (next) {
      setCriteria(composeCriteriaQuery(fields) ?? "")
    } else {
      setFields(criteriaFieldsFromQuery(criteria).fields)
    }
    setAdvanced(next)
  }

  async function handleSave(): Promise<void> {
    if (!canSave || criteriaQuery === null) return
    setSaving(true)
    setErrorMessage(null)
    const actions: RuleAction[] = drafts.map((draft) => {
      if (draft.type === "add_labels" || draft.type === "remove_labels") {
        return { type: draft.type, labels: splitLabels(draft.labels) }
      }
      if (draft.type === "move") {
        return { type: draft.type, folder: draft.folder.trim() }
      }
      if (draft.type === "set_category") {
        return { type: draft.type, category: draft.category as Category }
      }
      return { type: draft.type }
    })
    try {
      const executor = getExecutor()
      if (editing) {
        await updateRule(executor, editing.id, {
          name: name.trim(),
          criteriaQuery,
          actions,
          enabled,
        })
        toast.success(
          t("settingsMail.ruleDialog.updated", { name: name.trim() })
        )
      } else {
        await createRule(executor, {
          accountId,
          name: name.trim(),
          criteriaQuery,
          actions,
          enabled,
        })
        toast.success(
          t("settingsMail.ruleDialog.created", { name: name.trim() })
        )
      }
      onSaved()
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("settingsMail.ruleDialog.saveFailed")
      )
      setSaving(false)
    }
  }

  const criteriaRows = (
    <>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <Label htmlFor="crit-from">{t("settingsMail.ruleDialog.from")}</Label>
        <Input
          id="crit-from"
          value={fields.from}
          onChange={(event) => updateFields({ from: event.target.value })}
          placeholder={t("settingsMail.ruleDialog.fromPlaceholder")}
        />
      </div>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <Label htmlFor="crit-to">{t("settingsMail.ruleDialog.to")}</Label>
        <Input
          id="crit-to"
          value={fields.to}
          onChange={(event) => updateFields({ to: event.target.value })}
          placeholder={t("settingsMail.ruleDialog.toPlaceholder")}
        />
      </div>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <Label htmlFor="crit-subject">
          {t("settingsMail.ruleDialog.subject")}
        </Label>
        <Input
          id="crit-subject"
          value={fields.subject}
          onChange={(event) => updateFields({ subject: event.target.value })}
          placeholder={t("settingsMail.ruleDialog.subjectPlaceholder")}
        />
      </div>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <Label htmlFor="crit-has-words">
          {t("settingsMail.ruleDialog.hasWords")}
        </Label>
        <Input
          id="crit-has-words"
          value={fields.hasWords}
          onChange={(event) => updateFields({ hasWords: event.target.value })}
          placeholder={t("settingsMail.ruleDialog.hasWordsPlaceholder")}
        />
      </div>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <Label htmlFor="crit-doesnt-have">
          {t("settingsMail.ruleDialog.doesntHave")}
        </Label>
        <Input
          id="crit-doesnt-have"
          value={fields.doesntHave}
          onChange={(event) => updateFields({ doesntHave: event.target.value })}
          placeholder={t("settingsMail.ruleDialog.doesntHavePlaceholder")}
        />
      </div>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <Label htmlFor="crit-size-value">
          {t("settingsMail.ruleDialog.size")}
        </Label>
        <div className="flex items-center gap-2">
          <Select
            value={fields.sizeDirection}
            onValueChange={(value) =>
              updateFields({
                sizeDirection: value === "smaller" ? "smaller" : "larger",
              })
            }
          >
            <SelectTrigger
              aria-label={t("settingsMail.ruleDialog.sizeComparison")}
              className="w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="larger">
                {t("settingsMail.ruleDialog.greaterThan")}
              </SelectItem>
              <SelectItem value="smaller">
                {t("settingsMail.ruleDialog.lessThan")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Input
            id="crit-size-value"
            type="number"
            min="0"
            value={fields.sizeValue}
            onChange={(event) =>
              updateFields({ sizeValue: event.target.value })
            }
            className="w-24"
            aria-label={t("settingsMail.ruleDialog.sizeValue")}
          />
          <Select
            value={fields.sizeUnit}
            onValueChange={(value) =>
              updateFields({ sizeUnit: value === "kb" ? "kb" : "mb" })
            }
          >
            <SelectTrigger
              aria-label={t("settingsMail.ruleDialog.sizeUnit")}
              className="w-20"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mb">MB</SelectItem>
              <SelectItem value="kb">KB</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
        <Label htmlFor="crit-date-value">
          {t("settingsMail.ruleDialog.arrived")}
        </Label>
        <div className="flex items-center gap-2">
          <Select
            value={fields.dateDirection}
            onValueChange={(value) =>
              updateFields({
                dateDirection: value === "after" ? "after" : "before",
              })
            }
          >
            <SelectTrigger
              aria-label={t("settingsMail.ruleDialog.dateDirection")}
              className="w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="before">
                {t("settingsMail.ruleDialog.before")}
              </SelectItem>
              <SelectItem value="after">
                {t("settingsMail.ruleDialog.after")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Input
            id="crit-date-value"
            type="date"
            value={fields.dateValue}
            onChange={(event) =>
              updateFields({ dateValue: event.target.value })
            }
            aria-label={t("settingsMail.ruleDialog.date")}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="crit-has-attachment"
          checked={fields.hasAttachment}
          onCheckedChange={(checked) => {
            updateFields({ hasAttachment: checked === true })
          }}
        />
        <Label htmlFor="crit-has-attachment">
          {t("settingsMail.ruleDialog.hasAttachment")}
        </Label>
      </div>
    </>
  )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* wider than the sm:max-w-sm default: the Gmail-style criteria rows
          (label column + size/date control clusters) overflow a 24rem
          dialog, clipping the right-hand controls. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t("settingsMail.ruleDialog.editTitle")
              : t("settingsMail.ruleDialog.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settingsMail.ruleDialog.description")}
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
            <Label htmlFor="rule-name">
              {t("settingsMail.ruleDialog.name")}
            </Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settingsMail.ruleDialog.namePlaceholder")}
              autoFocus
            />
          </div>
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="rule-advanced"
                checked={advanced}
                onCheckedChange={(checked) => {
                  toggleAdvanced(checked === true)
                }}
              />
              <Label htmlFor="rule-advanced">
                {t("settingsMail.ruleDialog.advanced")}
              </Label>
            </div>
            {advanced ? (
              <div className="grid gap-2">
                <Label htmlFor="rule-criteria">
                  {t("settingsMail.ruleDialog.whenMatches")}
                </Label>
                <Input
                  id="rule-criteria"
                  value={criteria}
                  onChange={(event) => setCriteria(event.target.value)}
                  placeholder={t("settingsMail.ruleDialog.criteriaPlaceholder")}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  {criteriaHelp()}
                </p>
              </div>
            ) : (
              criteriaRows
            )}
          </div>
          <div className="grid gap-2">
            <Label>{t("settingsMail.ruleDialog.then")}</Label>
            {drafts.map((draft, index) => (
              <div key={draft.key} className="flex items-start gap-2">
                <Select
                  value={draft.type}
                  onValueChange={(value) =>
                    updateDraft(draft.key, {
                      type: String(value) as RuleActionType,
                    })
                  }
                >
                  <SelectTrigger
                    aria-label={t("settingsMail.ruleDialog.actionType", {
                      index: index + 1,
                    })}
                    className="w-44 shrink-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(draft.type === "add_labels" ||
                  draft.type === "remove_labels") && (
                  <Input
                    aria-label={t("settingsMail.ruleDialog.actionLabels", {
                      index: index + 1,
                    })}
                    value={draft.labels}
                    onChange={(event) =>
                      updateDraft(draft.key, { labels: event.target.value })
                    }
                    placeholder={t("settingsMail.ruleDialog.labelsPlaceholder")}
                  />
                )}
                {draft.type === "move" && (
                  <Input
                    aria-label={t("settingsMail.ruleDialog.actionFolder", {
                      index: index + 1,
                    })}
                    value={draft.folder}
                    onChange={(event) =>
                      updateDraft(draft.key, { folder: event.target.value })
                    }
                    placeholder={t("settingsMail.ruleDialog.folderPlaceholder")}
                  />
                )}
                {draft.type === "set_category" && (
                  // Task 3.4 (design D4): the category the rule names.
                  // Always has a value (the draft defaults to primary), so
                  // no filled-check gates saving.
                  <Select
                    value={draft.category}
                    onValueChange={(value) =>
                      updateDraft(draft.key, { category: value ?? "primary" })
                    }
                  >
                    <SelectTrigger
                      aria-label={t("settingsMail.ruleDialog.actionCategory", {
                        index: index + 1,
                      })}
                      className="w-40 shrink-0"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("settingsMail.ruleDialog.removeAction", {
                    index: index + 1,
                  })}
                  onClick={() => removeDraft(draft.key)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDrafts((current) => [...current, newActionDraft()])
                }
              >
                <CirclePlus />
                {t("settingsMail.ruleDialog.addAction")}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="rule-enabled"
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked === true)
              }}
            />
            <Label htmlFor="rule-enabled">
              {t("settingsMail.ruleDialog.enabled")}
            </Label>
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
              {t("settingsMail.ruleDialog.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {editing
                ? t("settingsMail.ruleDialog.saveChanges")
                : t("settingsMail.ruleDialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
