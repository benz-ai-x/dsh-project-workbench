// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  mountWorkbenchStyles,
  registerWorkbenchStyle,
} from '../src/client/style-lifecycle.ts'

const PACKAGE_ID = '@benz-ai-x/dsh-project-workbench-client'
const TAG_ID = `${PACKAGE_ID}/LifecycleFixture.module.css`

function currentStyle(): HTMLStyleElement | null {
  return [...document.querySelectorAll<HTMLStyleElement>('style[data-plugin-css]')]
    .find(tag => tag.dataset.pluginCss === TAG_ID) ?? null
}

afterEach(() => {
  for (const tag of document.querySelectorAll(`style[data-plugin="${PACKAGE_ID}"]`)) tag.remove()
})

describe('Workbench Client stylesheet lifecycle', () => {
  it('updates one stable tag, protects it from an old disposer, and recreates it after unload', () => {
    registerWorkbenchStyle(TAG_ID, '.surface{color:red}')
    const original = currentStyle()
    expect(original).not.toBeNull()
    expect(original?.textContent).toBe('.surface{color:red}')

    const disposeOldMount = mountWorkbenchStyles()

    // A new bundle materializes before its Fiber mounts: update in place and
    // change ownership immediately so the old Fiber cannot remove new CSS.
    registerWorkbenchStyle(TAG_ID, '.surface{color:blue}')
    expect(currentStyle()).toBe(original)
    expect(currentStyle()?.textContent).toBe('.surface{color:blue}')

    disposeOldMount()
    expect(currentStyle()).toBe(original)

    const disposeNewMount = mountWorkbenchStyles()
    disposeNewMount()
    expect(currentStyle()).toBeNull()

    const disposeRemount = mountWorkbenchStyles()
    expect(currentStyle()).not.toBe(original)
    expect(currentStyle()?.textContent).toBe('.surface{color:blue}')
    disposeRemount()
    expect(currentStyle()).toBeNull()
  })
})
