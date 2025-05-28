// tailwind.config.js
module.exports = {
    darkMode: "class",
    content: [
        "./views/**/*.ejs",
        "./views/**/*.css",
        "./src/**/*.ts",
        "./public/**/*.js",
        "./public/**/*.css",
        "./node_modules/preline/dist/*.js"
    ],

    theme: {
        extend: {
            screens: {
                mobile: "976px",
                "2xl": "1800px"
            },
            transitionDuration: {
                50: "50ms"
            },
            height: {
                inherit: "inherit"
            },
            width: {
                inherit: "inherit"
            },
            backgroundColor: {
                "personal-points": "#fde047",
                "personal-points-fill": "#eab308",
                "community-points": "#fdba74",
                "community-points-fill": "#f97316",
                "personal-points-dark": "#fef08a",
                "personal-points-fill-dark": "#eab308",
                "community-points-dark": "#fed7aa",
                "community-points-fill-dark": "#f97316"
            }
        }
    },
    plugins: []
};
