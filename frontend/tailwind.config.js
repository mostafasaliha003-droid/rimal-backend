/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                'remal-dark': '#112331',
                'remal-red': '#8B0000',
                'remal-blue': '#17A2B8',
                'remal-gold': '#FBBF24',
                'remal-bg': '#F4F6F9'
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
