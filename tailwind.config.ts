import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fg: '#e5e2e1',
        muted: '#c5c5d9',
        surface: '#131313',
        background: '#131313',
        'surface-low': '#1c1b1b',
        'surface-high': '#2a2a2a',
        'surface-highest': '#353534',
        'surface-lowest': '#0e0e0e',
        'surface-bright': '#393939',
        'surface-container-low': '#1c1b1b',
        'surface-container-high': '#2a2a2a',
        'surface-container-highest': '#353534',
        'surface-container-lowest': '#0e0e0e',
        'surface-variant': '#353534',
        'outline-variant': '#444656',
        'on-surface': '#e5e2e1',
        'on-surface-variant': '#c5c5d9',
        primary: '#bbc3ff',
        'primary-strong': '#3d5afe',
        'primary-deep': '#2848ee',
        'primary-container': '#3d5afe',
        'inverse-primary': '#2848ee',
        'on-primary': '#001d93',
        'on-primary-container': '#f1f0ff',
        danger: '#93000a',
        'danger-text': '#ffdad6',
        'error-container': '#93000a',
        'on-error-container': '#ffdad6'
      },
      borderRadius: {
        DEFAULT: '1rem',
        lg: '2rem',
        xl: '3rem'
      },
      boxShadow: {
        frame: '0 30px 80px rgba(0, 0, 0, 0.55)',
        'primary-glow': '0 10px 24px rgba(61, 90, 254, 0.3)'
      },
      fontFamily: {
        sans: ['Be Vietnam Pro', 'Segoe UI', 'sans-serif']
      }
    }
  }
} satisfies Config;