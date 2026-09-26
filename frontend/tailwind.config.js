/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                // RGB channels live in src/styles.css; <alpha-value> supports opacity modifiers.
                'remal-blue': 'rgb(var(--remal-blue-rgb) / <alpha-value>)',
                'remal-blue-strong': 'rgb(var(--remal-blue-strong-rgb) / <alpha-value>)',
                'remal-navy': 'rgb(var(--remal-navy-rgb) / <alpha-value>)',
                'remal-red': 'rgb(var(--remal-red-rgb) / <alpha-value>)',
                'remal-orange': 'rgb(var(--remal-orange-rgb) / <alpha-value>)',
                'remal-ink': 'rgb(var(--remal-ink-rgb) / <alpha-value>)',
                'remal-bg': 'rgb(var(--remal-bg-rgb) / <alpha-value>)',
                'remal-danger': 'rgb(var(--remal-danger-rgb) / <alpha-value>)',
                // Preserve legacy utilities without introducing competing brand values.
                'remal-dark': 'rgb(var(--remal-dark-rgb) / <alpha-value>)',
                'remal-gold': 'rgb(var(--remal-gold-rgb) / <alpha-value>)'
            },
            fontFamily: {
                sans: ['Tajawal', 'Cairo', 'sans-serif']
            },
            borderRadius: {
                '4xl': '2rem'
            },
            boxShadow: {
                float: '0 25px 70px rgba(17, 35, 49, 0.14)',
                luxe: '0 22px 45px rgba(139, 0, 0, 0.18)'
            }
        }
    },
    plugins: []
};
