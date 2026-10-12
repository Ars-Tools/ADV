(() => {
    if (globalThis.__advPersonalLoaded) return;
    globalThis.__advPersonalLoaded = true;
    let style;
    let lastCSS;
    let selectors = [];
    let youtubeActive = false;
    let reported;
    let lastReport = 0;
    const documentId = crypto.randomUUID();
    const started = performance.timeOrigin;
    const builtins = ['ins.adsbygoogle', '[data-ad-slot]'];
    async function reportActivity() {
        const blocked = youtubeActive || [...builtins, ...selectors,
            ...(['localhost', '127.0.0.1'].includes(location.hostname) ? ['#adv-demo-ad'] : [])]
            .some(selector => [...document.querySelectorAll(selector)].some(node => getComputedStyle(node).display === 'none'));
        if (blocked === reported && Date.now() - lastReport < 15000) return;
        try {
            const response = await browser.runtime.sendMessage({operation:'activity', document:documentId, started, blocked});
            if (!response?.error) { reported = blocked; lastReport = Date.now(); }
        } catch { /* Retry with the next refresh. */ }
    }
    globalThis.__advReportYouTube = active => { youtubeActive = active; reportActivity(); };
    async function refresh() {
        if (document.hidden) return;
        try {
            const state = await browser.runtime.sendMessage({operation: "list"});
            if (state.error) return;
            selectors = state.rules.filter(rule => !rule.deleted && rule.host === location.hostname)
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
        finally { if (document.documentElement) await reportActivity(); }
    }
    browser.runtime.onMessage.addListener(message => {
        if (message.operation === "refresh") refresh();
        if (message.operation === 'activityCheck') { reported = undefined; return refresh(); }
    });
    document.addEventListener("DOMContentLoaded", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener('pagehide', () => {
        browser.runtime.sendMessage({operation:'activity', document:documentId, started, blocked:false}).catch(() => {});
    });
    setInterval(refresh, 5000);
    // Recheck matching elements promptly without fetching storage on every DOM mutation.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => { scheduled = false; if (!document.hidden) reportActivity(); }, 100);
    });
    function observe() { observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['id','class','style','hidden','data-ad-slot']}); }
    if (document.documentElement) observe();
    else document.addEventListener('DOMContentLoaded', observe, {once:true});
    refresh();
})();
