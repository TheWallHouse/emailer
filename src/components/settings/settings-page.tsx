import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Archive,
  ArrowDownUp,
  ArrowLeft,
  Ban,
  Bell,
  BookOpen,
  Calendar,
  CalendarClock,
  CircleHelp,
  Database,
  DatabaseBackup,
  Filter,
  KeyRound,
  Keyboard,
  ListChecks,
  MailWarning,
  MailX,
  Monitor,
  Palette,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Tags,
  Users,
  UserRound,
  Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { i18next } from "@/i18n"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { AccountsSection } from "@/components/settings/accounts-section"
import { AddressBookSection } from "@/components/settings/address-book-section"
import { AiSection } from "@/components/settings/ai-section"
import { AppearanceSection } from "@/components/settings/appearance-section"
import { AttachmentSecuritySection } from "@/components/settings/attachment-security-section"
import { AutoArchiveSection } from "@/components/settings/auto-archive-section"
import { BackupSection } from "@/components/settings/backup-section"
import { CalendarSection } from "@/components/settings/calendar-section"
import { BlockedSendersSection } from "@/components/settings/blocked-senders-section"
import { CategoriesSection } from "@/components/settings/categories-section"
import { DataPortabilitySection } from "@/components/settings/data-portability-section"
import { DesktopSection } from "@/components/settings/desktop-section"
import { DeliverySchedulesSection } from "@/components/settings/delivery-schedules-section"
import { HelpSection } from "@/components/help/help-center"
import { JunkFilterSection } from "@/components/settings/junk-filter-section"
import { NotificationsSection } from "@/components/settings/notifications-section"
import { PgpSection } from "@/components/settings/pgp-section"
import { QuickStepsSection } from "@/components/settings/quick-steps-section"
import { ReadingSection } from "@/components/settings/reading-section"
import { RulesSection } from "@/components/settings/rules-section"
import { ShortcutsSection } from "@/components/settings/shortcuts-section"
import { SnippetsSection } from "@/components/settings/snippets-section"
import { StorageSection } from "@/components/settings/storage-section"
import { SubscriptionsSection } from "@/components/settings/subscriptions-section"
import { UpdatesSection } from "@/components/settings/updates-section"
import { useUiStore } from "@/stores/ui-store"

/**
 * The settings page (task 11.1). Replaces the mailbox panes while
 * ui-store.view.kind === "settings" (the shell swaps it in); the sidebar
 * Settings entry navigates here. The back control restores the mailbox
 * view the user came from via the store's previousView mechanism — the
 * same restore path clearSearch uses (ui-store never records settings
 * views as previousView, so back always lands on real mailbox state,
 * defaulting to the inbox).
 *
 * Section selection is internal state on purpose: ui-store only carries
 * the coarse view kind (design D5), and the mailbox-ui spec does not
 * deep-link individual settings sections.
 */

type SettingsSectionId =
  | "accounts"
  | "address-book"
  | "calendar"
  | "pgp"
  | "attachment-security"
  | "junk-filter"
  | "data-portability"
  | "backup"
  | "storage"
  | "updates"
  | "desktop"
  | "appearance"
  | "reading"
  | "ai"
  | "notifications"
  | "rules"
  | "categories"
  | "quick-steps"
  | "blocked-senders"
  | "subscriptions"
  | "delivery-schedules"
  | "auto-archive"
  | "shortcuts"
  | "snippets"
  | "help"

const SECTIONS: {
  id: SettingsSectionId
  label: string
  icon: LucideIcon
}[] = [
  {
    id: "accounts",
    get label() {
      return i18next.t("settings.page.sections.accounts")
    },
    icon: UserRound,
  },
  // CardDAV address-book sync (parity-round-2 task 4.3, spec contacts):
  // connect/disconnect, sync status, sealed-password note.
  {
    id: "address-book",
    get label() {
      return i18next.t("settings.page.sections.addressBook")
    },
    icon: Users,
  },
  // Calendar sources (task 5.2, spec calendar): Google/CalDAV connect,
  // discovery and removal.
  {
    id: "calendar",
    get label() {
      return i18next.t("settings.page.sections.calendar")
    },
    icon: Calendar,
  },
  {
    id: "pgp",
    get label() {
      return i18next.t("settings.page.sections.pgp")
    },
    icon: KeyRound,
  },
  {
    id: "attachment-security",
    get label() {
      return i18next.t("settings.page.sections.attachmentSecurity")
    },
    icon: ShieldAlert,
  },
  {
    id: "junk-filter",
    get label() {
      return i18next.t("settings.page.sections.junkFilter")
    },
    icon: MailWarning,
  },
  {
    id: "data-portability",
    get label() {
      return i18next.t("settings.page.sections.dataPortability")
    },
    icon: ArrowDownUp,
  },
  // Portable backup/restore (parity-round-3 tasks 5.1–5.5, design D4):
  // checksummed .emailer-backup export + replace/merge restore.
  {
    id: "backup",
    get label() {
      return i18next.t("settings.page.sections.backup")
    },
    icon: DatabaseBackup,
  },
  // Storage usage + delete-all-local-data (tasks 1.6/1.7, settings spec).
  {
    id: "storage",
    get label() {
      return i18next.t("settings.page.sections.storage")
    },
    icon: Database,
  },
  {
    id: "updates",
    get label() {
      return i18next.t("settings.page.sections.updates")
    },
    icon: RefreshCw,
  },
  {
    id: "desktop",
    get label() {
      return i18next.t("settings.page.sections.desktop")
    },
    icon: Monitor,
  },
  {
    id: "appearance",
    get label() {
      return i18next.t("settings.page.sections.appearance")
    },
    icon: Palette,
  },
  {
    id: "reading",
    get label() {
      return i18next.t("settings.page.sections.reading")
    },
    icon: BookOpen,
  },
  // AI assistance (task 4.2, spec ai-assistance): provider configuration,
  // per-surface toggles and cache management.
  {
    id: "ai",
    get label() {
      return i18next.t("settings.page.sections.ai")
    },
    icon: Sparkles,
  },
  {
    id: "notifications",
    get label() {
      return i18next.t("settings.page.sections.notifications")
    },
    icon: Bell,
  },
  {
    id: "rules",
    get label() {
      return i18next.t("settings.page.sections.rules")
    },
    icon: Filter,
  },
  // Category tabs (task 3.5): the inbox category tab row's visibility +
  // the on-demand back-categorization launch.
  {
    id: "categories",
    get label() {
      return i18next.t("settings.page.sections.categories")
    },
    icon: Tags,
  },
  // Quick steps (task 3.2): the manage UI for the 3.1 service — chains of
  // actions runnable from the context menu, the palette, or a digit key.
  {
    id: "quick-steps",
    get label() {
      return i18next.t("settings.page.sections.quickSteps")
    },
    icon: ListChecks,
  },
  {
    id: "blocked-senders",
    get label() {
      return i18next.t("settings.page.sections.blockedSenders")
    },
    icon: Ban,
  },
  // Subscription manager (task 3.6): detected newsletter senders +
  // unsubscribed senders, with bulk unsubscribe.
  {
    id: "subscriptions",
    get label() {
      return i18next.t("settings.page.sections.subscriptions")
    },
    icon: MailX,
  },
  {
    id: "delivery-schedules",
    get label() {
      return i18next.t("settings.page.sections.deliverySchedules")
    },
    icon: CalendarClock,
  },
  {
    id: "auto-archive",
    get label() {
      return i18next.t("settings.page.sections.autoArchive")
    },
    icon: Archive,
  },
  {
    id: "shortcuts",
    get label() {
      return i18next.t("settings.page.sections.shortcuts")
    },
    icon: Keyboard,
  },
  {
    id: "snippets",
    get label() {
      return i18next.t("settings.page.sections.snippets")
    },
    icon: Zap,
  },
  // Help center (task 2.9): the settings-page entry point; the palette's
  // "Open help center" command opens the same center as a dialog.
  {
    id: "help",
    get label() {
      return i18next.t("settings.page.sections.help")
    },
    icon: CircleHelp,
  },
]

/**
 * Renders the active section's content.
 */
function ActiveSection({ id }: { id: SettingsSectionId }) {
  switch (id) {
    case "accounts":
      return <AccountsSection />
    case "address-book":
      return <AddressBookSection />
    case "calendar":
      return <CalendarSection />
    case "pgp":
      return <PgpSection />
    case "attachment-security":
      return <AttachmentSecuritySection />
    case "junk-filter":
      return <JunkFilterSection />
    case "data-portability":
      return <DataPortabilitySection />
    case "backup":
      return <BackupSection />
    case "storage":
      return <StorageSection />
    case "updates":
      return <UpdatesSection />
    case "desktop":
      return <DesktopSection />
    case "appearance":
      return <AppearanceSection />
    case "reading":
      return <ReadingSection />
    case "ai":
      return <AiSection />
    case "notifications":
      return <NotificationsSection />
    case "rules":
      return <RulesSection />
    case "categories":
      return <CategoriesSection />
    case "quick-steps":
      return <QuickStepsSection />
    case "blocked-senders":
      return <BlockedSendersSection />
    case "subscriptions":
      return <SubscriptionsSection />
    case "delivery-schedules":
      return <DeliverySchedulesSection />
    case "auto-archive":
      return <AutoArchiveSection />
    case "shortcuts":
      return <ShortcutsSection />
    case "snippets":
      return <SnippetsSection />
    case "help":
      return <HelpSection />
  }
}

export function SettingsPage() {
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSectionId>("accounts")
  const setView = useUiStore((state) => state.setView)
  const previousView = useUiStore((state) => state.previousView)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-4 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("settings.page.backToMailbox")}
          onClick={() => setView(previousView)}
        >
          <ArrowLeft />
          {t("settings.page.back")}
        </Button>
        <h1 className="truncate text-xl font-bold text-foreground">
          {t("settings.page.title")}
        </h1>
      </div>
      <Separator />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("settings.page.sectionsNav")}
          className="grid w-44 shrink-0 content-start gap-0.5 p-2"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "true" : undefined}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "w-full justify-start",
                section === id && "bg-muted text-foreground"
              )}
              onClick={() => setSection(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <Separator orientation="vertical" />
        <ScrollArea className="min-w-0 flex-1">
          <div className="mx-auto max-w-2xl p-6">
            <ActiveSection id={section} />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
