// Friendly names for spawned test students/players — four themed sets of eight,
// then a plain "Test <n>". Shared by the teacher console (populate a class) and
// the single-table host (invite a few test players). Assigned by spawn position.
export const TEST_STUDENT_NAMES = [
  // Snow White & the seven dwarves
  'Snow White', 'Doc', 'Grumpy', 'Happy', 'Sleepy', 'Bashful', 'Sneezy', 'Dopey',
  // Santa's reindeer
  'Dasher', 'Dancer', 'Prancer', 'Vixen', 'Comet', 'Cupid', 'Donner', 'Blitzen',
  // Stars of Orion (Meissa added as the 8th — the classic list has seven)
  'Rigel', 'Bellatrix', 'Mintaka', 'Alnilam', 'Alnitak', 'Saiph', 'Betelgeuse', 'Meissa',
  // Wine (grape) varieties
  'Chardonnay', 'Syrah', 'Petit Verdot', 'Malbec', 'Merlot', 'Grenache', 'Sangiovese', 'Riesling',
]

export function testStudentName(i) {
  return TEST_STUDENT_NAMES[i - 1] || `Test ${i}`
}
