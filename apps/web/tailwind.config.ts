
import type { Config } from 'tailwindcss'
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        orange: '#E8793B',
        blue: '#215696',
        yellow: '#FFD23F',
        green: '#6AB547',
        aqua: '#00ADF1',
        charcoal: '#222222',
        'light-gray': '#F2F2F2',
        stage: {
          draft: '#9CA3AF', // gray
          intake: '#22C55E', // green
          in_progress: '#3B82F6', // blue
          awaiting_approval: '#F59E0B', // amber
          revisions: '#EF4444', // red
          delivered: '#10B981', // emerald
          archived: '#6B7280' // gray-600
        }
      }
    }
  },
  plugins: []
} satisfies Config
