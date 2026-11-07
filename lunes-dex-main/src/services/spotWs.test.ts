import { it, expect, vi, afterEach } from 'vitest'

class FakeSocket {
  static last: FakeSocket
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: unknown[] = []
  constructor() {
    FakeSocket.last = this
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw))
  }
  close() {
    this.readyState = 3
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}
;(FakeSocket as unknown as { OPEN: number }).OPEN = 1
vi.stubGlobal('WebSocket', FakeSocket)

import { spotWs } from './spotService'

afterEach(() => spotWs.disconnect())

it('only forwards channel messages that carry data (update/snapshot)', () => {
  spotWs.connect()
  FakeSocket.last.onopen?.()
  const cb = vi.fn()
  spotWs.subscribe('trades:QAX/QUSD', cb)

  // Control acks must never reach listeners as `undefined` payloads.
  FakeSocket.last.emit({ type: 'subscribed', channel: 'trades:QAX/QUSD' })
  FakeSocket.last.emit({ type: 'unsubscribed', channel: 'trades:QAX/QUSD' })
  expect(cb).not.toHaveBeenCalled()

  FakeSocket.last.emit({
    type: 'update',
    channel: 'trades:QAX/QUSD',
    data: { id: 't1' }
  })
  FakeSocket.last.emit({
    type: 'snapshot',
    channel: 'trades:QAX/QUSD',
    data: { id: 't0' }
  })
  expect(cb.mock.calls).toEqual([[{ id: 't1' }], [{ id: 't0' }]])
})
