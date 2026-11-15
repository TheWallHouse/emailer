import { EllipsisVertical, Check, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * Per-todo row menu (task 15.2): the ⋯ trigger behind the section row's
 * secondary actions. Completing with the row's check button is the plain
 * one-click path; this menu carries the OPTIONAL done-marking variant
 * (spec: "complete a todo … optionally marking the thread Done") plus the
 * remove, so the row stays uncluttered while both completion semantics
 * remain one click deep.
 */
export function TodoRowMenu({
  subject,
  onCompleteMarkDone,
  onRemove,
}: {
  subject: string
  onCompleteMarkDone: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t("sidebar.todos.menu.moreActions", { subject })}
            className={buttonVariants({
              variant: "ghost",
              size: "icon-sm",
            })}
          >
            <EllipsisVertical className="text-muted-foreground" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={onCompleteMarkDone}>
          <Check aria-hidden />
          {t("sidebar.todos.menu.completeMarkDone")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          <Trash2 aria-hidden />
          {t("sidebar.todos.menu.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
