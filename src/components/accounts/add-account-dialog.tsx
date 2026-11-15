import { useState } from "react"
import type { ReactNode } from "react"
import { KeyRound, Server } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

import { Button } from "@/components/ui/button"
import { ProviderIcon } from "@/components/providers/provider-icon"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AddGmailFlow } from "./add-gmail-flow"
import { AddImapFlow } from "./add-imap-flow"
import { AddMicrosoftFlow } from "./add-microsoft-flow"

/**
 * Entry point of the add-account UI (tasks 5.3/5.4, parity-round-2
 * 3.5): the chooser between the Gmail (OAuth), Microsoft 365 (Graph
 * OAuth) and the generic IMAP/SMTP flow, plus the "what do I need"
 * pointer to Google's Client-ID instructions. The individual flows
 * replace the chooser content and report back through onSuccess.
 */

/** Google's Client-ID setup instructions, linked as the footer "What do I need?". */
const GMAIL_SETUP_GUIDE_URL =
  "https://developers.google.com/gmail/api/quickstart/js"

type AddAccountMode = "choose" | "gmail" | "microsoft" | "imap"

interface AddAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function accountOptions(t: TFunction): {
  mode: Exclude<AddAccountMode, "choose">
  title: string
  description: string
  icon: ReactNode
}[] {
  return [
    {
      mode: "gmail",
      title: "Gmail",
      description: t("accounts.add.gmailDescription"),
      icon: <ProviderIcon provider="gmail" className="size-4" />,
    },
    {
      mode: "microsoft",
      title: "Microsoft 365 / Outlook.com",
      description: t("accounts.add.microsoftDescription"),
      icon: <ProviderIcon provider="outlook" className="size-4" />,
    },
    {
      mode: "imap",
      title: t("accounts.add.imapTitle"),
      description: t("accounts.add.imapDescription"),
      icon: <Server className="size-4 text-muted-foreground" />,
    },
  ]
}

export function AddAccountDialog({
  open,
  onOpenChange,
}: AddAccountDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AddAccountMode>("choose")

  // A close — user-initiated (Esc, overlay, close button) via the Dialog's
  // callback, or flow success below — resets the dialog to the chooser, so
  // every open starts fresh.
  function close(): void {
    setMode("choose")
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close()
          return
        }
        onOpenChange(true)
      }}
    >
      <DialogContent className="sm:max-w-md">
        {mode === "gmail" ? (
          <AddGmailFlow onBack={() => setMode("choose")} onSuccess={close} />
        ) : mode === "microsoft" ? (
          <AddMicrosoftFlow
            onBack={() => setMode("choose")}
            onSuccess={close}
          />
        ) : mode === "imap" ? (
          <AddImapFlow onBack={() => setMode("choose")} onSuccess={close} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("accounts.add.title")}</DialogTitle>
              <DialogDescription>
                {t("accounts.add.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {accountOptions(t).map((option) => (
                <Button
                  key={option.mode}
                  variant="outline"
                  className="h-auto w-full flex-col items-start gap-1 px-4 py-3 text-left"
                  onClick={() => setMode(option.mode)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {option.icon}
                    {option.title}
                  </span>
                  {/* whitespace-normal: the button base style is nowrap, and
                      the long provider line's min-content width would blow
                      the grid track past the dialog's max-width */}
                  <span className="text-xs font-normal whitespace-normal text-muted-foreground">
                    {option.description}
                  </span>
                </Button>
              ))}
            </div>
            <DialogFooter className="items-center">
              <a
                href={GMAIL_SETUP_GUIDE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                <KeyRound className="size-3" aria-hidden />
                {t("accounts.add.whatDoINeed")}
              </a>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
