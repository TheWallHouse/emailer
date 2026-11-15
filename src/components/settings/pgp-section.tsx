import { useCallback, useEffect, useRef, useState } from "react"
import { KeyRound, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { saveAttachmentAs } from "@/services/attachments/file-actions"
import { getExecutor } from "@/services/db/executor"
import {
  getPgpEnabled,
  setPgpEnabledPreference,
} from "@/services/settings/preferences"
import { useActiveAccount } from "@/stores/account-store"
import { i18next } from "@/i18n"

/**
 * Settings "Encryption" section (task 18.7, mail-security "PGP key
 * management", design D11): the per-account OpenPGP opt-in toggle plus the
 * key management UI — generate a passphrase-protected key pair (with a
 * confirmed passphrase and a post-generation backup/export prompt, per the
 * design's unrecoverable-key risk note), import existing private/public
 * armor, list keys, pick the default (sign) key, copy/export the public
 * key, and delete with a confirmation. Everything is scoped to the ACTIVE
 * account, like the rules/blocked-senders/delivery-schedules sections.
 *
 * LAZY LOADING (D11, the verifiable part): this file NEVER statically
 * imports the key service — every PGP touch goes through loadPgpKeys()'s
 * dynamic import(), and the service only loads once the account's enable
 * toggle is ON. With the feature off the section renders the toggle alone
 * and no PGP (or openpgp) chunk is ever fetched; settings-page.tsx pulls
 * this file statically, so its static import graph stays crypto-free (the
 * pgp-lazy-loading source scan pins the whole graph). The summary TYPES
 * are derived with `typeof import(...)` queries — erased at build time,
 * zero runtime import.
 */

/** The key service's module type, resolved lazily (type-level only). */
type PgpKeysModule = Awaited<typeof import("@/services/crypto/pgp-keys")>

// The summary types are derived from the list functions because the
// `typeof import(...)` query carries VALUE exports only (TS 6 drops
// type-only exports from it) — the element types of listPrivateKeys/
// listPublicKeys ARE the exported PgpPrivateKey/PgpPublicKeySummary
// interfaces, so this resolves to exactly those.
/** Metadata summary of one stored private key (no key material). */
type PrivateKeySummary = Awaited<
  ReturnType<PgpKeysModule["listPrivateKeys"]>
>[number]
/** Metadata summary of one stored public key (no key material). */
type PublicKeySummary = Awaited<
  ReturnType<PgpKeysModule["listPublicKeys"]>
>[number]

/**
 * The lazy boundary: the ONLY way this section reaches PGP functionality.
 * The dynamic import() keeps the key service — and the openpgp chunk it
 * itself loads on demand — out of the settings chunk until an enabled
 * account actually manages keys. Awaiting it repeatedly is free after the
 * first call (module cache).
 */
function loadPgpKeys(): Promise<PgpKeysModule> {
  return import("@/services/crypto/pgp-keys")
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The stored hex fingerprint in the conventional 4-char groups so users
 * can compare it against their correspondents' copies. */
function formatFingerprint(id: string): string {
  return id.replace(/(.{4})/g, "$1 ").trim()
}

function formatCreatedDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(i18next.language)
}

/** Clipboard write with an execCommand fallback (the Tauri webview
 * exposes the async clipboard API; other environments may not). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement("textarea")
      area.value = text
      area.setAttribute("readonly", "")
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      const copied = document.execCommand("copy")
      area.remove()
      return copied
    } catch {
      return false
    }
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// ---------------------------------------------------------------------------
// Key rows
// ---------------------------------------------------------------------------

function PrivateKeyRow({
  summary,
  onCopy,
  onSetDefault,
  onDelete,
}: {
  summary: PrivateKeySummary
  onCopy: (summary: PrivateKeySummary) => void
  onSetDefault: (summary: PrivateKeySummary) => void
  onDelete: (summary: PrivateKeySummary) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="pgp-private-key-row"
      className="flex items-start gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {summary.email}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={summary.id}
        >
          {t("settingsAdvanced.pgp.row.created", {
            fingerprint: formatFingerprint(summary.id),
            date: formatCreatedDate(summary.createdAt),
          })}
        </p>
      </div>
      {summary.isDefault ? (
        <Badge aria-label={t("settingsAdvanced.pgp.row.defaultSigningKey")}>
          {t("settingsAdvanced.pgp.row.default")}
        </Badge>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("settingsAdvanced.pgp.row.makeDefault", {
            email: summary.email,
          })}
          onClick={() => onSetDefault(summary)}
        >
          {t("settingsAdvanced.pgp.row.setDefault")}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsAdvanced.pgp.row.copyPublicKeyFor", {
          email: summary.email,
        })}
        onClick={() => onCopy(summary)}
      >
        {t("settingsAdvanced.pgp.row.copyPublicKey")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsAdvanced.pgp.row.deleteKeyFor", {
          email: summary.email,
        })}
        onClick={() => onDelete(summary)}
      >
        {t("settingsAdvanced.pgp.row.delete")}
      </Button>
    </div>
  )
}

function PublicKeyRow({
  summary,
  onCopy,
  onDelete,
}: {
  summary: PublicKeySummary
  onCopy: (summary: PublicKeySummary) => void
  onDelete: (summary: PublicKeySummary) => void
}) {
  const { t } = useTranslation()
  const email = summary.email ?? summary.id
  return (
    <div
      data-testid="pgp-public-key-row"
      className="flex items-start gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{email}</p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={summary.id}
        >
          {t("settingsAdvanced.pgp.row.created", {
            fingerprint: formatFingerprint(summary.id),
            date: formatCreatedDate(summary.createdAt),
          })}
        </p>
      </div>
      <Badge variant="outline" className="font-normal">
        {summary.source === "imported"
          ? t("settingsAdvanced.pgp.row.imported")
          : t("settingsAdvanced.pgp.row.fromYourKey")}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsAdvanced.pgp.row.copyPublicKeyFor", { email })}
        onClick={() => onCopy(summary)}
      >
        {t("settingsAdvanced.pgp.row.copy")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("settingsAdvanced.pgp.row.deletePublicKeyFor", { email })}
        onClick={() => onDelete(summary)}
      >
        {t("settingsAdvanced.pgp.row.delete")}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generate dialog (with the forced confirm + backup/export step)
// ---------------------------------------------------------------------------

function GenerateKeyDialog({
  accountId,
  defaultName,
  defaultEmail,
  onOpenChange,
  onGenerated,
}: {
  accountId: string
  defaultName: string
  defaultEmail: string
  onOpenChange: (open: boolean) => void
  onGenerated: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [passphrase, setPassphrase] = useState("")
  const [confirmPassphrase, setConfirmPassphrase] = useState("")
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /** Set after a successful generation: flips the dialog into the
   * backup/export step (the design risk note — key loss is unrecoverable,
   * so the copy/export prompt is unmissable and the private key's
   * passphrase dependence spelled out). */
  const [generated, setGenerated] = useState<{
    email: string
    id: string
    armor: string
  } | null>(null)

  const mismatch =
    confirmPassphrase.length > 0 && passphrase !== confirmPassphrase
  const canGenerate =
    name.trim() !== "" &&
    email.trim() !== "" &&
    passphrase.length > 0 &&
    passphrase === confirmPassphrase &&
    !saving

  async function handleGenerate(): Promise<void> {
    if (!canGenerate) return
    setSaving(true)
    setErrorMessage(null)
    try {
      const pgp = await loadPgpKeys()
      const executor = getExecutor()
      const summary = await pgp.generateKey(executor, accountId, {
        name: name.trim(),
        email: email.trim(),
        passphrase,
      })
      const armor = await pgp.getPublicKeyArmor(executor, accountId, summary.id)
      setGenerated({
        email: summary.email,
        id: summary.id,
        armor: armor ?? "",
      })
    } catch (error) {
      setErrorMessage(
        toErrorMessage(error, t("settingsAdvanced.pgp.generate.failed"))
      )
      setSaving(false)
    }
  }

  async function handleCopy(): Promise<void> {
    if (!generated) return
    const copied = await copyText(generated.armor)
    if (copied) {
      toast.success(t("settingsAdvanced.pgp.generate.copied"))
    } else {
      toast.error(t("settingsAdvanced.pgp.generate.clipboardFailed"))
    }
  }

  async function handleExport(): Promise<void> {
    if (!generated) return
    try {
      const target = await saveAttachmentAs(
        { filename: `0x${generated.id.slice(-8)}.asc` },
        new TextEncoder().encode(generated.armor)
      )
      if (target) {
        toast.success(
          t("settingsAdvanced.pgp.generate.savedTo", { path: target })
        )
      }
    } catch (error) {
      console.warn("[settings] failed to export the public key", error)
      toast.error(t("settingsAdvanced.pgp.generate.exportFailed"))
    }
  }

  // The backup/export step replaces the form after a successful
  // generation — the passphrase fields are gone and the armor is the
  // dialog's whole content.
  if (generated) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settingsAdvanced.pgp.generate.saveTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settingsAdvanced.pgp.generate.saveDescription", {
                email: generated.email,
              })}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            value={generated.armor}
            aria-label={t("settingsAdvanced.pgp.generate.publicKey")}
            className="h-40 font-mono text-xs"
          />
          <p className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("settingsAdvanced.pgp.generate.recoveryWarning")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => void handleCopy()}>
              {t("settingsAdvanced.pgp.generate.copyPublicKey")}
            </Button>
            <Button variant="outline" onClick={() => void handleExport()}>
              {t("settingsAdvanced.pgp.generate.exportKeyFile")}
            </Button>
            <Button
              onClick={() => {
                onGenerated()
                onOpenChange(false)
              }}
            >
              {t("settingsAdvanced.pgp.generate.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settingsAdvanced.pgp.generate.title")}</DialogTitle>
          <DialogDescription>
            {t("settingsAdvanced.pgp.generate.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleGenerate()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="pgp-generate-name">
              {t("settingsAdvanced.pgp.generate.name")}
            </Label>
            <Input
              id="pgp-generate-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settingsAdvanced.pgp.generate.namePlaceholder")}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pgp-generate-email">
              {t("settingsAdvanced.pgp.generate.email")}
            </Label>
            <Input
              id="pgp-generate-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("settingsAdvanced.pgp.generate.emailPlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pgp-generate-passphrase">
              {t("settingsAdvanced.pgp.generate.passphrase")}
            </Label>
            <Input
              id="pgp-generate-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {t("settingsAdvanced.pgp.generate.passphraseHint")}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pgp-generate-confirm">
              {t("settingsAdvanced.pgp.generate.confirmPassphrase")}
            </Label>
            <Input
              id="pgp-generate-confirm"
              type="password"
              value={confirmPassphrase}
              onChange={(event) => setConfirmPassphrase(event.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch || undefined}
            />
            {mismatch && (
              <p role="alert" className="text-xs text-destructive">
                {t("settingsAdvanced.pgp.generate.mismatch")}
              </p>
            )}
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
              {t("settingsAdvanced.pgp.generate.cancel")}
            </Button>
            <Button type="submit" disabled={!canGenerate}>
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {t("settingsAdvanced.pgp.generate.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Import dialog
// ---------------------------------------------------------------------------

function ImportKeyDialog({
  accountId,
  onOpenChange,
  onImported,
}: {
  accountId: string
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<"public" | "private">("public")
  const [armor, setArmor] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const canImport =
    armor.trim() !== "" &&
    (kind === "public" || passphrase.length > 0) &&
    !saving

  async function handleImport(): Promise<void> {
    if (!canImport) return
    setSaving(true)
    setErrorMessage(null)
    try {
      const pgp = await loadPgpKeys()
      const executor = getExecutor()
      if (kind === "public") {
        await pgp.importPublicKey(executor, accountId, armor)
      } else {
        await pgp.importPrivateKey(executor, accountId, armor, passphrase)
      }
      toast.success(
        kind === "public"
          ? t("settingsAdvanced.pgp.import.importedPublic")
          : t("settingsAdvanced.pgp.import.importedPrivate")
      )
      await onImported()
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(
        toErrorMessage(error, t("settingsAdvanced.pgp.import.failed"))
      )
      setSaving(false)
    }
  }

  async function handleLoadFile(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      setArmor(await file.text())
      setErrorMessage(null)
    } catch {
      setErrorMessage(t("settingsAdvanced.pgp.import.readFileFailed"))
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settingsAdvanced.pgp.import.title")}</DialogTitle>
          <DialogDescription>
            {t("settingsAdvanced.pgp.import.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleImport()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="pgp-import-kind">
              {t("settingsAdvanced.pgp.import.keyType")}
            </Label>
            <Select
              value={kind}
              onValueChange={(value) =>
                setKind(String(value) === "private" ? "private" : "public")
              }
              items={{
                public: t("settingsAdvanced.pgp.import.publicKey"),
                private: t("settingsAdvanced.pgp.import.privateKey"),
              }}
            >
              <SelectTrigger id="pgp-import-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  {t("settingsAdvanced.pgp.import.publicKey")}
                </SelectItem>
                <SelectItem value="private">
                  {t("settingsAdvanced.pgp.import.privateKey")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pgp-import-armor">
              {t("settingsAdvanced.pgp.import.armoredKey")}
            </Label>
            <Textarea
              id="pgp-import-armor"
              value={armor}
              onChange={(event) => setArmor(event.target.value)}
              placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
              className="h-32 font-mono text-xs"
            />
            <Input
              type="file"
              accept=".asc,.txt,application/pgp-keys,text/plain"
              aria-label={t("settingsAdvanced.pgp.import.loadFromFile")}
              onChange={(event) => void handleLoadFile(event.target.files?.[0])}
            />
          </div>
          {kind === "private" && (
            <div className="grid gap-2">
              <Label htmlFor="pgp-import-passphrase">
                {t("settingsAdvanced.pgp.import.passphrase")}
              </Label>
              <Input
                id="pgp-import-passphrase"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                {t("settingsAdvanced.pgp.import.passphraseHint")}
              </p>
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
              {t("settingsAdvanced.pgp.import.cancel")}
            </Button>
            <Button type="submit" disabled={!canImport}>
              {saving && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {t("settingsAdvanced.pgp.import.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

type DeleteTarget =
  | { kind: "private"; summary: PrivateKeySummary }
  | { kind: "public"; summary: PublicKeySummary }

function DeleteKeyDialog({
  accountId,
  target,
  onOpenChange,
  onDeleted,
}: {
  accountId: string
  target: DeleteTarget
  onOpenChange: (open: boolean) => void
  onDeleted: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isPrivate = target.kind === "private"
  const label =
    target.kind === "private"
      ? target.summary.email
      : (target.summary.email ?? formatFingerprint(target.summary.id))

  async function handleDelete(): Promise<void> {
    setDeleting(true)
    setErrorMessage(null)
    try {
      const pgp = await loadPgpKeys()
      const executor = getExecutor()
      if (target.kind === "private") {
        await pgp.deletePrivateKey(executor, accountId, target.summary.id)
      } else {
        await pgp.deletePublicKey(executor, accountId, target.summary.id)
      }
      toast.success(
        isPrivate
          ? t("settingsAdvanced.pgp.delete.deletedPrivate", { label })
          : t("settingsAdvanced.pgp.delete.deletedPublic", { label })
      )
      await onDeleted()
      onOpenChange(false)
    } catch (error) {
      setErrorMessage(
        toErrorMessage(error, t("settingsAdvanced.pgp.delete.failed"))
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isPrivate
              ? t("settingsAdvanced.pgp.delete.titlePrivate")
              : t("settingsAdvanced.pgp.delete.titlePublic")}
          </DialogTitle>
          <DialogDescription>
            {isPrivate
              ? t("settingsAdvanced.pgp.delete.descriptionPrivate", { label })
              : t("settingsAdvanced.pgp.delete.descriptionPublic", { label })}
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
            {t("settingsAdvanced.pgp.delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void handleDelete()
            }}
            disabled={deleting}
          >
            {deleting && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            )}
            {t("settingsAdvanced.pgp.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The key manager (loaded only while the account's toggle is on)
// ---------------------------------------------------------------------------

function KeyManager({
  accountId,
  defaultName,
  defaultEmail,
}: {
  accountId: string
  defaultName: string
  defaultEmail: string
}) {
  const { t } = useTranslation()
  // Null until the first (lazy) load resolves — the "chunk fetching" state.
  const [privateKeys, setPrivateKeys] = useState<PrivateKeySummary[] | null>(
    null
  )
  const [publicKeys, setPublicKeys] = useState<PublicKeySummary[] | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const reload = useCallback((): Promise<void> => {
    // First call pulls the PGP chunk through loadPgpKeys()'s dynamic
    // import — the lazy boundary of this whole section. State updates
    // stay inside the promise callbacks; one failed load degrades to the
    // empty lists, never a stuck spinner (the read-time-drop convention
    // of the other sections). The returned promise is what the dialogs'
    // onGenerated/onImported/onDeleted props await.
    return loadPgpKeys()
      .then((pgp) => {
        const executor = getExecutor()
        return Promise.all([
          pgp.listPrivateKeys(executor, accountId),
          pgp.listPublicKeys(executor, accountId),
        ])
      })
      .catch((error: unknown) => {
        console.warn("[settings] failed to load PGP keys", error)
        return [[], []] as [PrivateKeySummary[], PublicKeySummary[]]
      })
      .then(([priv, pub]) => {
        setPrivateKeys(priv)
        setPublicKeys(pub)
      })
  }, [accountId])

  // The shell only mounts settings after bootstrap(), so the executor is
  // available (same assumption as the other sections).
  useEffect(() => {
    void reload()
  }, [reload])

  async function handleCopy(summary: { id: string; email?: string }) {
    try {
      const pgp = await loadPgpKeys()
      const armor = await pgp.getPublicKeyArmor(
        getExecutor(),
        accountId,
        summary.id
      )
      if (!armor) {
        toast.error(t("settingsAdvanced.pgp.manager.materialMissing"))
        return
      }
      const copied = await copyText(armor)
      if (copied) {
        toast.success(
          summary.email === undefined
            ? t("settingsAdvanced.pgp.manager.copiedForThisKey")
            : t("settingsAdvanced.pgp.manager.copiedFor", {
                email: summary.email,
              })
        )
      } else {
        toast.error(t("settingsAdvanced.pgp.manager.clipboardFailed"))
      }
    } catch (error) {
      console.warn("[settings] failed to copy the public key", error)
      toast.error(t("settingsAdvanced.pgp.manager.copyFailed"))
    }
  }

  async function handleSetDefault(summary: PrivateKeySummary): Promise<void> {
    try {
      const pgp = await loadPgpKeys()
      await pgp.setDefaultPrivateKey(getExecutor(), accountId, summary.id)
      reload()
    } catch (error) {
      console.warn("[settings] failed to set the default key", error)
      toast.error(t("settingsAdvanced.pgp.manager.setDefaultFailed"))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("settingsAdvanced.pgp.manager.description")}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={privateKeys === null}
            onClick={() => setImportOpen(true)}
          >
            {t("settingsAdvanced.pgp.manager.import")}
          </Button>
          <Button
            size="sm"
            disabled={privateKeys === null}
            onClick={() => setGenerateOpen(true)}
          >
            <KeyRound />
            {t("settingsAdvanced.pgp.manager.generate")}
          </Button>
        </div>
      </div>
      {privateKeys === null ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t("settingsAdvanced.pgp.manager.loading")}
        </p>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {t("settingsAdvanced.pgp.manager.yourKeys")}
            </h3>
            {privateKeys.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {t("settingsAdvanced.pgp.manager.noKeys")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {privateKeys.map((summary) => (
                  <PrivateKeyRow
                    key={summary.id}
                    summary={summary}
                    onCopy={(target) => {
                      void handleCopy(target)
                    }}
                    onSetDefault={(target) => {
                      void handleSetDefault(target)
                    }}
                    onDelete={(target) =>
                      setDeleteTarget({ kind: "private", summary: target })
                    }
                  />
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {t("settingsAdvanced.pgp.manager.publicKeys")}
            </h3>
            {publicKeys === null ? null : publicKeys.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {t("settingsAdvanced.pgp.manager.noPublicKeys")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {publicKeys.map((summary) => (
                  <PublicKeyRow
                    key={summary.id}
                    summary={summary}
                    onCopy={(target) => {
                      void handleCopy(target)
                    }}
                    onDelete={(target) =>
                      setDeleteTarget({ kind: "public", summary: target })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <Separator />
      <p className="text-xs text-muted-foreground">
        {t("settingsAdvanced.pgp.manager.footer")}
      </p>
      {/* Remounted on every open so the forms always start fresh. */}
      {generateOpen && (
        <GenerateKeyDialog
          key="pgp-generate"
          accountId={accountId}
          defaultName={defaultName}
          defaultEmail={defaultEmail}
          onOpenChange={setGenerateOpen}
          onGenerated={reload}
        />
      )}
      {importOpen && (
        <ImportKeyDialog
          key="pgp-import"
          accountId={accountId}
          onOpenChange={setImportOpen}
          onImported={reload}
        />
      )}
      {deleteTarget && (
        <DeleteKeyDialog
          key={`pgp-delete-${deleteTarget.summary.id}`}
          accountId={accountId}
          target={deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          onDeleted={reload}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export function PgpSection() {
  const { t } = useTranslation()
  const account = useActiveAccount()
  /** The account the opt-in flag was last read/written for — scoping the
   * boolean to its account means an account switch renders the (correct)
   * unloaded toggle until the new account's flag resolves, instead of
   * flashing the previous account's manager. */
  const [enabledForAccountId, setEnabledForAccountId] = useState<string | null>(
    null
  )
  const enabled = account !== null && enabledForAccountId === account.id
  // Set as soon as the user toggles: the async initial load must never
  // clobber a change with a stale DB read (the reading-section pattern).
  const dirtyRef = useRef(false)

  // Load the persisted opt-in once per account (the shell only mounts
  // this page after bootstrap(), so the executor is available). Failures
  // keep the default (off) — fail toward no PGP, never surprise-on.
  useEffect(() => {
    if (!account) return
    dirtyRef.current = false
    let cancelled = false
    try {
      void getPgpEnabled(getExecutor(), account.id)
        .then((value) => {
          if (!cancelled && !dirtyRef.current) {
            setEnabledForAccountId(value ? account.id : null)
          }
        })
        .catch(() => {})
    } catch (error) {
      console.warn("[settings] failed to load the PGP opt-in", error)
    }
    return () => {
      cancelled = true
    }
  }, [account])

  async function changeEnabled(next: boolean): Promise<void> {
    if (!account) return
    const previous = enabledForAccountId
    dirtyRef.current = true
    setEnabledForAccountId(next ? account.id : null)
    try {
      await setPgpEnabledPreference(getExecutor(), account.id, next)
    } catch (error) {
      setEnabledForAccountId(previous)
      console.warn("[settings] failed to persist the PGP opt-in", error)
    }
  }

  return (
    <section
      aria-label={t("settingsAdvanced.pgp.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settingsAdvanced.pgp.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settingsAdvanced.pgp.description")}
        </p>
      </div>
      {!account ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsAdvanced.pgp.noAccount")}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-6 py-1">
            <div className="grid gap-0.5">
              <Label htmlFor="pgp-enabled">
                {t("settingsAdvanced.pgp.enable")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settingsAdvanced.pgp.enableHint", { email: account.email })}
              </p>
            </div>
            <Switch
              id="pgp-enabled"
              checked={enabled}
              onCheckedChange={(checked) => {
                void changeEnabled(checked)
              }}
            />
          </div>
          {/* The PGP chunk loads only past this point (design D11). */}
          {enabled && (
            <KeyManager
              accountId={account.id}
              defaultName={account.displayName ?? ""}
              defaultEmail={account.email}
            />
          )}
        </>
      )}
    </section>
  )
}
