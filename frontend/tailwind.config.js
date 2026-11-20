/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7ff",
          100: "#e0effe",
          200: "#bae0fd",
          300: "#7cc8fb",
          400: "#36aaf5",
          500: "#0c8ee6",
          600: "#0170c5",
          700: "#0259a0",
          800: "#064c83",
          900: "#0b406d",
          950: "#072848",
        },
        // Theme-driven semantic tokens — these read the live CSS variables set
        // by applyThemeVars() (see src/theme/applyTheme.ts), so `bg-app-surface`
        // etc. repaint the instant the dashboard's theme object changes; they
        // are NOT a fixed color like the `brand` scale above.
        app: {
          bg: "var(--color-background)",
          surface: "var(--color-surface)",
          text: "var(--color-text)",
          muted: "var(--color-muted-text)",
          primary: "var(--color-primary)",
          secondary: "var(--color-secondary)",
          success: "var(--color-success)",
          warning: "var(--color-warning)",
          danger: "var(--color-danger)",
          border: "var(--color-border)",
        },
      },
      fontFamily: {
        app: "var(--font-family)",
      },
      borderRadius: {
        app: "var(--radius)",
      },
      boxShadow: {
        app: "var(--shadow)",
      },
      spacing: {
        "app-xs": "var(--space-xs)",
        "app-sm": "var(--space-sm)",
        "app-md": "var(--space-md)",
        "app-lg": "var(--space-lg)",
        "app-xl": "var(--space-xl)",
      },
    },
  },
  plugins: [],
};
