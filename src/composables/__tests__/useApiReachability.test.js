import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { apiFetch } from '../../utils/apiFetch.js'
import { useApiReachability, __resetApiReachability } from '../useApiReachability.js'
import ApiUnreachableBanner from '../../components/ApiUnreachableBanner.vue'

// The network or a filter blocking our API used to leave students looking at
// empty assignment lists with no explanation. apiFetch now reports each
// outcome, and a failure is confirmed against /health before the app says so.

const API = 'http://localhost:3000/api'
const blocked = () => Promise.reject(new TypeError('Failed to fetch'))
const ok = () => Promise.resolve(new Response('OK', { status: 200 }))

let fetchMock
beforeEach(() => {
  __resetApiReachability()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => {
  __resetApiReachability()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const healthCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/health'))

describe('API reachability', () => {
  it('a response, even an error status, means the server was reached', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('nope', { status: 500 })))
    await apiFetch(`${API}/x`)
    expect(useApiReachability().unreachable.value).toBe(false)
    expect(healthCalls()).toHaveLength(0)
  })

  it('one failed call is not an alarm when /health still answers', async () => {
    fetchMock.mockImplementation((url) => (String(url).endsWith('/health') ? ok() : blocked()))
    await expect(apiFetch(`${API}/x`)).rejects.toThrow('Failed to fetch')
    await flushPromises()
    expect(healthCalls()).toHaveLength(1)
    expect(useApiReachability().unreachable.value).toBe(false)
  })

  it('a failed call AND a failed /health check marks the API unreachable', async () => {
    fetchMock.mockImplementation(blocked)
    await expect(apiFetch(`${API}/x`)).rejects.toThrow()
    await flushPromises()
    const r = useApiReachability()
    expect(r.unreachable.value).toBe(true)
    expect(r.since.value).toBeInstanceOf(Date)
    expect(String(healthCalls()[0][0])).toBe('http://localhost:3000/health') // origin, not /api/health
  })

  it('leaves an offline device to the offline indicator', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    fetchMock.mockImplementation(blocked)
    await expect(apiFetch(`${API}/x`)).rejects.toThrow()
    await flushPromises()
    expect(healthCalls()).toHaveLength(0)
    expect(useApiReachability().unreachable.value).toBe(false)
  })

  it('a request we cancelled says nothing about reachability', async () => {
    fetchMock.mockImplementation(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    await expect(apiFetch(`${API}/x`)).rejects.toThrow()
    await flushPromises()
    expect(healthCalls()).toHaveLength(0)
  })

  it('re-checks every minute while unreachable, and notices when it comes back', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(blocked)
    await expect(apiFetch(`${API}/x`)).rejects.toThrow()
    await vi.runOnlyPendingTimersAsync()
    const r = useApiReachability()
    expect(r.unreachable.value).toBe(true)

    fetchMock.mockImplementation(ok) // the network lets us through again
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.unreachable.value).toBe(false)
    expect(r.recovered.value).toBe(true)
  })

  it('any API response after a block clears it at once', async () => {
    fetchMock.mockImplementation(blocked)
    await expect(apiFetch(`${API}/x`)).rejects.toThrow()
    await flushPromises()
    fetchMock.mockImplementation(ok)
    await apiFetch(`${API}/y`)
    const r = useApiReachability()
    expect(r.unreachable.value).toBe(false)
    expect(r.recovered.value).toBe(true)
  })
})

describe('ApiUnreachableBanner', () => {
  it('says nothing while the API is reachable', () => {
    const w = mount(ApiUnreachableBanner)
    expect(w.find('[data-testid="api-unreachable-banner"]').exists()).toBe(false)
    expect(w.find('[data-testid="api-recovered-banner"]').exists()).toBe(false)
  })

  it('explains the block, and Try again re-checks', async () => {
    fetchMock.mockImplementation(blocked)
    await expect(apiFetch(`${API}/x`)).rejects.toThrow()
    await flushPromises()
    const w = mount(ApiUnreachableBanner)
    const banner = w.find('[data-testid="api-unreachable-banner"]')
    expect(banner.text()).toContain("Can't reach the Bridge Classroom server")
    expect(banner.text()).toContain('Assignments and class lists')
    expect(banner.text()).toContain('localhost:3000')

    fetchMock.mockImplementation(ok)
    await w.find('.api-banner-btn').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="api-unreachable-banner"]').exists()).toBe(false)
    expect(w.find('[data-testid="api-recovered-banner"]').text()).toContain('Reload')
  })
})
