import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // shadcn semantic slots — components read these, backed by the CSS
        // variables in globals.css (light values in :root, dark values in
        // .dark) so the palette below stays the single source of truth.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          hover: 'hsl(var(--primary-hover))',
          active: 'hsl(var(--primary-active))',
          light: 'hsl(var(--primary-light))',
          surface: 'hsl(var(--primary-surface))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          hover: 'hsl(var(--secondary-hover))',
          surface: 'hsl(var(--secondary-surface))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          surface: 'hsl(var(--success-surface))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          surface: 'hsl(var(--warning-surface))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          surface: 'hsl(var(--info-surface))',
          foreground: 'hsl(var(--info-foreground))',
        },
        // "AI Generated" / AI-feature accent (purple) — used sparingly, per
        // the brief, so AI-specific surfaces stay visually distinct from
        // the primary blue CTA color without competing with it.
        ai: {
          DEFAULT: 'hsl(var(--ai-accent))',
          surface: 'hsl(var(--ai-accent-surface))',
          foreground: 'hsl(var(--ai-accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          surface: 'hsl(var(--destructive-surface))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Tailwind's built-in `slate` scale already matches the brief's
        // neutral gray scale (50 #F8FAFC ... 900 #0F172A) value-for-value,
        // so it isn't redefined here — reach for `slate-*` directly for
        // neutral text/background/border needs outside the semantic slots.
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: '0.5rem' /* 8px */,
        DEFAULT: '0.625rem' /* 10px */,
        md: '0.625rem' /* 10px */,
        lg: 'var(--radius)' /* 12px */,
        xl: '1rem' /* 16px */,
        '2xl': '1.25rem' /* 20px */,
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        dropdown: '0 4px 6px -2px rgb(15 23 42 / 0.05), 0 10px 15px -3px rgb(15 23 42 / 0.08)',
        popover: '0 4px 6px -2px rgb(15 23 42 / 0.05), 0 10px 15px -3px rgb(15 23 42 / 0.08)',
        dialog: '0 10px 15px -3px rgb(15 23 42 / 0.1), 0 20px 25px -5px rgb(15 23 42 / 0.1)',
        toast: '0 4px 6px -2px rgb(15 23 42 / 0.05), 0 10px 15px -3px rgb(15 23 42 / 0.08)',
        tooltip: '0 2px 4px 0 rgb(15 23 42 / 0.08)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'live-reel-drift': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'live-reel-drift': 'live-reel-drift 18s linear infinite',
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
