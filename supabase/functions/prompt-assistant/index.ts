/**
 * Edge Function: prompt-assistant
 *
 * Reusable Prompt Assistant backend for all 5 AI agent tabs
 *   (website, whatsapp, page, instagram, telegram).
 *
 * PHASE 4 — CANONICAL CONTRACT
 * -----------------------------
 * Request from app to workflow (all optional unless marked *):
 *   mode*             : 'improve_existing' | 'create_new' | 'use_current'
 *   originalPrompt    : string — existing prompt (only for improve_existing)
 *   goal*             : string
 *   business*         : string
 *   tone*             : string
 *   language*         : string
 *   collectFields     : string[]
 *   avoidRules        : string[]
 *   importantNote     : string
 *   locale            : string (UI locale, e.g. 'en', 'ar')
 *   textDirection     : 'ltr' | 'rtl'
 *   workspaceId       : string (org_id — server-verified)
 *   agentId           : string (slug)
 *   agentTabId        : string
 *   agentTabKey       : string
 *   currentPromptValue: string
 *   promptStorageType : string (server-verified: 'agent_configs_row')
 *   promptRecordId    : string (server-verified)
 *   promptColumnKey   : string (server-verified: 'system_prompt')
 *   planKey           : string (server-verified from org_subscriptions)
 *   validatedDailyLimit : number (server-verified)
 *   validatedDailyUsed  : number (server-verified)
 *   remainingToday      : number (server-verified)
 *
 * Response from workflow back to UI:
 *   success          : boolean
 *   modeApplied      : 'improve_existing' | 'create_new' | 'use_current'
 *   originalPrompt   : string
 *   finalPrompt      : string
 *   summary          : string
 *   missingFields    : string[]
 *   questions        : string[]
 *   canApply         : boolean
 *   canCopy          : boolean
 *   canRegenerate    : boolean
 *
 * Rules:
 *   - Only verified fields are forwarded. Unknown / unverifiable fields
 *     are OMITTED rather than faked.
 *   - The workflow is treated as the stateless generation layer. Product
 *     truth — rate limits, versioning, audit, permissions — lives here.
 *   - Apply / Undo are app-side concerns, never touched by the workflow.
 *
 * Deploy: supabase functions deploy prompt-assistant
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   N8N_PROMPT_ASSISTANT_URL   (default: https://n8n.srv1174105.hstgr.cloud/webhook/prompt-imporve)
 *                              (note: 'prompt-imporve' — typo preserved to match the live endpoint)
 *
 * Response envelope from edge function back to UI (stable for UI layer):
 *   { ok: true, data: {
 *       success, modeApplied, originalPrompt, finalPrompt, summary,
 *       missingFields, questions, canApply, canCopy, canRegenerate,
 *       suggested_prompt  // legacy alias of finalPrompt for smooth UI migration
 *     }, remaining: number }
 *   { ok: false, error: { code, message }, remaining?: number }
 *
 *   Response headers additionally carry:
 *     X-Pa-Remaining: <int>   (remaining generations today)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const N8N_URL =
    Deno.env.get('N8N_PROMPT_ASSISTANT_URL') ||
    'https://n8n.srv1174105.hstgr.cloud/webhook/prompt-imporve';

const ALLOWED_AGENTS = ['website', 'whatsapp', 'page', 'instagram', 'telegram'] as const;
type AgentType = typeof ALLOWED_AGENTS[number];

const DEFAULT_DAILY_LIMIT = 15;  // safe floor when plan cannot be resolved
const REQUIRED_PERMISSION = 'agents.configure';

// Trusted plan ladder. The app/database is the source of truth; the
// workflow is never consulted for plan limits. A billing_plans.limits
// override (prompt_assistant_daily_limit) can widen or narrow any plan.
const PLAN_DAILY_LIMITS: Record<string, number> = {
    starter: 15,
    growth:  25,
    pro:     40,
    pro_sim: 40,       // internal simulator plan -- mirror pro
    free_trial: 15,    // legacy; treated as starter-tier
};

// Optional shared secret for the n8n webhook. Set via env; when present we
// send both Authorization: Bearer <secret> and X-PA-Secret so the workflow
// can reject anonymous traffic.
const N8N_SHARED_SECRET = Deno.env.get('N8N_PROMPT_ASSISTANT_SECRET') || '';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, apikey',
    'Content-Type': 'application/json',
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, ...extraHeaders },
    });
}

function errorBody(code: string, message: string, remaining?: number) {
    return { ok: false, error: { code, message }, ...(remaining !== undefined ? { remaining } : {}) };
}

function utcDayKey(orgId: string): string {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `prompt_assistant:${orgId}:${y}-${m}-${day}`;
}

function utcDayStart(): string {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
        return json(errorBody('method_not_allowed', 'Only POST is supported'), 405);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- 1. AUTH --------------------------------------------------------------
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
        return json(errorBody('unauthenticated', 'Missing Bearer token'), 401);
    }

    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) {
        return json(errorBody('unauthenticated', 'Invalid or expired token'), 401);
    }
    const userId = userRes.user.id;

    // --- 2. PARSE BODY --------------------------------------------------------
    let body: any;
    try {
        body = await req.json();
    } catch {
        return json(errorBody('bad_request', 'Body must be valid JSON'), 400);
    }

    const action: string = body?.action;
    const agent: AgentType | undefined = body?.agent;
    if (!['generate', 'apply', 'undo'].includes(action)) {
        return json(errorBody('bad_request', 'action must be generate | apply | undo'), 400);
    }
    if (!agent || !ALLOWED_AGENTS.includes(agent)) {
        return json(errorBody('bad_request', `agent must be one of ${ALLOWED_AGENTS.join(', ')}`), 400);
    }

    // --- 3. RESOLVE ORG + ROLE + PERMISSION -----------------------------------
    const { data: profile, error: profileErr } = await admin
        .from('profiles')
        .select('org_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (profileErr || !profile?.org_id) {
        return json(errorBody('no_org', 'Could not resolve org for user'), 403);
    }
    const orgId = profile.org_id as string;

    const { data: member, error: memberErr } = await admin
        .from('organization_members')
        .select('role, permission_overrides')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();

    if (memberErr || !member) {
        return json(errorBody('no_membership', 'User is not a member of org'), 403);
    }
    const role: string = member.role;

    // `agents.configure` gate: allow if (a) role == owner/admin, or
    //                         (b) org_role_permissions row grants it, or
    //                         (c) per-user override grants it.
    let canConfigure = role === 'owner' || role === 'admin';
    if (!canConfigure) {
        const { data: grant } = await admin
            .from('org_role_permissions')
            .select('granted')
            .eq('org_id', orgId)
            .eq('role', role)
            .eq('permission', REQUIRED_PERMISSION)
            .maybeSingle();
        canConfigure = !!grant?.granted;
    }
    const overrides = (member.permission_overrides ?? {}) as Record<string, boolean>;
    if (overrides && typeof overrides[REQUIRED_PERMISSION] === 'boolean') {
        canConfigure = overrides[REQUIRED_PERMISSION];
    }

    // Route to handler
    try {
        if (action === 'generate') {
            return await handleGenerate({ admin, orgId, userId, agent, body });
        } else if (action === 'apply') {
            if (!canConfigure) {
                return json(errorBody('permission_denied', `Requires ${REQUIRED_PERMISSION}`), 403);
            }
            return await handleApply({ admin, orgId, userId, agent, role, body });
        } else if (action === 'undo') {
            if (!canConfigure) {
                return json(errorBody('permission_denied', `Requires ${REQUIRED_PERMISSION}`), 403);
            }
            return await handleUndo({ admin, orgId, userId, agent });
        }
    } catch (err) {
        console.error('prompt-assistant error:', err);
        return json(errorBody('internal', (err as Error).message || 'Unknown error'), 500);
    }

    return json(errorBody('bad_request', 'Unhandled action'), 400);
});

// -----------------------------------------------------------------------------
// GENERATE
// -----------------------------------------------------------------------------

// Resolve the daily limit via the public.prompt_assistant_resolve_plan RPC,
// which joins org_subscriptions to billing_plans.id and surfaces a slug +
// optional limits override. A hardcoded PLAN_DAILY_LIMITS map is applied
// when no numeric override is stored on the billing plan.
async function resolveDailyLimit(admin: any, orgId: string): Promise<{ limit: number; planSlug: string | undefined }> {
    const { data: rows, error } = await admin.rpc('prompt_assistant_resolve_plan', { p_org_id: orgId });
    if (error) {
        console.warn('prompt_assistant_resolve_plan RPC failed', error);
        return { limit: DEFAULT_DAILY_LIMIT, planSlug: undefined };
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    const planSlug: string | undefined = row?.plan_slug ? String(row.plan_slug) : undefined;
    const override: number | null = (row && typeof row.daily_limit_override === 'number') ? row.daily_limit_override : null;
    if (override !== null && override > 0) return { limit: override, planSlug };
    if (planSlug && PLAN_DAILY_LIMITS[planSlug] !== undefined) {
        return { limit: PLAN_DAILY_LIMITS[planSlug], planSlug };
    }
    return { limit: DEFAULT_DAILY_LIMIT, planSlug };
}

// Atomic daily-usage bump via SECURITY DEFINER Postgres function.
// The SQL takes a row-level lock, compares against the trusted limit, and
// increments in one statement. No client-trusted counters.
async function bumpRateLimit(admin: any, orgId: string, limit: number): Promise<{ ok: boolean; remaining: number; count: number }> {
    const { data, error } = await admin.rpc('prompt_assistant_bump_daily', {
        p_org_id: orgId,
        p_limit:  limit,
    });
    if (error) {
        console.warn('prompt_assistant_bump_daily RPC failed; fallback to upsert', error);
        // Fallback: last-resort best-effort counter via table upsert.
        const key = utcDayKey(orgId);
        const { data: existing } = await admin
            .from('rate_limits')
            .select('count')
            .eq('key', key)
            .maybeSingle();
        const current = (existing?.count as number) ?? 0;
        if (current >= limit) return { ok: false, remaining: 0, count: current };
        const next = current + 1;
        await admin.from('rate_limits').upsert(
            { key, count: next, window_start: utcDayStart(), updated_at: new Date().toISOString() },
            { onConflict: 'key' },
        );
        return { ok: true, remaining: Math.max(0, limit - next), count: next };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const allowed: boolean = !!row?.allowed;
    const count:   number  = Number(row?.new_count ?? 0);
    const remaining: number = Math.max(0, Number(row?.remaining ?? 0));
    return { ok: allowed, remaining, count };
}

// -----------------------------------------------------------------------------
// Mode normalization — accept both legacy short names AND canonical names.
// Canonical names are what we forward to the workflow.
// -----------------------------------------------------------------------------
const CANONICAL_MODES = ['improve_existing', 'create_new', 'use_current'] as const;
type CanonicalMode = typeof CANONICAL_MODES[number];

function canonicalizeMode(raw: unknown): CanonicalMode | null {
    const s = String(raw ?? '').trim();
    if (CANONICAL_MODES.includes(s as CanonicalMode)) return s as CanonicalMode;
    if (s === 'improve') return 'improve_existing';
    if (s === 'create')  return 'create_new';
    if (s === 'use')     return 'use_current';
    return null;
}

// Safe string / array coercion with a cap. Returns undefined when the source
// is empty/invalid — we OMIT fields rather than faking them.
function trimStr(v: unknown, cap: number): string | undefined {
    if (v === null || v === undefined) return undefined;
    const s = String(v).trim();
    if (!s) return undefined;
    return s.length > cap ? s.slice(0, cap) : s;
}

function trimStrArr(v: unknown, capItems: number, capItemLen: number): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out: string[] = [];
    for (const item of v) {
        const s = trimStr(item, capItemLen);
        if (s) out.push(s);
        if (out.length >= capItems) break;
    }
    return out.length ? out : undefined;
}

// resolvePlanKey is superseded by resolveDailyLimit, which returns the plan
// slug via the prompt_assistant_resolve_plan RPC in one roundtrip. Kept as a
// thin wrapper for any future caller that only needs the slug.
async function resolvePlanKey(admin: any, orgId: string): Promise<string | undefined> {
    const { data: rows } = await admin.rpc('prompt_assistant_resolve_plan', { p_org_id: orgId });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row?.plan_slug ? String(row.plan_slug) : undefined;
}

async function handleGenerate({ admin, orgId, userId, agent, body }: any) {
    const canonicalMode = canonicalizeMode(body?.mode);
    if (!canonicalMode) {
        return json(
            errorBody('bad_request', 'mode must be improve_existing | create_new | use_current'),
            400
        );
    }

    // 'use_current' does not call the generator — it just echoes the current prompt back
    // as a draft so the UI can render it in the diff/preview panel. Apply/Copy/Regen
    // are all true for the user's own prompt.
    if (canonicalMode === 'use_current') {
        const currentPrompt = String(
            body?.currentPromptValue ?? body?.inputs?.current_prompt ?? ''
        ).trim();
        // Peek at the lock state so the UI can surface Apply correctly.
        const { data: cfgLock } = await admin
            .from('agent_configs')
            .select('is_locked, lock_reason')
            .eq('org_id', orgId)
            .eq('agent', agent)
            .maybeSingle();
        const locked = !!cfgLock?.is_locked;
        return json({
            ok: true,
            data: {
                success: true,
                modeApplied: 'use_current',
                originalPrompt: currentPrompt,
                finalPrompt: currentPrompt,
                summary: '',
                missingFields: [],
                questions: [],
                canApply: !locked,
                canCopy: true,
                canRegenerate: false,
                isLocked: locked,
                lockReason: cfgLock?.lock_reason || null,
                // legacy alias for the current UI
                suggested_prompt: currentPrompt,
                mode: 'use_current',
            },
            remaining: -1,
        });
    }

    const { limit, planSlug: resolvedPlan } = await resolveDailyLimit(admin, orgId);
    const rl = await bumpRateLimit(admin, orgId, limit);
    if (!rl.ok) {
        return json(
            errorBody('rate_limited', `Daily limit of ${limit} generations reached`, 0),
            429,
            { 'X-Pa-Remaining': '0' }
        );
    }

    // Accept inputs either as a nested `inputs` object (legacy UI) OR at the
    // root (canonical). Both forms get normalized to canonical keys below.
    const inputs = body?.inputs ?? {};
    const src = {
        goal:            body?.goal            ?? inputs.goal,
        business:        body?.business        ?? inputs.business,
        tone:            body?.tone            ?? inputs.tone,
        language:        body?.language        ?? inputs.language,
        collectFields:   body?.collectFields   ?? inputs.collect,
        avoidRules:      body?.avoidRules      ?? inputs.avoid,
        importantNote:   body?.importantNote   ?? inputs.note,
        originalPrompt:  body?.originalPrompt  ?? inputs.current_prompt,
        currentPromptValue: body?.currentPromptValue ?? inputs.current_prompt,
        locale:          body?.locale          ?? inputs.language,
        textDirection:   body?.textDirection,
        agentTabId:      body?.agentTabId      ?? agent,
        agentTabKey:     body?.agentTabKey     ?? agent,
    };

    // Required fields (by the canonical contract).
    const missingRequired: string[] = [];
    if (!trimStr(src.goal, 500))     missingRequired.push('goal');
    if (!trimStr(src.business, 500)) missingRequired.push('business');
    if (!trimStr(src.tone, 80))      missingRequired.push('tone');
    if (!trimStr(src.language, 20))  missingRequired.push('language');
    if (missingRequired.length) {
        return json(
            errorBody('bad_request', `Missing required fields: ${missingRequired.join(', ')}`),
            400,
            { 'X-Pa-Remaining': String(rl.remaining) }
        );
    }

    // Pull VERIFIED fields from the DB — never fake these.
    const { data: cfg } = await admin
        .from('agent_configs')
        .select('id, system_prompt, tone, supported_languages, persona, multilingual_prompts, is_locked, lock_reason')
        .eq('org_id', orgId)
        .eq('agent', agent)
        .maybeSingle();

    // Re-use the plan slug from resolveDailyLimit -- avoids a second RPC roundtrip.
    const planKey = resolvedPlan;

    // Build the canonical payload. Each field is included ONLY if we have a
    // real, verified value for it. textDirection is inferred from language
    // when not supplied, which is a deterministic derivation — not a fake.
    const language = trimStr(src.language, 20)!;
    const inferredDir =
        trimStr(src.textDirection, 8) ||
        (language && ['ar', 'he', 'fa', 'ur'].includes(language.toLowerCase()) ? 'rtl' : 'ltr');

    const originalPrompt =
        canonicalMode === 'improve_existing'
            ? trimStr(src.originalPrompt ?? cfg?.system_prompt, 8000)
            : undefined;

    // Canonical request (only real / verified fields).
    const canonicalReq: Record<string, unknown> = {
        mode: canonicalMode,
        goal: trimStr(src.goal, 500),
        business: trimStr(src.business, 500),
        tone: trimStr(src.tone, 80),
        language,
        textDirection: inferredDir,
        locale: trimStr(src.locale, 20) || language,
        workspaceId: orgId,
        agentId: agent,
        agentTabId: trimStr(src.agentTabId, 80) || agent,
        agentTabKey: trimStr(src.agentTabKey, 80) || agent,
        validatedDailyLimit: limit,
        validatedDailyUsed: rl.count,
        remainingToday: rl.remaining,
    };
    if (originalPrompt) canonicalReq.originalPrompt = originalPrompt;

    const collectFields = trimStrArr(src.collectFields, 20, 80);
    if (collectFields) canonicalReq.collectFields = collectFields;

    const avoidRules = trimStrArr(src.avoidRules, 20, 120);
    if (avoidRules) canonicalReq.avoidRules = avoidRules;

    const importantNote = trimStr(src.importantNote, 1000);
    if (importantNote) canonicalReq.importantNote = importantNote;

    const currentPromptValue = trimStr(src.currentPromptValue ?? cfg?.system_prompt, 8000);
    if (currentPromptValue) canonicalReq.currentPromptValue = currentPromptValue;

    if (cfg?.id) {
        canonicalReq.promptStorageType = 'agent_configs_row';
        canonicalReq.promptRecordId = String(cfg.id);
        canonicalReq.promptColumnKey = 'system_prompt';
    }
    if (planKey) canonicalReq.planKey = planKey;

    const genHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (N8N_SHARED_SECRET) {
        genHeaders['Authorization'] = `Bearer ${N8N_SHARED_SECRET}`;
        genHeaders['X-PA-Secret']   = N8N_SHARED_SECRET;
    }

    // One retry on transient failure (network, timeout, 5xx). A 4xx is
    // treated as a deterministic response from the workflow and not retried.
    async function callGenerator(): Promise<{ ok: true; parsed: any } | { ok: false; status: number; text: string } | { ok: false; kind: 'network' | 'timeout'; message: string }> {
        try {
            const res = await fetch(N8N_URL, {
                method: 'POST',
                headers: genHeaders,
                body: JSON.stringify(canonicalReq),
                signal: AbortSignal.timeout(25_000),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                return { ok: false, status: res.status, text };
            }
            let parsedBody: any = await res.json().catch(() => ({}));
            if (typeof parsedBody === 'string') parsedBody = { finalPrompt: parsedBody };
            return { ok: true, parsed: parsedBody };
        } catch (err: any) {
            const kind = err?.name === 'TimeoutError' ? 'timeout' : 'network';
            return { ok: false, kind, message: err?.message || 'Network error' };
        }
    }

    let parsed: any = null;
    let attempt = 0;
    let last: Awaited<ReturnType<typeof callGenerator>> | null = null;
    while (attempt < 2) {
        last = await callGenerator();
        if ('ok' in last && last.ok) { parsed = last.parsed; break; }
        // Retry only on network / timeout / 5xx
        const retryable =
            ('kind' in last) ||
            ('status' in last && typeof last.status === 'number' && last.status >= 500);
        if (!retryable || attempt === 1) break;
        attempt += 1;
        await new Promise(r => setTimeout(r, 400));  // brief backoff
    }
    if (!parsed) {
        if (last && !last.ok && 'status' in last) {
            console.error('n8n non-200', last.status, (last.text || '').slice(0, 400));
            return json(
                errorBody('generation_failed', `Generator returned ${last.status}`, rl.remaining),
                502,
                { 'X-Pa-Remaining': String(rl.remaining) }
            );
        }
        if (last && !last.ok && 'kind' in last) {
            const code = last.kind;
            return json(errorBody(code, last.message, rl.remaining), 504, {
                'X-Pa-Remaining': String(rl.remaining),
            });
        }
        return json(errorBody('network', 'Generator unreachable', rl.remaining), 504, {
            'X-Pa-Remaining': String(rl.remaining),
        });
    }

    // Parse canonical response from the workflow. Fall back to legacy shapes
    // where present so any older generator variant still works during rollout.
    const finalPrompt =
        trimStr(parsed?.finalPrompt, 16000) ??
        trimStr(parsed?.suggested_prompt, 16000) ??
        trimStr(parsed?.prompt, 16000) ??
        trimStr(parsed?.text, 16000) ??
        trimStr(parsed?.output, 16000) ??
        trimStr(parsed?.result, 16000) ??
        trimStr(parsed?.data?.finalPrompt, 16000) ??
        trimStr(parsed?.data?.prompt, 16000) ??
        trimStr(parsed?.data?.suggested_prompt, 16000) ??
        '';

    const missingFields = trimStrArr(parsed?.missingFields, 20, 120) ?? [];
    const questions = trimStrArr(parsed?.questions, 20, 400) ?? [];
    const summary = trimStr(parsed?.summary, 1000) ?? '';

    // If the workflow asked follow-up questions, don't treat this as a ready draft.
    const needsMore = missingFields.length > 0 || questions.length > 0;

    if (!finalPrompt && !needsMore) {
        return json(
            errorBody('generation_failed', 'Empty response from generator', rl.remaining),
            502,
            { 'X-Pa-Remaining': String(rl.remaining) }
        );
    }

    const success =
        typeof parsed?.success === 'boolean' ? parsed.success : !needsMore && !!finalPrompt;
    const modeApplied = canonicalizeMode(parsed?.modeApplied) || canonicalMode;
    const originalOut = trimStr(parsed?.originalPrompt, 16000) ?? originalPrompt ?? '';

    const canApply =
        typeof parsed?.canApply === 'boolean' ? parsed.canApply : success && !!finalPrompt && !needsMore;
    const canCopy =
        typeof parsed?.canCopy === 'boolean' ? parsed.canCopy : !!finalPrompt;
    const canRegenerate =
        typeof parsed?.canRegenerate === 'boolean' ? parsed.canRegenerate : true;

    // Best-effort audit log (non-blocking)
    admin.from('dcc_audit_logs').insert({
        org_id: orgId,
        user_id: userId,
        action: 'prompt_assistant.generate',
        resource_type: 'agent_config',
        resource_id: agent,
        metadata: {
            mode: canonicalMode,
            modeApplied,
            remaining: rl.remaining,
            daily_limit: limit,
            needsMore,
        },
    }).then(() => {}, (e: unknown) => console.warn('audit insert failed', e));

    return json(
        {
            ok: true,
            data: {
                success,
                modeApplied,
                originalPrompt: originalOut,
                finalPrompt,
                summary,
                missingFields,
                questions,
                canApply: canApply && !cfg?.is_locked,
                canCopy,
                canRegenerate,
                isLocked: !!cfg?.is_locked,
                lockReason: cfg?.lock_reason || null,
                // Legacy alias -- current UI reads data.suggested_prompt.
                suggested_prompt: finalPrompt,
                mode: modeApplied,
                agent,
            },
            remaining: rl.remaining,
        },
        200,
        { 'X-Pa-Remaining': String(rl.remaining) }
    );
}

// -----------------------------------------------------------------------------
// APPLY
// -----------------------------------------------------------------------------

async function handleApply({ admin, orgId, userId, agent, role, body }: any) {
    const suggested: string = String(body?.suggested_prompt ?? body?.finalPrompt ?? '').trim();
    const applyMode: string = body?.apply_mode || 'replace';
    const overrideLock: boolean = body?.overrideLock === true;
    if (!suggested) {
        return json(errorBody('bad_request', 'suggested_prompt is required'), 400);
    }
    if (!['apply', 'replace'].includes(applyMode)) {
        return json(errorBody('bad_request', "apply_mode must be 'apply' or 'replace'"), 400);
    }

    // Fetch existing config. Ownership is enforced by the .eq('org_id', orgId)
    // filter; there is no cross-tenant path.
    const { data: existing, error: existErr } = await admin
        .from('agent_configs')
        .select('id, system_prompt, tone, is_active, is_locked, lock_reason, org_id')
        .eq('org_id', orgId)
        .eq('agent', agent)
        .maybeSingle();

    if (existErr) {
        return json(errorBody('internal', existErr.message), 500);
    }

    // Defensive cross-check: even though the query is scoped to orgId,
    // verify the returned row actually belongs to the caller's org.
    if (existing?.org_id && existing.org_id !== orgId) {
        return json(errorBody('permission_denied', 'Target prompt does not belong to your organization'), 403);
    }

    // Locked prompts may generate drafts (that ran in handleGenerate) but
    // may not be silently overwritten. Only owners may override the lock
    // and only with an explicit overrideLock=true flag on the request.
    if (existing?.is_locked) {
        const isOwner = role === 'owner' || role === 'admin';
        if (!overrideLock || !isOwner) {
            return json(
                errorBody(
                    'locked',
                    existing.lock_reason || 'Prompt is locked. Unlock it before applying.'
                ),
                409
            );
        }
    }

    // Snapshot previous into versions (if a row exists and has a prompt)
    if (existing?.id && existing.system_prompt) {
        const { error: versionErr } = await admin.from('agent_config_versions').insert({
            config_id: existing.id,
            org_id: orgId,
            agent,
            system_prompt: existing.system_prompt,
            tone: existing.tone ?? null,
            is_active: !!existing.is_active,
            changed_by: userId,
        });
        if (versionErr) console.warn('version snapshot failed (non-fatal)', versionErr);
    }

    // Upsert the new value (onConflict matches existing app at index.html ~31767)
    const { data: upserted, error: upsertErr } = await admin
        .from('agent_configs')
        .upsert(
            {
                org_id: orgId,
                agent,
                system_prompt: suggested,
                updated_by: userId,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'org_id,agent' }
        )
        .select('id, system_prompt, tone, updated_at')
        .maybeSingle();

    if (upsertErr) {
        return json(errorBody('internal', upsertErr.message), 500);
    }

    admin.from('dcc_audit_logs').insert({
        org_id: orgId,
        user_id: userId,
        action: 'prompt_assistant.apply',
        resource_type: 'agent_config',
        resource_id: agent,
        metadata: { apply_mode: applyMode, prompt_chars: suggested.length },
    }).then(() => {}, (e: unknown) => console.warn('audit insert failed', e));

    return json({ ok: true, data: { config: upserted, apply_mode: applyMode } });
}

// -----------------------------------------------------------------------------
// UNDO
// -----------------------------------------------------------------------------

async function handleUndo({ admin, orgId, userId, agent }: any) {
    const { data: lastVersion, error: verErr } = await admin
        .from('agent_config_versions')
        .select('id, system_prompt, tone, is_active')
        .eq('org_id', orgId)
        .eq('agent', agent)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (verErr) return json(errorBody('internal', verErr.message), 500);
    if (!lastVersion) {
        return json(errorBody('no_version', 'Nothing to undo'), 404);
    }

    const { data: restored, error: updErr } = await admin
        .from('agent_configs')
        .update({
            system_prompt: lastVersion.system_prompt,
            tone: lastVersion.tone,
            updated_by: userId,
            updated_at: new Date().toISOString(),
        })
        .eq('org_id', orgId)
        .eq('agent', agent)
        .select('id, system_prompt, tone, updated_at')
        .maybeSingle();

    if (updErr) return json(errorBody('internal', updErr.message), 500);

    // Remove the row we just consumed, so subsequent Undo walks further back.
    await admin.from('agent_config_versions').delete().eq('id', lastVersion.id);

    admin.from('dcc_audit_logs').insert({
        org_id: orgId,
        user_id: userId,
        action: 'prompt_assistant.undo',
        resource_type: 'agent_config',
        resource_id: agent,
    }).then(() => {}, (e: unknown) => console.warn('audit insert failed', e));

    return json({ ok: true, data: { config: restored } });
}
