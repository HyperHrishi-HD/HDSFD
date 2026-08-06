/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          300: 'rgb(var(--theme-accent-light) / <alpha-value>)',
          400: 'rgb(var(--theme-accent-light) / <alpha-value>)',
          500: 'rgb(var(--theme-accent) / <alpha-value>)',
          600: 'rgb(var(--theme-accent) / <alpha-value>)',
          900: 'rgb(var(--theme-accent-dark) / <alpha-value>)',
        }
      }
    },
  },
  plugins: [],
}
