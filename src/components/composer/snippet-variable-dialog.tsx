import { useState } from "react"
import { useTranslation } from "react-i18next"

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
  SNIPPET_VARIABLE_LABELS,
  type SnippetVariableId,
} from "@/services/composer/snippet-variables"

/**
 * The ONE prompt per snippet insertion for unknown `{{variable}}` ids
 * (task 2.3, design D11): every id without a context value gets a single
 * input, and each answer substitutes into ALL occurrences of its id when
 * the insertion continues (spec: unknown variable prompts once). The
 * open/cancel state deliberately lives in composer.tsx (which resolves
 * insertSnippetBody's injected prompt promise) — NOT in composer-store:
 * this is transient UI, not draft data. The field values are
 * component-local and reset per request (the composer keys this component
 * by the id list so a fresh insertion starts empty). A blank answer is
 * allowed and keeps that placeholder literal in the inserted text.
 */
export function SnippetVariableDialog({
  variables,
  onInsert,
  onCancel,
}: {
  /** Unique unresolved variable ids, first-appearance order. */
  variables: string[]
  /** Confirmed: called with the collected answers (id → value, blanks
   * included — the substitution treats blanks as unanswered). */
  onInsert: (answers: Record<string, string>) => void
  /** Cancelled: the insertion is abandoned entirely. */
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>({})

  const setValue = (variable: string, value: string) =>
    setValues((current) => ({ ...current, [variable]: value }))

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onInsert(values)
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("composer.snippetVariables.title")}</DialogTitle>
            <DialogDescription>
              {t("composer.snippetVariables.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {variables.map((variable, index) => (
              <div key={variable} className="flex flex-col gap-1.5">
                <Label htmlFor={`snippet-variable-${index}`}>
                  {SNIPPET_VARIABLE_LABELS[variable as SnippetVariableId] ??
                    variable}
                </Label>
                <Input
                  id={`snippet-variable-${index}`}
                  value={values[variable] ?? ""}
                  onChange={(event) => setValue(variable, event.target.value)}
                  autoComplete="off"
                  autoFocus={index === 0}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("composer.snippetVariables.cancel")}
            </Button>
            <Button type="submit">
              {t("composer.snippetVariables.insert")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
