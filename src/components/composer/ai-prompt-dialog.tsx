import { useState, type FormEvent } from "react"
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
import { Textarea } from "@/components/ui/textarea"

/**
 * The "Draft from prompt" input (batch C3): a small dialog with one
 * textarea and a Generate action. Controlled entirely by the composer —
 * the dialog collects the instruction and hands the trimmed text back
 * through `onGenerate`; the result NEVER lands in the draft directly, it
 * rides the same pending-replacement accept/discard bar as the compose
 * transforms. Opening starts with an empty field (keyed by the caller);
 * closing discards the typed text — a prompt is transient input, not
 * draft data.
 */
export function AiPromptDialog({
  open,
  onOpenChange,
  onGenerate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerate: (prompt: string) => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState("")

  // Each open starts clean — the previous instruction must not leak into
  // the next draft request. Clearing on close (an event handler, not an
  // effect) achieves that without cascading renders.
  const handleOpenChange = (next: boolean) => {
    if (!next) setValue("")
    onOpenChange(next)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const prompt = value.trim()
    if (prompt === "") return
    handleOpenChange(false)
    onGenerate(prompt)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={submit}
          data-testid="ai-prompt-form"
        >
          <DialogHeader>
            <DialogTitle>{t("composer.aiPrompt.title")}</DialogTitle>
            <DialogDescription>
              {t("composer.aiPrompt.description")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={t("composer.aiPrompt.instruction")}
            placeholder={t("composer.aiPrompt.placeholder")}
            rows={5}
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              {t("composer.aiPrompt.cancel")}
            </Button>
            <Button type="submit" disabled={value.trim() === ""}>
              {t("composer.aiPrompt.generate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
