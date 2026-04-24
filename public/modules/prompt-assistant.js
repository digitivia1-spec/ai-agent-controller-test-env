/* Prompt Assistant module — exposes window.openPromptAssistant() etc. */
(function(){
  'use strict';
  const PA = {
    state:      Object.create(null),
    drafts:     Object.create(null),
    lastRequest:Object.create(null),
    abortController: null,
    pendingApply: null,
    currentAgent: null,
    currentAction: null,
    remaining: Object.create(null),
    unlockObserver: null,
  };
  window.PromptAssistant = PA;
  const I18N = (k, f) => (typeof window.t === 'function' ? (window.t(k) || f || k) : (f || k));
  function $(id){ return document.getElementById(id); }
  function el(tag, attrs, html){
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs){ if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function safeToast(msg, type){ try { if (typeof window.showToast === 'function') window.showToast(msg, type||'info'); } catch(_){} }

  function setState(agentId, state){
    PA.state[agentId] = state;
    const slot = $(`pa-editor-slot-${agentId}`);
    if (slot) slot.setAttribute('data-state', state);
    const map = { loading:`pa-loading-${agentId}`, draft:`pa-draft-wrap-${agentId}`, applied:`pa-applied-${agentId}`, error:`pa-error-${agentId}` };
    Object.keys(map).forEach(s => { const n = $(map[s]); if (n) n.hidden = (s !== state); });
  }

  function tokenize(s){ return (s || '').match(/\s+|[\p{L}\p{N}_']+|[^\s\p{L}\p{N}_']/gu) || []; }
  function lcsDiff(a, b){
    const n = a.length, m = b.length;
    if (n * m > 2_500_000) return [{ op:'del', text:a.join('') }, { op:'ins', text:b.join('') }];
    const dp = Array.from({length:n+1}, () => new Uint32Array(m+1));
    for (let i=n-1; i>=0; i--) for (let j=m-1; j>=0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
    const out = []; let i=0, j=0;
    while (i<n && j<m){
      if (a[i] === b[j]){ out.push({op:'eq',text:a[i]}); i++; j++; }
      else if (dp[i+1][j] >= dp[i][j+1]){ out.push({op:'del',text:a[i]}); i++; }
      else { out.push({op:'ins',text:b[j]}); j++; }
    }
    while (i<n) out.push({op:'del',text:a[i++]});
    while (j<m) out.push({op:'ins',text:b[j++]});
    return out;
  }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderDiffSide(which, current, suggested){
    const ops = lcsDiff(tokenize(current), tokenize(suggested));
    let html = '';
    for (const op of ops){
      if (op.op === 'eq') html += escapeHtml(op.text);
      else if (op.op === 'ins' && which === 'suggested') html += `<span class="pa-diff-ins">${escapeHtml(op.text)}</span>`;
      else if (op.op === 'del' && which === 'current')   html += `<span class="pa-diff-del">${escapeHtml(op.text)}</span>`;
    }
    return html;
  }

  function paintDraft(agentId){
    const d = PA.drafts[agentId]; if (!d) return;
    const wrap = $(`pa-draft-wrap-${agentId}`); if (!wrap) return;
    // Canonical field name is finalPrompt; suggested_prompt is the legacy alias still
    // written into drafts for back-compat with apply/copy paths.
    const finalText = (d.finalPrompt || d.suggested_prompt || '');
    const currentText = (d.originalPrompt || d.current_prompt || '');
    const emptyHint = `<em style="opacity:.6">${I18N('prompt_assistant.empty_prompt_hint','(empty)')}</em>`;
    wrap.querySelector('.pa-diff-col-current .pa-diff-body').innerHTML = renderDiffSide('current', currentText, finalText) || emptyHint;
    wrap.querySelector('.pa-diff-col-suggested .pa-diff-body').innerHTML = renderDiffSide('suggested', currentText, finalText) || emptyHint;
    if (!wrap.getAttribute('data-active-tab')) wrap.setAttribute('data-active-tab','suggested');

    // Summary line (optional): surface only when the workflow returned one.
    let sumEl = wrap.querySelector('.pa-draft-summary');
    const summary = (d.summary || '').trim();
    if (summary){
      if (!sumEl){
        sumEl = el('div', {class:'pa-draft-summary'});
        const tabs = wrap.querySelector('.pa-draft-tabs');
        if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(sumEl, tabs);
        else wrap.insertBefore(sumEl, wrap.firstChild);
      }
      sumEl.textContent = summary;
      sumEl.hidden = false;
    } else if (sumEl){
      sumEl.hidden = true;
      sumEl.textContent = '';
    }

    // Toggle Apply / Copy / Regenerate buttons per canonical capability flags.
    // Default to true when the flag is absent so existing behavior is preserved.
    // isLocked is authoritative: the server returns it on every generate;
    // locked prompts may still preview a draft but cannot be silently applied.
    const isLocked      = !!d.isLocked;
    const canApply      = (d.canApply      !== false) && !isLocked;
    const canCopy       = (d.canCopy       !== false);
    const canRegenerate = (d.canRegenerate !== false);
    // Lock badge surfaces why Apply is disabled.
    let lockChip = wrap.querySelector('.pa-lock-chip');
    if (isLocked){
      if (!lockChip){
        lockChip = el('div', {class:'pa-lock-chip', role:'status', 'aria-live':'polite'});
        const first = wrap.firstChild;
        if (first) wrap.insertBefore(lockChip, first); else wrap.appendChild(lockChip);
      }
      const reason = (d.lockReason || '').trim();
      const lbl = I18N('prompt_assistant.locked_badge','Locked');
      lockChip.textContent = reason ? (lbl + ': ' + reason) : lbl;
      lockChip.hidden = false;
    } else if (lockChip){
      lockChip.hidden = true;
      lockChip.textContent = '';
    }
    const actions = wrap.querySelector('.pa-draft-actions');
    if (actions){
      const btnApply  = actions.querySelector('button[onclick^="paApplyDraft"][onclick*="\'apply\'"]');
      const btnRepl   = actions.querySelector('button[onclick^="paApplyDraft"][onclick*="\'replace\'"]');
      const btnCopy   = actions.querySelector('button[onclick^="paCopyDraft"]');
      const btnRegen  = actions.querySelector('button[onclick^="paRegenerate"]');
      [btnApply, btnRepl].forEach(b => { if (b){ b.disabled = !canApply; b.setAttribute('aria-disabled', canApply ? 'false' : 'true'); if (isLocked) b.setAttribute('title', I18N('prompt_assistant.locked_hint','This prompt is locked. Unlock it to apply.')); else b.removeAttribute('title'); } });
      if (btnCopy){ btnCopy.disabled = !canCopy; btnCopy.setAttribute('aria-disabled', canCopy ? 'false' : 'true'); }
      if (btnRegen){ btnRegen.disabled = !canRegenerate; btnRegen.setAttribute('aria-disabled', canRegenerate ? 'false' : 'true'); }
    }
  }

  const GOAL_OPTS    = ['qualify_leads','book_meetings','answer_faq','drive_sales','collect_contact'];
  const TONE_OPTS    = ['friendly','professional','helpful','concise','playful'];
  const LANG_OPTS    = ['en','ar','fr','es'];
  const COLLECT_OPTS = ['name','phone','email','company','budget','timeframe'];
  const AVOID_OPTS   = ['prices','personal_data','competitors','promises'];
  const BUSINESS_MIN = 8;
  const BUSINESS_MAX = 500;
  const NOTE_MAX     = 1000;

  function fieldWrap(name, labelKey, fallback, {required, hintKey, hintFallback} = {}){
    const wrap = el('div', {class:'pa-form-field','data-pa-field-wrap':name});
    const labelRow = el('div', {class:'pa-form-label-row'});
    const lbl = el('div', {class:'pa-form-label'}, I18N('prompt_assistant.'+labelKey, fallback));
    if (required) lbl.appendChild(el('span', {class:'pa-required-star','aria-hidden':'true'}, '*'));
    labelRow.appendChild(lbl);
    if (!required) labelRow.appendChild(el('span', {class:'pa-optional-badge'}, I18N('prompt_assistant.optional_badge','Optional')));
    wrap.appendChild(labelRow);
    if (hintKey) wrap.appendChild(el('div', {class:'pa-field-hint'}, I18N('prompt_assistant.'+hintKey, hintFallback || '')));
    return wrap;
  }

  function attachErrSlot(wrap){ wrap.appendChild(el('div', {class:'pa-err-hint','data-pa-err':'1','role':'alert','aria-live':'polite'})); }

  function setFieldError(wrap, msgKey, msgFallback){
    if (!wrap) return;
    const slot = wrap.querySelector('[data-pa-err]');
    if (msgKey){
      wrap.classList.add('pa-invalid');
      if (slot) slot.textContent = I18N('prompt_assistant.'+msgKey, msgFallback || '');
    } else {
      wrap.classList.remove('pa-invalid');
      if (slot) slot.textContent = '';
    }
  }

  function chipGroup(name, labelKey, labelFallback, opts, multi, {required, hintKey, hintFallback} = {}){
    const wrap = fieldWrap(name, labelKey, labelFallback, {required, hintKey, hintFallback});
    const row = el('div', {class:'pa-chip-row','data-pa-group':name,'data-pa-multi':multi?'1':'0'});
    opts.forEach(o => {
      const chip = el('button', {class:'pa-chip','data-pa-value':o,type:'button','aria-pressed':'false'}, I18N('prompt_assistant.'+name+'_opts.'+o, o.replace(/_/g,' ')));
      chip.addEventListener('click', () => {
        if (multi){ chip.classList.toggle('active'); chip.setAttribute('aria-pressed', chip.classList.contains('active') ? 'true':'false'); }
        else { row.querySelectorAll('.pa-chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed','false'); }); chip.classList.add('active'); chip.setAttribute('aria-pressed','true'); }
        setFieldError(wrap, null);
        refreshGenerateEnabled();
      });
      row.appendChild(chip);
    });
    wrap.appendChild(row);
    attachErrSlot(wrap);
    return wrap;
  }

  function textField(name, labelKey, labelFallback, {required, placeholder, maxLen, multiline, hintKey, hintFallback, minLen} = {}){
    const wrap = fieldWrap(name, labelKey, labelFallback, {required, hintKey, hintFallback});
    const tag = multiline ? 'textarea' : 'input';
    const attrs = {'data-pa-field':name};
    if (!multiline) attrs.type = 'text';
    if (placeholder) attrs.placeholder = placeholder;
    if (maxLen) attrs.maxlength = String(maxLen);
    if (minLen) attrs['data-pa-minlen'] = String(minLen);
    const input = el(tag, attrs);
    wrap.appendChild(input);
    if (maxLen){
      const counter = el('div', {class:'pa-counter','data-pa-counter':name}, '0/'+maxLen);
      wrap.appendChild(counter);
      const updateCounter = () => {
        const len = input.value.length;
        counter.textContent = len + '/' + maxLen;
        counter.classList.toggle('pa-counter-near', len >= maxLen * 0.9 && len < maxLen);
        counter.classList.toggle('pa-counter-over', len >= maxLen);
      };
      input.addEventListener('input', updateCounter);
    }
    input.addEventListener('input', () => { setFieldError(wrap, null); refreshGenerateEnabled(); });
    input.addEventListener('blur', () => { validateField(name); });
    attachErrSlot(wrap);
    return wrap;
  }

  function readForm(){
    const body = $('pa-panel-body');
    if (!body) return { goal:'', tone:'', language:'', business:'', collect:[], avoid:[], note:'' };
    const read = (name, multi) => {
      const row = body.querySelector(`.pa-chip-row[data-pa-group="${name}"]`);
      if (!row) return multi ? [] : '';
      const active = [...row.querySelectorAll('.pa-chip.active')].map(c => c.getAttribute('data-pa-value'));
      return multi ? active : (active[0] || '');
    };
    const field = n => { const f = body.querySelector(`[data-pa-field="${n}"]`); return f ? f.value.trim() : ''; };
    return { goal:read('goal'), tone:read('tone'), language:read('language'), business:field('business'), collect:read('collect',true), avoid:read('avoid',true), note:field('note') };
  }

  function validateField(name){
    const body = $('pa-panel-body'); if (!body) return true;
    const wrap = body.querySelector(`[data-pa-field-wrap="${name}"]`);
    if (!wrap) return true;
    const inputs = readForm();
    if (name === 'goal' && !inputs.goal){ setFieldError(wrap, 'errors.missing_goal', 'Pick a goal'); return false; }
    if (name === 'tone' && !inputs.tone){ setFieldError(wrap, 'errors.missing_tone', 'Pick a tone'); return false; }
    if (name === 'language' && !inputs.language){ setFieldError(wrap, 'errors.missing_language', 'Pick a language'); return false; }
    if (name === 'business'){
      if (!inputs.business){ setFieldError(wrap, 'errors.missing_business', 'Describe your business'); return false; }
      if (inputs.business.length < BUSINESS_MIN){
        const msg = I18N('prompt_assistant.errors.business_too_short', 'Add at least {n} characters').replace('{n}', String(BUSINESS_MIN));
        setFieldError(wrap, null); wrap.classList.add('pa-invalid');
        const slot = wrap.querySelector('[data-pa-err]'); if (slot) slot.textContent = msg;
        return false;
      }
    }
    setFieldError(wrap, null);
    return true;
  }

  function validateAll(){
    return ['goal','business','tone','language'].map(validateField).every(Boolean);
  }

  function refreshGenerateEnabled(){
    const btn = document.querySelector('#pa-panel-foot [data-pa-generate]');
    if (!btn) return;
    const i = readForm();
    const ok = !!(i.goal && i.tone && i.language && i.business && i.business.length >= BUSINESS_MIN);
    btn.disabled = !ok;
    btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }

  function renderForm(agentId, action){
    const body = $('pa-panel-body'), foot = $('pa-panel-foot');
    body.innerHTML = ''; foot.innerHTML = '';
    if (action === 'use'){
      const ta = $(`prompt-${agentId}`);
      const cur = (ta && ta.value || '').trim();
      body.appendChild(el('div', {class:'pa-form-field'},
        `<div class="pa-form-label">${escapeHtml(I18N('prompt_assistant.use_current_hint','Preview your current prompt side-by-side.'))}</div>` +
        `<textarea readonly style="min-height:160px">${escapeHtml(cur)}</textarea>`
      ));
      foot.appendChild(el('button', {class:'pill-btn',onclick:'closePromptAssistant()'}, I18N('prompt_assistant.cancel','Cancel')));
      const goBtn = el('button', {class:'pill-btn primary'}, I18N('prompt_assistant.use_current','Use current prompt'));
      goBtn.addEventListener('click', () => {
        // use_current mode: echo the existing prompt; no call to the generator.
        PA.drafts[agentId] = {
          finalPrompt: cur,
          suggested_prompt: cur,          // legacy alias for apply/copy paths
          originalPrompt: cur,
          current_prompt: cur,            // legacy alias for diff rendering
          mode: 'use_current',
          summary: '',
          missingFields: [],
          questions: [],
          canApply: true,
          canCopy: true,
          canRegenerate: false,
          inputs: {}
        };
        paintDraft(agentId); setState(agentId, 'draft'); closePromptAssistant();
      });
      foot.appendChild(goBtn);
      return;
    }
    body.appendChild(chipGroup('goal','label_goal','Goal',GOAL_OPTS,false,{required:true, hintKey:'hint_goal', hintFallback:'What outcome should the agent drive toward?'}));
    body.appendChild(textField('business','label_business','What does your business do?',{
      required:true,
      placeholder:I18N('prompt_assistant.ph_business','e.g. Selling handmade soap in Cairo'),
      maxLen:BUSINESS_MAX,
      minLen:BUSINESS_MIN,
      hintKey:'hint_business',
      hintFallback:'2–3 sentences — what you sell and who you serve.'
    }));
    body.appendChild(chipGroup('tone','label_tone','Tone',TONE_OPTS,false,{required:true, hintKey:'hint_tone', hintFallback:'How should the agent sound?'}));
    body.appendChild(chipGroup('language','label_language','Primary language',LANG_OPTS,false,{required:true, hintKey:'hint_language', hintFallback:'The language the agent should reply in.'}));
    body.appendChild(el('div', {class:'pa-fast-path-note'}, I18N('prompt_assistant.hint_fast_path','These four are all we need — the Generate button lights up as soon as you fill them in.')));
    const adv = el('details', {class:'pa-form-advanced'});
    adv.appendChild(el('summary', {}, I18N('prompt_assistant.label_advanced','Advanced (optional)')));
    adv.appendChild(chipGroup('collect','label_collect','Info to collect',COLLECT_OPTS,true,{hintKey:'hint_collect', hintFallback:'Data the agent should ask customers for.'}));
    adv.appendChild(chipGroup('avoid','label_avoid','Topics to avoid',AVOID_OPTS,true,{hintKey:'hint_avoid', hintFallback:'Things the agent must not discuss.'}));
    adv.appendChild(textField('note','label_note','Additional notes',{
      placeholder:I18N('prompt_assistant.ph_note','Edge cases, policies, anything else worth knowing.'),
      maxLen:NOTE_MAX,
      multiline:true,
      hintKey:'hint_note',
      hintFallback:'Edge cases, policies, or tone calls the agent should honor.'
    }));
    body.appendChild(adv);
    foot.appendChild(el('button', {class:'pill-btn',onclick:'closePromptAssistant()'}, I18N('prompt_assistant.cancel','Cancel')));
    const genBtn = el('button', {class:'pill-btn primary','data-pa-generate':'1',onclick:'paSubmitGenerate()','disabled':'disabled','aria-disabled':'true'}, I18N('prompt_assistant.generate_btn','Generate'));
    foot.appendChild(genBtn);
    refreshGenerateEnabled();
  }

  window.openPromptAssistant = function(agentId, action){
    PA.currentAgent = agentId; PA.currentAction = action || 'improve';
    const root = $('pa-root'); if (!root) return;
    root.hidden = false;
    try { root.setAttribute('dir', (typeof window.detectLangDir === 'function' ? window.detectLangDir() : document.documentElement.getAttribute('dir') || 'ltr')); } catch(_){}
    renderForm(agentId, PA.currentAction);
    const titles = { improve:'prompt_assistant.title_improve', create:'prompt_assistant.title_create', use:'prompt_assistant.title_use' };
    $('pa-panel-title').textContent = I18N(titles[PA.currentAction] || 'prompt_assistant.drawer_title', 'Prompt Assistant');
    requestAnimationFrame(() => root.classList.add('open'));
  };
  window.closePromptAssistant = function(){
    const root = $('pa-root'); if (!root) return;
    root.classList.remove('open');
    setTimeout(() => { root.hidden = true; }, 220);
  };

  async function callEdge(body){
    const client = (window.supabaseClient || window.supabase);
    if (!client || !client.functions || typeof client.functions.invoke !== 'function')
      throw Object.assign(new Error('Supabase client not available'), { code:'network' });
    const { data, error } = await client.functions.invoke('prompt-assistant', { body });
    if (error){
      let code = 'generation_failed', msg = error.message || 'Unknown error';
      try { if (error.context && error.context.json){ code = error.context.json?.error?.code || code; msg = error.context.json?.error?.message || msg; } } catch(_){}
      throw Object.assign(new Error(msg), { code });
    }
    if (data && data.ok === false) throw Object.assign(new Error(data.error?.message || 'Failed'), { code: data.error?.code || 'generation_failed' });
    return data;
  }

  // --- Phase 4: canonical contract helpers ----------------------------------
  // Canonical mode values the workflow understands.
  const PA_CANONICAL_MODES = ['improve_existing','create_new','use_current'];
  function toCanonicalMode(short){
    if (PA_CANONICAL_MODES.indexOf(String(short || '')) !== -1) return String(short);
    if (short === 'improve') return 'improve_existing';
    if (short === 'create')  return 'create_new';
    if (short === 'use')     return 'use_current';
    return 'improve_existing';
  }
  // Detect Arabic/Hebrew/Persian/Urdu for RTL default.
  function paInferDir(language, explicit){
    if (explicit === 'rtl' || explicit === 'ltr') return explicit;
    try {
      if (typeof window.detectLangDir === 'function'){
        const d = window.detectLangDir();
        if (d === 'rtl' || d === 'ltr') return d;
      }
    } catch(_){}
    const rtl = new Set(['ar','he','fa','ur']);
    return rtl.has(String(language || '').toLowerCase()) ? 'rtl' : 'ltr';
  }
  // Best-effort read of currently-active agent tab metadata.
  function paReadTabMeta(agentId){
    const out = { agentTabId: null, agentTabKey: null };
    try {
      const tab = document.querySelector(
        `[data-agent-tab="${agentId}"], [data-agent-id="${agentId}"]`
      );
      if (tab){
        out.agentTabId  = tab.getAttribute('data-agent-tab-id')  || tab.id || null;
        out.agentTabKey = tab.getAttribute('data-agent-tab-key') || tab.getAttribute('data-agent-tab') || null;
      }
    } catch(_){}
    return out;
  }
  // Build the canonical request body. Only includes verified fields; omits
  // anything we cannot read locally so the workflow never sees fake values.
  function buildCanonicalRequest({ agentId, mode, inputs, originalPrompt, currentPromptValue }){
    const locale = (document.documentElement.getAttribute('lang') || inputs.language || 'en');
    const textDirection = paInferDir(inputs.language, document.documentElement.getAttribute('dir'));
    const tab = paReadTabMeta(agentId);
    const req = {
      action: 'generate',
      agent: agentId,
      mode,
      // App-side inputs (root-level per canonical contract).
      goal:           inputs.goal           || '',
      business:       inputs.business       || '',
      tone:           inputs.tone           || '',
      language:       inputs.language       || '',
      collectFields:  Array.isArray(inputs.collect) ? inputs.collect : [],
      avoidRules:     Array.isArray(inputs.avoid)   ? inputs.avoid   : [],
      importantNote:  inputs.note           || '',
      originalPrompt: originalPrompt        || '',
      currentPromptValue: currentPromptValue || '',
      locale,
      textDirection,
      agentId,
      agentTabId:  tab.agentTabId,
      agentTabKey: tab.agentTabKey,
      // Nested inputs kept as a legacy alias for older edge code paths.
      inputs: { ...inputs, current_prompt: currentPromptValue }
    };
    return req;
  }
  // Follow-up questions state: when the workflow returns missingFields or
  // questions we re-open the drawer with a lightweight Q&A form so the user
  // can supply the missing info and re-submit.
  PA.pendingFollowUp = PA.pendingFollowUp || {};
  function openFollowUpState(agentId, info){
    try {
      const root = $('pa-root'); if (!root) return;
      root.hidden = false;
      root.classList.add('open');
      const body = $('pa-panel-body'), foot = $('pa-panel-foot'), title = $('pa-panel-title');
      if (title) title.textContent = I18N('prompt_assistant.followup_title','A few more details');
      if (body) body.innerHTML = '';
      if (foot) foot.innerHTML = '';
      const wrap = el('div', {class:'pa-followup'});
      const intro = el('div', {class:'pa-field-hint'},
        I18N('prompt_assistant.followup_intro','The assistant needs a bit more info before it can draft a prompt.'));
      wrap.appendChild(intro);
      const answers = {};
      (info.missingFields || []).forEach((f, i) => {
        const row = el('div', {class:'pa-form-field'});
        row.appendChild(el('div', {class:'pa-form-label'}, String(f)));
        const input = el('input', {type:'text','data-pa-followup':'missing:'+i,placeholder:''});
        row.appendChild(input);
        wrap.appendChild(row);
        answers['missing:'+i] = { field:String(f), input };
      });
      (info.questions || []).forEach((q, i) => {
        const row = el('div', {class:'pa-form-field'});
        row.appendChild(el('div', {class:'pa-form-label'}, String(q)));
        const input = el('textarea', {rows:'2','data-pa-followup':'q:'+i});
        row.appendChild(input);
        wrap.appendChild(row);
        answers['q:'+i] = { question:String(q), input };
      });
      if (body) body.appendChild(wrap);
      const cancel = el('button', {class:'pill-btn', onclick:'closePromptAssistant()'}, I18N('prompt_assistant.cancel','Cancel'));
      const submit = el('button', {class:'pill-btn primary'}, I18N('prompt_assistant.followup_submit','Send answers'));
      submit.addEventListener('click', () => {
        const extra = {};
        Object.keys(answers).forEach(k => {
          const v = (answers[k].input && answers[k].input.value || '').trim();
          if (v) extra[k] = v;
        });
        const prior = PA.lastRequest[agentId] || {};
        const next = { ...prior, followUpAnswers: extra };
        PA.lastRequest[agentId] = next;
        closePromptAssistant();
        setState(agentId, 'loading');
        (async () => {
          try {
            const data = await callEdge(next);
            const payload = data?.data || {};
            const finalPrompt = (payload.finalPrompt || payload.suggested_prompt || '');
            if (!finalPrompt) throw Object.assign(new Error('Empty draft'), { code:'generation_failed' });
            PA.drafts[agentId] = {
              finalPrompt,
              suggested_prompt: finalPrompt,
              originalPrompt: payload.originalPrompt || prior.originalPrompt || '',
              current_prompt: prior.originalPrompt || '',
              mode: payload.modeApplied || prior.mode || 'improve_existing',
              summary: typeof payload.summary === 'string' ? payload.summary : '',
              missingFields: [],
              questions: [],
              canApply:       (payload.canApply      !== false) && !!finalPrompt,
              canCopy:        (payload.canCopy       !== false) && !!finalPrompt,
              canRegenerate:  (payload.canRegenerate !== false),
              isLocked:       !!payload.isLocked,
              lockReason:     payload.lockReason || null,
              inputs: prior.inputs || {}
            };
            if (typeof data?.remaining === 'number'){
              PA.remaining[agentId] = data.remaining;
              const rem = $(`pa-remaining-${agentId}`);
              if (rem) rem.textContent = I18N('prompt_assistant.remaining_today','{n} left today').replace('{n}', String(data.remaining));
            }
            paintDraft(agentId); setState(agentId, 'draft');
          } catch (err){
            const code = err.code || 'generation_failed';
            const strip = $(`pa-error-${agentId}`);
            if (strip) strip.querySelector('.pa-err-msg').textContent = I18N('prompt_assistant.errors.'+code, err.message || 'Something went wrong');
            setState(agentId, 'error');
          }
        })();
      });
      if (foot){ foot.appendChild(cancel); foot.appendChild(submit); }
    } catch(_){ /* non-fatal: fall through to normal state */ }
  }
  // --------------------------------------------------------------------------

  window.paSubmitGenerate = async function(){
    const agentId = PA.currentAgent, action = PA.currentAction;
    if (!agentId) return;
    if (!validateAll()){
      // Focus the first invalid field so it's obvious even on small screens
      const body = $('pa-panel-body');
      const firstBad = body && body.querySelector('.pa-form-field.pa-invalid');
      if (firstBad){
        const focusable = firstBad.querySelector('input,textarea,.pa-chip');
        try { focusable && focusable.focus({preventScroll:false}); } catch(_){ try { focusable && focusable.focus(); } catch(__){} }
      }
      safeToast(I18N('prompt_assistant.errors.missing_required','Please fill goal, business, tone, and language'), 'warn');
      return;
    }
    const inputs = readForm();
    const ta = $(`prompt-${agentId}`);
    const canonicalMode = toCanonicalMode(action);
    const currentPromptValue = (ta && ta.value) || '';
    const originalPrompt = canonicalMode === 'improve_existing' ? currentPromptValue : '';
    const req = buildCanonicalRequest({
      agentId,
      mode: canonicalMode,
      inputs,
      originalPrompt,
      currentPromptValue
    });
    PA.lastRequest[agentId] = req;
    closePromptAssistant();
    setState(agentId, 'loading');
    try {
      const data = await callEdge(req);
      const payload = data?.data || {};
      // Prefer canonical finalPrompt; fall back to legacy suggested_prompt alias.
      const finalPrompt = (payload.finalPrompt || payload.suggested_prompt || '');
      const missingFields = Array.isArray(payload.missingFields) ? payload.missingFields : [];
      const questions     = Array.isArray(payload.questions)     ? payload.questions     : [];
      const needsMore = (missingFields.length > 0) || (questions.length > 0);
      if (!finalPrompt && !needsMore){
        throw Object.assign(new Error('Empty draft'), { code:'generation_failed' });
      }
      if (typeof data?.remaining === 'number'){
        PA.remaining[agentId] = data.remaining;
        const rem = $(`pa-remaining-${agentId}`);
        if (rem) rem.textContent = I18N('prompt_assistant.remaining_today','{n} left today').replace('{n}', String(data.remaining));
      }
      if (needsMore){
        // Follow-up questions from the generator: keep the drawer open in a
        // 'needs more' state so the user can answer and re-submit.
        PA.pendingFollowUp[agentId] = { missingFields, questions, mode: canonicalMode, inputs };
        setState(agentId, 'normal');
        openFollowUpState(agentId, { missingFields, questions, mode: canonicalMode });
        return;
      }
      PA.drafts[agentId] = {
        finalPrompt,
        suggested_prompt: finalPrompt,           // legacy alias
        originalPrompt: payload.originalPrompt || originalPrompt,
        current_prompt: originalPrompt,          // legacy alias for diff
        mode: payload.modeApplied || canonicalMode,
        summary: typeof payload.summary === 'string' ? payload.summary : '',
        missingFields: [],
        questions: [],
        canApply:       (payload.canApply      !== false) && !!finalPrompt,
        canCopy:        (payload.canCopy       !== false) && !!finalPrompt,
        canRegenerate:  (payload.canRegenerate !== false),
        isLocked:       !!payload.isLocked,
        lockReason:     payload.lockReason || null,
        inputs
      };
      paintDraft(agentId); setState(agentId, 'draft');
    } catch (err){
      const code = err.code || 'generation_failed';
      const strip = $(`pa-error-${agentId}`);
      if (strip) strip.querySelector('.pa-err-msg').textContent = I18N('prompt_assistant.errors.'+code, err.message || 'Something went wrong');
      setState(agentId, 'error');
    }
  };

  window.paCancelGeneration = function(){ const a = PA.currentAgent; if (a) setState(a, 'normal'); };
  window.paRegenerate = function(){
    const agentId = PA.currentAgent, req = agentId && PA.lastRequest[agentId];
    if (!req) return;
    setState(agentId, 'loading');
    (async () => {
      try {
        const data = await callEdge(req);
        const payload = data?.data || {};
        const finalPrompt = (payload.finalPrompt || payload.suggested_prompt || '');
        if (!finalPrompt) throw Object.assign(new Error('Empty draft'), { code:'generation_failed' });
        const prev = PA.drafts[agentId] || {};
        PA.drafts[agentId] = {
          ...prev,
          finalPrompt,
          suggested_prompt: finalPrompt,
          originalPrompt: payload.originalPrompt || prev.originalPrompt || prev.current_prompt || '',
          mode: payload.modeApplied || prev.mode,
          summary: typeof payload.summary === 'string' ? payload.summary : (prev.summary || ''),
          canApply:       (payload.canApply      !== false) && !!finalPrompt,
          canCopy:        (payload.canCopy       !== false) && !!finalPrompt,
          canRegenerate:  (payload.canRegenerate !== false),
          isLocked:       (payload.isLocked   !== undefined) ? !!payload.isLocked    : !!prev.isLocked,
          lockReason:     (payload.lockReason !== undefined) ? (payload.lockReason || null) : (prev.lockReason || null)
        };
        if (typeof data?.remaining === 'number'){
          PA.remaining[agentId] = data.remaining;
          const rem = $(`pa-remaining-${agentId}`);
          if (rem) rem.textContent = I18N('prompt_assistant.remaining_today','{n} left today').replace('{n}', String(data.remaining));
        }
        paintDraft(agentId); setState(agentId, 'draft');
      } catch (err){
        const code = err.code || 'generation_failed';
        const strip = $(`pa-error-${agentId}`);
        if (strip) strip.querySelector('.pa-err-msg').textContent = I18N('prompt_assistant.errors.'+code, err.message || 'Something went wrong');
        setState(agentId, 'error');
      }
    })();
  };
  window.paRetry = function(){ window.paRegenerate(); };
  window.paDismissError = function(){ const a = PA.currentAgent; if (a) setState(a, PA.drafts[a] ? 'draft' : 'normal'); };
  window.paCancelDraft = function(){ const a = PA.currentAgent; if (!a) return; delete PA.drafts[a]; setState(a, 'normal'); };
  window.paCopyDraft = function(){
    const a = PA.currentAgent, d = a && PA.drafts[a];
    if (!d) return;
    if (d.canCopy === false) return;
    const text = d.finalPrompt || d.suggested_prompt || '';
    try { navigator.clipboard.writeText(text); safeToast(I18N('prompt_assistant.copy_success','Copied to clipboard'),'success'); }
    catch(_){ safeToast(I18N('prompt_assistant.errors.network','Copy failed'), 'error'); }
  };
  window.paSwitchDiffTab = function(agentId, tab){
    const wrap = $(`pa-draft-wrap-${agentId}`); if (!wrap) return;
    wrap.setAttribute('data-active-tab', tab);
    wrap.querySelectorAll('.pa-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-pa-tab') === tab));
  };

  function requestUnlockSafe(agentId){
    try { if (typeof window.requestUnlock === 'function'){ window.requestUnlock(agentId); return true; } } catch(_){}
    return false;
  }
  window.paApplyDraft = async function(agentId, applyMode){
    const d = PA.drafts[agentId]; if (!d) return;
    if (d.canApply === false) return;
    const ta = $(`prompt-${agentId}`); if (!ta) return;
    if (ta.hasAttribute('readonly')){
      PA.pendingApply = { agentId, applyMode };
      watchForUnlock(agentId);
      if (!requestUnlockSafe(agentId)) safeToast(I18N('prompt_assistant.lock_blocked','Unlock to apply'), 'warn');
      return;
    }
    await performApply(agentId, applyMode);
  };
  async function performApply(agentId, applyMode){
    const d = PA.drafts[agentId], ta = $(`prompt-${agentId}`);
    if (!d || !ta) return;
    if (d.canApply === false) return;
    const oldValue = ta.value, newValue = (d.finalPrompt || d.suggested_prompt || '');
    if (!newValue) return;
    ta.value = newValue;
    ta.dispatchEvent(new Event('input', { bubbles:true }));
    ta.dispatchEvent(new Event('change', { bubbles:true }));
    try { if (typeof window.checkDirty === 'function') window.checkDirty(agentId); } catch(_){}
    try {
      const data = await callEdge({ action:'apply', agent:agentId, suggested_prompt:newValue, finalPrompt:newValue, apply_mode:applyMode });
      if (data?.ok !== false){
        const chip = $(`pa-applied-${agentId}`);
        if (chip){ chip.hidden = false; setTimeout(() => { chip.hidden = true; }, 4000); }
        safeToast(I18N('prompt_assistant.applied_chip','Prompt updated'), 'success');
        setState(agentId, 'applied');
        return;
      }
    } catch (err){
      ta.value = oldValue; ta.dispatchEvent(new Event('input', { bubbles:true }));
      const code = err.code || 'generation_failed';
      const strip = $(`pa-error-${agentId}`);
      if (strip) strip.querySelector('.pa-err-msg').textContent = I18N('prompt_assistant.errors.'+code, err.message || 'Apply failed');
      setState(agentId, 'error');
    }
  }
  function watchForUnlock(agentId){
    const ta = $(`prompt-${agentId}`); if (!ta) return;
    try { PA.unlockObserver && PA.unlockObserver.disconnect(); } catch(_){}
    PA.unlockObserver = new MutationObserver(() => {
      if (!ta.hasAttribute('readonly') && PA.pendingApply && PA.pendingApply.agentId === agentId){
        const p = PA.pendingApply; PA.pendingApply = null;
        try { PA.unlockObserver.disconnect(); } catch(_){}
        performApply(p.agentId, p.applyMode);
      }
    });
    PA.unlockObserver.observe(ta, { attributes:true, attributeFilter:['readonly'] });
    setTimeout(() => { try { PA.unlockObserver && PA.unlockObserver.disconnect(); } catch(_){} }, 120000);
  }

  window.paUndoApplied = async function(agentId){
    try {
      const data = await callEdge({ action:'undo', agent:agentId });
      const restored = data?.data?.config?.system_prompt;
      const ta = $(`prompt-${agentId}`);
      if (ta && typeof restored === 'string'){
        ta.value = restored; ta.dispatchEvent(new Event('input', { bubbles:true }));
        safeToast(I18N('prompt_assistant.undo','Reverted'), 'success');
      }
      setState(agentId, 'normal');
    } catch (err){
      safeToast(I18N('prompt_assistant.errors.'+(err.code||'generation_failed'), err.message || 'Undo failed'), 'error');
    }
  };

  document.addEventListener('keydown', function(e){
    const root = $('pa-root');
    if (!root || root.hidden) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')){
        // Open PA for the currently-active agent tab, if any
        try {
          const activeTab = document.querySelector('.agent-tab.active, [data-agent-tab].active');
          const id = activeTab && (activeTab.getAttribute('data-agent-tab') || activeTab.getAttribute('data-agent-id'));
          if (id){ e.preventDefault(); window.openPromptAssistant(id, 'improve'); }
        } catch(_){}
      }
      return;
    }
    if (e.key === 'Escape'){ e.preventDefault(); window.closePromptAssistant(); }
  });
})();
