(() => {
    const scrollbarStyle = document.getElementById("scrollbar-style");

    function setAppearance(theme, saveInStore = true, dispatchEvent = true) {
        const resetStyles = document.createElement("style");
        resetStyles.innerText = `*{transition: unset !important;}`;
        resetStyles.setAttribute("data-theme-onload-styles", "");
        document.head.appendChild(resetStyles);

        if (saveInStore) localStorage.setItem("theme", theme);
        if (theme === "auto")
            theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

        const htmlClasses = document.querySelector("html").classList;
        htmlClasses.remove("light");
        htmlClasses.remove("dark");
        htmlClasses.remove("default");
        htmlClasses.remove("auto");
        htmlClasses.add(theme);

        if (theme === "light") {
            scrollbarStyle.textContent = `
                :root {
                    --scrollbar-percentage-color: rgba(40, 40, 40, 0.75);
                    --scrollbar-track-color: rgba(125, 125, 125, 0.5);
                    --scrollbar-thumb-color: rgba(75, 75, 75, 0.5);
                    --scrollbar-thumb-hover-color: rgba(40, 40, 40, 0.5);
                }
                `;
        } else {
            scrollbarStyle.textContent = `
                :root {
                    --scrollbar-percentage-color: rgba(200, 200, 200, 0.75);
                    --scrollbar-track-color: rgba(75, 75, 75, 0.5);
                    --scrollbar-thumb-color: rgba(150, 150, 150, 0.5);
                    --scrollbar-thumb-hover-color: rgba(200, 200, 200, 0.5);
                }
            `;
        }

        setTimeout(() => resetStyles.remove(), 1);
        if (dispatchEvent)
            window.dispatchEvent(new CustomEvent("on-theme-change", { detail: theme }));
    }

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (localStorage.getItem("theme") || "auto" === "auto") setAppearance("auto", false);
    });

    window.addEventListener("load", () => {
        const toggles = document.querySelectorAll("[data-theme-value]");

        toggles.forEach((el) => {
            el.addEventListener("click", () =>
                setAppearance(el.getAttribute("data-theme-value"), true, el)
            );
        });
    });

    setAppearance(localStorage.getItem("theme") || "auto");
})();
