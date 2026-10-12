// Optional help owns no rule store. Page investigation is a bounded, read-only
// function passed to scripting.executeScript; generated model code is never run.
const ADVHelp = (() => {
    const panel = document.getElementById('help');
    const input = document.getElementById('help-selector');
    const markup = document.getElementById('help-html');
    const question = document.getElementById('help-question');
    const output = document.getElementById('help-status');
    const findings = document.getElementById('help-findings');
    const candidates = document.getElementById('help-candidates');
    const conversation = document.getElementById('help-conversation');
    const inspect = document.getElementById('help-inspect');
    const ask = document.getElementById('help-ask');
    let history = [];
    let scope;

    function inspectDocument(mode, selector, selectors = [], html = '') {
        const valid = value => typeof value === 'string' && value.length <= 2048 && !/[{}@\x00-\x1f\x7f]/.test(value);
        function matches(value) {
            if (!valid(value) || !value.trim()) throw new Error('Enter a valid CSS selector.');
            const nodes = [...document.querySelectorAll(value)];
            if (nodes.includes(document.body) || nodes.includes(document.documentElement)) throw new Error('Whole-page selectors are not supported.');
            return nodes;
        }
        if (mode === 'preview') {
            const nodes = matches(selector);
            globalThis.__advHelpPreview?.remove();
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
            const shadow = overlay.attachShadow({mode:'closed'});
            for (const node of nodes.slice(0, 200)) {
                const rect = node.getBoundingClientRect();
                if (!rect.width || !rect.height) continue;
                const box = document.createElement('div');
                box.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:3px solid #1f40a8;background:#1f40a818;box-sizing:border-box`;
                shadow.append(box);
            }
            document.documentElement.append(overlay);
            globalThis.__advHelpPreview = overlay;
            setTimeout(() => { overlay.remove(); if (globalThis.__advHelpPreview === overlay) delete globalThis.__advHelpPreview; }, 10000);
            return {host:location.hostname, count:nodes.length};
        }
        if (selectors.length > 80 || html.length > 10000) throw new Error('Inspect at most 80 rules or 10,000 characters of HTML at once.');
        const ids = new WeakMap(); let nextID = 0;
        const observations = selectors.map(value => {
            try {
                // Whole-page stored rules are still audited, but never proposed.
                const nodes = [...document.querySelectorAll(value)];
                return {selector:value, count:nodes.length, matches:nodes.slice(0,200).map(node => {
                    if (!ids.has(node)) ids.set(node, nextID++);
                    return ids.get(node);
                })};
            } catch { return {selector:value, count:null, matches:[]}; }
        });
        let element;
        if (html.trim()) {
            // A detached template keeps pasted scripts and resources inert.
            const template = document.createElement('template'); template.innerHTML = html;
            element = template.content.firstElementChild;
        } else if (selector.trim()) element = matches(selector)[0];
        const result = [];
        function add(value, reason) {
            if (result.length >= 12 || result.some(item=>item.selector === value) || !valid(value)) return;
            try { const nodes = matches(value); result.push({selector:value, reason, count:nodes.length}); } catch { /* Not a usable page selector. */ }
        }
        if (selector.trim()) add(selector.trim(), 'The explicit selector you supplied.');
        const generated = value => /[a-f0-9]{8,}|[0-9]{8,}|[a-f0-9]{8}-[a-f0-9-]{27,}/i.test(value) || (value.length >= 20 && /[0-9]/.test(value) && /[a-z]/i.test(value));
        for (let depth = 0; element && depth < 4; depth++, element = element.parentElement) {
            const tag = element.localName;
            if (['html','body','script','style','template'].includes(tag)) break;
            const reason = depth ? 'Parent container; may also include normal content. Review its scope.' : 'Selected element or pasted outer element.';
            if (element.id && !generated(element.id)) add('#' + CSS.escape(element.id), reason + ' Uses an ID.');
            const classes = [...element.classList].filter(value=>!generated(value)).slice(0,3);
            if (classes.length) add(tag + classes.map(value=>'.' + CSS.escape(value)).join(''), reason + ' Uses shared classes.');
            for (const name of ['data-gc-test-id','data-ref','data-ad-slot','data-ad-client','data-ad-unit']) {
                const value = element.getAttribute(name);
                if (value && value.length <= 120 && !generated(value)) add(`${tag}[${name}="${CSS.escape(value)}"]`, reason + ' Uses an explicit data attribute.');
            }
            const prefix = generated(element.id || '') && element.id.match(/^([a-z][a-z_-]{2,})(?=[0-9a-f]{8,}|[0-9]{3,})/i)?.[1];
            if (prefix) add(`${tag}[id^="${CSS.escape(prefix)}"]`, reason + ' Uses an ID prefix; verify that the prefix remains stable.');
        }
        return {host:location.hostname, observations, candidates:result};
    }

    async function page(mode, selector, selectors = [], html = '') {
        if (!host || !Number.isInteger(tab?.id)) throw new Error('Open a permitted web page first.');
        const results = await browser.scripting.executeScript({target:{tabId:tab.id}, func:inspectDocument, args:[mode, selector, selectors, html]});
        const result = results.find(item=>item.frameId === 0)?.result || results[0]?.result;
        if (!result || result.host !== host) throw new Error('The page changed. Reopen ADV before inspecting.');
        return result;
    }
    function showRule(selector) {
        panel.open = true; input.value = selector; markup.value = ''; panel.scrollIntoView({block:'start'});
    }
    async function loadDraft() {
        const draft = await browser.runtime.sendMessage({operation:'helpDraftGet', tabId:tab.id});
        if (draft.host === host && draft.selector) showRule(draft.selector);
    }
    async function investigate(withQuestion) {
        inspect.disabled = ask.disabled = true;
        output.textContent = withQuestion ? 'Inspecting the document and asking the on-device guide…' : 'Inspecting this document…';
        try {
            const state = await browser.runtime.sendMessage({operation:'list'});
            if (state.error) throw new Error(state.error);
            const rules = state.rules.filter(rule=>!rule.deleted && rule.host === host);
            const snapshot = await page('inspect', input.value.trim(), rules.slice(0,80).map(rule=>rule.selector), markup.value);
            const currentScope = JSON.stringify([host,input.value.trim(),markup.value]);
            if (scope !== currentScope) { history = []; conversation.replaceChildren(); scope = currentScope; }
            const query = withQuestion ? question.value.trim() : '';
            if (withQuestion && !query) throw new Error('Enter a question first.');
            const report = await browser.runtime.sendMessage({operation:'assist', request:{...snapshot, question:query, history}});
            if (report.error) throw new Error(report.error);
            if (!Array.isArray(report.findings) || !Array.isArray(report.candidates)) throw new Error('Invalid guide response.');
            output.textContent = report.modelStatus + (rules.length > 80 ? ' Only the first 80 rules were inspected.' : '');
            findings.replaceChildren(); candidates.replaceChildren();
            for (const finding of report.findings) {
                const row = document.createElement('li'); const code = document.createElement('code'); code.textContent = finding.selector;
                const note = document.createElement('p'); note.textContent = finding.message; row.append(code,note); findings.append(row);
            }
            if (!report.findings.length) findings.textContent = 'No issues detected by these checks. This is not a guarantee of stability.';
            const answer = document.createElement('p'); answer.textContent = report.explanation;
            if (query) {
                const user = document.createElement('p'); user.textContent = query; user.className = 'help-question'; conversation.append(user);
                history.push({question:query.slice(0,1500),answer:report.explanation.slice(0,1500)}); history = history.slice(-4);
                while (conversation.children.length >= 8) conversation.firstElementChild.remove();
            } else conversation.replaceChildren();
            conversation.append(answer);
            for (const [index,candidate] of report.candidates.entries()) {
                const row = document.createElement('li'); const code = document.createElement('code'); code.textContent = candidate.selector;
                const note = document.createElement('p'); note.textContent = `${candidate.reason} ${candidate.count ?? 'Unknown'} match(es) in this document.` + (report.suggestedIndex === index ? ' Suggested by the guide.' : '');
                const preview = document.createElement('button'); preview.textContent = 'Preview matches';
                const edit = document.createElement('button'); edit.textContent = 'Copy to rule editor'; edit.disabled = true;
                preview.onclick = async () => {
                    edit.disabled = true;
                    try {
                        const result = await page('preview',candidate.selector);
                        output.textContent = `${result.count} match(es); visible matches outlined for 10 seconds (up to 200). Already hidden elements have no visible outline.`;
                        edit.disabled = result.count === 0;
                    } catch (error) { output.textContent = error.message; }
                };
                edit.onclick = () => {
                    const editor = document.getElementById('selectors');
                    const lines = editor.value.split(/\r?\n/).filter(Boolean);
                    if (!lines.includes(candidate.selector)) lines.push(candidate.selector);
                    editor.value = lines.join('\n'); editor.scrollIntoView({block:'center'}); editor.focus();
                    output.textContent = 'Copied to the normal editor. Review it and use Save rules; no rule has been saved or removed.';
                };
                row.append(code,note,preview,edit); candidates.append(row);
            }
        } catch (error) { output.textContent = error.message; }
        finally { inspect.disabled = ask.disabled = false; }
    }
    inspect.onclick = () => investigate(false);
    ask.onclick = () => investigate(true);
    return {inspectDocument, showRule, loadDraft};
})();
