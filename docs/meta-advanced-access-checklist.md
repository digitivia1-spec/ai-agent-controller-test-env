# Meta Advanced Access — Complete Submission Checklist

**Product:** Omnio by Digitivia  
**Date:** 2026-04-28  
**Goal:** Get Advanced Access approval for `whatsapp_business_messaging` and `whatsapp_business_management` permissions  

---

## Part A — Prerequisites (Must Be Done Before You Record)

### A1. Business Verification

- [ ] Go to **Meta Business Suite → Settings → Business Info** and confirm your business is **Verified** (green checkmark).
- [ ] If not verified: upload business documents (incorporation certificate, utility bill, or bank statement matching your legal business name). Verification takes 1–5 business days — you cannot submit for App Review without it.
- [ ] Your Business Manager ID is visible at the top of Business Settings. Note it down.

### A2. App Settings in Meta Developer Dashboard

Open [developers.facebook.com/apps](https://developers.facebook.com/apps) → select your app (App ID: `875686618745863`).

- [ ] **Basic Settings** (`Settings → Basic`):
  - App Display Name is set (e.g. "Omnio by Digitivia")
  - Contact Email is set (e.g. mahmoud@digitivia.com)
  - Privacy Policy URL is set and publicly accessible (e.g. `https://app.omnio.ai/privacy`)
  - Terms of Service URL is set and publicly accessible
  - App Icon is uploaded (1024×1024, no alpha/transparency)
  - Category is set (e.g. "Business and Pages")
  - Business Use is set to "Support my own business" or "Provide services to other businesses" (Solution Provider)

- [ ] **Advanced Settings** (`Settings → Advanced`):
  - App Mode is **Live** (not Development). If still in Development, switch it to Live.

- [ ] **WhatsApp Product** (`WhatsApp → Getting Started`):
  - WhatsApp is added as a product to the app
  - A WABA (WhatsApp Business Account) is linked
  - At least one phone number is registered
  - The Embedded Signup Configuration ID (`1239600244448047`) is active

- [ ] **Webhook Subscriptions**:
  - Page subscriptions → Callback URL = `https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/messenger-webhook`
  - Instagram subscriptions → Callback URL = `https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/instagram-webhook`
  - Verify Token matches `META_VERIFY_TOKEN` secret
  - Fields subscribed: `messages`
  - Webhook verification succeeds (Meta sends a GET with `hub.verify_token`)

### A3. Permissions & Features to Request

You need Advanced Access for these two permissions:

| Permission | What it does | Where you use it |
|---|---|---|
| `whatsapp_business_messaging` | Send/receive WhatsApp messages via Cloud API | Omnio inbox — every WhatsApp conversation uses this |
| `whatsapp_business_management` | Manage WABA, phone numbers, message templates | Onboarding wizard (Embedded Signup), template management panel |

You may also need:

| Permission/Feature | Needed if… |
|---|---|
| `pages_messaging` | You handle Messenger conversations |
| `instagram_basic` + `instagram_manage_messages` | You handle Instagram DM conversations |
| `business_management` | You manage business assets programmatically |

**For each permission, you need a separate screencast and a separate justification.**

### A4. Make at Least One Successful API Call Per Permission

Meta requires proof that your app has made real API calls. Before recording:

**For `whatsapp_business_messaging`:**
- [ ] Send at least one test message via the Cloud API:
  ```
  POST https://graph.facebook.com/v22.0/{phone_number_id}/messages
  Content-Type: application/json
  Authorization: Bearer {your_system_user_token}

  {
    "messaging_product": "whatsapp",
    "to": "{your_test_number}",
    "type": "template",
    "template": { "name": "hello_world", "language": { "code": "en_US" } }
  }
  ```
- [ ] Confirm you received a 200 response with a `wamid` (WhatsApp message ID).
- [ ] Confirm the test phone actually received the message.

**For `whatsapp_business_management`:**
- [ ] Fetch your WABA phone numbers:
  ```
  GET https://graph.facebook.com/v22.0/{waba_id}/phone_numbers
  Authorization: Bearer {your_system_user_token}
  ```
- [ ] Fetch your message templates:
  ```
  GET https://graph.facebook.com/v22.0/{waba_id}/message_templates
  Authorization: Bearer {your_system_user_token}
  ```
- [ ] Confirm both return 200 with real data.

### A5. Prepare the Test Account

Meta reviewers will log in to your app to test. You must provide working credentials.

- [ ] Create a dedicated test user account in Omnio (e.g. `meta-reviewer@digitivia.com`)
- [ ] This account must have:
  - An organization already set up
  - A WhatsApp channel already connected (via Embedded Signup — complete the flow yourself first)
  - At least one conversation visible in the inbox
  - The ability to send a test message from the inbox
  - Access to the message templates panel
- [ ] Test the credentials yourself in an incognito browser window — make sure login works without 2FA blocking, email verification popups, or expired sessions.
- [ ] If your app requires any setup wizard on first login, complete it for the test account so the reviewer lands on the main dashboard.

---

## Part B — Recording the Screencast

### B1. Technical Requirements

Per [Meta's screencast guide](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/):

- [ ] **Format:** MP4 or MOV
- [ ] **Max size:** 120 MB per video
- [ ] **Max length:** No hard limit, but keep it under 5 minutes per permission. Shorter is better.
- [ ] **Resolution:** At least 720p. 1080p recommended.
- [ ] **Audio:** Not required, but helpful if you narrate. If no audio, use on-screen text annotations.
- [ ] **No password entry on camera:** Type credentials off-screen or blur them. Meta explicitly says do not show passwords.
- [ ] **Language:** English preferred for the reviewer.

### B2. What Each Screencast Must Show

**CRITICAL: Record the business-facing interface (your Omnio dashboard), NOT the consumer-facing WhatsApp chat.**

#### Screencast for `whatsapp_business_messaging`:

1. **Login:** Open your app URL (`https://app.omnio.ai`). Log in with the test credentials (blur the password).
2. **Navigate to inbox:** Show the WhatsApp inbox tab with real conversations visible.
3. **Open a conversation:** Click into an existing WhatsApp conversation. Show the message thread.
4. **Send a message:** Type and send a reply to a real WhatsApp contact. Show the message appearing in the thread as "sent" / "delivered."
5. **Receive a message:** If possible, show an incoming message appearing in real-time (have someone send a WhatsApp message to your registered number while recording).
6. **Show the API call proof:** Open the browser DevTools Network tab briefly, filter by `graph.facebook.com`, and show the POST to `/messages` returning 200. This proves the permission is actively used.

#### Screencast for `whatsapp_business_management`:

1. **Login:** Same as above (you can continue from the same session).
2. **Navigate to WhatsApp settings:** Show the WhatsApp agent tab → click "Settings" or "Connect Channel."
3. **Show the Embedded Signup flow:** Click "Continue with Facebook" → show the Meta login popup → show the permission grant screen → show the WABA selection → show the phone number selection → show the connection completing successfully.
4. **Show connected state:** After connecting, show the WABA ID, phone number, verified name displayed in your UI.
5. **Show message templates:** Click "View Message Templates" → show the list of templates loaded from Meta with their status (APPROVED, PENDING, etc.).
6. **Show the API call proof:** Open DevTools Network tab, filter by the template fetch call, show the 200 response with template data.

### B3. Screencast Recording Steps (for Omnio specifically)

1. Open Chrome in incognito mode.
2. Navigate to `https://app.omnio.ai`.
3. Open DevTools (F12) → Network tab → filter by `facebook` or `graph`.
4. In the JS console, run `enableScreencastMode()` to activate the amber screencast banner (this reminds you of the steps and looks professional).
5. Log in with the test reviewer account (blur password).
6. Record with OBS, Loom, or any screen recorder at 1080p.
7. Walk through each flow described in B2 above.
8. Stop recording.
9. In the console, click the ✕ on the screencast banner to dismiss it.

---

## Part C — Permission Justification Text

For each permission, you must write a description explaining why you need it. Meta rejects generic descriptions. Here are specific, accurate justifications for Omnio:

### For `whatsapp_business_messaging`:

> **How our app uses this permission:**
>
> Omnio is a business messaging command center that enables organizations to manage WhatsApp conversations with their customers from a unified inbox. When a customer sends a WhatsApp message to a business's registered phone number, our platform receives the message via the WhatsApp Cloud API webhook and displays it in the business operator's inbox. When the operator replies from our inbox, we use the WhatsApp Cloud API `POST /{phone_number_id}/messages` endpoint to deliver the response to the customer.
>
> Specific API endpoints used:
> - `POST /{phone_number_id}/messages` — Send text, template, and media messages to customers
> - Webhook (`messages` field) — Receive incoming messages and delivery status updates
>
> This permission is essential to our core product functionality. Without it, businesses cannot send or receive WhatsApp messages through our platform.

### For `whatsapp_business_management`:

> **How our app uses this permission:**
>
> Omnio uses the WhatsApp Embedded Signup flow to onboard new business customers onto the WhatsApp Business Platform. During onboarding, the business owner connects their Facebook account, selects or creates a WhatsApp Business Account (WABA), and registers a phone number — all within our application interface.
>
> After onboarding, we use the Business Management API to:
> - `GET /{waba_id}/phone_numbers` — Retrieve registered phone numbers and their verification status
> - `GET /{waba_id}/message_templates` — Fetch and display approved message templates so operators can send template messages from our inbox
> - `POST /{waba_id}/subscribed_apps` — Subscribe our app to receive webhooks for the connected WABA
>
> This permission is required for the onboarding flow (Embedded Signup) and for ongoing template management within our platform.

### Reviewer Instructions (goes in the "Reviewer Instructions" field):

> **Test Account Credentials:**
> - URL: https://app.omnio.ai
> - Email: meta-reviewer@digitivia.com
> - Password: [provide the password]
>
> **Steps to test `whatsapp_business_messaging`:**
> 1. Log in with the credentials above.
> 2. Click the "Inbox" tab in the left sidebar.
> 3. Select any existing WhatsApp conversation from the list.
> 4. Type a message in the input field and click Send.
> 5. The message is sent via the WhatsApp Cloud API (`POST /{phone_number_id}/messages`).
> 6. You can verify delivery by checking the message status indicator (single check = sent, double check = delivered).
>
> **Steps to test `whatsapp_business_management`:**
> 1. From the left sidebar, click the "WhatsApp" agent tab.
> 2. Click "Settings" to see the connected WABA details (WABA ID, phone number, verified name).
> 3. Click "View Message Templates" to see templates fetched from the Meta Graph API.
> 4. To test the Embedded Signup flow: click "Reconnect" → a Facebook login popup appears → grant access → connection completes with WABA and phone number displayed.
>
> **Note:** The test account has a pre-connected WhatsApp Business Account so you can immediately verify messaging and template functionality without needing to run the full onboarding flow.

---

## Part D — Common Rejection Reasons & How to Avoid Them

| Rejection Reason | How to Avoid |
|---|---|
| "Screencast does not show the permission being used" | Show the actual API call in DevTools. Don't just show the UI — show the network request and 200 response. |
| "App is in Development mode" | Switch to Live mode in `Settings → Advanced` before submitting. |
| "Business not verified" | Complete Business Verification first (can take 1–5 days). |
| "Test account does not work" | Test credentials in incognito. Make sure no 2FA, no email verify popup, no expired session. |
| "Description is too generic" | Use the specific justification text above — mention exact endpoints by name. |
| "Screencast shows consumer-facing experience" | Record YOUR dashboard (the business operator's view), not the end-user's WhatsApp app. |
| "No successful API calls detected" | Make at least one real API call per permission before submitting. Meta checks their logs. |
| "Privacy Policy URL is broken" | Verify the URL loads in incognito. Must be a public page, not behind login. |
| "Screencast is too long or unclear" | Keep each video under 3 minutes. Use clear on-screen annotations. Go directly to the relevant feature. |
| "Permission justification copied between permissions" | Write a unique description for each permission. Don't reuse text. |
| "App icon missing or invalid" | Upload a 1024×1024 PNG with no transparency. |

---

## Part E — Final Submission Checklist

Before clicking "Submit for Review":

### App Configuration
- [ ] App Mode is **Live**
- [ ] App Display Name, Icon, Contact Email are set
- [ ] Privacy Policy URL works (test in incognito)
- [ ] Terms of Service URL works
- [ ] Business Verification is complete (green check)
- [ ] WhatsApp product is added with a linked WABA

### API Call Proof
- [ ] At least 1 successful `POST /messages` call in the last 7 days
- [ ] At least 1 successful `GET /{waba_id}/phone_numbers` call in the last 7 days
- [ ] At least 1 successful `GET /{waba_id}/message_templates` call in the last 7 days

### Screencasts
- [ ] One video for `whatsapp_business_messaging` (MP4/MOV, under 120MB)
- [ ] One video for `whatsapp_business_management` (MP4/MOV, under 120MB)
- [ ] Each video shows: login → navigate to feature → use the feature → API call in DevTools
- [ ] No passwords visible on screen
- [ ] Videos are under 5 minutes each
- [ ] Business-facing UI is shown (not the consumer WhatsApp app)

### Permission Descriptions
- [ ] `whatsapp_business_messaging` description mentions specific endpoints (`POST /messages`, webhook)
- [ ] `whatsapp_business_management` description mentions specific endpoints (`GET /phone_numbers`, `GET /message_templates`, `POST /subscribed_apps`, Embedded Signup)
- [ ] Each description is unique (not copy-pasted)

### Reviewer Instructions
- [ ] Test URL provided
- [ ] Test email and password provided
- [ ] Step-by-step instructions for testing each permission
- [ ] Tested credentials in incognito — login works first try

### Final Check
- [ ] Run `enableScreencastMode()` in console before recording (amber banner appears)
- [ ] Dismiss the banner after recording (click ✕)
- [ ] Build and deploy the latest code (`npm run build`)
- [ ] Ensure the edge functions are deployed (`supabase functions deploy`)
- [ ] Ensure the META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN secrets are set

---

## Quick Reference: API Versions

Your app currently uses Graph API **v22.0**. Meta's latest is v25.0 (Feb 2026). v22.0 is stable and supported. If you see deprecation warnings, update `WHATSAPP_GRAPH_API_VERSION` in `index.html` line 15303 and `FB.init` version at line 16547.

## Quick Reference: Key IDs

| Item | Value |
|---|---|
| Meta App ID | `875686618745863` |
| Embedded Signup Config ID | `1239600244448047` |
| Supabase Project Ref | `xrycghxaxqzvkmzqzzkx` |
| Graph API Version | `v22.0` |
| Messenger Webhook | `https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/messenger-webhook` |
| Instagram Webhook | `https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/instagram-webhook` |
| Meta Token Manager | `https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/meta-token-manager` |
