import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import postgres from "npm:postgres@3.4.7";

type SecretRow = {
  name: string;
  decrypted_secret: string;
};

type NotificationRow = {
  id: string;
  org_id: string;
  type: string | null;
  title: string | null;
  message: string | null;
  link: string | null;
  event_key: string | null;
  payload: Record<string, unknown> | null;
};

type OrgRow = {
  id: string;
  name: string | null;
};

type EmailLogInsert = {
  org_id: string;
  notification_id: string | null;
  event_key: string | null;
  recipient_email: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  provider: string;
  provider_message_id?: string | null;
  error_message?: string | null;
  payload?: Record<string, unknown>;
};

type RecentMessageSummary = {
  contact_name?: string | null;
  platform?: string | null;
  content?: string | null;
  created_at?: string | null;
};

const jsonHeaders = {
  "Content-Type": "application/json",
};

const DEFAULT_APP_BASE_URL = "https://ai-agent.digitivia.com";
const DEFAULT_FROM_NAME = "Digitivia";
const EMAILABLE_EVENT_KEYS = new Set([
  "order_created",
  "order_live",
  "meeting_created",
  "meeting_confirmed",
  "meeting_rescheduled",
  "meeting_cancelled",
  "meeting_no_show",
  "login_detected",
  "welcome_email",
  "inbox_messages_threshold",
  "team_invitation_sent",
  "team_member_joined",
  "crm_lead_assigned",
  "crm_due_date_set",
  "task_assigned",
  "task_created",
  "task_updated",
  "task_completed",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toTitleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

function dedupeEmails(values: string[]) {
  return [...new Set(values.map(normalizeEmail).filter(isValidEmail))];
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function formatDateTime(value: unknown) {
  if (!value) return "--";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCurrency(amount: unknown, currency: unknown) {
  const numericAmount = Number(amount ?? 0);
  const safeCurrency = String(currency || "EGP").toUpperCase();
  if (!Number.isFinite(numericAmount)) return `-- ${safeCurrency}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch (_error) {
    return `${numericAmount.toFixed(2)} ${safeCurrency}`;
  }
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n\r]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveAppUrl(rawLink: string | null | undefined, appBaseUrl: string) {
  const base = new URL(appBaseUrl);
  if (!rawLink) return base.href;
  if (rawLink.startsWith("#")) return `${base.origin}${base.pathname}${rawLink}`;
  try {
    return new URL(rawLink, base.href).href;
  } catch (_error) {
    return base.href;
  }
}

function renderSummaryValue(value: string) {
  const safeValue = String(value || "");
  if (!safeValue || safeValue === "--") return escapeHtml(safeValue);
  if (isValidEmail(safeValue)) {
    const email = normalizeEmail(safeValue);
    return `<a href=\"mailto:${escapeHtml(email)}\">${escapeHtml(safeValue)}</a>`;
  }
  if (/^https?:\/\//i.test(safeValue)) {
    return `<a href=\"${escapeHtml(safeValue)}\">${escapeHtml(safeValue)}</a>`;
  }
  return escapeHtml(safeValue);
}

async function isEmailChannelEnabled(
  sql: postgres.Sql<Record<string, unknown>>,
  orgId: string,
  eventKey: string | null,
) {
  if (!eventKey) return true;
  const rows = await sql<Array<{ enabled: boolean | null }>>`
    select public.is_notification_channel_enabled(
      ${orgId}::uuid,
      ${eventKey}::text,
      'email'
    ) as enabled
  `;
  return Boolean(rows[0]?.enabled ?? true);
}

function buildKeyValueRows(items: Array<{ label: string; value: string }>) {
  return items
    .filter((item) => item.value && item.value !== "--")
    .map((item) => `
      <tr>
        <td class=\"summary-label\" style=\"padding:18px 0;border-bottom:1px solid #edf2f8;color:#7d8aa2;font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;line-height:16px;letter-spacing:0.18em;text-transform:uppercase;font-weight:800;vertical-align:top;width:180px;\">${escapeHtml(item.label)}</td>
        <td class=\"summary-value\" style=\"padding:18px 0;border-bottom:1px solid #edf2f8;color:#122033;font-family:Arial,'Helvetica Neue',sans-serif;font-size:15px;line-height:24px;font-weight:700;\">${renderSummaryValue(item.value)}</td>
      </tr>
    `)
    .join("");
}

function buildItemList(title: string, rows: string[]) {
  if (!rows.length) return "";
  return `
    <div style=\"margin:34px 0 0;\">
      <div class=\"section-label\" style=\"font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;line-height:11px;letter-spacing:0.22em;text-transform:uppercase;font-weight:800;color:#95a2b8;\">${escapeHtml(title)}</div>
      <div style=\"margin-top:14px;border:1px solid #edf2f8;border-radius:22px;overflow:hidden;background:#f8fbff;box-shadow:0 12px 30px rgba(14,22,40,0.05);\">
        ${rows.join("")}
      </div>
    </div>
  `;
}

function renderShell({
  preheader,
  eyebrow,
  title,
  intro,
  ctaLabel,
  ctaUrl,
  summaryRows,
  detailsRows,
  tips,
  footer,
}: {
  preheader: string;
  eyebrow: string;
  title: string;
  intro: string;
  ctaLabel?: string;
  ctaUrl?: string;
  summaryRows?: Array<{ label: string; value: string }>;
  detailsRows?: string[];
  tips?: string[];
  footer?: string;
}) {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro).replace(/\n/g, "<br />");

  const summaryBlock = summaryRows?.length
    ? `
      <div style=\"margin-top:34px;padding:30px;border-radius:30px;background:linear-gradient(150deg,#f7fbff 0%,#edf5ff 100%);border:1px solid #dce7f7;box-shadow:0 20px 42px rgba(11,31,63,0.08);\">
        <div style=\"font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;line-height:11px;letter-spacing:0.22em;text-transform:uppercase;font-weight:800;color:#95a2b8;\">Summary</div>
        <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"margin-top:16px;border-collapse:collapse;\">
          <tbody>
            ${buildKeyValueRows(summaryRows)}
          </tbody>
        </table>
      </div>
    `
    : "";

  const detailsBlock = detailsRows?.length
    ? buildItemList("Details", detailsRows)
    : "";

  const tipsBlock = tips?.length
    ? buildItemList(
        "Recommended Actions",
        tips.map((tip) => `
          <div style=\"padding:16px 20px;border-bottom:1px solid #edf2f8;font-family:Arial,'Helvetica Neue',sans-serif;font-size:14px;line-height:22px;color:#1f2b3d;\">${escapeHtml(tip)}</div>
        `),
      )
    : "";

  const ctaBlock = ctaLabel && ctaUrl
    ? `
      <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin-top:36px;\">
        <tr>
          <td>
            <a href=\"${escapeHtml(ctaUrl)}\" style=\"display:inline-block;padding:14px 32px;border-radius:999px;background:linear-gradient(135deg,#2152ff 0%,#4f7dff 100%);color:#ffffff;text-decoration:none;font-family:Arial,'Helvetica Neue',sans-serif;font-size:14px;font-weight:700;line-height:20px;letter-spacing:0.01em;box-shadow:0 14px 26px rgba(33,82,255,0.32);\">${escapeHtml(ctaLabel)}</a>
          </td>
        </tr>
      </table>
    `
    : "";

  const footerBlock = footer
    ? `<p style=\"margin:34px 0 0;font-family:Arial,'Helvetica Neue',sans-serif;font-size:13px;line-height:22px;color:#7d8aa2;\">${escapeHtml(footer)}</p>`
    : "";

  const preheaderText = escapeHtml(preheader || title);

  const html = `
<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
    <title>${safeTitle}</title>
  </head>
  <body style=\"margin:0;padding:0;background:radial-gradient(circle at top,#eaf1ff 0%,#f3f7ff 38%,#f6f8fc 100%);\">
    <div style=\"display:none;font-size:1px;color:#f6f8fc;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;\">${preheaderText}</div>

    <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"padding:26px 14px;\">
      <tr>
        <td align=\"center\">
          <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"max-width:640px;background:#ffffff;border-radius:34px;overflow:hidden;border:1px solid #e3e9f4;box-shadow:0 28px 52px rgba(14,26,46,0.14);\">
            <tr>
              <td style=\"padding:48px 42px 44px;\">
                <div style=\"display:inline-flex;align-items:center;gap:10px;padding:9px 18px;border-radius:999px;background:#eef4ff;border:1px solid #d8e4ff;color:#2857d4;font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;\">${escapeHtml(eyebrow)}</div>

                <h1 style=\"margin:22px 0 0;font-family:Arial,'Helvetica Neue',sans-serif;font-size:32px;line-height:40px;color:#101e33;font-weight:800;letter-spacing:-0.02em;\">${safeTitle}</h1>

                <p style=\"margin:18px 0 0;font-family:Arial,'Helvetica Neue',sans-serif;font-size:15px;line-height:25px;color:#51637d;max-width:520px;\">${safeIntro}</p>

                ${summaryBlock}
                ${detailsBlock}
                ${tipsBlock}
                ${ctaBlock}
                ${footerBlock}

                <p style=\"margin:36px 0 0;font-family:Arial,'Helvetica Neue',sans-serif;font-size:12px;line-height:20px;color:#94a0b4;\">This alert was sent by Digitivia AI Agent. You are receiving it because this email channel is enabled for your organization.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const text = [
    title,
    "",
    intro,
    "",
    ...(summaryRows?.length
      ? [
          "Summary:",
          ...summaryRows.map((row) => `${row.label}: ${row.value}`),
          "",
        ]
      : []),
    ...(detailsRows?.length
      ? [
          "Details:",
          ...detailsRows.map((row) => stripHtml(row)),
          "",
        ]
      : []),
    ...(tips?.length
      ? [
          "Recommended actions:",
          ...tips,
          "",
        ]
      : []),
    ctaLabel && ctaUrl ? `${ctaLabel}: ${ctaUrl}` : "",
    "",
    footer || "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { html, text };
}

function toUuid(value: unknown) {
  const candidate = String(value || "").trim();
  if (!candidate) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

async function loadSecrets(sql: postgres.Sql<Record<string, unknown>>) {
  // Vault stores these under lowercase names (mail_google_*, mail_sender_*, app_base_url).
  // We also read the legacy uppercase names as a fallback for backward compatibility.
  const rows = await sql<SecretRow[]>`
    select name, decrypted_secret
    from vault.decrypted_secrets
    where name in (
      'mail_google_client_id',
      'mail_google_client_secret',
      'mail_google_refresh_token',
      'mail_sender_email',
      'mail_sender_name',
      'app_base_url',
      'GMAIL_OAUTH_CLIENT_ID',
      'GMAIL_OAUTH_CLIENT_SECRET',
      'GMAIL_OAUTH_REFRESH_TOKEN',
      'GMAIL_FROM_EMAIL',
      'GMAIL_FROM_NAME',
      'APP_BASE_URL'
    )
  `;

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.name && row.decrypted_secret != null) {
      map.set(row.name, row.decrypted_secret);
    }
  }

  const pick = (...names: string[]) => {
    for (const name of names) {
      const v = map.get(name) ?? Deno.env.get(name) ?? "";
      if (v) return v;
    }
    return "";
  };

  const oauthClientId = pick("mail_google_client_id", "GMAIL_OAUTH_CLIENT_ID");
  const oauthClientSecret = pick("mail_google_client_secret", "GMAIL_OAUTH_CLIENT_SECRET");
  const oauthRefreshToken = pick("mail_google_refresh_token", "GMAIL_OAUTH_REFRESH_TOKEN");
  const fromEmail = pick("mail_sender_email", "GMAIL_FROM_EMAIL");
  const fromName = pick("mail_sender_name", "GMAIL_FROM_NAME") || DEFAULT_FROM_NAME;
  const appBaseUrl = pick("app_base_url", "APP_BASE_URL") || DEFAULT_APP_BASE_URL;

  return {
    oauthClientId,
    oauthClientSecret,
    oauthRefreshToken,
    fromEmail,
    fromName,
    appBaseUrl,
  };
}

async function loadNotification(
  sql: postgres.Sql<Record<string, unknown>>,
  notificationId: string,
): Promise<NotificationRow | null> {
  const rows = await sql<NotificationRow[]>`
    select
      id::text,
      org_id::text,
      type,
      title,
      message,
      link,
      event_key,
      payload
    from public.notifications
    where id = ${notificationId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

async function loadOrg(sql: postgres.Sql<Record<string, unknown>>, orgId: string): Promise<OrgRow | null> {
  const rows = await sql<OrgRow[]>`
    select id::text, name
    from public.organizations
    where id = ${orgId}::uuid
    limit 1
  `;
  return rows[0] ?? null;
}

async function resolveUserEmail(
  sql: postgres.Sql<Record<string, unknown>>,
  userId: unknown,
): Promise<string | null> {
  const id = toUuid(userId);
  if (!id) return null;
  const rows = await sql<Array<{ email: string | null }>>`
    select lower(trim(u.email)) as email
    from auth.users u
    where u.id = ${id}::uuid
    limit 1
  `;
  const email = rows[0]?.email || null;
  return email && isValidEmail(email) ? email : null;
}

async function loadRecipients(
  sql: postgres.Sql<Record<string, unknown>>,
  orgId: string,
  notification: NotificationRow,
) {
  const payload = notification.payload || {};
  const explicitRecipients = dedupeEmails(parseStringArray(payload.recipients));
  if (explicitRecipients.length) {
    return explicitRecipients;
  }
  const alternateRecipients = dedupeEmails(parseStringArray(payload.recipient_emails));
  if (alternateRecipients.length) {
    return alternateRecipients;
  }

  if (notification.event_key === "team_invitation_sent") {
    const invited = String(payload.invited_email || "").trim();
    if (isValidEmail(invited)) return [normalizeEmail(invited)];
  }

  if (notification.event_key === "login_detected") {
    const direct = String(payload.user_email || "").trim();
    if (isValidEmail(direct)) return [normalizeEmail(direct)];
  }

  // Task/CRM assignment events: prefer the assignee's email
  if (
    notification.event_key === "task_assigned" ||
    notification.event_key === "crm_lead_assigned"
  ) {
    const direct = String(payload.assignee_email || payload.assigned_to_email || "").trim();
    if (isValidEmail(direct)) return [normalizeEmail(direct)];
    const byUser = await resolveUserEmail(sql, payload.assigned_to ?? payload.recipient_user_id);
    if (byUser) return [byUser];
  }

  // CRM due-date set: notify the user who scheduled it (recipient_user_id is the actor)
  if (notification.event_key === "crm_due_date_set") {
    const byUser = await resolveUserEmail(sql, payload.recipient_user_id);
    if (byUser) return [byUser];
  }

  // Generic: a notification may be user-targeted via payload.recipient_user_id
  const byUser = await resolveUserEmail(sql, payload.recipient_user_id);
  if (byUser) return [byUser];

  const rows = await sql<Array<{ email: string | null }>>`
    select distinct lower(trim(u.email)) as email
    from public.organization_members om
    join auth.users u on u.id = om.user_id
    where om.org_id = ${orgId}::uuid
      and om.role in ('owner', 'moderator')
      and coalesce(trim(u.email), '') <> ''
  `;

  const emails = rows
    .map((row) => String(row.email || "").trim())
    .filter((email) => isValidEmail(email));

  return dedupeEmails(emails);
}

function buildOrderSummary(payload: Record<string, unknown>) {
  const customerName = String(payload.customer_name || payload.customerName || "--");
  const customerEmail = String(payload.customer_email || payload.customerEmail || "--");
  const customerPhone = String(payload.customer_phone || payload.customerPhone || "--");
  const packageName = String(payload.package_name || payload.packageName || "--");
  const serviceName = String(payload.service_name || payload.serviceName || "--");
  const total = formatCurrency(
    payload.total_price ?? payload.total ?? payload.amount ?? payload.total_amount,
    payload.currency,
  );
  const status = toTitleCase(String(payload.status || payload.order_status || "new"));
  const notes = String(payload.notes || payload.note || "").trim();
  const meetingDateRaw = payload.meeting_date || payload.meetingDate || payload.scheduled_at;

  const summaryRows = [
    { label: "Customer", value: customerName },
    { label: "Email", value: customerEmail },
    { label: "Phone", value: customerPhone },
    { label: "Package", value: packageName },
    { label: "Service", value: serviceName },
    { label: "Total", value: total },
    { label: "Status", value: status },
  ];

  if (meetingDateRaw) {
    summaryRows.push({ label: "Preferred meeting", value: formatDateTime(meetingDateRaw) });
  }

  const tips = [
    "Confirm the order details with the customer.",
    "Coordinate scheduling and assign an owner to follow up.",
  ];

  if (notes) {
    tips.unshift(`Customer note: ${notes}`);
  }

  return { summaryRows, tips };
}

function buildMeetingSummary(payload: Record<string, unknown>) {
  const attendeeName = String(
    payload.contact_name || payload.customer_name || payload.attendee_name || payload.name || "--",
  );
  const attendeeEmail = String(
    payload.contact_email || payload.customer_email || payload.attendee_email || payload.email || "--",
  );
  const attendeePhone = String(
    payload.contact_phone || payload.customer_phone || payload.attendee_phone || payload.phone || "--",
  );
  const meetingType = toTitleCase(String(payload.meeting_type || payload.type || "Consultation"));
  const platform = String(payload.platform || payload.channel || "--");
  const meetingTime = formatDateTime(payload.starts_at || payload.start_time || payload.scheduled_at || payload.meeting_date || payload.date);
  const meetingLink = String(payload.meeting_link || payload.meeting_url || payload.link || "");
  const reason = String(payload.reason || payload.notes || payload.topic || "").trim();

  const summaryRows = [
    { label: "Attendee", value: attendeeName },
    { label: "Email", value: attendeeEmail },
    { label: "Phone", value: attendeePhone },
    { label: "Meeting type", value: meetingType },
    { label: "Platform", value: platform },
    { label: "Time", value: meetingTime },
  ];

  if (meetingLink) {
    summaryRows.push({ label: "Join link", value: meetingLink });
  }

  const tips = [
    "Review attendee context before the session.",
    "Share meeting link and confirmation details with the attendee.",
  ];

  if (reason) {
    tips.unshift(`Context: ${reason}`);
  }

  return { summaryRows, tips };
}

function buildInboxThresholdSummary(payload: Record<string, unknown>) {
  const pending = Number(payload.pending_inbound ?? payload.pending_messages ?? payload.count ?? 40);
  const threshold = Number(payload.threshold ?? 40);
  const latestMessages = Array.isArray(payload.recent_messages)
    ? (payload.recent_messages as RecentMessageSummary[])
    : [];

  const summaryRows = [
    {
      label: "Pending inbound",
      value: Number.isFinite(pending) ? String(pending) : "--",
    },
    {
      label: "Alert threshold",
      value: Number.isFinite(threshold) ? String(threshold) : "40",
    },
  ];

  const detailsRows = latestMessages.slice(0, 5).map((item) => {
    const contact = item.contact_name || "Unknown";
    const platform = item.platform || "inbox";
    const content = String(item.content || "").trim() || "(No preview available)";
    const createdAt = formatDateTime(item.created_at || null);
    return `
      <div style=\"padding:18px 20px;border-bottom:1px solid #edf2f8;\">
        <div style=\"font-family:Arial,'Helvetica Neue',sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#122033;\">${escapeHtml(contact)} <span style=\"font-weight:600;color:#6f7f96;\">(${escapeHtml(platform)})</span></div>
        <div style=\"margin-top:6px;font-family:Arial,'Helvetica Neue',sans-serif;font-size:13px;line-height:21px;color:#334764;\">${escapeHtml(content)}</div>
        <div style=\"margin-top:4px;font-family:Arial,'Helvetica Neue',sans-serif;font-size:12px;line-height:18px;color:#90a0b8;\">${escapeHtml(createdAt)}</div>
      </div>
    `;
  });

  const tips = [
    "Reply to high-priority inbound messages first.",
    "Assign inbox ownership and clear the backlog.",
  ];

  return { summaryRows, detailsRows, tips };
}

function buildLoginSummary(payload: Record<string, unknown>) {
  const userName = String(payload.user_name || payload.user || payload.name || "there");
  const userEmail = String(payload.user_email || payload.email || "--");
  const ipAddress = String(payload.ip_address || payload.ip || "--");
  const location = String(payload.location || payload.city || "--");
  const device = String(payload.device || payload.user_agent || "--");
  const loginTime = formatDateTime(payload.logged_in_at || payload.created_at || new Date().toISOString());

  const summaryRows = [
    { label: "Member", value: userName },
    { label: "Email", value: userEmail },
    { label: "Login time", value: loginTime },
    { label: "IP", value: ipAddress },
    { label: "Location", value: location },
    { label: "Device", value: device },
  ];

  const tips = [
    "If this was you, no further action is needed.",
    "If this was not you, reset your password and review active sessions immediately.",
  ];

  return { summaryRows, tips };
}

function buildWelcomeSummary(payload: Record<string, unknown>) {
  const userName = String(payload.user_name || payload.name || "there");
  const workspace = String(payload.org_name || payload.organization || payload.workspace || "your organization");

  const summaryRows = [
    { label: "Member", value: userName },
    { label: "Workspace", value: workspace },
  ];

  const tips = [
    "Open your profile to review notification preferences.",
    "Connect inbox channels and complete onboarding tasks.",
  ];

  return { summaryRows, tips };
}

function buildInvitationSummary(payload: Record<string, unknown>) {
  const orgName = String(payload.organization_name || payload.org_name || "your organization");
  const inviterName = String(payload.inviter_name || payload.invited_by_name || "A teammate");
  const invitedName = String(payload.invited_name || payload.invited_full_name || "").trim();
  const invitedEmail = String(payload.invited_email || payload.invitee_email || "--");
  const role = toTitleCase(String(payload.role || "member"));

  const summaryRows = [
    { label: "Organization", value: orgName },
    { label: "Invited by", value: inviterName },
    { label: "Role", value: role },
    { label: "Email", value: invitedEmail },
  ];

  if (invitedName) {
    summaryRows.splice(3, 0, { label: "Name", value: invitedName });
  }

  const tips = [
    "Click Accept invitation to set up your account and join the workspace.",
    "If you did not expect this invitation you can safely ignore this email.",
  ];

  return { summaryRows, tips };
}

function buildTaskSummary(payload: Record<string, unknown>) {
  const title = String(payload.task_title || payload.title || "Untitled task");
  const status = toTitleCase(String(payload.status || "open"));
  const priority = toTitleCase(String(payload.priority || "normal"));
  const due = payload.due_date || payload.due_at || payload.deadline;
  const assignedTo = String(payload.assignee_name || payload.assigned_to_name || "--");
  const assignedBy = String(payload.assigner_name || payload.assigned_by_name || "--");
  const notes = String(payload.description || payload.notes || "").trim();

  const summaryRows = [
    { label: "Task", value: title },
    { label: "Status", value: status },
    { label: "Priority", value: priority },
    { label: "Due", value: due ? formatDateTime(due) : "--" },
    { label: "Assigned to", value: assignedTo },
    { label: "Assigned by", value: assignedBy },
  ];

  const tips = [
    "Open the task to review details and timeline.",
    "Update the status as you make progress.",
  ];

  if (notes) {
    tips.unshift(`Context: ${notes}`);
  }

  return { summaryRows, tips };
}

function buildLeadSummary(payload: Record<string, unknown>) {
  const lead = String(payload.lead_name || payload.name || "New lead");
  const source = toTitleCase(String(payload.source || "--"));
  const status = toTitleCase(String(payload.status || "new"));
  const assignedTo = String(payload.assignee_name || payload.assigned_to_name || "--");
  const leadEmail = String(payload.lead_email || payload.email || "--");
  const leadPhone = String(payload.lead_phone || payload.phone || "--");

  const summaryRows = [
    { label: "Lead", value: lead },
    { label: "Email", value: leadEmail },
    { label: "Phone", value: leadPhone },
    { label: "Source", value: source },
    { label: "Status", value: status },
    { label: "Assigned to", value: assignedTo },
  ];

  const tips = [
    "Reach out to the lead while the context is fresh.",
    "Log the first contact attempt in the CRM.",
  ];

  return { summaryRows, tips };
}

function buildDueDateSummary(payload: Record<string, unknown>) {
  const lead = String(payload.lead_name || payload.name || "Lead");
  const source = toTitleCase(String(payload.source || "--"));
  const leadEmail = String(payload.lead_email || payload.email || "--");
  const leadPhone = String(payload.lead_phone || payload.phone || "--");
  const dueLocal = String(payload.due_at_local || "").trim();
  const dueDisplay = dueLocal || formatDateTime(payload.due_at || payload.due_date);

  const summaryRows = [
    { label: "Lead", value: lead },
    { label: "Due", value: dueDisplay },
    { label: "Phone", value: leadPhone },
    { label: "Email", value: leadEmail },
    { label: "Platform", value: source },
  ];

  const tips = [
    "Add the due date to your calendar so you don't miss it.",
    "Prepare any context or follow-up materials before the due date.",
  ];

  return { summaryRows, tips };
}

function buildTeamJoinedSummary(payload: Record<string, unknown>) {
  const member = String(payload.member_name || payload.name || "New teammate");
  const email = String(payload.member_email || payload.email || "--");
  const role = toTitleCase(String(payload.member_role || payload.role || "member"));
  const joinedAt = formatDateTime(payload.joined_at || payload.created_at || new Date().toISOString());

  const summaryRows = [
    { label: "Member", value: member },
    { label: "Email", value: email },
    { label: "Role", value: role },
    { label: "Joined", value: joinedAt },
  ];

  const tips = [
    "Welcome the new teammate and share onboarding resources.",
    "Assign initial tasks or projects to help them ramp up.",
  ];

  return { summaryRows, tips };
}

function buildEmailContent(
  notification: NotificationRow,
  org: OrgRow,
  appBaseUrl: string,
) {
  const payload = notification.payload || {};
  const eventKey = notification.event_key || "";
  const orgName = org.name || "your organization";
  const defaultUrl = resolveAppUrl(notification.link, appBaseUrl);

  const title = String(notification.title || "Notification");
  const message = String(notification.message || "You have a new update.");

  if (eventKey === "order_created" || eventKey === "order_live") {
    const { summaryRows, tips } = buildOrderSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "Orders",
        title,
        intro: message,
        ctaLabel: "Open Order Board",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "Keep response times tight to maintain conversion momentum.",
      }),
    };
  }

  if (
    eventKey === "meeting_created" ||
    eventKey === "meeting_confirmed" ||
    eventKey === "meeting_rescheduled" ||
    eventKey === "meeting_cancelled" ||
    eventKey === "meeting_no_show"
  ) {
    const { summaryRows, tips } = buildMeetingSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "Meetings",
        title,
        intro: message,
        ctaLabel: "Open Calendar",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "Meeting changes have been synced with your workspace timeline.",
      }),
    };
  }

  if (eventKey === "inbox_messages_threshold") {
    const { summaryRows, detailsRows, tips } = buildInboxThresholdSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "Inbox",
        title,
        intro: message,
        ctaLabel: "Open Inbox",
        ctaUrl: defaultUrl,
        summaryRows,
        detailsRows,
        tips,
        footer: "This alert will continue if the backlog remains above the configured threshold.",
      }),
    };
  }

  if (eventKey === "login_detected") {
    const { summaryRows, tips } = buildLoginSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: "Welcome back. Your login was successful.",
        eyebrow: "Account",
        title: title || "Welcome Back",
        intro: message || "Welcome back to Digitivia. Your account sign-in was successful.",
        ctaLabel: "Open Workspace",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "This account login email can be toggled from organization notification settings.",
      }),
    };
  }

  if (eventKey === "welcome_email") {
    const { summaryRows, tips } = buildWelcomeSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "Welcome",
        title,
        intro: message,
        ctaLabel: "Open Workspace",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "Need help? Reply to this email and our team will assist.",
      }),
    };
  }

  if (eventKey === "team_invitation_sent") {
    const { summaryRows, tips } = buildInvitationSummary(payload);
    const acceptUrlRaw = String(payload.accept_url || payload.invitation_url || "").trim();
    const acceptUrl = acceptUrlRaw ? resolveAppUrl(acceptUrlRaw, appBaseUrl) : defaultUrl;
    const invitedName = String(payload.invited_name || "").trim();
    const inviterName = String(payload.inviter_name || "Your teammate");
    const orgDisplay = String(payload.organization_name || orgName);
    const headline = `You're invited to join ${orgDisplay}`;
    const intro = invitedName
      ? `Hi ${invitedName}, ${inviterName} has invited you to join ${orgDisplay} on Digitivia. Accept the invitation to set up your account and start collaborating.`
      : `${inviterName} has invited you to join ${orgDisplay} on Digitivia. Accept the invitation to set up your account and start collaborating.`;
    return {
      subject: `Invitation to join ${orgDisplay} on Digitivia`,
      ...renderShell({
        preheader: `${inviterName} invited you to ${orgDisplay} on Digitivia`,
        eyebrow: "Team Invitation",
        title: headline,
        intro,
        ctaLabel: "Accept invitation",
        ctaUrl: acceptUrl,
        summaryRows,
        tips,
        footer: "This invitation link will expire for your security. If it has expired, ask your teammate to resend it.",
      }),
    };
  }

  if (
    eventKey === "task_assigned" ||
    eventKey === "task_created" ||
    eventKey === "task_updated" ||
    eventKey === "task_completed"
  ) {
    const { summaryRows, tips } = buildTaskSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "Tasks",
        title,
        intro: message,
        ctaLabel: "Open Task",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "Task updates keep your team aligned on what needs to happen next.",
      }),
    };
  }

  if (eventKey === "crm_lead_assigned") {
    const { summaryRows, tips } = buildLeadSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "CRM",
        title,
        intro: message,
        ctaLabel: "Open Lead",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "Reach out promptly for the best chance of conversion.",
      }),
    };
  }

  if (eventKey === "crm_due_date_set") {
    const { summaryRows, tips } = buildDueDateSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "CRM · Due Date",
        title,
        intro: message,
        ctaLabel: "Open Lead",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "You'll see this lead surface in your CRM when the due date approaches.",
      }),
    };
  }

  if (eventKey === "team_member_joined") {
    const { summaryRows, tips } = buildTeamJoinedSummary(payload);
    return {
      subject: `${title} · ${orgName}`,
      ...renderShell({
        preheader: message,
        eyebrow: "Team",
        title,
        intro: message,
        ctaLabel: "Open Team",
        ctaUrl: defaultUrl,
        summaryRows,
        tips,
        footer: "A warm welcome helps new teammates ramp up faster.",
      }),
    };
  }

  return {
    subject: `${title} · ${orgName}`,
    ...renderShell({
      preheader: message,
      eyebrow: "Notification",
      title,
      intro: message,
      ctaLabel: "Open Workspace",
      ctaUrl: defaultUrl,
      summaryRows: [
        { label: "Organization", value: orgName },
        { label: "Event", value: eventKey || "general" },
      ],
    }),
  };
}

async function sendViaGmailApi({
  accessToken,
  fromEmail,
  fromName,
  recipient,
  subject,
  html,
  text,
}: {
  accessToken: string;
  fromEmail: string;
  fromName: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
}) {
  const boundary = `digitivia-${crypto.randomUUID()}`;
  const plainBody = text || stripHtml(html);

  const rawMessage = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    plainBody,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  const encoded = base64UrlEncode(rawMessage);

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Gmail API error (${response.status}): ${body}`);
  }

  const parsed = JSON.parse(body) as { id?: string };
  return parsed.id || null;
}

async function writeEmailLog(
  sql: postgres.Sql<Record<string, unknown>>,
  log: EmailLogInsert,
) {
  const payload = JSON.parse(JSON.stringify(log.payload ?? {}));
  await sql`
    insert into public.email_notification_logs (
      org_id,
      notification_id,
      event_key,
      recipient_email,
      subject,
      status,
      provider,
      provider_message_id,
      error_message,
      payload
    ) values (
      ${log.org_id}::uuid,
      ${log.notification_id ? `${log.notification_id}` : null}::uuid,
      ${log.event_key},
      ${log.recipient_email},
      ${log.subject},
      ${log.status},
      ${log.provider},
      ${log.provider_message_id ?? null},
      ${log.error_message ?? null},
      ${sql.json(payload)}
    )
  `;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  let sql: postgres.Sql<Record<string, unknown>> | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const notificationId = toUuid(body?.notification_id);
    // When true, the caller (e.g. test email RPC) asks us to bypass the channel policy.
    const bypassChannelCheck = Boolean(body?.bypass_channel_check);

    if (!notificationId) {
      return jsonResponse({ ok: false, error: "notification_id is required" }, 400);
    }

    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!dbUrl || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ ok: false, error: "Missing required environment configuration" }, 500);
    }

    sql = postgres(dbUrl, { prepare: false });
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
      global: { headers: { "X-Client-Info": "digitivia-send-email-notification" } },
    });

    const notification = await loadNotification(sql, notificationId);
    if (!notification) {
      return jsonResponse({ ok: false, error: "Notification not found" }, 404);
    }

    const eventKey = notification.event_key || null;
    const emailEnabled = bypassChannelCheck
      ? true
      : await isEmailChannelEnabled(sql, notification.org_id, eventKey);

    if (!emailEnabled) {
      const skipPayload = {
        reason: "channel_disabled",
        event_key: eventKey,
        channel: "email",
      };

      await writeEmailLog(sql, {
        org_id: notification.org_id,
        notification_id: notification.id,
        event_key: eventKey,
        recipient_email: "n/a",
        subject: notification.title || "Notification",
        status: "skipped",
        provider: "policy",
        payload: skipPayload,
      });

      return jsonResponse({
        ok: true,
        status: "skipped",
        reason: "email_channel_disabled",
        event_key: eventKey,
      });
    }

    if (eventKey && !EMAILABLE_EVENT_KEYS.has(eventKey)) {
      return jsonResponse({
        ok: true,
        status: "ignored",
        reason: "event_not_emailable",
        event_key: eventKey,
      });
    }

    const org = await loadOrg(sql, notification.org_id);
    if (!org) {
      return jsonResponse({ ok: false, error: "Organization not found" }, 404);
    }

    const recipients = await loadRecipients(sql, notification.org_id, notification);
    if (!recipients.length) {
      await writeEmailLog(sql, {
        org_id: notification.org_id,
        notification_id: notification.id,
        event_key: eventKey,
        recipient_email: "n/a",
        subject: notification.title || "Notification",
        status: "skipped",
        provider: "gmail_api",
        error_message: "No eligible recipients",
      });
      return jsonResponse({ ok: true, status: "skipped", reason: "no_recipients" });
    }

    const secrets = await loadSecrets(sql);
    if (!secrets.fromEmail || !secrets.oauthClientId || !secrets.oauthClientSecret || !secrets.oauthRefreshToken) {
      return jsonResponse({
        ok: false,
        error: "Missing Gmail OAuth credentials (mail_sender_email / mail_google_client_id / mail_google_client_secret / mail_google_refresh_token)",
      }, 500);
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: secrets.oauthClientId,
        client_secret: secrets.oauthClientSecret,
        refresh_token: secrets.oauthRefreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenText = await tokenResponse.text();
    if (!tokenResponse.ok) {
      throw new Error(`Gmail OAuth refresh failed (${tokenResponse.status}): ${tokenText}`);
    }
    const tokenJson = JSON.parse(tokenText) as { access_token?: string };
    const accessToken = tokenJson.access_token || "";
    if (!accessToken) {
      throw new Error("Gmail OAuth refresh did not return access_token");
    }

    const emailContent = buildEmailContent(notification, org, secrets.appBaseUrl);
    let sentCount = 0;
    const failures: Array<{ recipient: string; error: string }> = [];

    for (const recipient of recipients) {
      try {
        const providerMessageId = await sendViaGmailApi({
          accessToken,
          fromEmail: secrets.fromEmail,
          fromName: secrets.fromName,
          recipient,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });

        await writeEmailLog(sql, {
          org_id: notification.org_id,
          notification_id: notification.id,
          event_key: eventKey,
          recipient_email: recipient,
          subject: emailContent.subject,
          status: "sent",
          provider: "gmail_api",
          provider_message_id: providerMessageId,
          payload: {
            org_name: org.name,
            event_key: eventKey,
          },
        });

        sentCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ recipient, error: message });

        await writeEmailLog(sql, {
          org_id: notification.org_id,
          notification_id: notification.id,
          event_key: eventKey,
          recipient_email: recipient,
          subject: emailContent.subject,
          status: "failed",
          provider: "gmail_api",
          error_message: message,
          payload: {
            org_name: org.name,
            event_key: eventKey,
          },
        });
      }
    }

    if (failures.length && sentCount === 0) {
      return jsonResponse({
        ok: false,
        error: "Failed to send email to all recipients",
        recipients: recipients.length,
        failures,
      }, 502);
    }

    const updates: Record<string, unknown> = {
      email_attempted_at: new Date().toISOString(),
      email_status: failures.length ? "partial" : "sent",
      email_sent_count: sentCount,
      email_failure_count: failures.length,
    };

    await supabase
      .from("notifications")
      .update({
        payload: {
          ...(notification.payload || {}),
          delivery: updates,
        },
      })
      .eq("id", notification.id);

    return jsonResponse({
      ok: true,
      status: failures.length ? "partial" : "sent",
      recipients: recipients.length,
      sent: sentCount,
      failed: failures.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-email-notification error", message);
    return jsonResponse({ ok: false, error: message }, 500);
  } finally {
    await sql?.end({ timeout: 2 });
  }
});
