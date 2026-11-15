import { useState } from "react"
import { SquareSplitHorizontal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { createSplitWithToast } from "@/components/layout/use-splits"
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

/**
 * "Save as Split" affordance in the results view (task 9.3, mailbox-ui
 * spec "Create a split from a search"): mounted by the search field next
 * to "Save search", visible exactly while a search view with a non-empty
 * query is active. The dialog prefills the query from the current search
 * (still editable); saving creates the split across the accounts and
 * ENTERS it right away — the tab appears above the list already active.
 * Duplicate names keep the dialog open with a form error (the
 * snippets-section pattern).
 */
export function SaveAsSplitButton({ query }: { query: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("search.saveAsSplit.label")}
        title={t("search.saveAsSplit.label")}
        data-testid="save-as-split-button"
        onClick={() => setOpen(true)}
      >
        <SquareSplitHorizontal />
      </Button>
      {open && <SaveAsSplitDialog query={query} onOpenChange={setOpen} />}
    </>
  )
}

function SaveAsSplitDialog({
  query,
  onOpenChange,
}: {
  query: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [queryInput, setQueryInput] = useState(query)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(): Promise<void> {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    const outcome = await createSplitWithToast({
      name,
      query: queryInput,
      enter: true,
    })
    if (outcome.ok) {
      onOpenChange(false)
      return
    }
    setSaving(false)
    setError(
      outcome.error === "name-taken"
        ? t("search.saveAsSplit.nameTaken", { name: name.trim() })
        : t("search.saveAsSplit.createFailed")
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("search.saveAsSplit.label")}</DialogTitle>
          <DialogDescription>
            {t("search.saveAsSplit.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="split-from-search-name">
              {t("search.saveAsSplit.name")}
            </Label>
            <Input
              id="split-from-search-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("search.saveAsSplit.namePlaceholder")}
              autoFocus
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="split-from-search-query">
              {t("search.saveAsSplit.query")}
            </Label>
            <Input
              id="split-from-search-query"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              disabled={saving}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("search.saveAsSplit.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {t("search.saveAsSplit.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
