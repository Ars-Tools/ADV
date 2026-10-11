const status = document.getElementById("status");
const pick = document.getElementById("pick");
const bulk = document.getElementById("save-bulk");
bulk.onclick = async () => {
    bulk.disabled = true;
    const output = document.getElementById("bulk-status");
    try {
        const input = document.getElementById("selectors");
        const selectors = input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (!selectors.length || selectors.length > 1000) throw new Error("Enter between 1 and 1000 selectors.");
        for (const selector of selectors) {
            try { document.querySelector(selector); }
            catch { throw new Error(`Invalid CSS selector: ${selector}`); }
        }
        const result = await browser.runtime.sendMessage({operation: "addMany", host, selectors});
        if (result.error) throw new Error(result.error);
        await render();
        input.value = "";
        output.textContent = `${result.added} rules saved. They remain after Safari closes. Duplicate rules were skipped.`;
    } catch (error) { output.textContent = error.message; }
    finally { bulk.disabled = !host; }
};
let tab;
let host;
async function renderSources() {
    const output = document.getElementById('source-status');
    try {
        const result = await browser.runtime.sendMessage({operation:'sourceList'});
        if (result.error) throw new Error(result.error);
        const list = document.getElementById('blocked-sources'); list.replaceChildren();
        for (const source of result.hosts) {
            const row = document.createElement('li');
            const code = document.createElement('code'); code.textContent = source;
            const remove = document.createElement('button'); remove.textContent = 'Unblock';
            remove.onclick = async () => {
                remove.disabled = true;
                try {
                    const response = await browser.runtime.sendMessage({operation:'sourceRemove', host:source});
                    if (response.error) throw new Error(response.error);
                    await renderSources();
                } catch (error) { output.textContent = error.message; remove.disabled = false; }
            };
            row.append(code, remove); list.append(row);
        }
        if (!result.hosts.length) list.textContent = 'No personal source blocks.';
        output.textContent = `${result.hosts.length} source host(s) blocked across websites.`;
    } catch (error) { output.textContent = `Source rules: ${error.message}`; }
}
document.getElementById('block-source').onclick = async () => {
    const button = document.getElementById('block-source'); button.disabled = true;
    try {
        const input = document.getElementById('source-host');
        const result = await browser.runtime.sendMessage({operation:'sourceAdd', hosts:[input.value]});
        if (result.error) throw new Error(result.error);
        input.value = ''; await renderSources();
    } catch (error) { document.getElementById('source-status').textContent = error.message; }
    finally { button.disabled = false; }
};
async function render() {
    const state = await browser.runtime.sendMessage({operation: "list"});
    if (state.error) throw new Error(state.error);
    status.textContent = state.shared
        ? (state.cloudConfigured ? "Shared with ADV. Open ADV on both devices to sync iCloud." : "Shared with ADV on this device. iCloud is not configured.")
        : "Saved in this Safari profile. iCloud is not configured.";
    const list = document.getElementById("rules");
    list.replaceChildren();
    for (const rule of state.rules.filter(rule => !rule.deleted && rule.host === host)) {
        const item = document.createElement("li");
        const code = document.createElement("code"); code.textContent = rule.selector;
        const remove = document.createElement("button"); remove.textContent = "Remove";
        remove.onclick = async () => {
            remove.disabled = true;
            try {
                const result = await browser.runtime.sendMessage({operation: "remove", id: rule.id});
                if (result.error) throw new Error(result.error);
                await render();
            } catch (error) { status.textContent = error.message; remove.disabled = false; }
        };
        item.append(code, remove); list.append(item);
    }
    if (!list.children.length) list.textContent = "No personal rules for this site.";
}
pick.onclick = async () => {
    pick.disabled = true;
    try {
        await browser.scripting.executeScript({target: {tabId: tab.id}, files: ["personal.js", "picker.js"]});
        window.close();
    } catch (error) {
        status.textContent = `Could not start picker: ${error.message}. Allow ADV on this site in Safari.`;
        pick.disabled = false;
        bulk.disabled = false;
    }
};
(async () => {
    try {
        const network = await browser.runtime.sendMessage({operation: "networkStatus"});
        document.getElementById("network").textContent = network.error
            ? `Network filters: ${network.error}`
            : (network.enabled ? "Built-in network filters: enabled." : "Built-in network filters: not enabled.");
        await renderSources();
        [tab] = await browser.tabs.query({active: true, currentWindow: true});
        const url = new URL(tab.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Open a regular HTTP or HTTPS page first.");
        host = url.hostname;
        document.getElementById("site").textContent = host;
        pick.disabled = false;
        bulk.disabled = false;
        await render();
    } catch (error) { status.textContent = error.message; }
})();
