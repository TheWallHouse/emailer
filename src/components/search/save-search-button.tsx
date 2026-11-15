import { useState } from "react"
import { BookmarkPlus } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"

import { saveSearchWithToast } from "@/components/layout/use-saved-searches"
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
 * "Save search" affordance in the results view (task 7.2, mail-search
 * spec): mounted by the search field next to the query chip, so it is
 * visible exactly while a search view with a non-empty query is active.
 * Clicking opens a small name prompt (the settings-sections dialog
 * pattern); saving writes a saved_searches row with the query as typed
 * and notifies the sidebar's Saved Searches section via its notify seam.
 */
export function SaveSearchButton({ query }: { query: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("search.saveSearch.label")}
        title={t("search.saveSearch.label")}
        data-testid="save-search-button"
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus />
      </Button>
      {open && <SaveSearchDialog query={query} onOpenChange={setOpen} />}
    </>
  )
}

function SaveSearchDialog({
  query,
  onOpenChange,
}: {
  query: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSubmit(): Promise<void> {
    if (!name.trim() || saving) return
    setSaving(true)
    if (await saveSearchWithToast(name, query)) {
      onOpenChange(false)
    } else {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("search.saveSearch.label")}</DialogTitle>
          <DialogDescription>
            <Trans
              i18nKey="search.saveSearch.description"
              values={{ query }}
              components={{ query: <span className="font-medium" /> }}
            />
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
            <Label htmlFor="saved-search-name">
              {t("search.saveSearch.name")}
            </Label>
            <Input
              id="saved-search-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("search.saveSearch.namePlaceholder")}
              autoFocus
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("search.saveSearch.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {t("search.saveSearch.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
