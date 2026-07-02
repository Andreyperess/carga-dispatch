/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        asphalt: {
          DEFAULT: '#1C2530',
          light: '#28333F',
          dark: '#12181F',
        },
        paper: '#F6F4EF',
        border: '#E2DFD6',
        accent: {
          DEFAULT: '#FF6A3D',
          dark: '#E4552B',
        },
        steel: '#64748B',
        success: '#1F9D67',
        pending: '#E8A93B',
        danger: '#D64545',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
