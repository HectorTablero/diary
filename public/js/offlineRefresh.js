let intervalId;
function checkConnectivity(url) {
    const interval = 2500;

    async function fetchUrl() {
        console.log(`Fetching ${url}`);
        try {
            const response = await fetch(url);
            if (response.ok) {
                console.log("Fetched successfully");
                notifyConectivity();
                clearInterval(intervalId);
            } else {
                clearInterval(intervalId);
                intervalId = setInterval(fetchUrl, interval);
            }
        } catch (error) {
            console.log("Failed to fetch:", error);
            clearInterval(intervalId);
            intervalId = setInterval(fetchUrl, interval);
        }
    }

    fetchUrl();
}

function notifyConectivity() {
    document.location.reload();
    //alert(`Resource at ${window.location.href} is now accessible`);
}
