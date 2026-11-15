import { describe, expect, it } from "vitest"

import en from "./locales/en"
import es from "./locales/es"

type Catalog = { [key: string]: string | Catalog }

/** Flatten a nested catalog into "a.b.c" keys. */
function keys(catalog: Catalog, prefix = ""): string[] {
  return Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : keys(value, `${prefix}${key}.`)
  )
}

/** Interpolation placeholders ({{name}}) used by a string. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()
}

function lookup(catalog: Catalog, path: string): string {
  return path
    .split(".")
    .reduce<string | Catalog>((node, part) => (node as Catalog)[part], catalog) as string
}

const LOCALES: Record<string, Catalog> = { es }

describe("locale catalogs", () => {
  const reference = keys(en).sort()

  for (const [lang, catalog] of Object.entries(LOCALES)) {
    it(`${lang} has exactly the English keys`, () => {
      expect(keys(catalog).sort()).toEqual(reference)
    })

    it(`${lang} keeps every interpolation placeholder`, () => {
      for (const key of reference) {
        expect(placeholders(lookup(catalog, key)), key).toEqual(
          placeholders(lookup(en, key))
        )
      }
    })

    it(`${lang} has no empty strings`, () => {
      for (const key of reference) {
        expect(lookup(catalog, key).trim(), key).not.toBe("")
      }
    })
  }
})
