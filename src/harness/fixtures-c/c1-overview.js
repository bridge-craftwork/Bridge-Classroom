// C1 · overview (teacher multi-table console). A live class of four tables, one in
// each state a teacher actually sees at a glance: bidding, cardplay, complete, and
// one still waiting for its fourth. Plus the lobby roster (waiting + parked).
//
// This is the ONE full-table surface deliberately OUTSIDE the grid arranger: the
// console monitor is a bespoke `tc-grid` of MiniTable tiles, and MiniTable draws its
// own compass diagram rather than composing BridgeTable. That's why it needed its own
// fixture — nothing in the A1/B galleries exercises it.
//
// It's also where integration-roadmap Phase 4's open question lives: the roadmap
// pencils in a `ConsoleTile` component that was never built, and the shipped answer
// is MiniTable. Seeing the tile grid at real density is how that gets decided.
//
// Hand shape is MiniTable's own: suit letter + rank char, 'T' for ten (not the
// {spades:[...]} shape the arranger surfaces use).
export default {
  label: 'C1 · console overview',
  surface: 'c1',
  view: 'overview',
  sessionName: "Tuesday 7pm — Intermediate",
  connectionStatus: 'connected',
  shareUrl: 'https://bridge-classroom.org/play/BRG-4K7Q',
  deck: { loaded: true, label: 'Minor Suit Openings', board: 4, total: 12 },
  settings: { seatPolicy: 'pairs', botMode: 'rulesbot' },
  waitToSeat: true,

  tables: [
    {
      table_id: 't1',
      name: 'Table 1',
      board_no: 4,
      phase: 'bidding',
      contract: null,
      tricks: { ns: 0, ew: 0 },
      next_to_act: 'E',
      ready: [],
      seats: {
        N: { kind: 'human', name: 'Ana', connected: true },
        E: { kind: 'human', name: 'Ben', connected: true },
        S: { kind: 'human', name: 'Cara', connected: true },
        W: { kind: 'human', name: 'Dev', connected: true },
      },
      hands: {
        N: ['SK', 'S7', 'S4', 'HQ', 'H9', 'H3', 'DA', 'DJ', 'D6', 'CK', 'C8', 'C4', 'C2'],
        E: ['S6', 'S3', 'HT', 'H8', 'H6', 'H5', 'H2', 'D9', 'D8', 'D7', 'CT', 'C9', 'C3'],
        S: ['SA', 'SQ', 'SJ', 'ST', 'S8', 'HA', 'HJ', 'H7', 'DK', 'DT', 'D2', 'CJ', 'C7'],
        W: ['S9', 'S5', 'S2', 'HK', 'H4', 'DQ', 'D5', 'D4', 'D3', 'CA', 'CQ', 'C6', 'C5'],
      },
      current_trick: { plays: [] },
    },
    {
      table_id: 't2',
      name: 'Table 2',
      board_no: 4,
      phase: 'play',
      contract: { text: '4S', declarer: 'S' },
      tricks: { ns: 3, ew: 1 },
      next_to_act: 'W',
      ready: [],
      seats: {
        N: { kind: 'human', name: 'Eli', connected: true },
        E: { kind: 'bot', name: 'RulesBot' },
        S: { kind: 'human', name: 'Fay', connected: true },
        W: { kind: 'human', name: 'Gus', connected: false }, // dropped — the red dot case
      },
      hands: {
        N: ['SK', 'S7', 'HQ', 'H9', 'DA', 'DJ', 'CK', 'C8', 'C4'],
        E: ['S6', 'HT', 'H8', 'H6', 'D9', 'D8', 'CT', 'C9', 'C3'],
        S: ['SA', 'SQ', 'SJ', 'HA', 'HJ', 'DK', 'DT', 'CJ', 'C7'],
        W: ['S9', 'S5', 'HK', 'H4', 'DQ', 'D5', 'CA', 'CQ', 'C6'],
      },
      current_trick: { plays: [{ seat: 'S', card: 'SA' }, { seat: 'W', card: 'S5' }] },
    },
    {
      table_id: 't3',
      name: 'Table 3',
      board_no: 4,
      phase: 'complete',
      contract: { text: '3NT', declarer: 'N' },
      tricks: { ns: 10, ew: 3 },
      next_to_act: null,
      ready: ['N', 'S'], // two of four have pressed ready — the lockstep waiting case
      seats: {
        N: { kind: 'human', name: 'Hana', connected: true },
        E: { kind: 'human', name: 'Ivan', connected: true },
        S: { kind: 'human', name: 'Jo', connected: true },
        W: { kind: 'bot', name: 'RulesBot' },
      },
      hands: {
        N: ['SK', 'S7', 'S4', 'HQ', 'H9', 'H3', 'DA', 'DJ', 'D6', 'CK', 'C8', 'C4', 'C2'],
        E: ['S6', 'S3', 'HT', 'H8', 'H6', 'H5', 'H2', 'D9', 'D8', 'D7', 'CT', 'C9', 'C3'],
        S: ['SA', 'SQ', 'SJ', 'ST', 'S8', 'HA', 'HJ', 'H7', 'DK', 'DT', 'D2', 'CJ', 'C7'],
        W: ['S9', 'S5', 'S2', 'HK', 'H4', 'DQ', 'D5', 'D4', 'D3', 'CA', 'CQ', 'C6', 'C5'],
      },
      current_trick: { plays: [] },
      result: { contract: { made: true, declarer_tricks: 10 } },
    },
    {
      table_id: 't4',
      name: 'Table 4',
      board_no: 4,
      phase: 'bidding',
      contract: null,
      tricks: { ns: 0, ew: 0 },
      next_to_act: 'N',
      ready: [],
      seats: {
        N: { kind: 'human', name: 'Kit', connected: true },
        E: { kind: 'bot', name: 'RulesBot' },
        S: { kind: 'bot', name: 'RulesBot' },
        W: { kind: 'bot', name: 'RulesBot' },
      },
      hands: {
        N: ['SK', 'S7', 'S4', 'HQ', 'H9', 'H3', 'DA', 'DJ', 'D6', 'CK', 'C8', 'C4', 'C2'],
        E: ['S6', 'S3', 'HT', 'H8', 'H6', 'H5', 'H2', 'D9', 'D8', 'D7', 'CT', 'C9', 'C3'],
        S: ['SA', 'SQ', 'SJ', 'ST', 'S8', 'HA', 'HJ', 'H7', 'DK', 'DT', 'D2', 'CJ', 'C7'],
        W: ['S9', 'S5', 'S2', 'HK', 'H4', 'DQ', 'D5', 'D4', 'D3', 'CA', 'CQ', 'C6', 'C5'],
      },
      current_trick: { plays: [] },
    },
  ],

  waiting: [{ sub: 'k1', name: 'Lena' }, { sub: 'k2', name: 'Marco' }],
  parked: [{ sub: 'k3', name: 'Nina', table_id: 't2' }],
}
