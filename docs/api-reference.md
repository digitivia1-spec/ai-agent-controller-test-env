# Digitivia AI Agent — Public API Reference (v1)

Base URL: `https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/api-v1`

## Authentication

All requests require an API key via the `X-API-Key` header:

```
X-API-Key: dk_live_your_api_key_here
```

API keys can be created in **Settings → API Keys** within the dashboard.

---

## Endpoints

### Agents

#### List Agents
```
GET /agents
```
Returns all configured AI agents for your organization.

**Response:**
```json
{
  "data": [
    {
      "agent": "website",
      "system_prompt": "You are...",
      "tone": "professional",
      "is_active": true
    }
  ]
}
```

---

### Leads (CRM)

#### List Leads
```
GET /leads?limit=50&offset=0&status=new
```

| Param | Type | Description |
|-------|------|-------------|
| `limit` | int | Max results (default 50) |
| `offset` | int | Pagination offset (default 0) |
| `status` | string | Filter by status: new, contacted, qualified, negotiation, proposal, follow_up, won, lost |

**Response:**
```json
{
  "data": [...],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

#### Create Lead
```
POST /leads
Content-Type: application/json

{
  "name": "John Doe",
  "phone": "+1234567890",
  "email": "john@example.com",
  "status": "new",
  "source": "api",
  "category": "enterprise",
  "priority": "high",
  "notes": "Interested in Growth plan"
}
```

---

### Conversations

#### List Conversations
```
GET /conversations?limit=50&platform=whatsapp
```

| Param | Type | Description |
|-------|------|-------------|
| `limit` | int | Max results (default 50) |
| `platform` | string | Filter: whatsapp, messenger, instagram, telegram, website |

---

### Messages

#### Send Message
```
POST /messages
Content-Type: application/json

{
  "conversation_id": "uuid-here",
  "content": "Hello! How can I help you today?"
}
```

---

### Tickets

#### List Tickets
```
GET /tickets?limit=50&status=open
```

| Param | Type | Description |
|-------|------|-------------|
| `limit` | int | Max results (default 50) |
| `status` | string | Filter: open, in_progress, waiting, resolved, closed |

#### Create Ticket
```
POST /tickets
Content-Type: application/json

{
  "subject": "Billing issue",
  "description": "Customer cannot complete checkout",
  "priority": "high",
  "category": "billing",
  "customer_name": "Jane Smith",
  "customer_email": "jane@example.com"
}
```

---

## Rate Limits

| Plan | Requests/minute |
|------|----------------|
| Starter | 60 |
| Growth | 200 |
| Enterprise | 1000 |

## Error Responses

```json
{
  "error": "Description of the error"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (missing required fields) |
| 401 | Missing API key |
| 403 | Invalid or expired API key |
| 404 | Unknown endpoint |
| 500 | Server error |
