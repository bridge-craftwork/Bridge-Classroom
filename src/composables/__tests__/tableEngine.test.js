import { describe, it, expect } from 'vitest'
import {
  LOCAL_CAPABILITIES,
  SERVER_CAPABILITIES,
  capabilityGaps,
} from '../engines/tableEngine.js'

describe('tableEngine capabilities', () => {
  it('server is missing exactly the local-only analysis features (the backlog)', () => {
    // What the server would need to match the local experience.
    expect(capabilityGaps(LOCAL_CAPABILITIES, SERVER_CAPABILITIES).sort()).toEqual(
      ['bbaExpectedAuction', 'divergence', 'doubleDummy', 'narrative'].sort(),
    )
  })

  it('local is missing exactly the multiplayer features', () => {
    expect(capabilityGaps(SERVER_CAPABILITIES, LOCAL_CAPABILITIES).sort()).toEqual(
      ['invite', 'multiHuman', 'redaction', 'seats'].sort(),
    )
  })

  it('non-boolean capability keys (mechanism choices) are not treated as gaps', () => {
    const gaps = capabilityGaps(LOCAL_CAPABILITIES, SERVER_CAPABILITIES)
    expect(gaps).not.toContain('changeBid')
    expect(gaps).not.toContain('dealSource')
  })
})
