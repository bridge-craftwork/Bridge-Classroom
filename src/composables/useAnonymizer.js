import { ref } from 'vue'

const STORAGE_KEY = 'bridge-classroom-anon-mode'
const SALT = 'BridgeClassroom-Anon'
const REDACTED = '*** redacted ***'

// Same name arrays as BBA-Server IpAnonymizer.cs
const FIRST_NAMES = [
  'Aaron', 'Abigail', 'Adam', 'Adrian', 'Aiden', 'Alex', 'Alice', 'Allison',
  'Amanda', 'Amber', 'Amy', 'Andrea', 'Andrew', 'Angela', 'Anna', 'Anthony',
  'Ashley', 'Austin', 'Barbara', 'Benjamin', 'Beth', 'Brandon', 'Brenda',
  'Brian', 'Brittany', 'Bruce', 'Bryan', 'Caleb', 'Cameron', 'Carl', 'Carlos',
  'Carol', 'Caroline', 'Catherine', 'Charles', 'Charlotte', 'Chelsea', 'Chris',
  'Christina', 'Christine', 'Christopher', 'Cindy', 'Claire', 'Clara', 'Cody',
  'Colin', 'Connor', 'Craig', 'Crystal', 'Cynthia', 'Dale', 'Daniel', 'Danielle',
  'David', 'Dawn', 'Deborah', 'Dennis', 'Derek', 'Diana', 'Diane', 'Donald',
  'Donna', 'Dorothy', 'Douglas', 'Dylan', 'Edward', 'Eileen', 'Eleanor', 'Elizabeth',
  'Ellen', 'Emily', 'Emma', 'Eric', 'Erica', 'Erin', 'Ethan', 'Eugene', 'Eva',
  'Evan', 'Evelyn', 'Frances', 'Francis', 'Frank', 'Gabriel', 'Gary', 'George',
  'Gerald', 'Gloria', 'Grace', 'Gregory', 'Hannah', 'Harold', 'Harry', 'Heather',
  'Helen', 'Henry', 'Holly', 'Howard', 'Ian', 'Isaac', 'Isabella', 'Jack', 'Jacob',
  'James', 'Jamie', 'Jane', 'Janet', 'Jason', 'Jean', 'Jeffrey', 'Jennifer',
  'Jeremy', 'Jerry', 'Jesse', 'Jessica', 'Jill', 'Joan', 'Joe', 'Joel', 'John',
  'Jonathan', 'Jordan', 'Joseph', 'Joshua', 'Joyce', 'Julia', 'Julie', 'Justin',
  'Karen', 'Katherine', 'Kathleen', 'Katie', 'Keith', 'Kelly', 'Kenneth', 'Kevin',
  'Kim', 'Kimberly', 'Kyle', 'Larry', 'Laura', 'Lauren', 'Lawrence', 'Leah',
  'Leonard', 'Leslie', 'Linda', 'Lisa', 'Logan', 'Louis', 'Lucas', 'Lucy', 'Luke',
  'Madison', 'Margaret', 'Maria', 'Marie', 'Mark', 'Martha', 'Martin', 'Mary',
  'Mason', 'Matthew', 'Megan', 'Melanie', 'Melissa', 'Michael', 'Michelle', 'Mike',
  'Monica', 'Nancy', 'Natalie', 'Nathan', 'Nicholas', 'Nicole', 'Noah', 'Oliver',
  'Olivia', 'Oscar', 'Pamela', 'Patricia', 'Patrick', 'Paul', 'Paula', 'Peter',
  'Philip', 'Rachel', 'Ralph', 'Randy', 'Raymond', 'Rebecca', 'Richard', 'Robert',
  'Robin', 'Roger', 'Ronald', 'Rose', 'Roy', 'Russell', 'Ruth', 'Ryan', 'Samantha',
  'Samuel', 'Sandra', 'Sara', 'Sarah', 'Scott', 'Sean', 'Sharon', 'Sophia',
  'Stephanie', 'Stephen', 'Steve', 'Steven', 'Susan', 'Tammy', 'Teresa', 'Terry',
  'Thomas', 'Tiffany', 'Timothy', 'Todd', 'Tom', 'Tony', 'Tracy', 'Travis', 'Tyler',
  'Valerie', 'Vanessa', 'Victor', 'Victoria', 'Vincent', 'Virginia', 'Walter',
  'Wayne', 'Wendy', 'William', 'Zachary'
]

const SURNAMES = [
  'Adams', 'Allen', 'Anderson', 'Bailey', 'Baker', 'Barnes', 'Bell', 'Bennett',
  'Brooks', 'Brown', 'Bryant', 'Butler', 'Campbell', 'Carter', 'Clark', 'Coleman',
  'Collins', 'Cook', 'Cooper', 'Cox', 'Cruz', 'Davis', 'Diaz', 'Edwards', 'Evans',
  'Fisher', 'Flores', 'Ford', 'Foster', 'Garcia', 'Gibson', 'Gomez', 'Gonzalez',
  'Gordon', 'Graham', 'Gray', 'Green', 'Griffin', 'Hall', 'Hamilton', 'Harris',
  'Harrison', 'Hayes', 'Henderson', 'Hernandez', 'Hill', 'Holmes', 'Howard',
  'Hughes', 'Hunt', 'Jackson', 'James', 'Jenkins', 'Johnson', 'Jones', 'Jordan',
  'Kelly', 'Kennedy', 'Kim', 'King', 'Lee', 'Lewis', 'Long', 'Lopez', 'Marshall',
  'Martin', 'Martinez', 'Mason', 'Matthews', 'Miller', 'Mitchell', 'Moore',
  'Morales', 'Morgan', 'Morris', 'Murphy', 'Murray', 'Nelson', 'Nguyen', 'Ortiz',
  'Owens', 'Parker', 'Patterson', 'Perez', 'Perry', 'Peterson', 'Phillips',
  'Powell', 'Price', 'Ramirez', 'Reed', 'Reyes', 'Reynolds', 'Richardson', 'Rivera',
  'Roberts', 'Robinson', 'Rodriguez', 'Rogers', 'Ross', 'Russell', 'Sanchez',
  'Sanders', 'Scott', 'Simmons', 'Smith', 'Stewart', 'Sullivan', 'Taylor', 'Thomas',
  'Thompson', 'Torres', 'Turner', 'Walker', 'Wallace', 'Ward', 'Washington',
  'Watson', 'West', 'White', 'Williams', 'Wilson', 'Wood', 'Wright', 'Young'
]

// FNV-1a 64-bit hash (same algorithm as EDGAR-Defense-Toolkit)
// Uses BigInt for 64-bit arithmetic
function fnv1aHash(str) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * prime) & 0xFFFFFFFFFFFFFFFFn
  }
  return hash
}

function generateAnonName(firstName, lastName) {
  const input = `${SALT}:${firstName} ${lastName}`
  const hash = fnv1aHash(input)
  const firstIdx = Number(hash % BigInt(FIRST_NAMES.length))
  const surnameIdx = Number((hash / BigInt(FIRST_NAMES.length)) % BigInt(SURNAMES.length))
  return { firstName: FIRST_NAMES[firstIdx], lastName: SURNAMES[surnameIdx] }
}

// Singleton shared state
const isAnonymized = ref(localStorage.getItem(STORAGE_KEY) === 'true')

export function useAnonymizer() {
  function toggleAnonymize() {
    isAnonymized.value = !isAnonymized.value
    localStorage.setItem(STORAGE_KEY, isAnonymized.value.toString())
  }

  function displayName(student) {
    if (!isAnonymized.value) {
      return { firstName: student.first_name, lastName: student.last_name }
    }
    return generateAnonName(student.first_name, student.last_name)
  }

  function displayFullName(student) {
    const { firstName, lastName } = displayName(student)
    return `${firstName} ${lastName}`
  }

  function displayInitials(student) {
    const { firstName, lastName } = displayName(student)
    const first = firstName?.charAt(0) || ''
    const last = lastName?.charAt(0) || ''
    return (first + last).toUpperCase() || '?'
  }

  // Emails are redacted rather than substituted — there's no plausible fake
  // address that reads as "hidden on purpose," and the whole point is
  // presentation/screenshot safety, not a consistent alias.
  function displayEmail(email) {
    if (!isAnonymized.value) return email
    return REDACTED
  }

  return {
    isAnonymized,
    toggleAnonymize,
    displayName,
    displayFullName,
    displayInitials,
    displayEmail
  }
}
