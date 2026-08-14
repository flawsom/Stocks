import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        // Editorial broadsheet stack — TWK Lausanne → Inter, PP Mondwest →
        // Playfair Display, Editorial New → Cormorant Garamond, Times stays Times.
        serif: ["'Playfair Display'", "Georgia", "serif"],
        editorial: ["'Cormorant Garamond'", "Georgia", "serif"],
        times: ["Times", "Times New Roman", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* ── Editorial broadsheet "green room" — the terminal now lives on
           the same bone-white canvas as the landing page. The single
           saturated accent is highlighter green (#2bee4b); for small text
           on the bone canvas we use its readable deep derivation (#16a034)
           so contrast stays legible while hue stays on-brand. ── */
        terminal: {
          bg: "#fafffa",        // bone white canvas (was #080c14)
          surface: "#f0f6ef",   // subtle sage surface (was #0d1420)
          panel: "#f4f9f2",     // panel (was #111827)
          border: "#c8d2c8",    // muted sage hairline (was #1e2d45)
          borderLight: "#dbe4d9",
        },
        brand: {
          cyan: "#16a034",      // deep highlighter green — readable accent
          cyanDim: "#12812b",
          green: "#0a9c36",
          greenDim: "#0b8a31",
          gold: "#a16207",
          goldDim: "#8a5206",
        },
        bull: {
          DEFAULT: "#0a9c36",
          dim: "#0b8a31",
          dark: "#ddf4e3",
        },
        bear: {
          DEFAULT: "#d43b36",
          dim: "#bb352f",
          dark: "#fbe7e5",
        },
        predict: {
          DEFAULT: "#a16207",
          dim: "#8a5206",
          dark: "#fdf3da",
        },
        neural: {
          DEFAULT: "#7c3aed",
          dim: "#6d28d9",
          dark: "#efeafd",
        },
        /* Editorial broadsheet system — single saturated green accent over a
           warm monochrome canvas (bone white canvas / press black ink). */
        editorial: {
          bone: "#fafffa",       // page canvas — warm near-white "paper"
          ink: "#121613",        // press black — headlines, dark sections, footer
          blackink: "#000000",   // typesetter ink
          verdant: "#232924",    // slate verdant — borders, muted dark accents
          newsprint: "#516254",  // muted captions / helper text
          sage: "#c8d2c8",       // light text on dark surfaces
          marker: "#2bee4b",     // highlighter green — the single accent
          moss: "#93b799",       // shadow moss — supporting green detail
          echo: "#c4e4c9",       // echo green — supporting detail
        },
        /* Slate is remapped to ink-tinted editorial grays so every
           text-slate-* class in the terminal resolves to the light system:
           the "bright text on dark" roles (100–300) become ink, the muted
           label roles (400–600) become newsprint-family mid tones, and the
           dimmest footer roles (700) become a soft gray. */
        slate: {
          50: "#f4f8f4",
          100: "#161a17",
          200: "#1d231e",
          300: "#2a312b",
          400: "#55635a",
          500: "#5f6e62",
          600: "#516254",
          700: "#7b8a7d",
          800: "#232924",
          900: "#121613",
          950: "#0a0d0b",
        },
      },
      backgroundImage: {
        "terminal-gradient": "linear-gradient(135deg, #fafffa 0%, #eef6ec 50%, #fafffa 100%)",
        "panel-gradient": "linear-gradient(180deg, #ffffff 0%, #f2f7f0 100%)",
        "bull-glow": "linear-gradient(135deg, #ddf4e3 0%, #f0fbf2 100%)",
        "bear-glow": "linear-gradient(135deg, #fbe7e5 0%, #fef6f5 100%)",
        "predict-glow": "linear-gradient(135deg, #fdf3da 0%, #fefaf0 100%)",
        "neural-glow": "linear-gradient(135deg, #efeafd 0%, #f8f5fe 100%)",
        "glass": "linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(250,255,250,0.4) 100%)",
      },
      boxShadow: {
        "terminal": "0 0 0 1px #c8d2c8, 0 4px 24px rgba(18,22,19,0.06)",
        "panel": "0 0 0 1px #c8d2c8, inset 0 1px 0 rgba(255,255,255,0.8)",
        "cyan-glow": "0 0 16px rgba(22,160,52,0.18), 0 0 40px rgba(22,160,52,0.08)",
        "green-glow": "0 0 14px rgba(10,156,54,0.22), 0 0 40px rgba(10,156,54,0.08)",
        "gold-glow": "0 0 14px rgba(161,98,7,0.25), 0 0 40px rgba(161,98,7,0.08)",
        "red-glow": "0 0 14px rgba(212,59,54,0.22), 0 0 40px rgba(212,59,54,0.08)",
        "neural-glow": "0 0 14px rgba(124,58,237,0.22), 0 0 40px rgba(124,58,237,0.08)",
      },
      animation: {
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        "blink": "blink 1s step-end infinite",
        "scan-line": "scanLine 3s linear infinite",
        "neural-pulse": "neuralPulse 1.5s ease-in-out infinite",
        "data-stream": "dataStream 0.5s ease-out",
        "slide-right": "slideRight 0.3s ease-out",
        "fade-up": "fadeUp 0.4s ease-out",
        "marquee": "marquee 45s linear infinite",
        "marquee-slow": "marquee 70s linear infinite",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        scanLine: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        neuralPulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.8" },
          "50%": { transform: "scale(1.1)", opacity: "1" },
        },
        dataStream: {
          "0%": { transform: "translateX(-10px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        slideRight: {
          "0%": { transform: "translateX(-20px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        fadeUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
