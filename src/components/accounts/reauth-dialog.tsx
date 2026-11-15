import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getAccount } from "@/services/db/accounts"
import { getExecutor } from "@/services/db/executor"
import {
  ImapTestFailedError,
  OauthCancelledError,
  SmtpTestFailedError,
  cancelOauthWait,
  reauthGmailAccount,
  reauthImapPassword,
  reauthMicrosoftAccount,
} from "@/services/account-flows"
import type { GmailFlowStep } from "@/services/account-flows"
import type { AccountInfo } from "@/stores/account-store"

/**
 * Re-authentication dialog (task 5.6, accounts spec "Refresh token
 * revoked" / "IMAP password changed"). Rendered for an account the
 * scheduler paused as auth-error:
 *
 * - gmail: the stored Client ID pre-filled (editable), then the same
 *   browser consent round-trip the add flow uses. Local mail data is
 *   never touched; on success the account returns to "active" and sync
 *   resumes immediately.
 * - imap: new password entry; the orchestrator re-tests BOTH connections
 *   against the stored server settings before saving anything.
 *
 * The host keys this component by target account (and remounts it on
 * every open), so its input/in-flight state always starts fresh. Closing
 * while a consent wait is pending unmounts the instance and cancels the
 * loopback server, so nothing leaks (same contract as the add flow); a
 * local cancel is a quiet no-op.
 */

function stepLabel(
  t: TFunction,
  step: GmailFlowStep,
  provider: "gmail" | "microsoft"
): string {
  switch (step) {
    case "consent":
      return t("accounts.oauth.steps.consent")
    case "exchange":
      return t("accounts.oauth.steps.exchange")
    case "profile":
      return provider === "microsoft"
        ? t("accounts.oauth.steps.microsoftProfile")
        : t("accounts.oauth.steps.gmailProfile")
    case "save":
      return t("accounts.oauth.steps.update")
  }
}

interface ReauthDialogProps {
  account: AccountInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReauthDialog({
  account,
  open,
  onOpenChange,
}: ReauthDialogProps) {
  const { t } = useTranslation()
  const [clientId, setClientId] = useState("")
  const [password, setPassword] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [step, setStep] = useState<GmailFlowStep>("consent")
  /** True only while the browser consent wait is pending. */
  const consentRef = useRef(false)

  const accountId = account?.id
  const isGmail = account?.type === "gmail"
  const isMicrosoft = account?.type === "microsoft"
  // The OAuth flows share one dialog shape; only the provider copy and
  // the submit handler differ.
  const oauthProvider = isMicrosoft ? "microsoft" : isGmail ? "gmail" : null

  // Pre-fill the stored Client ID so OAuth re-authentication is usually a
  // single "Continue" — best-effort: before initDatabase() (plain vite,
  // tests) getExecutor() throws and the field simply starts empty.
  useEffect(() => {
    if (!open || !accountId || (!isGmail && !isMicrosoft)) return
    let cancelled = false
    void (async () => {
      try {
        const row = await getAccount(getExecutor(), accountId)
        if (!cancelled && row?.oauth_client_id) {
          setClientId(row.oauth_client_id)
        }
      } catch {
        // No database binding — start with an empty field.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, accountId, isGmail, isMicrosoft])

  // If the dialog closes while the consent wait is pending, abort the
  // loopback server; the pending flow rejects as cancelled and its handler
  // stays quiet.
  useEffect(() => {
    if (!open) return
    return () => {
      if (consentRef.current) {
        void cancelOauthWait().catch(() => {
          // Nothing to cancel is fine (wait already settled).
        })
      }
    }
  }, [open])

  function handleError(error: unknown, fallback: string): void {
    setErrorMessage(error instanceof Error ? error.message : fallback)
  }

  async function handleGmailSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!account) return
    const trimmed = clientId.trim()
    if (!trimmed) {
      setValidationError(t("accounts.oauth.enterGoogleClientId"))
      return
    }
    setValidationError(null)
    setErrorMessage(null)
    setWorking(true)
    consentRef.current = true
    try {
      await reauthGmailAccount(account.id, {
        clientId: trimmed,
        onProgress: setStep,
      })
      onOpenChange(false)
    } catch (error) {
      if (error instanceof OauthCancelledError) {
        // Quiet: the user backed out; stay on the Client ID step.
        return
      }
      handleError(error, t("accounts.oauth.signInFailed"))
    } finally {
      consentRef.current = false
      setWorking(false)
    }
  }

  async function handleMicrosoftSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!account) return
    const trimmed = clientId.trim()
    if (!trimmed) {
      setValidationError(t("accounts.oauth.enterMicrosoftClientId"))
      return
    }
    setValidationError(null)
    setErrorMessage(null)
    setWorking(true)
    consentRef.current = true
    try {
      await reauthMicrosoftAccount(account.id, {
        clientId: trimmed,
        onProgress: setStep,
      })
      onOpenChange(false)
    } catch (error) {
      if (error instanceof OauthCancelledError) {
        // Quiet: the user backed out; stay on the Client ID step.
        return
      }
      handleError(error, t("accounts.oauth.signInFailed"))
    } finally {
      consentRef.current = false
      setWorking(false)
    }
  }

  async function handleImapSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!account) return
    if (!password) {
      setValidationError(t("accounts.reauth.enterNewPassword"))
      return
    }
    setValidationError(null)
    setWorking(true)
    try {
      // Both connection tests run inside the orchestrator before anything
      // is saved; the typed errors say WHICH side rejected the password.
      await reauthImapPassword(account.id, password)
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ImapTestFailedError) {
        setErrorMessage(
          t("accounts.reauth.incomingFailed", { message: error.message })
        )
      } else if (error instanceof SmtpTestFailedError) {
        setErrorMessage(
          t("accounts.reauth.outgoingFailed", { message: error.message })
        )
      } else {
        handleError(error, t("accounts.reauth.updateFailed"))
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open && account !== null} onOpenChange={onOpenChange}>
      {account && (
        <DialogContent>
          {oauthProvider !== null ? (
            working ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t("accounts.reauth.signInAgain")}</DialogTitle>
                  <DialogDescription>
                    {oauthProvider === "microsoft"
                      ? t("accounts.reauth.waitingMicrosoft", {
                          email: account.email,
                        })
                      : t("accounts.reauth.waitingGoogle", {
                          email: account.email,
                        })}
                  </DialogDescription>
                </DialogHeader>
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-3 py-2 text-sm text-muted-foreground"
                >
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  {stepLabel(t, step, oauthProvider)}
                </div>
                <div className="flex justify-start">
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Aborts the loopback wait; the flow rejects as
                      // cancelled and lands back on the Client ID step.
                      void cancelOauthWait().catch(() => {})
                    }}
                  >
                    {t("accounts.oauth.cancel")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>{t("accounts.reauth.signInAgain")}</DialogTitle>
                  <DialogDescription>
                    {oauthProvider === "microsoft"
                      ? t("accounts.reauth.brokenMicrosoft", {
                          email: account.email,
                        })
                      : t("accounts.reauth.brokenGoogle", {
                          email: account.email,
                        })}
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(event) => {
                    void (oauthProvider === "microsoft"
                      ? handleMicrosoftSubmit(event)
                      : handleGmailSubmit(event))
                  }}
                  className="grid gap-3"
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor="reauth-gmail-client-id">
                      {oauthProvider === "microsoft"
                        ? t("accounts.oauth.applicationClientId")
                        : t("accounts.oauth.clientId")}
                    </Label>
                    <Input
                      id="reauth-gmail-client-id"
                      autoFocus
                      placeholder={
                        oauthProvider === "microsoft"
                          ? "00000000-0000-0000-0000-000000000000"
                          : "1234567890-abc123.apps.googleusercontent.com"
                      }
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
                  {errorMessage && (
                    <p role="alert" className="text-sm text-destructive">
                      {errorMessage}
                    </p>
                  )}
                  <div className="flex items-center justify-end">
                    <Button type="submit">
                      {t("accounts.oauth.continueInBrowser")}
                    </Button>
                  </div>
                </form>
              </>
            )
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("accounts.reauth.updatePassword")}</DialogTitle>
                <DialogDescription>
                  {t("accounts.reauth.passwordRejected", {
                    email: account.email,
                  })}
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(event) => {
                  void handleImapSubmit(event)
                }}
                className="grid gap-3"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="reauth-imap-password">
                    {t("accounts.reauth.newPassword")}
                  </Label>
                  <Input
                    id="reauth-imap-password"
                    autoFocus
                    type="password"
                    autoComplete="off"
                    placeholder={t("accounts.imap.passwordPlaceholder")}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
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
                {errorMessage && (
                  <p role="alert" className="text-sm text-destructive">
                    {errorMessage}
                  </p>
                )}
                <div className="flex items-center justify-end">
                  <Button type="submit" disabled={working}>
                    {working && (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    )}
                    {t("accounts.reauth.testAndSave")}
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}
