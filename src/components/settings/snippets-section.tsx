import { useCallback, useEffect, useState } from "react"
import { CirclePlus, Loader2, Pencil, Trash2 } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { getExecutor } from "@/services/db/executor"
import type { SnippetRow } from "@/services/db/snippets"
import {
  createSnippet,
  deleteSnippet,
  listSnippets,
  updateSnippet,
} from "@/services/db/snippets"
import { SNIPPET_VARIABLES } from "@/services/composer/snippet-variables"

/**
 * Settings "Snippets" section (task 6.1): manages the global composer text
 * templates (the `snippets` table — no account scope, every account sees
 * the same list). Lists name, shortcut and a one-line body preview; Add
 * and Edit share one dialog (remounted fresh per open, like the account
 * dialogs), Delete reuses the destructive confirm-dialog pattern of
 * account removal. The composer insertion itself is a later task; this
 * section is the only writer.
 *
 * Task 2.4 (design D11) adds a read-only "Template variables" legend: one
 * line per registry variable, rendered from the substitution engine's
 * SNIPPET_VARIABLES metadata so the documentation can never drift from
 * what insertion actually resolves.
 */

type DialogTarget = { mode: "add" } | { mode: "edit"; snippet: SnippetRow }

/** One blank value is stored as NULL so the column stays truly optional. */
function normalizeShortcut(shortcut: string): string | null {
  const trimmed = shortcut.trim()
  return trimmed === "" ? null : trimmed
}

function SnippetDialog({
  target,
  onOpenChange,
  onSaved,
}: {
  target: DialogTarget
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const editing = target.mode === "edit" ? target.snippet : null
  const [name, setName] = useState(editing?.name ?? "")
  const [shortcut, setShortcut] = useState(editing?.shortcut ?? "")
  const [body, setBody] = useState(editing?.body ?? "")
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canSave = name.trim() !== "" && body.trim() !== "" && !saving

  async function handleSave(): Promise<void> {
    if (!canSave) return
    setSaving(true)
    setErrorMessage(null)
    try {
      const executor = getExecutor()
      if (editing) {
        await updateSnippet(executor, editing.id, {
          name: name.trim(),
          body,
          shortcut: normalizeShortcut(shortcut),
        })
      } else {
        await createSnippet(executor, {
          name: name.trim(),
          body,
          shortcut: normalizeShortcut(shortcut) ?? undefined,
        })
      }
      onSaved()
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("settingsMail.snippets.saveFailed")
      )
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t("settingsMail.snippets.editTitle")
              : t("settingsMail.snippets.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settingsMail.snippets.dialogDescription")}
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
            <Label htmlFor="snippet-name">
              {t("settingsMail.snippets.name")}
            </Label>
            <Input
              id="snippet-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settingsMail.snippets.namePlaceholder")}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="snippet-shortcut">
              {t("settingsMail.snippets.shortcut")}
            </Label>
            <Input
              id="snippet-shortcut"
              value={shortcut}
              onChange={(event) => setShortcut(event.target.value)}
              placeholder={t("settingsMail.snippets.shortcutPlaceholder")}
              className="font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="snippet-body">
              {t("settingsMail.snippets.body")}
            </Label>
            <Textarea
              id="snippet-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("settingsMail.snippets.bodyPlaceholder")}
              rows={5}
            />
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
              {t("settingsMail.snippets.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {editing
                ? t("settingsMail.snippets.saveChanges")
                : t("settingsMail.snippets.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSnippetDialog({
  snippet,
  onOpenChange,
  onDeleted,
}: {
  snippet: SnippetRow
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm(): Promise<void> {
    setDeleting(true)
    try {
      await deleteSnippet(getExecutor(), snippet.id)
      onDeleted()
      onOpenChange(false)
    } catch (error) {
      console.warn("[settings] failed to delete snippet", error)
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settingsMail.snippets.deleteTitle")}</DialogTitle>
          <DialogDescription>
            <Trans
              i18nKey="settingsMail.snippets.deleteConfirm"
              values={{ name: snippet.name }}
              components={{
                name: <span className="font-medium text-foreground" />,
              }}
            />
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {t("settingsMail.snippets.cancel")}
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
            {t("settingsMail.snippets.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SnippetRowItem({
  snippet,
  onEdit,
  onDelete,
}: {
  snippet: SnippetRow
  onEdit: (snippet: SnippetRow) => void
  onDelete: (snippet: SnippetRow) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="settings-snippet-row"
      className="flex items-center gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {snippet.name}
          </p>
          {snippet.shortcut && (
            <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
              {snippet.shortcut}
            </kbd>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{snippet.body}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsMail.snippets.editAria", { name: snippet.name })}
        onClick={() => onEdit(snippet)}
      >
        <Pencil />
        {t("settingsMail.snippets.edit")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsMail.snippets.deleteAria", {
          name: snippet.name,
        })}
        onClick={() => onDelete(snippet)}
      >
        <Trash2 />
        {t("settingsMail.snippets.delete")}
      </Button>
    </div>
  )
}

/**
 * Read-only legend for the `{{variable}}` placeholders a snippet body may
 * use (task 2.4, design D11) — rendered straight from the substitution
 * engine's SNIPPET_VARIABLES metadata (single source of truth), so the
 * documented list is always exactly what insertion resolves. Also states
 * the prompt behavior: a variable without a known value (registry or not)
 * asks once per insertion and the answer fills every occurrence.
 */
function TemplateVariablesHelp() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2" data-testid="snippet-variables-help">
      <h3 className="text-sm font-medium text-foreground">
        {t("settingsMail.snippets.variables.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        <Trans
          i18nKey="settingsMail.snippets.variables.intro"
          values={{ placeholder: "{{variable}}" }}
          components={{ code: <code className="font-mono" /> }}
        />
      </p>
      <ul className="flex flex-col gap-1.5">
        {SNIPPET_VARIABLES.map((variable) => (
          <li
            key={variable.id}
            className="text-xs text-muted-foreground"
            data-testid="snippet-variable-entry"
          >
            <code className="font-mono text-foreground">
              {`{{${variable.id}}}`}
            </code>{" "}
            {t("settingsMail.snippets.variables.entry", {
              description: variable.description,
              example: variable.example,
            })}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t("settingsMail.snippets.variables.prompt")}
      </p>
    </div>
  )
}

export function SnippetsSection() {
  const { t } = useTranslation()
  const [snippets, setSnippets] = useState<SnippetRow[]>([])
  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SnippetRow | null>(null)

  const reload = useCallback(() => {
    try {
      void listSnippets(getExecutor())
        .then(setSnippets)
        .catch((error) => {
          console.warn("[settings] failed to load snippets", error)
        })
    } catch (error) {
      console.warn("[settings] failed to load snippets", error)
    }
  }, [])

  // The shell only mounts settings after bootstrap(), so the executor is
  // available (same assumption as the other sections).
  useEffect(reload, [reload])

  return (
    <section
      aria-label={t("settingsMail.snippets.title")}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t("settingsMail.snippets.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settingsMail.snippets.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog({ mode: "add" })}>
          <CirclePlus />
          {t("settingsMail.snippets.add")}
        </Button>
      </div>
      <Separator />
      {snippets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsMail.snippets.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {snippets.map((snippet) => (
            <SnippetRowItem
              key={snippet.id}
              snippet={snippet}
              onEdit={(target) => setDialog({ mode: "edit", snippet: target })}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}
      <TemplateVariablesHelp />
      {/* Remounted on every open so the form always starts fresh. */}
      {dialog && (
        <SnippetDialog
          key={dialog.mode === "edit" ? `edit-${dialog.snippet.id}` : "add"}
          target={dialog}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onSaved={reload}
        />
      )}
      {deleteTarget && (
        <DeleteSnippetDialog
          key={`delete-${deleteTarget.id}`}
          snippet={deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          onDeleted={reload}
        />
      )}
    </section>
  )
}
