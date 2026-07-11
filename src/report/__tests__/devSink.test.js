import { describe, it, expect } from 'vitest'
import { saveToDevSink } from '../sinks/devSink.js'

// Mock a File System Access directory handle: nested getDirectoryHandle() calls
// flatten to one node, and getFileHandle→createWritable captures each write into
// a `files` map so we can assert what the sink wrote. `throwOn` lets a test make
// one specific file's write fail.
function mockDir({ throwOn = null } = {}) {
  const files = {}
  const dir = {
    name: 'dev-reports',
    async getDirectoryHandle() { return dir },
    async getFileHandle(name) {
      if (name === throwOn) throw new Error(`boom writing ${name}`)
      return {
        async createWritable() {
          return {
            async write(contents) { files[name] = contents },
            async close() {}
          }
        }
      }
    }
  }
  return { dir, files }
}

const bundle = {
  context: { note: 'seat box shrink-wraps', env: { app: 'practice-table' } },
  fixture: { stub: true },
  screenshot: null
}

describe('saveToDevSink — adjudication scaffold', () => {
  it('writes adjudication.md with status: open alongside the bundle', async () => {
    const { dir, files } = mockDir()
    const res = await saveToDevSink(bundle, { dirHandle: dir, copyClipboard: false })

    expect(res.ok).toBe(true)
    expect(res.singleFile).toBe(false)
    expect(files['context.json']).toContain('seat box shrink-wraps')

    const adj = files['adjudication.md']
    expect(adj).toBeTruthy()
    expect(adj).toContain('status: open')
    expect(adj).toContain('resolution:')
    expect(adj).toContain('refs: []')
    expect(adj).toContain('adjudicated_by:')
    expect(adj).toContain('## Narrative')
    expect(adj).toContain('_Untriaged._')
    // Frontmatter opens on line 1 (parseable by a frontmatter reader).
    expect(adj.startsWith('---\n')).toBe(true)
  })

  it('does NOT break report generation if the scaffold write fails', async () => {
    const { dir, files } = mockDir({ throwOn: 'adjudication.md' })
    const res = await saveToDevSink(bundle, { dirHandle: dir, copyClipboard: false })

    expect(res.ok).toBe(true) // report still saved
    expect(files['context.json']).toBeTruthy() // evidence intact
    expect(files['adjudication.md']).toBeUndefined() // scaffold degraded gracefully
  })

  it('never edits context.json (evidence stays as captured)', async () => {
    const { dir, files } = mockDir()
    await saveToDevSink(bundle, { dirHandle: dir, copyClipboard: false })
    // context.json is exactly the serialized context, no adjudication mixed in.
    expect(JSON.parse(files['context.json'])).toEqual(bundle.context)
    expect(files['context.json']).not.toContain('status: open')
  })
})
