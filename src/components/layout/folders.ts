import type { LucideIcon } from "lucide-react"
import {
  Archive,
  FileText,
  Inbox,
  OctagonAlert,
  Send,
  Star,
  Trash,
} from "lucide-react"

import { i18next } from "@/i18n"
import type { FolderCountKey } from "@/services/db/folder-counts"
import type { FolderSelection } from "@/stores/ui-store"

/**
 * The seven system folders of the mailbox UI (task 6.7) — THE shared
 * constant. The command palette (task 6.7) and the sidebar (task 6.3,
 * which adopted this constant in the cleanup that resolved its earlier
 * duplicate) both render from it: same order, icons, titles and
 * ViewSelection payloads, so the two surfaces can never drift.
 */
export interface FolderEntry {
  /** Key into FolderUnreadCounts (badge data, unused by the palette). */
  countKey: FolderCountKey
  /** Localized at read time (getter), so it follows language changes. */
  readonly title: string
  icon: LucideIcon
  /** ViewSelection folder payload (see ui-store's query mapping). */
  folder: FolderSelection
}

export const FOLDER_ITEMS: FolderEntry[] = [
  {
    countKey: "inbox",
    get title() {
      return i18next.t("common.folders.inbox")
    },
    icon: Inbox,
    folder: { kind: "specialUse", specialUse: "inbox" },
  },
  {
    countKey: "starred",
    get title() {
      return i18next.t("common.folders.starred")
    },
    icon: Star,
    folder: { kind: "starred" },
  },
  {
    countKey: "sent",
    get title() {
      return i18next.t("common.folders.sent")
    },
    icon: Send,
    folder: { kind: "specialUse", specialUse: "sent" },
  },
  {
    countKey: "drafts",
    get title() {
      return i18next.t("common.folders.drafts")
    },
    icon: FileText,
    folder: { kind: "specialUse", specialUse: "drafts" },
  },
  {
    countKey: "archive",
    get title() {
      return i18next.t("common.folders.archive")
    },
    icon: Archive,
    folder: { kind: "specialUse", specialUse: "archive" },
  },
  {
    countKey: "spam",
    get title() {
      return i18next.t("common.folders.spam")
    },
    icon: OctagonAlert,
    folder: { kind: "specialUse", specialUse: "spam" },
  },
  {
    countKey: "trash",
    get title() {
      return i18next.t("common.folders.trash")
    },
    icon: Trash,
    folder: { kind: "specialUse", specialUse: "trash" },
  },
]
