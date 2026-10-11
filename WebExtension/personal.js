(() => {
    if (globalThis.__advPersonalLoaded) return;
    globalThis.__advPersonalLoaded = true;
    let style;
    let lastCSS;
    async function refresh() {
        if (document.hidden) return;
        try {
            const state = await browser.runtime.sendMessage({operation: "list"});
            if (state.error) return;
            const selectors = state.rules.filter(rule => !rule.deleted && rule.host === location.hostname)
                .filter(rule => { try { document.querySelector(rule.selector); return true; } catch { return false; } })
                .map(rule => rule.selector);
            const fixtureCSS = ["localhost", "127.0.0.1"].includes(location.hostname)
                ? "#adv-demo-ad { display: none !important; }" : "";
            const css = fixtureCSS + selectors.map(selector => `${selector} { display: none !important; }`).join("\n");
            if (css === lastCSS && style?.isConnected) return;
            if (!document.documentElement) return;
            if (!style?.isConnected) {
                style = document.createElement("style");
                document.documentElement.append(style);
            }
            style.textContent = css;
            lastCSS = css;
        } catch { /* Keep applied rules while the background/native service is unavailable. */ }
    }
    browser.runtime.onMessage.addListener(message => {
        if (message.operation === "refresh") refresh();
    });
    document.addEventListener("DOMContentLoaded", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    setInterval(refresh, 5000);
    refresh();
})();
