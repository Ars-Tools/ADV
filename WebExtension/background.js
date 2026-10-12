/* Personal rules use browser-local storage until a signed App Group is available. */
const key = "personalRulesV1";
let queue = Promise.resolve();
const sourceKey = "globalBlockedSourcesV1";
const sourceRuleBase = 100000;
const sourceLimit = 1000;
let sourcesReady = false;
// Activity is ephemeral and tab-specific; never persist browsing history.
const activity = new Map();
const networkChecks = [];
function tabActivity(tabId) {
    if (!activity.has(tabId)) activity.set(tabId, {frames: new Map(), since: Date.now(), network: false, networkKnown: false});
    return activity.get(tabId);
}
async function updateToolbar(tabId, checkNetwork = false) {
    const state = tabActivity(tabId);
    if (checkNetwork && browser.declarativeNetRequest.getMatchedRules) {
        const now = Date.now();
        while (networkChecks.length && networkChecks[0] < now - 600000) networkChecks.shift();
        // Stay below the common five-calls-per-ten-minutes API quota.
        if (networkChecks.length < 3 && (!state.checked || now - state.checked >= 15000)) {
            networkChecks.push(now); state.checked = now;
            try {
                const result = await browser.declarativeNetRequest.getMatchedRules({tabId, minTimeStamp: state.since});
                state.network = result.rulesMatchedInfo.some(match => match.tabId === tabId && match.timeStamp >= state.since &&
                    (!match.rule || match.rule.rulesetId === 'advertising' ||
                     (match.rule.ruleId >= sourceRuleBase && match.rule.ruleId < sourceRuleBase + sourceLimit)));
                state.networkKnown = true;
            } catch { state.networkKnown = false; }
        }
    }
    if (activity.get(tabId) !== state) return; // Navigation superseded an asynchronous check.
    const blocked = state.network || [...state.frames.values()].some(frame => frame.blocked && Date.now() - frame.seen < 30000);
    const title = blocked ? 'ADV · Blocking detected on this page'
        : (state.networkKnown ? 'ADV · No blocking detected on this page' : 'ADV · No blocking observed; network activity unavailable');
    const icon = blocked ? 'toolbar.svg' : 'toolbar-idle.svg';
    if (state.icon !== icon) {
        await browser.action.setIcon({tabId, path: icon});
        state.icon = icon;
    }
    if (state.title !== title) {
        await browser.action.setTitle({tabId, title});
        state.title = title;
    }
    return {blocked, networkKnown: state.networkKnown};
}

function toolbarTask(task) {
    queue = queue.then(task).catch(() => {});
}
browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') {
        // Invalidate immediately so pending checks cannot repaint the old page.
        activity.delete(tabId);
        toolbarTask(() => updateToolbar(tabId));
    } else if (change.status === 'complete') toolbarTask(() => updateToolbar(tabId, true));
});
browser.tabs.onActivated.addListener(({tabId}) => toolbarTask(() => updateToolbar(tabId, true)));
browser.tabs.onRemoved.addListener(tabId => activity.delete(tabId));
setInterval(() => toolbarTask(async () => {
    for (const tab of await browser.tabs.query({active: true, currentWindow: true})) {
        if (tab.id !== undefined) await updateToolbar(tab.id, true);
    }
}), 210000);

function sourceHost(value) {
    if (typeof value !== "string") throw new Error("Enter a source hostname.");
    const host = value.trim().toLowerCase();
    if (host.length > 253 || !host.includes(".") || host.split(".").some(label =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Enter a hostname such as ads.example.com, without a URL or path.");
    return host;
}

async function savedSources() {
    const saved = await browser.storage.local.get(sourceKey);
    const hosts = saved[sourceKey] || [];
    if (!Array.isArray(hosts) || hosts.length > sourceLimit) throw new Error("Invalid source collection.");
    return [...new Set(hosts.map(sourceHost))].sort();
}

async function installSources(hosts) {
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.filter(rule => rule.id >= sourceRuleBase && rule.id < sourceRuleBase + sourceLimit).map(rule => rule.id);
    const addRules = hosts.map((host, index) => ({
        id: sourceRuleBase + index, priority: 1, action: {type: "block"},
        condition: {regexFilter: `^https?://([^/]+\\.)?${host.replace(/[.]/g, "\\.")}(:[0-9]+)?/`,
            resourceTypes: ["image", "script", "stylesheet", "xmlhttprequest", "sub_frame", "media", "font", "ping", "other"]}
    }));
    if (JSON.stringify(existing.filter(rule => removeRuleIds.includes(rule.id)).sort((a,b)=>a.id-b.id)) !== JSON.stringify(addRules)) {
        await browser.declarativeNetRequest.updateDynamicRules({removeRuleIds, addRules});
    }
    sourcesReady = true;
}

async function processSources(message, sender) {
    const old = await savedSources();
    if (!sourcesReady) await installSources(old);
    if (message.operation === "sourceList") return {hosts: old};
    if (sender.tab) {
        const page = new URL(sender.url || sender.tab.url);
        if (!["http:", "https:"].includes(page.protocol) || page.hostname !== message.pageHost) throw new Error("Site mismatch.");
    }
    let hosts;
    if (message.operation === "sourceAdd") {
        if (!Array.isArray(message.hosts) || !message.hosts.length || message.hosts.length > sourceLimit) throw new Error("Select between 1 and 1000 source hosts.");
        hosts = [...new Set([...old, ...message.hosts.map(sourceHost)])].sort();
    } else hosts = old.filter(host => host !== sourceHost(message.host));
    if (hosts.length > sourceLimit) throw new Error("The source list supports up to 1000 hosts.");
    await installSources(hosts);
    try { await browser.storage.local.set({[sourceKey]: hosts}); }
    catch (error) { sourcesReady = false; await installSources(old); throw error; }
    return {hosts, added: hosts.filter(host => !old.includes(host)).length};
}

function validate(rule) {
    if (!/^[0-9a-f-]{36}$/i.test(rule.id) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(rule.host) ||
        rule.host.length > 253 || rule.host.includes("..") || typeof rule.selector !== "string" ||
        !rule.selector.length || rule.selector.length > 2048 || /[{}@\x00-\x1f\x7f]/.test(rule.selector) ||
        !Number.isFinite(rule.modified) || rule.modified < 0 || typeof rule.deleted !== "boolean") {
        throw new Error("Invalid personal rule.");
    }
    return rule;
}

async function native(message) {
    const result = await browser.runtime.sendNativeMessage("ADV", message);
    if (result?.error) throw new Error(result.error);
    if (!result || typeof result.shared !== "boolean") throw new Error("Invalid native response.");
    return result;
}

async function state() {
    const saved = await browser.storage.local.get([key, "sharedActivated"]);
    const local = (saved[key] || []).map(validate);
    let result;
    try { result = await native({operation: "list"}); }
    catch (error) {
        if (saved.sharedActivated) throw error;
        return {rules: local, shared: false};
    }
    if (!result.shared) {
        if (saved.sharedActivated) throw new Error("Shared storage is unavailable. Restore signing settings before editing rules.");
        return {rules: local, shared: false};
    }
    // One-time migration of browser-local rules, including deletion tombstones.
    if (!saved.sharedActivated && local.length) result = await native({operation: "merge", rules: local});
    const rules = result.rules.map(validate);
    await browser.storage.local.set({[key]: rules, sharedActivated: true});
    return {rules, shared: true, cloudConfigured: result.cloudConfigured === true};
}

async function process(message, sender) {
    if (message?.operation === 'activity') {
        if (!sender.tab || typeof message.blocked !== 'boolean' || typeof message.document !== 'string' ||
            message.document.length > 64 || !Number.isFinite(message.started)) throw new Error('Invalid activity report.');
        const state = tabActivity(sender.tab.id);
        const frameId = sender.frameId || 0;
        const old = state.frames.get(frameId);
        // A late report from an old document must not replace its successor.
        if (!old || message.started >= old.started) {
            if (!frameId) {
                if (old && old.document !== message.document) {
                    state.frames.clear(); state.network = false; state.networkKnown = false; state.checked = undefined;
                    state.since = message.started;
                } else state.since = Math.min(state.since, message.started);
            }
            state.frames.set(frameId, {document: message.document, started: message.started, blocked: message.blocked, seen:Date.now()});
        }
        return await updateToolbar(sender.tab.id);
    }
    if (message?.operation === 'toolbarStatus') {
        if (sender.tab || !Number.isInteger(message.tabId)) throw new Error('Invalid toolbar request.');
        return await updateToolbar(message.tabId, true);
    }
    if (["sourceList", "sourceAdd", "sourceRemove"].includes(message?.operation)) return processSources(message, sender);
    if (message?.operation === "networkStatus") {
        const enabled = await browser.declarativeNetRequest.getEnabledRulesets();
        return {enabled: enabled.includes("advertising")};
    }
    if (!message || !["list", "add", "addMany", "remove"].includes(message.operation)) throw new Error("Unknown operation.");
    const current = await state();
    if (message.operation === "list") return current;
    let host = message.host;
    const adding = ["add", "addMany"].includes(message.operation);
    if (adding && sender.tab) {
        // A content script can only add a rule for its own frame's site.
        const url = new URL(sender.url || sender.tab.url);
        if (!["http:", "https:"].includes(url.protocol) || url.hostname !== host) throw new Error("Site mismatch.");
    }
    let added = 0;
    if (adding) {
        const selectors = message.operation === "add" ? [message.selector] : message.selectors;
        if (!Array.isArray(selectors) || !selectors.length || selectors.length > 1000) throw new Error("Enter between 1 and 1000 selectors.");
        // Validate the entire batch before committing any of it. Keep existing
        // records stable so repeated imports do not create duplicate filters.
        const incoming = selectors.map(selector => validate({id: crypto.randomUUID(), host, selector, modified: Date.now(), deleted: false}));
        const known = new Set(current.rules.filter(rule => !rule.deleted && rule.host === host).map(rule => rule.selector));
        const unique = incoming.filter(rule => {
            if (known.has(rule.selector)) return false;
            known.add(rule.selector); return true;
        });
        const combined = [...current.rules, ...unique];
        if (new TextEncoder().encode(JSON.stringify(combined)).length > 500000) throw new Error("Rule collection exceeds 500 KB.");
        added = unique.length;
        if (current.shared && added) {
            const result = await native({operation: "merge", rules: unique});
            current.rules = result.rules.map(validate);
        } else current.rules = combined;
    } else if (current.shared) {
        const result = await native({operation: message.operation, host, selector: message.selector, id: message.id});
        current.rules = result.rules.map(validate);
    } else {
        const rule = current.rules.find(rule => rule.id === message.id);
        if (rule) { rule.deleted = true; rule.modified = Math.max(Date.now(), rule.modified + 1); }
    }
    if (new TextEncoder().encode(JSON.stringify(current.rules)).length > 500000) throw new Error("Rule collection exceeds 500 KB.");
    await browser.storage.local.set({[key]: current.rules});
    // Notify permitted tabs; newly loaded/foreground tabs also fetch current rules.
    for (const tab of await browser.tabs.query({})) {
        if (tab.id !== undefined) browser.tabs.sendMessage(tab.id, {operation: "refresh"}).catch(() => {});
    }
    return {...current, added};
}

browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.operation === "refresh") return;
    const pending = queue.then(() => process(message, sender));
    queue = pending.catch(() => {});
    return pending.catch(error => ({error: error.message}));
});

// Dynamic rules persist in Safari; also reconstruct them from our saved source
// list when a new background instance starts, without depending on an open tab.
queue = queue.then(async () => { await installSources(await savedSources()); }).catch(() => {});
