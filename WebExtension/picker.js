(() => {
    globalThis.__advCancelPicker?.();
    const container = document.createElement("div");
    // A shadow root keeps the picker controls independent of the page's CSS.
    container.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important";
    const root = container.attachShadow({mode: "closed"});
    root.innerHTML = `<style>
    :host { all: initial; } * { box-sizing: border-box; }
    #outline, .selected-outline { position:fixed; border:3px solid #cc261a; background:#cc261a18; pointer-events:none; }
    .selected-outline { border-color:#1f40a8; background:#1f40a818; }
    #panel { position:fixed; bottom:16px; left:16px; right:16px; max-width:480px; max-height:calc(100% - 32px); overflow-y:auto; padding:20px; border:2px solid #171714; border-top:8px solid #f7c229; background:#f6f2e9; color:#171714; pointer-events:auto; font:14px -apple-system, Helvetica, sans-serif; }
    strong { display:block; font-size:20px; letter-spacing:-.5px; }
    input { width:100%; margin:8px 0; padding:10px; border-radius:0; color:#171714; background:#fff; border:2px solid #171714; font:13px ui-monospace,monospace; }
    button { margin:8px 8px 0 0; padding:10px 14px; min-height:44px; border:2px solid #171714; border-radius:0; background:#f6f2e9; color:#171714; font:700 13px -apple-system,Helvetica,sans-serif; cursor:pointer; }
    #save { background:#1f40a8; color:white; }
    #block-sources { background:#cc261a; color:white; }
    #sources label { display:flex; align-items:center; gap:8px; margin:8px 0; overflow-wrap:anywhere; }
    #sources input { width:auto; flex-shrink:0; }
    #source-message { font-size:12px; overflow-wrap:anywhere; }
    button:disabled, #save:disabled { background:#f6f2e9; color:#55524a; border-color:#aaa69e; cursor:default; }
    :focus-visible { outline:3px solid #1f40a8; outline-offset:3px; }
    #message { overflow-wrap:anywhere; }
    #similar-label { display:flex; align-items:center; gap:8px; font-size:12px; }
    #similar { width:auto; margin:0; padding:0; }
    ul { padding:0; margin:8px 0; list-style:none; max-height:120px; overflow:auto; }
    li { display:flex; align-items:center; gap:8px; border-top:1px solid #aaa69e; padding:6px 0; }
    code { flex:1; min-width:0; overflow-wrap:anywhere; font-size:12px; }
    li button { flex-shrink:0; margin:0; padding:4px 8px; }
    </style><div id="outline" hidden></div><div id="panel" role="dialog" aria-label="ADV element picker">
    <strong>ADV · Pick elements to hide</strong><p id="message" role="status">Click or tap unwanted elements one after another. Click the same element again to deselect. Escape cancels.</p>
    <ul id="selected" aria-label="Selected filters"></ul>
    <input id="selector" aria-label="Last selected CSS selector" placeholder="Select elements on the page" disabled>
    <label id="similar-label"><input id="similar" type="checkbox" disabled>Match similar elements by class or tag</label>
    <button id="help-selection">Help with last selection</button>
    <button id="save" disabled>Hide selected elements</button><button id="cancel">Cancel</button>
    <div id="sources"></div><p id="source-message">Source blocking applies across websites. Shared image or video hosts may also serve normal content.</p>
    <button id="block-sources" disabled>Block sources everywhere</button></div>`;
    document.documentElement.append(container);
    const outline = root.getElementById("outline");
    const input = root.getElementById("selector");
    const similar = root.getElementById('similar');
    const save = root.getElementById("save");
    const message = root.getElementById("message");
    const selections = [];
    let editing = -1;
    let saving = false;
    const chosenHosts = new Set();
    const blockSources = root.getElementById('block-sources');
    const sourceMessage = root.getElementById('source-message');
    function sourcesFor(element) {
        const hosts = new Set();
        function add(value) {
            if (!value) return;
            try {
                const url = new URL(value, document.baseURI);
                if (['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.')) hosts.add(url.hostname);
            } catch { /* Missing or non-network resource. */ }
        }
        const nodes = [element, ...element.querySelectorAll('img, iframe, video, audio, source, object')].slice(0, 200);
        for (const node of nodes) {
            if (node.matches('img, iframe, video, audio, source, input[type="image"]')) { add(node.currentSrc); add(node.src); }
            if (node.matches('object')) add(node.data);
            const background = getComputedStyle(node).backgroundImage;
            for (const match of background.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)) add(match[1] || match[2] || match[3]);
        }
        return [...hosts];
    }
    function renderSources() {
        const candidates = new Set(selections.flatMap(selection => selection.sources));
        for (const host of chosenHosts) if (!candidates.has(host)) chosenHosts.delete(host);
        const list = root.getElementById('sources'); list.replaceChildren();
        if (candidates.size) {
            const title = document.createElement('strong'); title.textContent = 'Source hosts · all websites'; list.append(title);
        }
        for (const host of [...candidates].sort()) {
            const label = document.createElement('label');
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = chosenHosts.has(host); checkbox.disabled = saving;
            checkbox.dataset.host = host;
            const text = document.createElement('span'); text.textContent = host + (host === location.hostname ? ' · this website' : '');
            checkbox.onchange = () => {
                if (checkbox.checked) chosenHosts.add(host); else chosenHosts.delete(host);
                blockSources.disabled = saving || !chosenHosts.size;
            };
            label.append(checkbox, text); list.append(label);
        }
        blockSources.disabled = saving || !chosenHosts.size;
        sourceMessage.textContent = candidates.size
            ? 'Check only advertising source hosts. Blocking includes their subdomains on every website; shared hosts may also serve normal content. Reload pages after saving.'
            : 'Select an ad image or iframe to look for its source host. Some ads do not expose their source in the selected element.';
    }
    function close() {
        document.removeEventListener("pointermove", hover, true);
        document.removeEventListener("click", choose, true);
        document.removeEventListener("keydown", keydown, true);
        window.removeEventListener("scroll", redraw, true);
        window.removeEventListener("resize", redraw);
        container.remove();
        delete globalThis.__advCancelPicker;
    }
    globalThis.__advCancelPicker = close;
    function show(element) {
        if (!(element instanceof Element) || element === container || element === document.body || element === document.documentElement) return;
        const rect = element.getBoundingClientRect();
        outline.hidden = false;
        outline.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    }
    function looksGenerated(value) {
        // Heuristic only: stable names can contain digits, and generated names can look readable.
        return /(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(value)
            || /^[a-f0-9-]{24,}$/i.test(value)
            || /\d{8,}/.test(value)
            || (value.length >= 20 && /[a-z]/i.test(value) && /\d/.test(value));
    }
    function selectorFor(element, reusable = false) {
        const parts = [];
        for (let current = element; current && current !== document.body; current = current.parentElement) {
            // Attribute presence survives rotating slot IDs and identifies other ad slots too.
            const marker = ['data-ad-slot', 'data-ad-client', 'data-ad-unit', 'data-ad-unit-id']
                .find(name => current.hasAttribute(name));
            if (marker) {
                parts.unshift(`${current.localName}[${marker}]`);
                return parts.join(' > ');
            }
            if (!reusable && current.id && !looksGenerated(current.id)) {
                const id = `#${CSS.escape(current.id)}`;
                if (document.querySelectorAll(id).length === 1) { parts.unshift(id); break; }
            }
            let part = current.localName;
            const classes = Array.from(current.classList).filter(value => !looksGenerated(value)).slice(0, 3);
            if (classes.length) part += classes.map(value => `.${CSS.escape(value)}`).join("");
            if (reusable) return part;
            const unpositioned = [part, ...parts].join(' > ');
            if (classes.length && document.querySelectorAll(unpositioned).length === 1) return unpositioned;
            const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(node => node.localName === current.localName) : [];
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            parts.unshift(part);
            const candidate = parts.join(" > ");
            if (document.querySelectorAll(candidate).length === 1) return candidate;
        }
        return parts.join(" > ");
    }
    function matchesFor(selector) {
        if (!selector || selector.length > 2048 || /[{}@\x00-\x1f\x7f]/.test(selector)) throw new Error("Invalid selector.");
        const matches = Array.from(document.querySelectorAll(selector));
        if (!matches.length || matches.some(node => node === container || node === document.body || node === document.documentElement || node.contains(container))) {
            throw new Error("Choose content inside the page, rather than the whole page.");
        }
        return matches;
    }
    function redraw() {
        root.querySelectorAll('.selected-outline').forEach(node => node.remove());
        for (const selection of selections) {
            try {
                for (const element of matchesFor(selection.selector).slice(0, 200)) {
                    const rect = element.getBoundingClientRect();
                    const mark = document.createElement('div'); mark.className = 'selected-outline';
                    mark.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
                    root.insertBefore(mark, root.getElementById('panel'));
                }
            } catch { /* An edited selector may be incomplete while typing. */ }
        }
    }
    function remove(index) {
        if (saving) return;
        selections.splice(index, 1);
        editing = selections.length - 1;
        input.value = selections[editing]?.selector || '';
        input.disabled = editing < 0;
        similar.checked = selections[editing]?.similar || false;
        preview();
    }
    function preview() {
        root.getElementById('cancel').disabled = saving;
        similar.disabled = saving || editing < 0;
        renderSources();
        const list = root.getElementById('selected'); list.replaceChildren();
        selections.forEach((selection, index) => {
            const row = document.createElement('li');
            const code = document.createElement('code'); code.textContent = selection.selector;
            const button = document.createElement('button'); button.textContent = 'Remove';
            button.disabled = saving; button.onclick = () => remove(index);
            row.append(code, button); list.append(row);
        });
        redraw();
        save.textContent = selections.length ? `Hide ${selections.length} selected filter(s)` : 'Hide selected elements';
        try {
            if (!selections.length) {
                message.textContent = 'Click or tap unwanted elements one after another. Click again to deselect. Escape cancels.';
                save.disabled = true; return;
            }
            const matched = new Set(selections.flatMap(selection => matchesFor(selection.selector)));
            message.textContent = `${selections.length} selected filter(s), ${matched.size} matching element(s) on ${location.hostname}. Keep picking, or edit the last selector, then save all at once.`;
            if (matched.size > selections.length) message.textContent += ' Saving hides every match; blue outlines preview up to 200 per filter.';
            if (selections.some(selection => selection.selector.includes(':nth-of-type('))) {
                message.textContent += ' Positional filters may stop matching when the page layout changes; prefer stable classes or ad attributes.';
            }
            save.disabled = saving;
        } catch (error) { message.textContent = error.message; save.disabled = true; }
    }
    function hover(event) { if (!saving && !event.composedPath().includes(container)) show(event.target); }
    function choose(event) {
        if (event.composedPath().includes(container)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (saving) return;
        const selected = event.target;
        if (!(selected instanceof Element) || selected === document.body || selected === document.documentElement) return;
        const selector = selectorFor(selected, similar.checked);
        const existing = selections.findIndex(selection => selection.element === selected);
        if (existing >= 0) { remove(existing); return; }
        const covered = selections.findIndex(selection => selection.selector === selector);
        if (covered >= 0) {
            editing = covered; input.value = selector; similar.checked = selections[covered].similar;
            preview(); message.textContent += ' This element is already covered by the selected filter.'; return;
        }
        if (selections.length >= 1000) { message.textContent = 'Select up to 1000 filters at a time.'; return; }
        selections.push({element:selected, selector, similar:similar.checked, sources:sourcesFor(selected)}); editing = selections.length - 1;
        input.value = selector; input.disabled = false; outline.hidden = true; preview();
    }
    function keydown(event) { if (event.key === "Escape") { event.preventDefault(); if (!saving) close(); } }
    input.addEventListener("input", () => {
        if (editing >= 0) {
            selections[editing].selector = input.value.trim();
            selections[editing].similar = false; similar.checked = false;
            try { selections[editing].sources = [...new Set(matchesFor(input.value.trim()).slice(0, 200).flatMap(sourcesFor))]; }
            catch { selections[editing].sources = []; }
        }
        preview();
    });
    similar.onchange = () => {
        if (editing < 0 || saving) return;
        const selection = selections[editing];
        selection.similar = similar.checked;
        selection.selector = selectorFor(selection.element, similar.checked);
        input.value = selection.selector;
        try { selection.sources = [...new Set(matchesFor(selection.selector).slice(0, 200).flatMap(sourcesFor))]; }
        catch { selection.sources = []; }
        preview();
    };
    root.getElementById('help-selection').onclick = async () => {
        if (editing < 0 || saving) { message.textContent = 'Select an element first.'; return; }
        try {
            const result = await browser.runtime.sendMessage({operation:'helpDraft', selector:input.value.trim()});
            if (result.error) throw new Error(result.error);
            message.textContent = 'Selection sent to help without saving. Open the ADV toolbar popup to inspect or ask about it. Other unsaved selections remain here.';
        } catch (error) { message.textContent = error.message; }
    };
    root.getElementById("cancel").onclick = close;
    save.onclick = async () => {
        if (saving || save.disabled) return;
        saving = true; input.disabled = true; preview();
        try {
            const result = await browser.runtime.sendMessage({operation: "addMany", host: location.hostname, selectors: selections.map(selection => selection.selector)});
            if (result.error) throw new Error(result.error);
            await browser.runtime.sendMessage({operation: "list"});
            // personal.js applies the saved rules; a refresh notification also reaches this tab.
            close();
        } catch (error) { saving = false; input.disabled = editing < 0; preview(); message.textContent = error.message; }
    };
    blockSources.onclick = async () => {
        if (saving || !chosenHosts.size) return;
        saving = true; input.disabled = true; preview();
        try {
            const result = await browser.runtime.sendMessage({operation:'sourceAdd', pageHost:location.hostname, hosts:[...chosenHosts]});
            if (result.error) throw new Error(result.error);
            saving = false;
            // Keep confirmation visible: downloaded content stays on the current
            // page until a reload; source rules affect subsequent requests.
            preview(); input.disabled = editing < 0;
            sourceMessage.textContent = `${result.added} new source host(s) blocked across websites. Saved in this Safari profile. Reload pages to block existing ads.`;
        } catch (error) { saving = false; input.disabled = editing < 0; preview(); sourceMessage.textContent = error.message; }
    };
    document.addEventListener("pointermove", hover, true);
    document.addEventListener("click", choose, true);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("scroll", redraw, true);
    window.addEventListener("resize", redraw);
})();
