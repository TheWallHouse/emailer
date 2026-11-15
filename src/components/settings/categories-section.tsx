import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { CategoryBackfillStatus } from "@/components/layout/category-backfill-status"
import {
  categorizeExistingMail,
  isBackfillActive,
  setCategoryTabsEnabled,
  useCategoriesEnabled,
  useCategoryBackfillProgress,
} from "@/components/layout/use-categories"

const CATEGORY_NAME_KEYS = [
  "primary",
  "updates",
  "promotions",
  "social",
  "newsletters",
] as const

/**
 * Settings "Categories" section (task 3.5, design D4, mailbox-ui spec
 * "Category tab presentation" + mail-organization spec "Automatic
 * categorization"): the visibility toggle for the inbox category tab row
 * (`organization.categoriesEnabled` — the spec's hideable row; disabling
 * shows the split tabs only and leaves the inbox list untouched) and the
 * on-demand back-categorization affordance — the spec's "the user enables
 * categories and chooses to categorize existing mail" scenario, offered
 * here the moment the tabs are switched on and remaining as the re-run
 * entry. The running job reports through the same progress surface the
 * tab bar uses (CategoryBackfillStatus: "Categorizing… N of M" + Cancel,
 * the done summary as a toast).
 */
export function CategoriesSection() {
  const { t } = useTranslation()
  const enabled = useCategoriesEnabled()
  const progress = useCategoryBackfillProgress()

  return (
    <section
      aria-label={t("settings.categories.title")}
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("settings.categories.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.categories.description", {
            names: CATEGORY_NAME_KEYS.map((key) =>
              t(`sidebar.categories.${key}`)
            ).join(", "),
          })}
        </p>
      </div>
      <div className="divide-y divide-border">
        <div className="flex items-center justify-between gap-6 py-3">
          <div className="grid gap-0.5">
            <Label htmlFor="categories-enabled">
              {t("settings.categories.tabs.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.categories.tabs.hint")}
            </p>
          </div>
          <Switch
            id="categories-enabled"
            data-testid="categories-enabled-switch"
            checked={enabled}
            onCheckedChange={(checked) => {
              void setCategoryTabsEnabled(checked)
            }}
          />
        </div>
        {enabled && (
          <div className="flex flex-col gap-2 py-3">
            <div className="grid gap-0.5">
              <Label htmlFor="categorize-existing">
                {t("settings.categories.existing.label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.categories.existing.hint")}
              </p>
            </div>
            <div>
              <Button
                id="categorize-existing"
                variant="outline"
                size="sm"
                data-testid="categorize-existing-button"
                disabled={isBackfillActive(progress)}
                onClick={() => void categorizeExistingMail()}
              >
                {t("settings.categories.existing.button")}
              </Button>
            </div>
            {/* The running job's progress line — the exact surface the
                tab bar shows, so both entry points report alike. */}
            <CategoryBackfillStatus />
          </div>
        )}
      </div>
    </section>
  )
}
