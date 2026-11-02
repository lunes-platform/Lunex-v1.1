import { useEffect, useState } from 'react'

export const MOBILE_MAX = 759
export const TABLET_MAX = 1199

export const useMediaQuery = (query: string): boolean => {
  const get = () =>
    typeof window !== 'undefined' && !!window.matchMedia
      ? window.matchMedia(query).matches
      : false
  const [matches, setMatches] = useState(get)

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** < 760px — matches the prototype's mobile breakpoint. */
export const useIsMobile = () => useMediaQuery(`(max-width: ${MOBILE_MAX}px)`)

/** 760–1199px */
export const useIsTablet = () =>
  useMediaQuery(
    `(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`
  )
