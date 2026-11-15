import { useEffect, useState } from "react"
import { formatDistanceToNow, fromUnixTime } from "date-fns"
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

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
import {
  AI_PROVIDER_KINDS,
  AI_SURFACE_IDS,
  AI_TIERS,
  addProvider,
  getAiSettings,
  isAiSurfaceId,
  providerRequiresApiKey,
  removeProvider,
  setActiveProvider,
  setAiEnabled,
  setOutputLanguage,
  setProviderApiKey,
  setSurfaceEnabled,
  setSurfaceTier,
  setTierModel,
  updateProvider,
  type AiProviderKind,
  type AiProviderView,
  type AiSettingsView,
  type AiSurfaceId,
  type AiTier,
} from "@/services/ai/settings"
import {
  aiCacheStats,
  clearAiCacheAll,
  type AiCacheStats,
} from "@/services/ai/cache"
import { testAiConnection } from "@/services/ai/client"
import {
  aiUsageSummary,
  clearAiUsage,
  type AiUsageSummary,
} from "@/services/ai/usage"
import {
  buildWritingStyleProfile,
  deleteStyleProfile,
  loadStyleProfile,
  type StyleProfileBuildFailure,
  type WritingStyleProfileEnvelope,
} from "@/services/ai/style-profile"
import { SemanticSearchSection } from "@/components/settings/semantic-search-section"
import { VoiceSection } from "@/components/settings/voice-section"
import { useAccountStore } from "@/stores/account-store"
import { getExecutor } from "@/services/db/executor"

/**
 * Settings "AI" section (task 4.2, spec ai-assistance, design D1): the
 * master enable switch, the provider list (add/edit/remove, per-provider
 * free-string model ids, connection test with a specific success/failure
 * report, active-provider radio), the per-surface toggles, the
 * result-cache management (stats + bulk clear over the 4.3 service),
 * and — parity-round-2 tasks 2.1/2.3 — the per-surface tier selectors
 * and per-tier model ids for the active provider, the output-language
 * control, and the per-surface usage summary with its clear action.
 *
 * The master switch is the spec's consent gate: with AI off, everything
 * below it disappears behind a note (nothing is configured, nothing is
 * sent). With AI on but no ACTIVE provider with a model, the mail
 * surfaces stay hidden elsewhere (settings.isAiConfigured) — this
 * section is where the user gets there: add a provider, test it, mark
 * it active.
 *
 * Key handling (design D1): the form holds the plaintext key only for
 * the moment between typing and saving; it is handed to the settings
 * service, which seals it into the credentials envelope before persist
 * (never logged, never returned by a read). Edits keep a stored key
 * unless a new one is typed; Ollama needs no key (all requests stay
 * local — spec "Ollama SHALL keep all requests on the local machine").
 *
 * Export safety: provider keys are sealed at rest and the export paths
 * (mbox/EML of mailbox content) never touch the settings table, so keys
 * are never included in exported data (spec "Keys stay local") — stated
 * in the fine print below.
 */

function kindLabel(t: TFunction, kind: AiProviderKind): string {
  return t(`settingsAdvanced.ai.kinds.${kind}`)
}

/** The name a new provider starts with (the user may type another). */
function kindDefaultLabel(t: TFunction, kind: AiProviderKind): string {
  switch (kind) {
    case "ollama":
      return "Ollama"
    case "custom":
      return t("settingsAdvanced.ai.customDefaultLabel")
    default:
      return kindLabel(t, kind)
  }
}

/** Free-string model hints — the ids are never validated against a list
 * (spec: model selection is a free string, never an enum). */
function kindModelPlaceholder(t: TFunction, kind: AiProviderKind): string {
  return t(`settingsAdvanced.ai.modelPlaceholders.${kind}`)
}

function surfaceLabel(t: TFunction, surface: AiSurfaceId): string {
  return t(`settingsAdvanced.ai.surfaces.${surface}.label`)
}

function surfaceDescription(t: TFunction, surface: AiSurfaceId): string {
  return t(`settingsAdvanced.ai.surfaces.${surface}.description`)
}

/** Tier display names (parity-round-2 task 2.1). */
function tierLabel(t: TFunction, tier: AiTier): string {
  return t(`settingsAdvanced.ai.tiers.${tier}`)
}

/** Free-string hints for the per-tier model ids (never validated against
 * a list — like the provider model id, the ids are whatever the active
 * provider offers). */
function tierModelPlaceholder(t: TFunction, tier: AiTier): string {
  return t(`settingsAdvanced.ai.tiers.placeholders.${tier}`)
}

/** The per-row connection-test display. */
interface TestOutcome {
  ok: boolean
  text: string
}

type DialogTarget = { mode: "add" } | { mode: "edit"; provider: AiProviderView }

function isDefaultLabel(t: TFunction, value: string): boolean {
  return AI_PROVIDER_KINDS.some(
    (candidate) => kindDefaultLabel(t, candidate) === value.trim()
  )
}

export function AiSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AiSettingsView | null>(null)
  const [cache, setCache] = useState<AiCacheStats | null>(null)
  const [usage, setUsage] = useState<AiUsageSummary | null>(null)
  const [confirmClearCache, setConfirmClearCache] = useState(false)
  const [confirmClearUsage, setConfirmClearUsage] = useState(false)
  const [testOutcomes, setTestOutcomes] = useState<Record<string, TestOutcome>>(
    {}
  )
  const [testingId, setTestingId] = useState<string | null>(null)

  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const [kind, setKind] = useState<AiProviderKind>("anthropic")
  const [label, setLabel] = useState("")
  const [model, setModel] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    try {
      void Promise.all([
        getAiSettings(getExecutor()),
        aiCacheStats(getExecutor()),
        aiUsageSummary(getExecutor()),
      ])
        .then(([settings, stats, usageStats]) => {
          if (cancelled) return
          setConfig(settings)
          setCache(stats)
          setUsage(usageStats)
        })
        .catch((error) => {
          console.warn("[settings] failed to load the AI settings", error)
        })
    } catch (error) {
      console.warn("[settings] failed to load the AI settings", error)
    }
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh(): Promise<void> {
    const executor = getExecutor()
    try {
      const [settings, stats, usageStats] = await Promise.all([
        getAiSettings(executor),
        aiCacheStats(executor),
        aiUsageSummary(executor),
      ])
      setConfig(settings)
      setCache(stats)
      setUsage(usageStats)
    } catch (error) {
      console.warn("[settings] failed to refresh the AI settings", error)
    }
  }

  async function changeEnabled(enabled: boolean): Promise<void> {
    const previous = config
    // Optimistic: the switch reacts immediately, rolls back on failure.
    setConfig((current) => (current ? { ...current, enabled } : current))
    try {
      await setAiEnabled(getExecutor(), enabled)
    } catch (error) {
      setConfig(previous)
      console.warn("[settings] failed to persist the AI enable flag", error)
    }
  }

  async function chooseActive(providerId: string): Promise<void> {
    const previous = config
    setConfig((current) =>
      current ? { ...current, activeProviderId: providerId } : current
    )
    try {
      await setActiveProvider(getExecutor(), providerId)
    } catch (error) {
      setConfig(previous)
      console.warn("[settings] failed to persist the active AI provider", error)
    }
  }

  async function changeSurface(
    surface: AiSurfaceId,
    enabled: boolean
  ): Promise<void> {
    const previous = config
    setConfig((current) =>
      current
        ? { ...current, surfaces: { ...current.surfaces, [surface]: enabled } }
        : current
    )
    try {
      await setSurfaceEnabled(getExecutor(), surface, enabled)
    } catch (error) {
      setConfig(previous)
      console.warn("[settings] failed to persist the AI surface toggle", error)
    }
  }

  async function changeSurfaceTier(
    surface: AiSurfaceId,
    tier: AiTier
  ): Promise<void> {
    const previous = config
    setConfig((current) =>
      current
        ? {
            ...current,
            surfaceTiers: { ...current.surfaceTiers, [surface]: tier },
          }
        : current
    )
    try {
      await setSurfaceTier(getExecutor(), surface, tier)
    } catch (error) {
      setConfig(previous)
      console.warn("[settings] failed to persist the AI surface tier", error)
    }
  }

  /** Persisted on blur: the whole row rewrites per edit, so per-keystroke
   * writes would be wasteful (the same reason the provider dialog saves
   * through a button — a text field is not a toggle). */
  async function changeTierModel(tier: AiTier, model: string): Promise<void> {
    const previous = config
    const trimmed = model.trim()
    setConfig((current) => {
      if (!current) return current
      const tiers = { ...current.tiers }
      if (trimmed === "") {
        delete tiers[tier]
      } else {
        tiers[tier] = trimmed
      }
      return { ...current, tiers }
    })
    try {
      await setTierModel(getExecutor(), tier, model)
    } catch (error) {
      setConfig(previous)
      console.warn("[settings] failed to persist the AI tier model", error)
    }
  }

  async function changeOutputLanguage(language: string): Promise<void> {
    const previous = config
    const trimmed = language.trim()
    setConfig((current) =>
      current ? { ...current, outputLanguage: trimmed || null } : current
    )
    try {
      await setOutputLanguage(getExecutor(), language)
    } catch (error) {
      setConfig(previous)
      console.warn("[settings] failed to persist the AI output language", error)
    }
  }

  async function runTest(provider: AiProviderView): Promise<void> {
    setTestingId(provider.id)
    setTestOutcomes((current) => {
      const next = { ...current }
      delete next[provider.id]
      return next
    })
    try {
      const result = await testAiConnection(provider.id)
      setTestOutcomes((current) => ({
        ...current,
        [provider.id]: result.ok
          ? { ok: true, text: t("settingsAdvanced.ai.providers.connectionOk") }
          : { ok: false, text: result.reason },
      }))
    } catch (error) {
      // testAiConnection resolves failures into results; this is a belt-
      // and-braces guard so a row never shows a stale spinner.
      setTestOutcomes((current) => ({
        ...current,
        [provider.id]: {
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        },
      }))
    } finally {
      setTestingId(null)
    }
  }

  async function removeExec(providerId: string): Promise<void> {
    try {
      await removeProvider(getExecutor(), providerId)
      await refresh()
    } catch (error) {
      console.warn("[settings] failed to remove the AI provider", error)
    }
  }

  function openAdd(): void {
    setDialog({ mode: "add" })
    setKind("anthropic")
    setLabel(kindDefaultLabel(t, "anthropic"))
    setModel("")
    setBaseUrl("")
    setApiKey("")
    setFormError(null)
  }

  function openEdit(provider: AiProviderView): void {
    setDialog({ mode: "edit", provider })
    setKind(provider.kind)
    setLabel(provider.label)
    setModel(provider.model)
    setBaseUrl(provider.baseUrl ?? "")
    // The stored key is never read back (hasApiKey only): an empty field
    // means "keep the saved key", typing replaces it.
    setApiKey("")
    setFormError(null)
  }

  function chooseKind(next: AiProviderKind): void {
    setKind(next)
    // Keep a name the user typed; follow the kind when it still shows a
    // default (add mode only — edit pins the kind).
    if (dialog?.mode === "add") {
      setLabel((current) =>
        current.trim() === "" || isDefaultLabel(t, current)
          ? kindDefaultLabel(t, next)
          : current
      )
    }
    setFormError(null)
  }

  function saveDisabled(): boolean {
    if (label.trim() === "" || model.trim() === "") return true
    if (kind === "custom" && baseUrl.trim() === "") return true
    if (
      dialog?.mode === "add" &&
      providerRequiresApiKey(kind) &&
      apiKey.trim() === ""
    ) {
      return true
    }
    return false
  }

  async function saveProvider(): Promise<void> {
    if (!dialog) return
    setFormError(null)
    setSaving(true)
    const executor = getExecutor()
    try {
      if (dialog.mode === "edit") {
        // Vendor kinds pin their official endpoints Rust-side; the base
        // URL field only carries meaning for custom (and optional Ollama).
        const usesBaseUrl = kind === "custom" || kind === "ollama"
        const updated = await updateProvider(executor, dialog.provider.id, {
          label,
          model,
          baseUrl: usesBaseUrl && baseUrl.trim() !== "" ? baseUrl : null,
        })
        if (!updated) {
          setFormError(t("settingsAdvanced.ai.dialog.notFound"))
          return
        }
        if (apiKey.trim() !== "") {
          // Replace-key path: the plaintext goes straight into the
          // sealing setter — never persisted raw, never logged.
          await setProviderApiKey(executor, dialog.provider.id, apiKey)
        }
      } else {
        await addProvider(executor, {
          kind,
          label,
          model,
          ...(kind === "custom" || kind === "ollama" ? { baseUrl } : {}),
          ...(apiKey.trim() !== "" ? { apiKey } : {}),
        })
      }
      setDialog(null)
      await refresh()
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : t("settingsAdvanced.ai.dialog.saveFailed")
      )
    } finally {
      setSaving(false)
    }
  }

  async function clearCache(): Promise<void> {
    try {
      await clearAiCacheAll(getExecutor())
      setConfirmClearCache(false)
      await refresh()
    } catch (error) {
      console.warn("[settings] failed to clear the AI cache", error)
    }
  }

  async function clearUsage(): Promise<void> {
    try {
      await clearAiUsage(getExecutor())
      setConfirmClearUsage(false)
      await refresh()
    } catch (error) {
      console.warn("[settings] failed to clear the AI usage", error)
    }
  }

  if (config === null) {
    return (
      <section
        aria-label={t("settingsAdvanced.ai.ariaLabel")}
        className="flex flex-col gap-4"
      >
        <SectionHeader />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {t("settingsAdvanced.ai.loading")}
        </p>
      </section>
    )
  }

  return (
    <section
      aria-label={t("settingsAdvanced.ai.ariaLabel")}
      className="flex flex-col gap-4"
    >
      <SectionHeader />
      <Separator />
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="ai-enabled">{t("settingsAdvanced.ai.title")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("settingsAdvanced.ai.enableHint")}
          </p>
        </div>
        <Switch
          id="ai-enabled"
          checked={config.enabled}
          onCheckedChange={(checked) => {
            void changeEnabled(checked)
          }}
        />
      </div>

      {config.enabled ? (
        <>
          <ProvidersBlock
            config={config}
            dialog={dialog}
            kind={kind}
            label={label}
            model={model}
            baseUrl={baseUrl}
            apiKey={apiKey}
            formError={formError}
            saving={saving}
            testingId={testingId}
            testOutcomes={testOutcomes}
            saveDisabled={saveDisabled()}
            onAdd={openAdd}
            onEdit={openEdit}
            onRemove={(id) => {
              void removeExec(id)
            }}
            onTest={(provider) => {
              void runTest(provider)
            }}
            onActivate={(id) => {
              void chooseActive(id)
            }}
            onKindChange={chooseKind}
            onLabelChange={setLabel}
            onModelChange={setModel}
            onBaseUrlChange={setBaseUrl}
            onApiKeyChange={(next) => {
              setApiKey(next)
              setFormError(null)
            }}
            onDialogChange={setDialog}
            onSave={() => {
              void saveProvider()
            }}
          />

          <Separator />

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold text-foreground">
              {t("settingsAdvanced.ai.surfaces.title")}
            </legend>
            <p className="text-xs text-muted-foreground">
              {t("settingsAdvanced.ai.surfaces.description")}
            </p>
            {AI_SURFACE_IDS.map((surface) => (
              <div
                key={surface}
                className="flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <Label htmlFor={`ai-surface-${surface}`}>
                    {surfaceLabel(t, surface)}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {surfaceDescription(t, surface)}
                  </p>
                </div>
                <Switch
                  id={`ai-surface-${surface}`}
                  checked={config.surfaces[surface]}
                  onCheckedChange={(checked) => {
                    void changeSurface(surface, checked)
                  }}
                />
              </div>
            ))}
          </fieldset>

          <Separator />

          <TiersBlock
            config={config}
            onChangeSurfaceTier={(surface, tier) => {
              void changeSurfaceTier(surface, tier)
            }}
            onChangeTierModel={(tier, nextModel) => {
              void changeTierModel(tier, nextModel)
            }}
            onChangeOutputLanguage={(language) => {
              void changeOutputLanguage(language)
            }}
          />

          <Separator />

          {/* Semantic search (parity-round-3 task 6.5): the local vector
              index behind the assistant's meaning-based retrieval — a
              self-contained block (its own component file), inserted
              here and nowhere else. */}
          <SemanticSearchSection />

          <Separator />

          {/* Voice (parity-round-3 tasks 7.2/7.3): dictation model +
              language picker and the writing-voice profile — a
              self-contained block (its own component file), inserted
              here and nowhere else. */}
          <VoiceSection />

          <Separator />

          <WritingStyleBlock />

          <Separator />

          <CacheBlock
            cache={cache}
            confirmClear={confirmClearCache}
            onConfirmClearChange={setConfirmClearCache}
            onClear={() => {
              void clearCache()
            }}
          />

          <Separator />

          <UsageBlock
            usage={usage}
            confirmClear={confirmClearUsage}
            onConfirmClearChange={setConfirmClearUsage}
            onClear={() => {
              void clearUsage()
            }}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("settingsAdvanced.ai.offHint")}
        </p>
      )}

      <Separator />
      <p className="text-xs text-muted-foreground">
        {t("settingsAdvanced.ai.keysFinePrint")}
      </p>
    </section>
  )
}

function SectionHeader() {
  const { t } = useTranslation()
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">
        {t("settingsAdvanced.ai.title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("settingsAdvanced.ai.description")}
      </p>
    </div>
  )
}

interface ProvidersBlockProps {
  config: AiSettingsView
  dialog: DialogTarget | null
  kind: AiProviderKind
  label: string
  model: string
  baseUrl: string
  apiKey: string
  formError: string | null
  saving: boolean
  testingId: string | null
  testOutcomes: Record<string, TestOutcome>
  saveDisabled: boolean
  onAdd: () => void
  onEdit: (provider: AiProviderView) => void
  onRemove: (providerId: string) => void
  onTest: (provider: AiProviderView) => void
  onActivate: (providerId: string) => void
  onKindChange: (kind: AiProviderKind) => void
  onLabelChange: (label: string) => void
  onModelChange: (model: string) => void
  onBaseUrlChange: (baseUrl: string) => void
  onApiKeyChange: (apiKey: string) => void
  onDialogChange: (dialog: DialogTarget | null) => void
  onSave: () => void
}

function ProvidersBlock(props: ProvidersBlockProps) {
  const { t } = useTranslation()
  const { config } = props
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("settingsAdvanced.ai.providers.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settingsAdvanced.ai.providers.description")}
          </p>
        </div>
        <Button size="sm" onClick={props.onAdd}>
          <Plus aria-hidden />
          {t("settingsAdvanced.ai.providers.add")}
        </Button>
      </div>

      {config.providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsAdvanced.ai.providers.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {config.providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              isActive={config.activeProviderId === provider.id}
              testing={props.testingId === provider.id}
              outcome={props.testOutcomes[provider.id]}
              onActivate={props.onActivate}
              onTest={props.onTest}
              onEdit={props.onEdit}
              onRemove={props.onRemove}
            />
          ))}
        </ul>
      )}

      <ProviderDialog
        dialog={props.dialog}
        kind={props.kind}
        label={props.label}
        model={props.model}
        baseUrl={props.baseUrl}
        apiKey={props.apiKey}
        formError={props.formError}
        saving={props.saving}
        saveDisabled={props.saveDisabled}
        onKindChange={props.onKindChange}
        onLabelChange={props.onLabelChange}
        onModelChange={props.onModelChange}
        onBaseUrlChange={props.onBaseUrlChange}
        onApiKeyChange={props.onApiKeyChange}
        onDialogChange={props.onDialogChange}
        onSave={props.onSave}
      />
    </div>
  )
}

interface ProviderRowProps {
  provider: AiProviderView
  isActive: boolean
  testing: boolean
  outcome: TestOutcome | undefined
  onActivate: (providerId: string) => void
  onTest: (provider: AiProviderView) => void
  onEdit: (provider: AiProviderView) => void
  onRemove: (providerId: string) => void
}

function ProviderRow(props: ProviderRowProps) {
  const { t } = useTranslation()
  const { provider } = props
  return (
    <li
      data-testid="ai-provider-row"
      className="flex flex-col gap-1.5 rounded-md border p-3"
    >
      <div className="flex items-center gap-3">
        <input
          type="radio"
          name="ai-active-provider"
          value={provider.id}
          checked={props.isActive}
          onChange={() => props.onActivate(provider.id)}
          aria-label={t("settingsAdvanced.ai.providers.use", {
            label: provider.label,
          })}
          className="size-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {provider.label}
            </span>
            <Badge variant="outline">{kindLabel(t, provider.kind)}</Badge>
            {provider.kind === "ollama" ? (
              <span className="text-xs text-muted-foreground">
                {t("settingsAdvanced.ai.providers.noKeyNeeded")}
              </span>
            ) : provider.hasApiKey ? (
              <Badge variant="secondary">
                {t("settingsAdvanced.ai.providers.keySaved")}
              </Badge>
            ) : (
              <Badge variant="outline">
                {t("settingsAdvanced.ai.providers.noApiKey")}
              </Badge>
            )}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {provider.model === ""
              ? t("settingsAdvanced.ai.providers.noModel")
              : provider.model}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={props.testing}
            onClick={() => props.onTest(provider)}
          >
            {props.testing ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : null}
            {t("settingsAdvanced.ai.providers.testConnection")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("settingsAdvanced.ai.providers.edit", {
              label: provider.label,
            })}
            onClick={() => props.onEdit(provider)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("settingsAdvanced.ai.providers.remove", {
              label: provider.label,
            })}
            onClick={() => props.onRemove(provider.id)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {props.outcome ? (
        <p
          data-testid="ai-connection-result"
          role={props.outcome.ok ? "status" : "alert"}
          className={
            props.outcome.ok
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"
          }
        >
          {props.outcome.text}
        </p>
      ) : null}
    </li>
  )
}

interface ProviderDialogProps {
  dialog: DialogTarget | null
  kind: AiProviderKind
  label: string
  model: string
  baseUrl: string
  apiKey: string
  formError: string | null
  saving: boolean
  saveDisabled: boolean
  onKindChange: (kind: AiProviderKind) => void
  onLabelChange: (label: string) => void
  onModelChange: (model: string) => void
  onBaseUrlChange: (baseUrl: string) => void
  onApiKeyChange: (apiKey: string) => void
  onDialogChange: (dialog: DialogTarget | null) => void
  onSave: () => void
}

function ProviderDialog(props: ProviderDialogProps) {
  const { t } = useTranslation()
  const open = props.dialog !== null
  const isEdit = props.dialog?.mode === "edit"
  const usesBaseUrl = props.kind === "custom" || props.kind === "ollama"
  const usesApiKey = props.kind !== "ollama"
  const kindItems = Object.fromEntries(
    AI_PROVIDER_KINDS.map((candidate) => [candidate, kindLabel(t, candidate)])
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onDialogChange(null)
      }}
    >
      <DialogContent data-testid="ai-provider-dialog">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("settingsAdvanced.ai.dialog.editTitle")
              : t("settingsAdvanced.ai.dialog.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settingsAdvanced.ai.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {isEdit ? (
            <p className="text-xs text-muted-foreground">
              {t("settingsAdvanced.ai.dialog.providerTypeValue", {
                kind: kindLabel(t, props.kind),
              })}
            </p>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="ai-provider-kind">
                {t("settingsAdvanced.ai.dialog.providerType")}
              </Label>
              <Select
                value={props.kind}
                items={kindItems}
                onValueChange={(value) =>
                  props.onKindChange(String(value) as AiProviderKind)
                }
              >
                <SelectTrigger id="ai-provider-kind" className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_KINDS.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {kindLabel(t, candidate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="ai-provider-label">
              {t("settingsAdvanced.ai.dialog.name")}
            </Label>
            <Input
              id="ai-provider-label"
              value={props.label}
              onChange={(event) => props.onLabelChange(event.target.value)}
              placeholder={t("settingsAdvanced.ai.dialog.namePlaceholder")}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ai-provider-model">
              {t("settingsAdvanced.ai.dialog.modelId")}
            </Label>
            <Input
              id="ai-provider-model"
              value={props.model}
              onChange={(event) => props.onModelChange(event.target.value)}
              placeholder={kindModelPlaceholder(t, props.kind)}
              className="font-mono"
            />
          </div>

          {usesBaseUrl ? (
            <div className="grid gap-2">
              <Label htmlFor="ai-provider-base-url">
                {props.kind === "custom"
                  ? t("settingsAdvanced.ai.dialog.baseUrl")
                  : t("settingsAdvanced.ai.dialog.baseUrlOptional")}
              </Label>
              <Input
                id="ai-provider-base-url"
                value={props.baseUrl}
                onChange={(event) => props.onBaseUrlChange(event.target.value)}
                placeholder={
                  props.kind === "ollama"
                    ? "http://localhost:11434"
                    : "https://your-endpoint.example.com/v1"
                }
                className="font-mono"
              />
            </div>
          ) : null}

          {props.kind === "ollama" ? (
            <p className="text-xs text-muted-foreground">
              {t("settingsAdvanced.ai.dialog.ollamaHint")}
            </p>
          ) : usesApiKey ? (
            <div className="grid gap-2">
              <Label htmlFor="ai-provider-api-key">
                {t("settingsAdvanced.ai.dialog.apiKey")}
              </Label>
              <Input
                id="ai-provider-api-key"
                type="password"
                value={props.apiKey}
                onChange={(event) => props.onApiKeyChange(event.target.value)}
                placeholder={
                  props.dialog?.mode === "edit" &&
                  props.dialog.provider.hasApiKey
                    ? t("settingsAdvanced.ai.dialog.apiKeySaved")
                    : t("settingsAdvanced.ai.dialog.apiKeyPlaceholder")
                }
                autoComplete="off"
                className="font-mono"
              />
            </div>
          ) : null}

          {props.formError ? (
            <p role="alert" className="text-xs text-destructive">
              {props.formError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => props.onDialogChange(null)}
            disabled={props.saving}
          >
            {t("settingsAdvanced.ai.dialog.cancel")}
          </Button>
          <Button
            onClick={props.onSave}
            disabled={props.saveDisabled || props.saving}
          >
            {props.saving ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : null}
            {isEdit
              ? t("settingsAdvanced.ai.dialog.saveChanges")
              : t("settingsAdvanced.ai.dialog.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface CacheBlockProps {
  cache: AiCacheStats | null
  confirmClear: boolean
  onConfirmClearChange: (confirm: boolean) => void
  onClear: () => void
}

function CacheBlock(props: CacheBlockProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("settingsAdvanced.ai.cache.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("settingsAdvanced.ai.cache.description")}
      </p>
      {props.cache === null ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsAdvanced.ai.cache.loading")}
        </p>
      ) : (
        <div data-testid="ai-cache-stats" className="flex flex-col gap-1">
          <p className="text-sm text-foreground">
            {t("settingsAdvanced.ai.cache.total", { count: props.cache.total })}
          </p>
          {props.cache.byKind.map((entry) => (
            <p key={entry.kind} className="text-xs text-muted-foreground">
              {entry.kind}: {entry.count}
            </p>
          ))}
        </div>
      )}
      {props.cache !== null && props.cache.total > 0 ? (
        props.confirmClear ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("settingsAdvanced.ai.cache.confirm", {
                count: props.cache.total,
              })}
            </span>
            <Button size="sm" variant="destructive" onClick={props.onClear}>
              {t("settingsAdvanced.ai.cache.clearAll")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.onConfirmClearChange(false)}
            >
              {t("settingsAdvanced.ai.cache.cancel")}
            </Button>
          </div>
        ) : (
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onConfirmClearChange(true)}
            >
              {t("settingsAdvanced.ai.cache.clearAll")}
            </Button>
          </div>
        )
      ) : null}
    </div>
  )
}

/**
 * Settings → AI "Model tiers" block (parity-round-2 task 2.1, spec
 * "Per-scenario AI model routing", design D8): one tier selector per
 * surface plus the per-tier model ids for the ACTIVE provider and the
 * output-language control. One tier set applies to whichever provider is
 * active; a tier left blank falls back to that provider's default model
 * (spec "Tier fallback"), which the copy states. Tier changes persist
 * immediately (they are selections); the text fields persist on blur —
 * a per-keystroke whole-row rewrite would be wasteful.
 */
interface TiersBlockProps {
  config: AiSettingsView
  onChangeSurfaceTier: (surface: AiSurfaceId, tier: AiTier) => void
  onChangeTierModel: (tier: AiTier, model: string) => void
  onChangeOutputLanguage: (language: string) => void
}

function TiersBlock(props: TiersBlockProps) {
  const { t } = useTranslation()
  const { config } = props
  const tierItems = Object.fromEntries(
    AI_TIERS.map((tier) => [tier, tierLabel(t, tier)])
  )
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {t("settingsAdvanced.ai.tiers.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("settingsAdvanced.ai.tiers.description")}
        </p>
      </div>

      {AI_SURFACE_IDS.map((surface) => (
        <div key={surface} className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor={`ai-tier-${surface}`}>
              {surfaceLabel(t, surface)}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settingsAdvanced.ai.tiers.current", {
                tier: tierLabel(t, config.surfaceTiers[surface]),
              })}
            </p>
          </div>
          <Select
            value={config.surfaceTiers[surface]}
            items={tierItems}
            onValueChange={(value) => {
              props.onChangeSurfaceTier(surface, String(value) as AiTier)
            }}
          >
            <SelectTrigger
              id={`ai-tier-${surface}`}
              aria-label={t("settingsAdvanced.ai.tiers.tierFor", {
                surface: surfaceLabel(t, surface),
              })}
              className="w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_TIERS.map((tier) => (
                <SelectItem key={tier} value={tier}>
                  {tierLabel(t, tier)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      <div className="grid gap-3 sm:grid-cols-3">
        {AI_TIERS.map((tier) => (
          <div key={tier} className="grid gap-2">
            <Label htmlFor={`ai-tier-model-${tier}`}>
              {t("settingsAdvanced.ai.tiers.modelId", {
                tier: tierLabel(t, tier),
              })}
            </Label>
            {/* Uncontrolled + blur-persist: the key re-mounts the field
            whenever the stored value changes (initial load, refresh,
            post-persist trim); typing stays in the DOM until blur. */}
            <Input
              key={`ai-tier-model-${tier}-${config.tiers[tier] ?? ""}`}
              id={`ai-tier-model-${tier}`}
              defaultValue={config.tiers[tier] ?? ""}
              onBlur={(event) =>
                props.onChangeTierModel(tier, event.target.value)
              }
              placeholder={tierModelPlaceholder(t, tier)}
              className="font-mono"
            />
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ai-output-language">
          {t("settingsAdvanced.ai.tiers.outputLanguage")}
        </Label>
        <Input
          key={`ai-output-language-${config.outputLanguage ?? ""}`}
          id="ai-output-language"
          defaultValue={config.outputLanguage ?? ""}
          onBlur={(event) => props.onChangeOutputLanguage(event.target.value)}
          placeholder={t("settingsAdvanced.ai.tiers.outputLanguagePlaceholder")}
        />
        <p className="text-xs text-muted-foreground">
          {t("settingsAdvanced.ai.tiers.outputLanguageHint")}
        </p>
      </div>
    </div>
  )
}

/**
 * Settings → AI "Usage" block (parity-round-2 task 2.3, spec "Usage
 * visibility"): per-surface request counts and token totals over the
 * `ai_usage` rows, refreshed on open (the section loads the summary
 * alongside the settings). Totals that include estimated rows are
 * labeled "approx." (design risk note: estimates mislead) — a row is
 * estimated when the provider did not report tokens and the chars/4
 * estimate was recorded instead. Cache hits make no provider request and
 * are not counted. Clearing is a two-step confirm, like the cache clear.
 */
interface UsageBlockProps {
  usage: AiUsageSummary | null
  confirmClear: boolean
  onConfirmClearChange: (confirm: boolean) => void
  onClear: () => void
}

function UsageBlock(props: UsageBlockProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("settingsAdvanced.ai.usage.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("settingsAdvanced.ai.usage.description")}
      </p>
      {props.usage === null ? (
        <p className="text-sm text-muted-foreground">
          {t("settingsAdvanced.ai.usage.loading")}
        </p>
      ) : props.usage.totalRequests === 0 ? (
        <p data-testid="ai-usage-stats" className="text-sm text-foreground">
          {t("settingsAdvanced.ai.usage.empty")}
        </p>
      ) : (
        <div data-testid="ai-usage-stats" className="flex flex-col gap-1">
          {props.usage.surfaces.map((surface) => {
            const label = isAiSurfaceId(surface.surface)
              ? surfaceLabel(t, surface.surface)
              : surface.surface
            const values = {
              surface: label,
              count: surface.requests,
              prompt: surface.promptTokens,
              completion: surface.completionTokens,
              total: surface.totalTokens,
            }
            return (
              <p
                key={surface.surface}
                className="text-xs text-muted-foreground"
              >
                {surface.estimatedRequests > 0
                  ? t("settingsAdvanced.ai.usage.lineApprox", values)
                  : t("settingsAdvanced.ai.usage.line", values)}
              </p>
            )
          })}
        </div>
      )}
      {props.usage !== null && props.usage.totalRequests > 0 ? (
        props.confirmClear ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("settingsAdvanced.ai.usage.confirm", {
                count: props.usage.totalRequests,
              })}
            </span>
            <Button size="sm" variant="destructive" onClick={props.onClear}>
              {t("settingsAdvanced.ai.usage.clear")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.onConfirmClearChange(false)}
            >
              {t("settingsAdvanced.ai.usage.cancel")}
            </Button>
          </div>
        ) : (
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => props.onConfirmClearChange(true)}
            >
              {t("settingsAdvanced.ai.usage.clear")}
            </Button>
          </div>
        )
      ) : null}
    </div>
  )
}

/** Human copy for the profile-build failure reasons (mirrors the smart-
 * reply dialog's copy — same typed reasons, one voice). */
function buildFailureCopy(
  t: TFunction,
  reason: StyleProfileBuildFailure
): string {
  switch (reason) {
    case "not-configured":
      return t("settingsAdvanced.ai.writingStyle.failures.notConfigured")
    case "no-sent-mail":
      return t("settingsAdvanced.ai.writingStyle.failures.noSentMail")
    case "parse":
      return t("settingsAdvanced.ai.writingStyle.failures.parse")
    case "provider":
      return t("settingsAdvanced.ai.writingStyle.failures.provider")
  }
}

/**
 * Settings → AI "Writing style" block (task 4.5, ai-assistance spec
 * "Writing-style smart replies", scenario "Rebuild the profile"): the
 * profile STATUS for the active account (built when · how many sent
 * messages were analyzed / none yet) plus Rebuild and Delete.
 *
 * Consent lives in the description: it states verbatim that building
 * analyzes the account's recent sent messages with the active provider,
 * and that suggestions stay editable drafts — nothing is sent
 * automatically. A rebuild re-runs the analysis and REPORTS COMPLETION
 * inline (role=status) with the new sample size; a delete removes the
 * stored profile outright (rebuilds simply save over it, so no confirm —
 * the row is re-creatable in one click). The profile is per ACCOUNT: the
 * block scopes to the account-store's active account and says so when
 * none is active.
 */
function WritingStyleBlock() {
  const { t } = useTranslation()
  const activeAccountId = useAccountStore((state) => state.activeAccountId)
  /** The loaded status, keyed by the account it was loaded FOR — the
   * render derives "Loading…" while a different account's probe is in
   * flight, so the load effect never needs a synchronous setState reset
   * (react-hooks/set-state-in-effect). */
  const [loadedFor, setLoadedFor] = useState<{
    accountId: string
    profile: WritingStyleProfileEnvelope | null
  } | null>(null)
  const [building, setBuilding] = useState(false)
  const [notice, setNotice] = useState<{
    accountId: string
    ok: boolean
    text: string
  } | null>(null)

  const statusKnown = loadedFor?.accountId === activeAccountId
  const profile = statusKnown ? (loadedFor?.profile ?? null) : null
  const accountNotice = notice?.accountId === activeAccountId ? notice : null

  useEffect(() => {
    if (activeAccountId === null) return
    let cancelled = false
    // The probe runs through an async IIFE so even getExecutor()'s
    // synchronous throw (plain vite) resolves through the same
    // callback-setState path — never a synchronous setState here.
    void (async () => {
      try {
        const stored = await loadStyleProfile(getExecutor(), activeAccountId)
        if (!cancelled) {
          setLoadedFor({ accountId: activeAccountId, profile: stored })
        }
      } catch {
        if (!cancelled) {
          setLoadedFor({ accountId: activeAccountId, profile: null })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeAccountId])

  async function rebuild(): Promise<void> {
    if (activeAccountId === null || building) return
    setBuilding(true)
    setNotice(null)
    try {
      const result = await buildWritingStyleProfile(
        getExecutor(),
        activeAccountId
      )
      if (result.ok) {
        // Spec scenario "Rebuild the profile": re-analyze and report
        // completion (inline status + the refreshed built-at line).
        const stored = await loadStyleProfile(getExecutor(), activeAccountId)
        setLoadedFor({ accountId: activeAccountId, profile: stored })
        setNotice({
          accountId: activeAccountId,
          ok: true,
          text: t("settingsAdvanced.ai.writingStyle.rebuilt", {
            count: result.sampleSize,
          }),
        })
      } else {
        setNotice({
          accountId: activeAccountId,
          ok: false,
          text:
            result.reason === "provider" && result.message
              ? t(
                  "settingsAdvanced.ai.writingStyle.failures.providerWithMessage",
                  { message: result.message }
                )
              : buildFailureCopy(t, result.reason),
        })
      }
    } catch (error) {
      console.warn("[settings] writing-style rebuild failed", error)
      setNotice({
        accountId: activeAccountId,
        ok: false,
        text: t("settingsAdvanced.ai.writingStyle.rebuildFailed"),
      })
    } finally {
      setBuilding(false)
    }
  }

  async function remove(): Promise<void> {
    if (activeAccountId === null) return
    try {
      await deleteStyleProfile(getExecutor(), activeAccountId)
      setLoadedFor({ accountId: activeAccountId, profile: null })
      setNotice({
        accountId: activeAccountId,
        ok: true,
        text: t("settingsAdvanced.ai.writingStyle.deleted"),
      })
    } catch (error) {
      console.warn("[settings] writing-style delete failed", error)
    }
  }

  return (
    <div
      data-testid="writing-style-block"
      className="flex flex-col gap-2"
      aria-label={t("settingsAdvanced.ai.writingStyle.ariaLabel")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {t("settingsAdvanced.ai.writingStyle.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settingsAdvanced.ai.writingStyle.description")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            data-testid="writing-style-rebuild"
            disabled={building || activeAccountId === null}
            onClick={() => {
              void rebuild()
            }}
          >
            {building ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            {statusKnown && profile
              ? t("settingsAdvanced.ai.writingStyle.rebuild")
              : t("settingsAdvanced.ai.writingStyle.build")}
          </Button>
          {profile ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid="writing-style-delete"
              disabled={building}
              aria-label={t("settingsAdvanced.ai.writingStyle.delete")}
              onClick={() => {
                void remove()
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {activeAccountId === null ? (
        <p className="text-xs text-muted-foreground">
          {t("settingsAdvanced.ai.writingStyle.noAccount")}
        </p>
      ) : statusKnown ? (
        <p
          data-testid="writing-style-status"
          className="text-sm text-foreground"
        >
          {profile
            ? t("settingsAdvanced.ai.writingStyle.built", {
                when: formatDistanceToNow(fromUnixTime(profile.builtAt), {
                  addSuffix: true,
                }),
                count: profile.sampleSize,
              })
            : t("settingsAdvanced.ai.writingStyle.none")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("settingsAdvanced.ai.writingStyle.loading")}
        </p>
      )}
      {accountNotice !== null && (
        <p
          data-testid="writing-style-notice"
          role={accountNotice.ok ? "status" : "alert"}
          className={
            accountNotice.ok
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"
          }
        >
          {accountNotice.text}
        </p>
      )}
    </div>
  )
}
