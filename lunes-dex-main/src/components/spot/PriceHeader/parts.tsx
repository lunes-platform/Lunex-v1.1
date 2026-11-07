import styled from 'styled-components'
import { C, grotesk, tabular } from 'components/ui/kit'

/** 3-column stat tiles used by the Pair info / Analytics dialogs. */
export const Tiles = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`

export const Tile = styled.div`
  padding: 10px;
  border-radius: 10px;
  background: ${C.bg};
  min-width: 0;
  > div:first-child {
    font-size: 10px;
    color: ${C.muted};
    margin-bottom: 3px;
  }
  > div:last-child {
    ${tabular};
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

/** Key/value list block. */
export const Rows = styled.div`
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: ${C.bg};
  padding: 4px 14px;
`

export const RowKV = styled.div<{ $mono?: boolean }>`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  font-size: 13px;
  & + & {
    border-top: 1px solid ${C.field};
  }
  > span:first-child {
    color: ${C.muted};
  }
  > span:last-child {
    ${tabular};
    font-weight: 500;
    text-align: right;
    font-family: ${p => (p.$mono ? 'ui-monospace, monospace' : 'inherit')};
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

export const SectionTitle = styled.span`
  ${grotesk};
  font-weight: 600;
  font-size: 14px;
`

export const Dot = styled.span<{ $on: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${p => (p.$on ? C.success : C.muted)};
  }
`
