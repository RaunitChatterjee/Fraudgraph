const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), panel: v('panel'), raised: v('raised'), line: v('line'),
        ink: v('ink'), muted: v('muted'), accent: v('accent'), gold: v('gold'),
        crit: '#c8372d', high: '#d9741c', med: '#c99a14', low: '#a89f8e', ok: '#2f7a5f', frozen: '#2f8a86',
      },
      borderRadius: { lg: '4px', md: '3px', DEFAULT: '2px', sm: '2px' },
      fontFamily: {
        sans: ['"Instrument Sans"', '"Helvetica Neue"', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', '"Times New Roman"', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
