(() => {
    if (globalThis.__advPersonalLoaded) return;
    globalThis.__advPersonalLoaded = true;
    let style;
    let lastCSS;
    let lastRules;
    let selectors = [];
    const hiddenElements = new Map();
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
    function apply() {
        if (lastCSS === undefined || !document.documentElement) return;
        if (!style?.isConnected) {
            style = document.createElement('style');
            document.documentElement.append(style);
        }
        if (style.disabled) style.disabled = false;
        if (style.media) style.media = '';
        if (style.sheet?.disabled) style.sheet.disabled = false;
        const rules = () => style.sheet ? [...style.sheet.cssRules].map(rule => rule.cssText).join('\n') : undefined;
        if (style.textContent !== lastCSS || rules() !== lastRules) {
            style.textContent = lastCSS;
            lastRules = rules();
        }
        const matches = new Set();
        for (const selector of selectors) {
            // Changing inline style would change these selectors' own predicate.
            // Keep their stylesheet semantics rather than oscillating hide/restore.
            if (/\[\s*style\b/i.test(selector)) continue;
            document.querySelectorAll(selector).forEach(node => matches.add(node));
        }
        for (const [node, original] of hiddenElements) {
            if (matches.has(node)) continue;
            if (node.style.getPropertyValue('display') === 'none' && node.style.getPropertyPriority('display') === 'important') {
                if (original.value) node.style.setProperty('display', original.value, original.priority);
                else node.style.removeProperty('display');
                if (!original.hadStyle && !node.style.length) node.removeAttribute('style');
            }
            hiddenElements.delete(node);
        }
        for (const node of matches) {
            const value = node.style.getPropertyValue('display');
            const priority = node.style.getPropertyPriority('display');
            const owned = value === 'none' && priority === 'important';
            const visible = getComputedStyle(node).display !== 'none';
            if (!owned && (visible || hiddenElements.has(node))) {
                hiddenElements.set(node, {value, priority, hadStyle:node.hasAttribute('style')});
            }
            if (visible && !owned) node.style.setProperty('display', 'none', 'important');
        }
    }
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
            lastCSS = css;
        } catch { /* Keep applied rules while the background/native service is unavailable. */ }
        finally { apply(); if (document.documentElement) await reportActivity(); }
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
        setTimeout(() => { scheduled = false; if (!document.hidden) { apply(); reportActivity(); } }, 100);
    });
    function observe() { observer.observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true}); }
    if (document.documentElement) observe();
    else document.addEventListener('DOMContentLoaded', observe, {once:true});
    refresh();
})();
