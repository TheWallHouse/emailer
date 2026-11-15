import { EllipsisVertical, Palette, Pencil, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { LabelRow } from "@/services/db/labels"

/**
 * Per-label row menu (task 10.4): a chevron trigger opening Rename… /
 * Change color… / Delete…. Rendered only for user labels — system labels
 * are protected from rename/delete and get no menu at all (the
 * label-admin guards enforce the same rule server-side of the UI).
 */
export function LabelRowMenu({
  label,
  onRename,
  onRecolor,
  onDelete,
}: {
  label: LabelRow
  onRename: (label: LabelRow) => void
  onRecolor: (label: LabelRow) => void
  onDelete: (label: LabelRow) => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t("labels.rowMenu.options", { name: label.name })}
            className={buttonVariants({
              variant: "ghost",
              size: "icon-sm",
            })}
          >
            <EllipsisVertical className="text-muted-foreground" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem onClick={() => onRename(label)}>
          <Pencil aria-hidden />
          {t("labels.rowMenu.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRecolor(label)}>
          <Palette aria-hidden />
          {t("labels.rowMenu.changeColor")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(label)}>
          <Trash2 aria-hidden />
          {t("labels.rowMenu.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
