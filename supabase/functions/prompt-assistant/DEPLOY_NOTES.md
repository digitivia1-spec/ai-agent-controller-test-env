# prompt-assistant — deploy notes (Phase 5/6)

## Deployment state (2026-04-22)

- **Project:** `xrycghxaxqzvkmzqzzkx` (Digitivia Agent Controller)
- **Migration applied:** `20260421213108 prompt_assistant_phase5`
  - Adds `agent_configs.is_locked / lock_reason / locked_by / locked_at`
  - Creates `prompt_assistant_bump_daily(p_org_id uuid, p_limit int)` — SECURITY DEFINER, `FOR UPDATE` row lock
  - Creates `prompt_assistant_resolve_plan(p_org_id uuid)` — joins `org_subscriptions → billing_plans` by `plan_id`
- **Edge function deployed:** `prompt-assistant`, version 1, `verify_jwt: true`
  - Endpoint: `https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/prompt-assistant`
  - sha256: `2d8077b42c3ae9270ef6bda28d95dc40d700da44f5268b2c763d32c463c85e70`

## Required secret

The edge function reads `N8N_PROMPT_ASSISTANT_SECRET` from its environment. When
set, every call to the n8n generator webhook is sent with:

```
Authorization: Bearer <secret>
X-PA-Secret: <secret>
```

If the secret is not set, the function still works but the generator call goes
out unauthenticated — the n8n workflow should be configured to reject missing
headers once the secret is provisioned on both sides.

### Provisioning the secret

Cannot be set via the Supabase MCP API. Use **one** of:

1. Supabase Dashboard → Project `xrycghxaxqzvkmzqzzkx` → Edge Functions → Secrets
   → add key `N8N_PROMPT_ASSISTANT_SECRET` with the shared value.
2. Supabase CLI:
   ```bash
   supabase secrets set N8N_PROMPT_ASSISTANT_SECRET=<value> \
     --project-ref xrycghxaxqzvkmzqzzkx
   ```

Then mirror the same value on the n8n workflow (webhook "Authentication
— Header Auth" → header `Authorization: Bearer <value>` or check
`$request.headers['x-pa-secret']`).

## Runtime smoke-test results (2026-04-22)

| check | result |
|---|---|
| `prompt_assistant_resolve_plan('df6a5930-…')` | `plan_slug=free_trial, override=null` |
| `prompt_assistant_resolve_plan('624e20c0-…')` | `plan_slug=starter, override=null` |
| `prompt_assistant_bump_daily` × 5 at limit=3 | `true/true/true/false/false`, counter caps at 3, remaining goes to 0 |
| `rate_limits` key format | `prompt_assistant:<org>:<YYYY-MM-DD>` (matches edge-function fallback) |
| Both RPCs | `security_type=DEFINER` |
| Edge function | listed ACTIVE, `verify_jwt=true`, version 1 |

## Plan ladder (trusted, in edge function)

| slug       | daily limit |
|------------|-------------|
| starter    | 15 |
| growth     | 25 |
| pro        | 40 |
| pro_sim    | 40 (internal simulator) |
| free_trial | 15 (legacy; treated as starter-tier) |

`billing_plans.limits.prompt_assistant_daily_limit` (numeric) overrides the
ladder when present.
