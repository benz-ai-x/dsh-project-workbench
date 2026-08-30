/** Client-owned stylesheet registration and Fiber-scoped disposal. */

const PACKAGE_ID = '@benz-ai-x/dsh-project-workbench-client'
const STYLE_OWNER = Symbol.for(`${PACKAGE_ID}/style-owner`)

/** CSS text retained by this materialized bundle so Loader remount can restore it. */
const registeredStyles = new Map<string, string>()

function findStyle(target: Document, tagId: string): HTMLStyleElement | undefined {
  for (const tag of target.querySelectorAll<HTMLStyleElement>('style[data-plugin-css]')) {
    if (tag.dataset.pluginCss === tagId) return tag
  }
  return undefined
}

function upsertStyle(
  target: Document,
  tagId: string,
  css: string,
  owner: object,
): HTMLStyleElement {
  let tag = findStyle(target, tagId)
  if (tag === undefined) tag = target.createElement('style')
  tag.dataset.plugin = PACKAGE_ID
  tag.dataset.pluginCss = tagId
  tag.textContent = css
  Reflect.set(tag, STYLE_OWNER, owner)
  if (!tag.isConnected) target.head.appendChild(tag)
  return tag
}

/**
 * Register one compiled CSS Module while the lazy Client factory materializes.
 * A fresh owner marker protects an updated tag from an overlapping old bundle's
 * disposer before the new Fiber has finished mounting.
 */
export function registerWorkbenchStyle(tagId: string, css: string): void {
  registeredStyles.set(tagId, css)
  if (typeof document === 'undefined') return
  upsertStyle(document, tagId, css, {})
}

/**
 * Attach every stylesheet from this materialized bundle to one Client mount.
 * Disposal is ownership-checked so an older mount cannot remove a tag already
 * updated or claimed by a newer bundle.
 */
export function mountWorkbenchStyles(): () => void {
  if (typeof document === 'undefined') return () => {}

  const owner = {}
  const owned = [...registeredStyles].map(([tagId, css]) =>
    upsertStyle(document, tagId, css, owner))
  let disposed = false

  return () => {
    if (disposed) return
    disposed = true
    for (const tag of owned) {
      if (Reflect.get(tag, STYLE_OWNER) === owner) tag.remove()
    }
  }
}
