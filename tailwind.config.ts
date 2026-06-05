import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f3efe4",
        panel: "#eee7da",
        ink: "#17140f",
        muted: "#716b60",
        rule: "#c9beac",
        verric: "#c73524",
        softred: "#ead7cf",
        good: "#2f6f4e",
        warn: "#a06422"
      },
      fontFamily: {
        serifdeck: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "Arial", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
