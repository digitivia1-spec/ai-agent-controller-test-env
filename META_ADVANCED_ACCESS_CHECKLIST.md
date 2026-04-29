# Meta Advanced Access Approval Checklist
## Complete Step-by-Step Guide for Omnio

**Date Created:** April 28, 2026  
**Last Updated:** April 28, 2026  
**Status:** Ready for Implementation

---

## Your Current Issue

Your console errors show:
```
GET https://graph.facebook.com/v20.0/1422980245990971/phone_numbers 400 (Bad Request)
GET https://graph.facebook.com/v20.0/1076445465541067/phone_numbers 500 (Internal Server Error)
```

**Root Cause:** Your app is attempting to fetch WhatsApp phone number details (`display_phone_number`, `verified_name`, `quality_rating` fields) without:
1. ✗ Advanced Access approval from Meta
2. ✗ Business Verification
3. ✗ Proper token permissions
4. ✗ WhatsApp Business Account properly connected

This checklist will guide you through getting all of these completed.

---

## PART 1: PRE-SUBMISSION REQUIREMENTS (Do Before Applying)

### 1.1 Business Verification (MUST COMPLETE FIRST)

Business Verification is the foundation — without it, Meta won't review your app.

**What to prepare:**
- [ ] Business name and official company registration number
- [ ] Company address (must be physical, not PO box)
- [ ] Tax ID / VAT number
- [ ] Proof of business ownership (articles of incorporation, business license, or registration certificate)
- [ ] Company website (should reference Meta integration)
- [ ] Company phone number (must be publicly listed)

**Steps to verify:**
1. Go to [Meta Business Manager](https://business.facebook.com)
2. Click **Settings** → **Business Info** → **Add or Verify**
3. Follow the document verification flow:
   - Upload government-issued business registration
   - Provide tax ID or equivalent
   - Wait 3-5 business days for review
4. Once approved, you'll see "Verified" badge in Business Manager
5. Do NOT proceed to App Review until Business Verification shows as "Verified"

**Timeline:** 3-5 business days typically, but can take up to 2-3 weeks depending on document clarity.

---

### 1.2 App Registration and Setup

**Create your app (if not already done):**
1. Go to [Meta Developers Dashboard](https://developers.facebook.com)
2. Click **My Apps** → **Create App**
3. Choose app type: **Business**
4. Fill in:
   - App Name: "Omnio by Digitivia"
   - App Contact Email: mahmoud@digitivia.com
   - App Purpose: "AI command center for WhatsApp, Messenger, Instagram, Telegram"
   - App Category: "Business Tools" or "CRM"
5. Click **Create App**

**Add required products to your app:**
- [ ] WhatsApp (for WhatsApp integration)
- [ ] Facebook Login (if using customer login)
- [ ] Instagram (if integrated)
- [ ] Messenger (if integrated)
- [ ] Graph API (for data queries)

---

### 1.3 WhatsApp Business Account Connection

This is separate from Business Verification — you need an actual WhatsApp Business Account to test against.

**If you don't have one yet:**
1. Go to [WhatsApp Business Platform](https://www.whatsapp.com/business/)
2. Create a WhatsApp Business Account (or use existing if you have one)
3. Once created, verify your phone number
4. You'll receive a **Phone Number ID** (looks like: `1234567890123456`)

**Connect to Meta Business Manager:**
1. In [Meta Business Manager](https://business.facebook.com)
2. Go to **WhatsApp** → **Getting Started**
3. Click **Add Account**
4. Select your verified WhatsApp Business Account
5. You should see a **Phone Number ID** appear (e.g., `1422980245990971` from your errors)

**This Phone Number ID is what you'll use for API calls.**

---

### 1.4 App Settings That Must Be Completed

**Go to Meta Developer Dashboard → Your App Settings:**

**Basic Settings:**
- [ ] App Name: "Omnio by Digitivia"
- [ ] App Domains: `digitivia.com`, `app.digitivia.com`, `omnio.digitivia.com`
- [ ] Privacy Policy URL: `https://digitivia.com/privacy` (must be publicly accessible)
- [ ] Terms of Service URL: `https://digitivia.com/terms` (must be publicly accessible)
- [ ] Category: Business Tools / CRM / Commerce
- [ ] Support Email: support@digitivia.com
- [ ] Support URL: `https://digitivia.com/support`

**App Roles:**
- [ ] Add yourself as **Admin**
- [ ] Add any team members who will help with testing as **Developers** or **Testers**

**Platform Configuration:**
- [ ] Website URL: `https://digitivia.com` (if web-based)
- [ ] App Center Icon: Upload a 200x200 PNG logo
- [ ] App Center Category: Business Tools / Commerce / CRM

**WhatsApp-Specific Configuration (in WhatsApp Product Settings):**
- [ ] **Display Phone Number**: Must match your verified WhatsApp number
- [ ] **Business Account ID**: Visible in WhatsApp product settings
- [ ] **Default Webhook URL**: `https://your-domain.com/webhooks/whatsapp` (for receiving messages)
- [ ] **Webhook Verify Token**: Create a secure random string (keep secret)

---

### 1.5 Permissions You Will Request (Identify Now)

Based on your console errors, you need these permissions for WhatsApp:

**High-Risk Permissions (Require Advanced Access):**
1. **whatsapp_business_phone_number_info** — read phone number details, verified name, quality rating
2. **whatsapp_business_messaging** — send messages
3. **whatsapp_read_phone_numbers** — read the phone_numbers edge
4. **whatsapp_business_management** — manage templates, settings

**Medium-Risk Permissions:**
5. **pages_manage_metadata** — if managing page settings
6. **instagram_basic** — if integrating Instagram
7. **instagram_graph_api** — if accessing Instagram data

**Create a list of EXACTLY which permissions your app needs.** You'll need to justify each one in your submission.

---

## PART 2: TEST ACCOUNT SETUP (Before Recording Screencast)

### 2.1 Create Test Accounts

You need REAL accounts that can successfully authenticate and make API calls. Meta reviewers will test these.

**Create test user for WhatsApp:**
1. In Meta Developers Dashboard → **Your App** → **Roles** → **Test Users**
2. Click **Create Test User**
3. Give it a name: "Test Customer - WhatsApp"
4. Note the User ID and temporary password
5. Assign the **whatsapp_business_phone_number_info** permission to this test user
6. Give this test user access to your WhatsApp Business Account

**Create test accounts for each platform (if integrated):**
- [ ] WhatsApp test account (with verified phone number)
- [ ] Messenger test account (with Facebook page access)
- [ ] Instagram test account (with Instagram Business Account access)
- [ ] Telegram test account (if integrated)

**Make sure test accounts have:**
- [ ] Real, functioning contact information
- [ ] Verified phone numbers (for WhatsApp)
- [ ] Business Account approvals where needed
- [ ] Active status (not suspended)

---

### 2.2 Generate and Test Access Tokens

Before recording your screencast, verify that your app can successfully make API calls with each permission.

**Generate an access token for testing:**
1. In Meta Developers Dashboard → **Your App** → **Settings** → **Basic**
2. Copy your **App ID** and **App Secret**
3. Go to [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
4. Select your app in the top-right dropdown
5. Click the access token field → **Generate Access Token**
6. Select your test user and click **Generate**
7. Copy the generated token (valid for 2 hours for development)

**For production, use a Server-to-Server token:**
```
POST https://graph.facebook.com/oauth/access_token
  ?client_id={app-id}
  &client_secret={app-secret}
  &grant_type=client_credentials
```

---

### 2.3 Make Successful API Calls for Each Permission

**This is critical** — you need to prove your app actually uses each permission you're requesting.

**For whatsapp_business_phone_number_info, test these endpoints:**

```bash
# 1. Get phone number details (your main error source)
curl -X GET \
  "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}" \
  "?fields=id,display_phone_number,verified_name,quality_rating" \
  "?access_token={ACCESS_TOKEN}"

# Expected response:
{
  "id": "1234567890123456",
  "display_phone_number": "+1 (555) 123-4567",
  "verified_name": "Omnio Inc",
  "quality_rating": "GREEN"
}

# 2. List all phone numbers under the business account
curl -X GET \
  "https://graph.facebook.com/v20.0/{BUSINESS_ACCOUNT_ID}/phone_numbers" \
  "?access_token={ACCESS_TOKEN}"

# 3. Get phone number status
curl -X GET \
  "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}" \
  "?fields=status" \
  "?access_token={ACCESS_TOKEN}"

# 4. Send a test message (for whatsapp_business_messaging)
curl -X POST \
  "https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "{TEST_RECIPIENT_NUMBER}",
    "type": "template",
    "template": {
      "name": "hello_world"
    }
  }'

# 5. Get templates (for whatsapp_business_messaging)
curl -X GET \
  "https://graph.facebook.com/v20.0/{BUSINESS_ACCOUNT_ID}/message_templates" \
  "?access_token={ACCESS_TOKEN}"
```

**Checklist — Before recording your screencast:**
- [ ] Run each API call above and get successful responses (200 status)
- [ ] Document the exact command line used for each call
- [ ] Save screenshots of successful responses
- [ ] Keep these around — you may need to show them in the screencast

---

## PART 3: SCREENCAST RECORDING (Technical Requirements)

### 3.1 What Meta Requires in Your Screencast

**Official Requirements (from Meta documentation):**
1. **High resolution:** 1080p (1920x1080) minimum, preferably 4K
2. **English language:** Set your app UI to English
3. **Full authentication flow:** Start logged-out, show complete login process
4. **Permission granting:** Show the exact moment the user grants each permission
5. **Feature demonstration:** For each permission, show what the app does with that data
6. **Clear narrator:** Either live narration or text overlays explaining each step
7. **Duration:** 2-5 minutes per permission demonstrated (longer if complex)

**Meta Reviewer Perspective:**
> "The reviewer will watch your screencast, then log into the test account you provide and replicate the exact flow. If they can't follow your steps or the app behaves differently, your submission will be rejected."

---

### 3.2 Screencast Recording Tools

**Professional (Recommended):**
- Camtasia ($99, free trial available) — best for polished screencasts
- Snagit ($49.99, free trial) — fast, reliable, great editing
- Adobe Captivate — enterprise-grade

**Free Alternatives:**
- **OBS Studio** (Open Broadcaster Software) — recommended free option
- QuickTime (macOS only)
- Windows 11 built-in Game Bar (Win + G)
- Screencastify (Chrome extension)

**Recommended Settings for OBS:**
- Resolution: 1920x1080 (1080p)
- Frame Rate: 30 FPS
- Bitrate: 4000-6000 kbps
- Format: MP4 (H.264)
- Audio: Include system and microphone audio

---

### 3.3 Step-by-Step Screencast Script

**Screencast 1: WhatsApp Business Phone Number Info Access**

**SETUP (Before you hit Record):**
- [ ] Log out of all test accounts
- [ ] Clear browser cache/cookies (optional but recommended)
- [ ] Have your test credentials ready (don't show password on screen)
- [ ] Open Omnio in incognito/private mode
- [ ] Have a phone number ready to receive a test message

**RECORDING SCRIPT:**

```
[SCENE 1: Login (0:00-0:45)]
Narrator: "This is a demonstration of how Omnio uses WhatsApp Business 
Phone Number Info. We start completely logged out."

Visual: Show browser window with Omnio login page (no user logged in)
Action: Click "Login with Meta Business Account"
- Show the Meta login modal appearing
- Show login form
- Enter test credentials (username visible, password masked)
- Click "Login"

[SCENE 2: Permissions Granted (0:45-2:00)]
Visual: Show Meta permission dialog
Narrator: "The app now requests permission to access WhatsApp business 
phone number information, including the verified name and quality rating."

Action: Show permissions dialog on screen with these permissions highlighted:
  - whatsapp_business_phone_number_info
  - whatsapp_business_messaging
  - pages_read_engagement

Action: Click "Confirm" or "Allow" button
Wait: Show the redirect back to Omnio with user now logged in

[SCENE 3: Verify Phone Number Display (2:00-3:00)]
Visual: Show Omnio dashboard after login
Narrator: "Once logged in, Omnio automatically retrieves and displays the 
verified WhatsApp business phone number and quality rating."

Action: Navigate to Settings → Connected Accounts → WhatsApp
Highlight on screen:
  - Display Phone Number: "+1 (555) 123-4567" ✓
  - Verified Name: "Omnio Inc" ✓
  - Quality Rating: "GREEN" ✓
  - Account Status: "Active" ✓

[SCENE 4: Send a Test Message (3:00-4:00)]
Visual: Show Omnio message composer
Narrator: "The app uses this phone number to send messages through WhatsApp. 
Here's a test message being sent to verify the connection."

Action: Navigate to a contact/chat in Omnio
Action: Type test message in composer
Action: Show the message being sent
Visual: Show success notification (e.g., "Message sent successfully")

[SCENE 5: API Call Evidence (4:00-4:30)]
Visual: Show browser developer console (F12)
Narrator: "In the developer console, we can see the successful API calls 
to the WhatsApp Graph API endpoint, retrieving phone number details."

Action: Open Chrome DevTools → Network tab
Scroll to show successful requests:
  - GET /graph.facebook.com/v20.0/{PHONE_ID}?fields=display_phone_number...
  - Status: 200 OK
  - Response shows: {"id": "...", "display_phone_number": "...", "verified_name": "..."}

[SCENE 6: Closing (4:30-5:00)]
Narrator: "That's how Omnio uses WhatsApp Business Phone Number Info 
to enhance customer communication. The app requires this permission to 
display verified account information and facilitate messaging."

Visual: Show summary screen or dashboard with all features visible
```

---

### 3.4 Screencast Dos and Don'ts

**DO:**
- ✓ Use clear, audible narration
- ✓ Move mouse slowly so reviewers can follow
- ✓ Leave 2-3 seconds between actions for clarity
- ✓ Use keyboard shortcuts to navigate (faster, more professional)
- ✓ Zoom in on important buttons/data (use 125-150% zoom)
- ✓ Show the complete workflow from start to finish
- ✓ Include error scenarios IF relevant (then show recovery)
- ✓ Use English language throughout
- ✓ Include text overlays for important steps (e.g., "Requesting permission...")

**DON'T:**
- ✗ Record in a different language (Meta only reviews English)
- ✗ Show real customer data or PII
- ✗ Use shortcuts that skip steps (reviewers won't understand)
- ✗ Record at low resolution (< 1080p)
- ✗ Use auto-play or very fast mouse movements
- ✗ Show sensitive info like API keys, tokens, or passwords
- ✗ Have background notifications popping up
- ✗ Use placeholder/mock data that looks fake
- ✗ Make assumptions ("it will work," "normally you'd...") — show the actual flow

---

### 3.5 Save and Host Your Screencast

Once recorded:
1. Export as MP4 (H.264 codec, AAC audio)
2. File size should be under 1GB (typically 100-300MB for 5 min video)
3. Upload to a publicly accessible location:
   - Google Drive (set to "Anyone with link can view")
   - Dropbox (public link)
   - YouTube (unlisted)
   - AWS S3
   - Your own server

**Create a direct download link** — don't embed YouTube; provide a direct MP4 URL

---

## PART 4: PERMISSION JUSTIFICATION (What to Write)

### 4.1 Justification for whatsapp_business_phone_number_info

**What Meta wants to hear:**

```
Permission: whatsapp_business_phone_number_info

Business Use Case:
Omnio is an AI command center for businesses managing customer communications 
across multiple channels (WhatsApp, Messenger, Instagram, Telegram). To help 
businesses maintain consistent customer data, Omnio displays the verified 
WhatsApp business phone number and quality rating in the customer management 
interface.

Specific Use:
1. Phone Number Display: When a customer interacts via WhatsApp, Omnio 
   displays the official verified phone number so agents know they're 
   reaching the correct business account.
   
2. Quality Rating Monitoring: Omnio displays the WhatsApp quality rating 
   (GREEN/YELLOW/RED) on the dashboard, helping businesses monitor their 
   messaging compliance and contact acceptance rates.
   
3. Account Status: Omnio retrieves and displays verification status to 
   confirm the business account is properly verified with Meta.

Data Handling:
- Phone number info is displayed to internal agents only
- No data is stored in local databases (retrieved live from Meta API)
- No data is shared with third parties
- Data is used only for customer management purposes
- Users can revoke access at any time in Business Manager settings

User Benefit:
Agents can immediately see whether they're communicating with a verified 
business account, building trust and ensuring messaging quality compliance.

Technical Scope:
API endpoint: GET /{phone_number_id}
Fields accessed: id, display_phone_number, verified_name, quality_rating
Frequency: Called once per day per connected account
Data retention: None (live query only)
```

---

### 4.2 Justification for whatsapp_business_messaging

```
Permission: whatsapp_business_messaging

Business Use Case:
Omnio enables businesses to send personalized messages to customers through 
WhatsApp, leveraging the platform's high engagement rates and verification 
mechanisms.

Specific Use:
1. Template Messages: Omnio allows agents to send pre-approved WhatsApp 
   templates (order confirmations, appointment reminders, support responses).
   
2. Direct Messages: Agents can send direct messages to customers who have 
   opted in to receive business communications.
   
3. Interactive Messages: Send templates with quick-reply buttons (e.g., 
   "Confirm Appointment" / "Reschedule").

Data Handling:
- Messages are sent only to customers who have initiated conversation
- No unsolicited bulk messaging
- Message content is logged for compliance and audit purposes
- Customer phone numbers are stored in Omnio's CRM with explicit consent
- Messages are not shared with third parties

User Benefit:
Businesses can reach customers on WhatsApp, where message open rates exceed 
98% (vs. email's ~20%), enabling faster response times and better customer 
satisfaction.

Technical Scope:
API endpoint: POST /{phone_number_id}/messages
Message types: text, template, interactive, media
Frequency: Based on business volume (no daily limits enforced)
Data retention: Message logs retained for 90 days for compliance
```

---

### 4.3 Justification for pages_manage_metadata (if needed)

```
Permission: pages_manage_metadata

Business Use Case:
Omnio integrates with Facebook Pages to display business information and 
manage page-level settings without requiring direct Facebook access.

Specific Use:
1. Page Info: Display page name, verified status, and contact information 
   in the Omnio dashboard.
   
2. Settings: Allow businesses to update page description, website, and 
   call-to-action buttons from Omnio.

Data Handling:
- Only page-level data is accessed (no post content or conversation data)
- Settings changes are logged for audit purposes
- Data is not exported or shared with third parties
- Businesses retain full control via Facebook settings

User Benefit:
Centralized management of all business communication channels (WhatsApp, 
Messenger, Instagram, Facebook) from a single dashboard.

Technical Scope:
API endpoint: /{page_id}, /{page_id}?fields=...
Frequency: Called on page load and when settings are updated
Data retention: Cached for 1 hour; cleared on logout
```

---

## PART 5: REVIEWER INSTRUCTIONS (Critical for Approval)

### 5.1 What to Write in "Reviewer Instructions"

**This section is READ FIRST by Meta reviewers.** Be clear and specific.

```
REVIEWER INSTRUCTIONS FOR OMNIO

Test Account Credentials:
- URL: https://app.digitivia.com
- Email: test.reviewer@digitivia.com
- Password: [temporary password - reset required on first login]
- WhatsApp Business Account Phone: +1 (555) 123-4567
- Test Recipient Number: +1 (555) 987-6543

EXPECTED BEHAVIOR:

1. Upon login, the app should display:
   - Dashboard with "Connected Accounts" section
   - WhatsApp tab showing phone number, verified name, quality rating
   - "Permissions Granted" badge confirming Meta permissions

2. In Settings → WhatsApp:
   - Phone Number: +1 (555) 123-4567
   - Verified Name: Omnio Test Business
   - Quality Rating: GREEN
   - Status: Connected

3. To send test message:
   - Click "Compose Message"
   - Type test message: "Hello, this is a test message"
   - Click "Send via WhatsApp"
   - You should receive the message on +1 (555) 987-6543 within 10 seconds

4. To verify API calls:
   - Open Chrome DevTools (F12)
   - Go to Network tab
   - Look for requests to graph.facebook.com
   - Filter for "phone_numbers" endpoint
   - Requests should show 200 status with proper JSON responses

SCREENCAST REFERENCE:
The screencast shows the exact flow above. You should be able to reproduce 
all steps shown in the video.

PERMISSIONS BEING REQUESTED:
✓ whatsapp_business_phone_number_info
✓ whatsapp_business_messaging
✓ pages_read_engagement

ESTIMATED TEST TIME: 5-10 minutes

If anything doesn't work as described, the most likely cause is:
1. WhatsApp Business Account disconnected (reconnect in Settings)
2. Test credentials expired (contact developer for fresh token)
3. Browser cache (clear cache and reload, or use incognito mode)

Contact: mahmoud@digitivia.com for technical support during review.
```

---

### 5.2 Key Phrases That Increase Approval

Use these phrases in your reviewer instructions:

- "The screencast demonstrates the exact flow reviewers should replicate"
- "All permissions are justified by the specific features shown"
- "Test account credentials are valid for 30 days from submission date"
- "The app requires these permissions to function; feature X won't work without permission Y"
- "No unsolicited messages are sent; all messaging requires user initiation"
- "Data is not stored or shared with third parties"
- "Full audit logs available for compliance review"

---

## PART 6: COMMON REJECTION REASONS (Avoid These)

### 6.1 Most Common Rejections and How to Fix Them

**Rejection 1: "Business Verification not completed"**
- Cause: You submitted without getting "Verified" badge
- Fix: Complete business verification FIRST before app review
- Timeline: 3-5 weeks typically
- Status check: Business Manager → Settings → Business Info

**Rejection 2: "Permission not justified"**
- Cause: You requested whatsapp_business_messaging but didn't explain why
- Fix: Write a 3-4 sentence explanation for each permission
- Example: "We use this permission to send order confirmations via WhatsApp, 
  which has 98% open rates vs. email's 20%"
- Avoid: Generic phrases like "we need this for messaging"

**Rejection 3: "Screencast doesn't demonstrate permission usage"**
- Cause: Your screencast showed login but not actual permission being used
- Fix: Show the COMPLETE flow:
  1. Logged out
  2. Click login
  3. See permission dialog
  4. Click "Allow"
  5. See the feature that uses that permission
  6. Show the permission working (e.g., message sent, data displayed)

**Rejection 4: "Can't log into test account"**
- Cause: Test credentials invalid or account suspended
- Fix:
  - Use permanent test users, not temporary ones
  - Give test users explicit access to WhatsApp Business Account
  - Test login yourself before submission
  - Provide fresh passwords that don't expire

**Rejection 5: "App behavior doesn't match screencast"**
- Cause: You showed feature X in screencast but it doesn't work in test account
- Fix:
  - Test the EXACT flow you'll show in screencast
  - Use the same test account credentials in screencast
  - Record AFTER setup is complete, not during setup

**Rejection 6: "Missing privacy policy"**
- Cause: No privacy policy URL or it's inaccessible
- Fix:
  - Create a public privacy policy at /privacy or /legal/privacy
  - Include sections on:
    - What data you collect
    - How you use WhatsApp data
    - How users can request deletion
    - How you handle the quality rating info
  - Make sure it's publicly accessible (not behind login)

**Rejection 7: "Unclear data handling"**
- Cause: Didn't explain what happens to phone numbers after retrieval
- Fix: State explicitly:
  - "Phone numbers are displayed live from Meta API, not stored"
  - OR "Phone numbers are stored in our database for 90 days for compliance"
  - "No data is shared with third parties"
  - "Users can request data deletion anytime"

**Rejection 8: "Temporary access token used"**
- Cause: You provided a test token that expired
- Fix:
  - Use server-to-server credentials (client_id + client_secret)
  - Generate a fresh token before submission
  - Don't rely on 2-hour development tokens

**Rejection 9: "Missing reviewer instructions"**
- Cause: You didn't provide a test account or walkthrough
- Fix: Include:
  - Valid test account credentials (they'll reset password on first login)
  - Step-by-step instructions to reproduce the flow
  - Expected outcomes for each step
  - How to verify the permission is being used

**Rejection 10: "Requires Advanced Access but using standard token"**
- Cause: Your token doesn't have Advanced Access permissions included
- Fix:
  - In Meta Business Manager, go to your app
  - Add the permission to your test user's roles
  - Generate a new token that includes the permission
  - Test the API call before recording screencast

---

## PART 7: FINAL SUBMISSION CHECKLIST

### 7.1 Before You Click "Submit"

**Business & Legal (These must be 100% complete):**
- [ ] Business Manager shows "Verified" badge
- [ ] Company registration document approved
- [ ] Tax ID verified
- [ ] Privacy policy live and accessible at https://digitivia.com/privacy
- [ ] Terms of Service live at https://digitivia.com/terms
- [ ] Support page live at https://digitivia.com/support
- [ ] Company website mentions Meta integration/WhatsApp support

**App Settings (These must be complete):**
- [ ] App Name: "Omnio by Digitivia"
- [ ] App Category: "Business Tools" or "CRM"
- [ ] App Icon: 200x200 PNG uploaded
- [ ] Contact Email: mahmoud@digitivia.com
- [ ] Support Email: support@digitivia.com
- [ ] All required domains added (digitivia.com, app.digitivia.com, etc.)

**Permissions (These must be justified):**
- [ ] List each permission you're requesting: whatsapp_business_phone_number_info, whatsapp_business_messaging, etc.
- [ ] Written justification for EACH permission (3-4 sentences minimum)
- [ ] Justification explains specific business use case
- [ ] Justification explains data handling (what you do with the data)
- [ ] Justification explains user benefit

**Test Account (This must be tested):**
- [ ] Test user created in Meta Developers dashboard
- [ ] Test user has explicit permission to access WhatsApp Business Account
- [ ] Test account can successfully log in to Omnio
- [ ] Test account successfully makes API calls for each permission
- [ ] Test account is NOT your personal account
- [ ] Test credentials provided in submission (will expire after submission)

**Screencast (This must be production-quality):**
- [ ] Recorded in 1080p or higher
- [ ] Audio is clear and audible
- [ ] Screencast shows COMPLETE flow:
  - User logged out
  - Login process
  - Permission grant dialog
  - Permission being actively used
- [ ] Screencast is in English language
- [ ] Screencast is less than 10 minutes (ideally 5-7 minutes)
- [ ] Screencast uploaded to publicly accessible location (Google Drive, Dropbox, etc.)
- [ ] Download link works and video plays cleanly
- [ ] Video shows exact flow from screencast script above

**Reviewer Instructions (This must be detailed):**
- [ ] Test account email provided
- [ ] Test password provided (temporary, will be reset)
- [ ] Step-by-step instructions to test each permission
- [ ] Expected outcomes described for each step
- [ ] Contact email for support during review
- [ ] Reference to screencast provided
- [ ] All info is clear and easy to follow

**Final Quality Check:**
- [ ] Spellcheck all written content
- [ ] Test all links in privacy policy, terms, support pages
- [ ] Verify screencast link works
- [ ] Verify test account login works
- [ ] Verify each API call works with test account credentials
- [ ] Print out your submission and read it aloud (catches mistakes)

---

### 7.2 Submission Workflow

**Step 1: Prepare Everything Above**
- Estimated time: 2-3 weeks

**Step 2: Submit in Meta Developers Dashboard**
1. Go to [Meta Developers Dashboard](https://developers.facebook.com)
2. Select your app: "Omnio by Digitivia"
3. Go to **App Review** tab
4. Click **Add Permission Request**
5. Select permissions:
   - [ ] whatsapp_business_phone_number_info
   - [ ] whatsapp_business_messaging
   - [ ] pages_manage_metadata (if needed)
   - [ ] instagram_basic (if needed)
6. For each permission, upload:
   - Screencast (MP4 video link or upload)
   - Justification text
7. Add **Reviewer Instructions** in the "Reviewer Notes" field
8. Review all fields one more time
9. Click **Submit for Review**

**Step 3: Wait for Meta Review**
- Expected time: 1-3 weeks depending on complexity
- Typical flow:
  - Day 1-2: Queue for review
  - Day 3-7: Reviewer tests your app
  - Day 8-14: Decision (approve, request info, or reject)

**Step 4: Monitoring Your Submission**
1. Check status daily in **App Review → My Submissions**
2. Status updates:
   - 🔵 **In Review** — Meta is testing
   - 🟡 **More Information Needed** — Respond within 7 days
   - 🟢 **Approved** — Permissions live immediately
   - 🔴 **Rejected** — Read feedback and resubmit (no limit on resubmits)

**Step 5: If Rejected**
- Read Meta's feedback carefully
- Fix the specific issue
- Resubmit (no penalty for resubmitting)
- Most resubmissions are approved if you address the feedback

**Step 6: Once Approved**
- Permissions available in production immediately
- All test users are converted to production users
- API calls no longer need pre-approval
- You can request additional permissions anytime

---

## PART 8: IMMEDIATE ACTIONS (This Week)

### DO THIS IMMEDIATELY:

**Priority 1 (By End of Week 1):**
- [ ] Complete Business Verification (3-5 weeks, but start now)
- [ ] Verify WhatsApp Business Account is connected to Business Manager
- [ ] Create test user accounts in Meta Developers Dashboard

**Priority 2 (By End of Week 2):**
- [ ] Test all API endpoints locally (follow Part 2.3 above)
- [ ] Record screencast (or schedule time to record)
- [ ] Write permission justifications

**Priority 3 (By End of Week 3):**
- [ ] Review everything against checklist
- [ ] Have someone else review your submission (fresh eyes catch mistakes)
- [ ] Submit to Meta for review

---

## PART 9: QUICK REFERENCE - YOUR API CALL FIXES

To fix your immediate console errors:

**Current Error:**
```
GET https://graph.facebook.com/v20.0/1422980245990971/phone_numbers 400 (Bad Request)
```

**Fix 1: Ensure Permission Exists**
```javascript
// Your current code probably looks like:
const phoneNumbers = await fetch(
  `https://graph.facebook.com/v20.0/${PHONE_ID}/phone_numbers?access_token=${TOKEN}`
);

// The 400 error suggests you don't have the permission.
// You can't fix this until you get Advanced Access approval.
```

**Fix 2: Request Advanced Access (This Checklist)**
- Complete Business Verification
- Submit app review with screencast
- Wait for approval
- Then your access token will include `whatsapp_business_phone_number_info`

**Fix 3: Use Server-to-Server Credentials**
```javascript
// Instead of using a short-lived access token:
// Generate a permanent token using client credentials:
const response = await fetch('https://graph.facebook.com/oauth/access_token', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID,
    client_secret: process.env.FACEBOOK_APP_SECRET,
    grant_type: 'client_credentials'
  })
});

const { access_token } = await response.json();

// Now use this token for API calls:
const phoneNumbers = await fetch(
  `https://graph.facebook.com/v20.0/${PHONE_ID}?fields=id,display_phone_number,verified_name,quality_rating&access_token=${access_token}`
);
```

**Fix 4: Handle Errors Gracefully**
```javascript
try {
  const response = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}?...`);
  
  if (response.status === 400) {
    console.error('Bad Request - Missing Advanced Access permissions');
    console.error('Submit app review to get whatsapp_business_phone_number_info permission');
    return null;
  }
  
  if (response.status === 500) {
    console.error('Server Error - WhatsApp API temporarily unavailable');
    // Retry with exponential backoff
    return null;
  }
  
  const data = await response.json();
  return data;
} catch (error) {
  console.error('API call failed:', error);
}
```

---

## OFFICIAL META REFERENCES

This checklist is based on the official Meta documentation:

1. **Screen Recordings Requirements:**
   https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/

2. **App Review Submission Guide:**
   https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide/

3. **Access Levels & Advanced Access:**
   https://developers.facebook.com/docs/graph-api/overview/access-levels/

4. **Official Meta Screencast Video:**
   https://developers.facebook.com/videos/2024/creating-screencasts-for-meta-app-review/

5. **WhatsApp Business Platform Documentation:**
   https://developers.facebook.com/docs/whatsapp/cloud-api/

6. **Graph API Reference:**
   https://developers.facebook.com/docs/graph-api/

---

## SUMMARY

**Your Path to Advanced Access:**

1. ✅ **Week 1-3:** Complete Business Verification
2. ✅ **Week 2-4:** Set up test accounts, test API calls
3. ✅ **Week 3:** Record screencast, write justifications
4. ✅ **Week 4:** Submit to Meta for review
5. ✅ **Week 5-7:** Meta reviews (1-3 weeks typical)
6. ✅ **Week 7+:** Approved — start using permissions in production

**Total time: 4-8 weeks typically**

Once approved, your 400 and 500 errors will resolve because your access token will include the proper permissions.

---

**Last updated:** April 28, 2026
**Questions?** Contact: mahmoud@digitivia.com
