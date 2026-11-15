import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  addMicrosoftAccount,
  cancelOauthWait,
  OauthCancelledError,
} from "@/services/account-flows"
import type { MicrosoftFlowStep } from "@/services/account-flows"
import { OAUTH_LOOPBACK_PORT } from "@/services/account-flows"
import type { HistoryWindowSetting } from "@/services/sync/history-window"
import { HistoryWindowField } from "./history-window-field"

/**
 * Add-Microsoft 365 flow UI (parity-round-2 task 3.5): registration help,
 * then Client ID entry, then the browser consent round-trip driven by
 * addMicrosoftAccount.
 *
 * Emailer ships NO bundled Microsoft registration — a personal app
 * registration is REQUIRED before the flow can start (the accounts spec:
 * "clearing it restores the built-in registration when one exists" — for
 * Microsoft none exists, so clearing leaves the app unset and this flow
 * explains what to create). The help text covers the redirect URI
 * (http://localhost:<port>, public client, no secret) and the work/school
 * admin-consent caveat (an organization may require admin approval for
 * the app registration).
 *
 * Consent denial and a rejected Client ID surface as retryable inline
 * errors (no account is created); a local cancel is quiet. Closing the
 * dialog while the consent wait is pending cancels the loopback server
 * so nothing leaks (the add-gmail contract).
 */

function stepLabel(t: TFunction, step: MicrosoftFlowStep): string {
  switch (step) {
    case "consent":
      return t("accounts.oauth.steps.consent")
    case "exchange":
      return t("accounts.oauth.steps.exchange")
    case "profile":
      return t("accounts.oauth.steps.microsoftProfile")
    case "save":
      return t("accounts.oauth.steps.save")
  }
}

/** Microsoft Entra's app-registration portal, linked from the help text. */
const ENTRA_APP_REGISTRATIONS_URL =
  "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"

interface AddMicrosoftFlowProps {
  onBack: () => void
  /** Called after the account row is saved; the host closes the dialog. */
  onSuccess: () => void
}

export function AddMicrosoftFlow({ onBack, onSuccess }: AddMicrosoftFlowProps) {
  const { t } = useTranslation()
  const [clientId, setClientId] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [historyWindow, setHistoryWindow] = useState<HistoryWindowSetting>(null)
  const [working, setWorking] = useState(false)
  const [step, setStep] = useState<MicrosoftFlowStep>("consent")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /** Mirrors `working` for the unmount cleanup (stale-closure-free). */
  const workingRef = useRef(false)

  // Leak-free cancellation: if the dialog closes (or the flow unmounts)
  // while the loopback wait is pending, abort it.
  useEffect(() => {
    return () => {
      if (workingRef.current) {
        void cancelOauthWait().catch(() => {
          // Nothing to cancel is fine (wait already settled).
        })
      }
    }
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = clientId.trim()
    if (!trimmed) {
      setValidationError(t("accounts.oauth.enterMicrosoftClientId"))
      return
    }
    setValidationError(null)
    setErrorMessage(null)
    setWorking(true)
    workingRef.current = true
    try {
      await addMicrosoftAccount({
        clientId: trimmed,
        historyWindow,
        onProgress: setStep,
      })
      onSuccess()
    } catch (error) {
      if (error instanceof OauthCancelledError) {
        // Quiet: the user backed out; stay on the Client ID step.
        return
      }
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("accounts.oauth.signInFailed")
      )
    } finally {
      workingRef.current = false
      setWorking(false)
    }
  }

  if (working) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("accounts.microsoft.title")}</DialogTitle>
          <DialogDescription>
            {t("accounts.microsoft.waiting")}
          </DialogDescription>
        </DialogHeader>
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 py-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          {stepLabel(t, step)}
        </div>
        <div className="flex justify-start">
          <Button
            variant="outline"
            onClick={() => {
              // Aborts the loopback wait; the orchestrator rejects as
              // cancelled and lands us back on the Client ID step.
              void cancelOauthWait().catch(() => {})
            }}
          >
            {t("accounts.oauth.cancel")}
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("accounts.microsoft.title")}</DialogTitle>
        <DialogDescription>
          {t("accounts.microsoft.description")}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-3">
        <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p>
            <Trans
              i18nKey="accounts.microsoft.registerHelp"
              values={{ port: OAUTH_LOOPBACK_PORT }}
              components={{
                link: (
                  <a
                    href={ENTRA_APP_REGISTRATIONS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  />
                ),
                code: (
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono" />
                ),
                em: <em />,
              }}
            />
          </p>
          <p>{t("accounts.microsoft.adminHelp")}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="microsoft-client-id">
            {t("accounts.oauth.applicationClientId")}
          </Label>
          <Input
            id="microsoft-client-id"
            autoFocus
            placeholder="00000000-0000-0000-0000-000000000000"
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value)
              setValidationError(null)
            }}
            aria-invalid={validationError ? true : undefined}
            className={cn(
              validationError &&
                "border-destructive focus-visible:ring-destructive/30"
            )}
          />
          {validationError && (
            <p role="alert" className="text-xs text-destructive">
              {validationError}
            </p>
          )}
        </div>
        <HistoryWindowField
          id="microsoft-history-window"
          value={historyWindow}
          onChange={setHistoryWindow}
          disabled={working}
        />
        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-1"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("accounts.oauth.back")}
          </Button>
          <Button type="submit">{t("accounts.oauth.continueInBrowser")}</Button>
        </div>
      </form>
    </>
  )
}
