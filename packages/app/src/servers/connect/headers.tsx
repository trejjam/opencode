import { Index, Show, createMemo, createUniqueId } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import type { ServerConnection } from "@/runtime/server/registry"
import "./headers.css"

type HeaderRow = { name: string; value: string }

function parseHeaders(rows: HeaderRow[]) {
  const invalid = rows
    .map((row, index) => {
      if (!row.name || !row.value.trim()) return { index, key: "server.connect.headers.incomplete" as const }

      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(row.name))
        return { index, key: "server.connect.headers.invalidName" as const }

      // HTTP field values allow horizontal tabs, visible ASCII, and Latin-1, but not line breaks or other controls.
      if (/[^\t\x20-\x7e\x80-\xff]/.test(row.value))
        return { index, key: "server.connect.headers.invalidValue" as const }

      if (rows.some((other, before) => before < index && other.name.toLowerCase() === row.name.toLowerCase()))
        return { index, key: "server.connect.headers.duplicate" as const }
    })
    .find((item) => item !== undefined)

  return {
    invalid,
    headers: invalid || !rows.length ? undefined : Object.fromEntries(rows.map((row) => [row.name, row.value])),
  }
}

export function createServerHeaderEditor(
  options: {
    headers?: ServerConnection.HttpBase["headers"]
    onChange?: () => void
  } = {},
) {
  const [state, setState] = createStore({
    rows: Object.entries(options.headers ?? {}).map(([name, value]) => ({ name, value })),
    submitted: false,
  })

  const result = createMemo(() => parseHeaders(state.rows))

  return {
    rows: () => state.rows,
    result,
    invalid: () => (state.submitted ? result().invalid : undefined),
    validate: () => {
      setState("submitted", true)

      return !result().invalid
    },
    reset: (headers?: ServerConnection.HttpBase["headers"]) =>
      setState({ rows: Object.entries(headers ?? {}).map(([name, value]) => ({ name, value })), submitted: false }),
    add: () => {
      setState("rows", (rows) => [...rows, { name: "", value: "" }])
      options.onChange?.()
    },
    remove: (index: number) => {
      setState("rows", (rows) => rows.filter((_, current) => current !== index))
      options.onChange?.()
    },
    change: (index: number, field: keyof HeaderRow, value: string) => {
      setState("rows", index, field, value)
      options.onChange?.()
    },
  }
}

export function ServerHeaderEditor(props: {
  editor: ReturnType<typeof createServerHeaderEditor>
  disabled?: boolean
  onKeyDown?: (event: KeyboardEvent) => void
}) {
  const language = useLanguage()
  const id = createUniqueId()

  return (
    <section class="server-header-editor" aria-labelledby={`${id}-title`}>
      <div class="server-header-heading">
        <h2 id={`${id}-title`}>{language.t("server.connect.headers.title")}</h2>
        <Button type="button" variant="neutral" size="small" disabled={props.disabled} onClick={props.editor.add}>
          <Icon name="plus-small" size="small" />
          {language.t("server.connect.headers.add")}
        </Button>
      </div>
      <Show when={props.editor.rows().length}>
        <p id={`${id}-hint`} class="server-header-hint">
          {language.t("server.connect.headers.hint")}
        </p>
        <Index each={props.editor.rows()}>
          {(row, index) => (
            <div class="server-header-row">
              <div class="server-header-field">
                <label for={`${id}-${index}-name`}>{language.t("server.connect.headers.name")}</label>
                <TextInput
                  id={`${id}-${index}-name`}
                  aria-label={language.t("server.connect.headers.nameLabel", { number: index + 1 })}
                  aria-describedby={props.editor.invalid()?.index === index ? `${id}-error` : `${id}-hint`}
                  dir="ltr"
                  appearance="large"
                  value={row().name}
                  placeholder={language.t("server.connect.headers.namePlaceholder")}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  disabled={props.disabled}
                  invalid={props.editor.invalid()?.index === index}
                  onInput={(event) => props.editor.change(index, "name", event.currentTarget.value)}
                  onKeyDown={props.onKeyDown}
                />
              </div>
              <div class="server-header-field">
                <label for={`${id}-${index}-value`}>{language.t("server.connect.headers.value")}</label>
                <TextInput
                  id={`${id}-${index}-value`}
                  aria-label={language.t("server.connect.headers.valueLabel", { number: index + 1 })}
                  aria-describedby={props.editor.invalid()?.index === index ? `${id}-error` : `${id}-hint`}
                  dir="ltr"
                  type="password"
                  appearance="large"
                  value={row().value}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  disabled={props.disabled}
                  invalid={props.editor.invalid()?.index === index}
                  onInput={(event) => props.editor.change(index, "value", event.currentTarget.value)}
                  onKeyDown={props.onKeyDown}
                />
              </div>
              <IconButton
                type="button"
                variant="ghost"
                size="large"
                aria-label={language.t("server.connect.headers.remove", { number: index + 1 })}
                icon={<Icon name="trash" size="small" />}
                disabled={props.disabled}
                onClick={() => props.editor.remove(index)}
              />
            </div>
          )}
        </Index>
      </Show>
      <Show when={props.editor.invalid()}>
        {(invalid) => (
          <p id={`${id}-error`} class="server-header-error" role="alert">
            {language.t(invalid().key)}
          </p>
        )}
      </Show>
    </section>
  )
}
