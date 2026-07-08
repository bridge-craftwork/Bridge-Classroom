// Chat mode: table messages, your own right-aligned.
export default {
  label: 'chat (table messages)',
  props: {
    mode: 'chat',
    title: 'Table chat',
    messages: [
      { from: 'Snow White', text: 'nice weak jump ♠' },
      { from: 'Rick', text: 'thanks — thinking 3♠ to compete', own: true },
      { from: 'Snow White', text: 'I have a little something' },
    ],
  },
}
