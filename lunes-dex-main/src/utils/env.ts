/**
 * Safe read of a build-time `process.env.REACT_APP_*` variable.
 *
 * vite.config.ts only inlines *literal* `process.env.REACT_APP_X` accesses
 * whose variable is set. An unset one is left as-is and throws
 * `ReferenceError: process is not defined` in the browser, and a
 * `typeof process` guard is wrong too (it is 'undefined' in the browser even
 * when the literal was inlined). So pass the literal access in a getter:
 *
 *   readEnv(() => process.env.REACT_APP_FOO)
 */
export const readEnv = (get: () => string | undefined): string => {
  try {
    return get() ?? ''
  } catch {
    return ''
  }
}
