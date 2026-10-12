const status = document.getElementById("status");
const pick = document.getElementById("pick");
const bulk = document.getElementById("save-bulk");
const editor = document.getElementById('selectors');
const previewDraft = document.getElementById('preview-draft');
let editingRule;
let draftDomain;
let reviewed;
let draftRevision=0;
function draftSelectors() {
    const lines = [...new Set(editor.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean))];
    if (!lines.length || lines.length>1000) throw new Error('Enter between 1 and 1000 conditions.');
    return lines;
}
function invalidateDraft() {
    draftRevision++;
    reviewed = undefined; bulk.disabled = true;
    previewDraft.disabled = !host || !editor.value.trim();
}
globalThis.ADVDraft = {
    get revision() { return draftRevision; },
    choose(selector,title,domain) {
        this.stage(selector,title,domain ? undefined : editingRule,domain);
        document.getElementById('draft-panel').scrollIntoView({block:'start'});
        return reviewDraft();
    },
    stage(value,title='Hide matching content',rule,domain) {
        editingRule = rule;
        draftDomain = domain;
        editor.value = value;
        editor.readOnly = !!domain;
        const domainCondition=document.getElementById('draft-domain');
        domainCondition.hidden = !domain;
        domainCondition.textContent = domain ? `Block ${domain} and its subdomains on all websites. Top-level navigation remains allowed.` : '';
        document.getElementById('draft-title').textContent = title;
        document.getElementById('draft-scope').textContent = domain ? 'Global request blocking. CSS below identifies preview reference elements only; it will not be saved as a cosmetic filter.' : `Hide content on ${host}. ${rule ? 'Replaces one saved condition after your approval.' : 'Adds conditions; existing filters are kept.'}`;
        invalidateDraft();
    }
};
editor.oninput = () => { document.getElementById('draft-title').textContent = editingRule ? 'Edit a saved filter' : 'Your custom conditions'; invalidateDraft(); };
document.getElementById('clear-draft').onclick = () => {
    ADVDraft.stage('', 'Nothing is staged yet.');
    document.getElementById('bulk-status').textContent = 'Draft discarded. Saved filters were not changed.';
};
async function reviewDraft() {
    bulk.disabled = true; previewDraft.disabled = true;
    try {
        const revision = draftRevision, text = editor.value;
        const selectors = draftSelectors();
        if (editingRule && selectors.length!==1) throw new Error('Edit one condition at a time, or discard this edit to add several.');
        const result = await ADVHelp.page('preview',selectors.join(', '));
        if (revision !== draftRevision) return;
        reviewed = {text, host, count:result.count, started:result.started};
        bulk.disabled = result.count===0;
        document.getElementById('bulk-status').textContent = draftDomain ? `${result.count} reference element(s) match. Outlines identify the inspected content; this does not simulate network blocking. Apply will block ${draftDomain} across all websites.` : `${result.count} element(s) match this draft. Review the blue outlines before applying. Already hidden elements have no visible outline.`;
        if (document.documentElement.classList.contains('workspace')) await browser.tabs.update(tab.id,{active:true});
    } catch(error) { reviewed=undefined; document.getElementById('bulk-status').textContent=error.message; }
    finally { previewDraft.disabled=!host || !editor.value.trim(); }
}
previewDraft.onclick = reviewDraft;
bulk.onclick = async () => {
    bulk.disabled = true;
    const output=document.getElementById('bulk-status');
    try {
        const revision=draftRevision, rule=editingRule, review=reviewed, domain=draftDomain;
        const selectors=draftSelectors();
        if (!review || review.text!==editor.value || review.host!==host) throw new Error('Preview the current draft before applying.');
        const current=await ADVHelp.page('preview',selectors.join(', '));
        if (revision!==draftRevision) throw new Error('The draft changed. Preview it again.');
        if (current.started!==review.started || current.count!==review.count || !current.count) throw new Error('The page or target count changed. Preview the draft again.');
        const message=domain ? {operation:'sourceAdd',hosts:[domain]} : rule
            ? {operation:'replace',id:rule.id,expectedModified:rule.modified,host,selector:selectors[0]}
            : {operation:'addMany',host,selectors};
        const result=await browser.runtime.sendMessage(message);
        if(result.error)throw new Error(result.error);
        const changed=!!rule;
        await render();
        if (domain) await renderSources();
        if (revision===draftRevision) ADVDraft.stage('','Nothing is staged yet.');
        output.textContent=domain ? `Blocked ${domain} and its subdomains across all websites. Reload affected pages.` : changed ? 'Updated the saved condition.' : `${result.added} condition(s) saved. Existing filters were kept.`;
    } catch(error) { output.textContent=error.message; invalidateDraft(); }
};

let tab;
let host;
async function renderSources() {
    const output = document.getElementById('source-status');
    try {
        const result = await browser.runtime.sendMessage({operation:'sourceList'});
        if (result.error) throw new Error(result.error);
        const list = document.getElementById('blocked-sources'); list.replaceChildren();
        // Compare from the domain suffix so related subdomains stay together.
        result.hosts.sort((a, b) => a.split('.').reverse().join('.').localeCompare(b.split('.').reverse().join('.')));
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
        const title=document.createElement('strong'); title.textContent=/fanza/i.test(rule.selector) ? 'Hidden content · FANZA' : /dmm/i.test(rule.selector) ? 'Hidden content · DMM' : 'Hidden page content';
        const details=document.createElement('details'); const summary=document.createElement('summary'); summary.textContent='Condition · CSS';
        const code = document.createElement("code"); code.textContent = rule.selector; details.append(summary,code);
        const remove = document.createElement("button"); remove.textContent = "Remove";
        remove.onclick = async () => {
            remove.disabled = true;
            try {
                const result = await browser.runtime.sendMessage({operation: "remove", id: rule.id});
                if (result.error) throw new Error(result.error);
                await render();
            } catch (error) { status.textContent = error.message; remove.disabled = false; }
        };
        const help = document.createElement('button'); help.textContent = 'Inspect / ask';
        help.onclick = () => ADVHelp.showRule(rule.selector);
        const edit=document.createElement('button'); edit.textContent='Edit';
        edit.onclick=()=>{ ADVDraft.stage(rule.selector,'Edit a saved filter',rule); document.getElementById('draft-details').open=true; editor.focus(); };
        item.append(title,details,edit,help,remove); list.append(item);
    }
    if (!list.children.length) list.textContent = "No personal rules for this site.";
}
pick.onclick = async () => {
    pick.disabled = true;
    try {
        if (!Number.isInteger(tab?.id)) throw new Error("No active Safari tab is available. Open a web page and reopen ADV.");
        await browser.scripting.executeScript({target: {tabId: tab.id}, files: ["personal.js", "picker.js"]});
        if(workspaceMode) await browser.tabs.update(tab.id,{active:true});
        else window.close();
    } catch (error) {
        status.textContent = `Could not start picker: ${error.message}. Allow ADV on this site in Safari.`;
        pick.disabled = !host || !Number.isInteger(tab?.id);
        bulk.disabled = true;
    }
};
const parameters=new URLSearchParams(location.search);
const workspaceMode=parameters.get('workspace')==='1';
document.documentElement.classList.toggle('workspace',workspaceMode);
document.getElementById('open-workspace').onclick=async()=>{
    try { await browser.tabs.create({url:browser.runtime.getURL('popup.html')+'?workspace=1&tabId='+tab.id,openerTabId:tab.id}); window.close(); }
    catch(error){status.textContent=error.message;}
};
document.addEventListener('visibilitychange',()=>{
    if(workspaceMode && !document.hidden && Number.isInteger(tab?.id)) ADVHelp.loadDraft().catch(()=>{});
});
(async () => {
    try {
        const network = await browser.runtime.sendMessage({operation: "networkStatus"});
        document.getElementById("network").textContent = network.error
            ? `Network filters: ${network.error}`
            : (network.enabled ? "Built-in network filters: enabled." : "Built-in network filters: not enabled.");
        await renderSources();
        if (workspaceMode) {
            const target=parameters.get('tabId');
            if (!target || !/^[0-9]+$/.test(target)) throw new Error('Open the workspace from the ADV popup on the page you want to change.');
            tab=await browser.tabs.get(Number(target));
        } else {
            [tab] = await browser.tabs.query({active: true, currentWindow: true});
            if (!Number.isInteger(tab?.id)) [tab] = await browser.tabs.query({active: true, lastFocusedWindow: true});
        }
        if (!Number.isInteger(tab?.id)) {
            document.getElementById('site').textContent = 'No active Safari tab';
            document.getElementById('activity').textContent = 'Page activity unavailable.';
            throw new Error('Open a web page in Safari and reopen ADV. If this is a private window, allow ADV in Private Browsing.');
        }
        if (!tab.url) throw new Error('Allow ADV access to this website in Safari, then reopen ADV.');
        const url = new URL(tab.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Open a regular HTTP or HTTPS page first.");
        host = url.hostname;
        document.getElementById("site").textContent = host;
        pick.disabled = false;
        invalidateDraft();
        document.getElementById('open-workspace').disabled = false;
        await render();
        await ADVHelp.loadDraft().catch(() => {});
        try {
            await browser.tabs.sendMessage(tab.id, {operation:'activityCheck'}).catch(() => {});
            const activity = await browser.runtime.sendMessage({operation:'toolbarStatus', tabId:tab.id});
            document.getElementById('activity').textContent = activity.error ? `Page activity: ${activity.error}`
                : (activity.blocked ? 'Blocking detected on this page · lid closed.'
                    : (activity.networkKnown ? 'No blocking detected on this page · lid open.'
                        : 'No blocking observed · network activity unavailable.'));
        } catch { document.getElementById('activity').textContent = 'Page activity unavailable.'; }
    } catch (error) { status.textContent = error.message; }
})();
