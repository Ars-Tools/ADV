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
    let searchTerms = [];

    function inspectDocument(mode, selector, selectors = [], html = '', terms = []) {
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
            return {host:location.hostname, count:nodes.length, started:performance.timeOrigin};
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
        const generated = value => /[a-f0-9]{8,}|[0-9]{8,}|[a-f0-9]{8}-[a-f0-9-]{27,}/i.test(value) || (value.length >= 20 && /[0-9]/.test(value) && /[a-z]/i.test(value));

        function add(value, reason, label) {
            value = value.trim();
            if (result.length >= 12 || result.some(item=>item.selector === value) || !valid(value)) return;
            try {
                const nodes = matches(value);
                if (mode==='discover' && result.some(item=>{
                    const previous=[...document.querySelectorAll(item.selector)];
                    return previous.length===nodes.length && previous.every(node=>nodes.includes(node));
                })) return;
                result.push({selector:value, reason:reason.slice(0,200), label:label || (reason.startsWith('Parent') ? 'Hide parent container' : 'Hide matching elements') + ' · ' + (value.startsWith('#') ? 'ID' : value.includes('[') ? 'attribute' : 'class condition'), count:nodes.length});
            } catch { /* Not a usable page selector. */ }
        }
        function snapshot() {
            const domains = [], seen = new Set();
            let inspected = 0;
            for (const candidate of result.slice(0,8)) {
                for (const node of matches(candidate.selector).slice(0,200)) {
                    const resources = [...(node.matches('img[src],iframe[src],script[src]') ? [node] : []), ...node.querySelectorAll('img[src],iframe[src],script[src]')];
                    for (const resource of resources) {
                        if (++inspected>500 || domains.length===4) break;
                        try {
                            const url = new URL(resource.currentSrc || resource.getAttribute('src'),document.baseURI);
                            const domain = url.hostname.toLowerCase();
                            if (!['http:','https:'].includes(url.protocol) || domain===location.hostname || !domain.includes('.') || seen.has(domain) || domain.split('.').some(part=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) continue;
                            seen.add(domain);
                            domains.push({domain,selector:candidate.selector,count:candidate.count,label:`Block ${domain} · all websites`.slice(0,120),reason:'Resource host observed inside this candidate. Blocks this host and subdomains across websites; normal content may also be affected.'});
                        } catch { /* Not an HTTP resource host. */ }
                    }
                    if (inspected>500 || domains.length===4) break;
                }
                if (inspected>500 || domains.length===4) break;
            }
            return {host:location.hostname, observations, candidates:[...result.slice(0,12-domains.length),...domains]};
        }
        if (mode === 'discover') {
            const words = terms.filter(word=>typeof word==='string' && word.length>1 && word.length<=40).slice(0,4);
            if (words.some(word=>/^(fanza|ファンザ)$/i.test(word))) words.push('FANZA','ファンザ');
            const adScope = '[data-ad-slot], [data-ad-client], .ad-card, .advertisement, .ad, .wipe-ad-div-class, [id^="bnc_ad"], [id^="adstir_inview_"]';
            if (!words.length) {
                const markers = adScope + ', [data-ad-unit], .adsbygoogle, #reload-ad-div-id, [data-ref="imaAd"], [data-gc-test-id="gc-instream-root"]';
                for (const node of [...document.querySelectorAll(markers)].slice(0,500)) {
                    const rect = node.getBoundingClientRect();
                    if (!rect.width || !rect.height) continue;
                    let value;
                    for (const name of ['data-ad-slot','data-ad-client','data-ad-unit','data-ref','data-gc-test-id']) {
                        const attribute = node.getAttribute(name);
                        if (attribute && !generated(attribute)) { value = `${node.localName}[${name}="${CSS.escape(attribute)}"]`; break; }
                    }
                    if (!value && node.id && !generated(node.id)) value = '#'+CSS.escape(node.id);
                    if (!value) {
                        const classes=[...node.classList].filter(value=>!generated(value)).slice(0,2);
                        if (classes.length) value=node.localName+classes.map(value=>'.'+CSS.escape(value)).join('');
                    }
                    if (!value) {
                        const prefix = ['bnc_ad','adstir_inview_'].find(prefix=>node.id.startsWith(prefix));
                        if (prefix) value=`${node.localName}[id^="${prefix}"]`;
                    }
                    if (!value) continue;
                    const side = rect.left+rect.width/2 < innerWidth/3 ? 'left' : rect.left+rect.width/2 > innerWidth*2/3 ? 'right' : 'center';
                    const vertical = rect.top+rect.height/2 < innerHeight/3 ? 'top' : rect.top+rect.height/2 > innerHeight*2/3 ? 'bottom' : 'middle';
                    const position = getComputedStyle(node).position;
                    const image = node.querySelector('img[alt]')?.alt.slice(0,60) || '';
                    add(value,`Marked advertising container. ${vertical} ${side}; ${position}; ${Math.round(rect.width)}×${Math.round(rect.height)}. ${node.querySelector('iframe') ? 'Contains a frame. ' : ''}${image ? 'Image description: '+image : ''}`,`Advertising container · ${vertical} ${side}`);
                }
                return snapshot();
            }
            for (const node of [...document.querySelectorAll('a[href], img[alt], img[src], iframe[src], script[src]')].slice(0,500)) {
                let leaf, evidence, word;
                if (node.matches('img[alt]') && words.some(value=>node.alt.toLowerCase().includes(value.toLowerCase()))) {
                    word = words.find(value=>node.alt.toLowerCase().includes(value.toLowerCase()));
                    if (!word) continue;
                    leaf = `img[alt*="${CSS.escape(word)}" i]`;
                    evidence = `Image description contains “${word}”.`;
                } else {
                    if (node.matches('a') && !node.querySelector('img') && !node.closest(adScope)) continue;
                    const attr = node.matches('a') ? 'href' : 'src';
                    const raw = node.currentSrc || node.getAttribute(attr);
                    try {
                        const url = new URL(raw,document.baseURI);
                        if (!['http:','https:'].includes(url.protocol)) continue;
                        word = words.find(value=>value.includes('.')
                            ? url.hostname===value.toLowerCase() || url.hostname.endsWith('.'+value.toLowerCase())
                            : (url.hostname + decodeURIComponent(url.pathname)).toLowerCase().includes(value.toLowerCase()));
                        if (!word || !raw.split(/[?#]/)[0]) continue;
                        leaf = `${node.localName}[${attr}^="${CSS.escape(raw.split(/[?#]/)[0])}" i]`;
                        evidence = `URL host or path mentions “${word}” (${url.hostname}).`;
                    } catch { continue; }
                }
                let selector = leaf;
                const container = node.closest(adScope);
                if (container && container!==node) {
                    let base;
                    if (container.hasAttribute('data-ad-slot')) base = container.localName+'[data-ad-slot]';
                    else if (container.id && !generated(container.id)) base = '#'+CSS.escape(container.id);
                    else {
                        const classes=[...container.classList].filter(value=>!generated(value)).slice(0,2);
                        if(classes.length) base=container.localName+classes.map(value=>'.'+CSS.escape(value)).join('');
                    }
                    if(base) selector = `${base}:has(${leaf})`;
                    evidence += ' Inside a marked advertising container.';
                } else {
                    if (node.matches('img') && node.closest('a')) selector = `a:has(${leaf})`;
                    evidence += ' Advertising role is unverified; confirm visually.';
                }
                add(selector,evidence,`Hide content mentioning ${word}`);
            }
            return snapshot();
        }
        if (selector.trim()) add(selector.trim(), 'The explicit selector you supplied.');

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
        return snapshot();
    }

    async function page(mode, selector, selectors = [], html = '', terms = []) {
        if (!host || !Number.isInteger(tab?.id)) throw new Error('Open a permitted web page first.');
        const results = await browser.scripting.executeScript({target:{tabId:tab.id}, func:inspectDocument, args:[mode, selector, selectors, html, terms]});
        const result = results.find(item=>item.frameId === 0)?.result || results[0]?.result;
        if (!result || result.host !== host) throw new Error('The page changed. Reopen ADV before inspecting.');
        return result;
    }
    function showRule(selector) {
        input.value = selector; markup.value = ''; panel.scrollIntoView({block:'start'});
    }
    async function loadDraft() {
        const draft = await browser.runtime.sendMessage({operation:'helpDraftGet', tabId:tab.id});
        if (draft.host === host && draft.selector) showRule(draft.selector);
    }
    async function investigate(withQuestion) {
        const draftRevision=ADVDraft.revision;
        inspect.disabled = ask.disabled = true;
        output.textContent = withQuestion ? 'Inspecting the document and asking the on-device guide…' : 'Inspecting this document…';
        try {
            const state = await browser.runtime.sendMessage({operation:'list'});
            if (state.error) throw new Error(state.error);
            const rules = state.rules.filter(rule=>!rule.deleted && rule.host === host);
            const query = withQuestion ? question.value.trim() : '';
            if (withQuestion && !query) throw new Error('Describe what you want to hide first.');
            if (withQuestion && !input.value.trim() && !markup.value.trim()) {
                const intent = await browser.runtime.sendMessage({operation:'assist',request:{host,question:query,candidates:[],observations:[],history:[],phase:'interpret'}});
                const explicit = /fanza|ファンザ/i.test(query) ? ['FANZA','ファンザ'] : /\bdmm\b/i.test(query) ? ['DMM'] : [];
                const ambiguous = /don't|do not|except|以外|消さない|残して/i.test(query);
                const fallback = !ambiguous && /hide|block|remove|非表示|隠|消|遮断/i.test(query) ? explicit : [];
                if (intent.error) throw new Error(intent.error);
                searchTerms = intent?.searchTerms?.length ? intent.searchTerms : (intent?.modelStatus === 'On-device guide available.' ? [] : fallback);
            }
            const discovery = withQuestion && !input.value.trim() && !markup.value.trim();
            const snapshot = await page(discovery ? 'discover' : 'inspect', input.value.trim(), rules.slice(0,80).map(rule=>rule.selector), markup.value, searchTerms);
            const sources = await browser.runtime.sendMessage({operation:'sourceList'});
            if (sources.error) throw new Error(sources.error);
            const known = new Set(rules.map(rule=>rule.selector.trim())), seen = new Set();
            snapshot.candidates = snapshot.candidates.filter(candidate=>{
                const key = candidate.domain ? 'domain:'+candidate.domain : 'css:'+candidate.selector.trim();
                if (seen.has(key) || (candidate.domain ? sources.hosts.some(host=>candidate.domain===host || candidate.domain.endsWith('.'+host)) : known.has(candidate.selector.trim()))) return false;
                seen.add(key); return true;
            });

            const currentScope = JSON.stringify([host,input.value.trim(),markup.value]);
            if (scope !== currentScope) { history = []; conversation.replaceChildren(); scope = currentScope; }
            const report = await browser.runtime.sendMessage({operation:'assist', request:{...snapshot, question:query, history}});
            if (report.error) throw new Error(report.error);
            if (!Array.isArray(report.findings) || !Array.isArray(report.candidates)) throw new Error('Invalid guide response.');
            output.textContent = (discovery ? (searchTerms.length ? `Search scope: ${searchTerms.join(', ')}. ` : 'Search scope: marked advertising containers on this page. ') : '') + (discovery && !snapshot.candidates.length ? 'No matching evidence found. Try selecting the content with the picker. ' : '') + report.modelStatus + (rules.length > 80 ? ' Only the first 80 rules were inspected.' : '');
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
            const confirmed = discovery && !report.candidates[report.suggestedIndex]?.domain ? report.candidates.filter((candidate,index)=>!candidate.domain && candidate.count>0 && ((searchTerms.length && candidate.reason.includes('Inside a marked advertising container.')) || report.suggestedIndex===index)) : [];
            if (confirmed.length && ADVDraft.revision===draftRevision && !document.getElementById('selectors').value.trim()) {
                ADVDraft.stage(confirmed.map(candidate=>candidate.selector).join('\n'), searchTerms.length ? `Proposed: hide content mentioning ${searchTerms.join(' / ')}` : 'Proposed: hide matching advertising content');
            }

            for (const [index,candidate] of report.candidates.entries()) {
                const row = document.createElement('li');
                const title = document.createElement('strong'); title.textContent = candidate.label || 'Hide matching page content';
                const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Technical condition';
                const code = document.createElement('code'); code.textContent = candidate.domain || candidate.selector; details.append(summary,code);
                if (candidate.domain) summary.textContent = 'Condition · domain and subdomains';
                const note = document.createElement('p'); note.textContent = `${candidate.reason} ${candidate.count ?? 'Unknown'} match(es) in this document.` + (report.suggestedIndex === index ? ' Suggested by the guide.' : '');
                const choose = document.createElement('button'); choose.textContent = 'Select & preview';
                choose.onclick = async () => {
                    choose.disabled = true;
                    try {
                        await ADVDraft.choose(candidate.selector,candidate.label || 'Hide matching content',candidate.domain);
                        output.textContent = 'Selected in the draft. Review the preview results, then use Apply draft to save.';
                    } catch (error) { output.textContent = error.message; }
                    finally { choose.disabled = false; }
                };
                row.append(title,note,details,choose); candidates.append(row);
            }
        } catch (error) { output.textContent = error.message; }
        finally { inspect.disabled = ask.disabled = false; }
    }
    inspect.onclick = () => investigate(false);
    ask.onclick = () => investigate(true);
    return {inspectDocument, page, showRule, loadDraft};
})();
