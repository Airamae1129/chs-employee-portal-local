import type { Config } from "tailwindcss";

// Palette lifted from the Cyberhealth CMS reference screenshots
// (Section 2 of the build prompt) so the Employee Portal shares the
// exact same visual system.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        chs: {
          charcoal: "#1A1512",
          charcoalLight: "#221C17",
          gold: "#D99A3D",
          goldLight: "#E0A83E",
          badge: "#F5E6C8",
          bg: "#F4F3F1",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 2px 10px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
