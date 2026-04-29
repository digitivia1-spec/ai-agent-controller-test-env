# Screencast Action Plan — TODAY
## For Meta Advanced Access Submission

**Status:** Ready to Record Right Now  
**Time to Complete:** 2-3 hours total  
**Prerequisite:** Phase 1 deployment complete + Edge Functions live

---

## YOUR ADVANTAGE

You have a screencast mode BUILT IN. This is huge. Most apps don't have this. You're ahead.

```javascript
// You already have this available
enableScreencastMode()  // Adds banner, sets localStorage flag
```

This means Meta reviewers will see a professional, clearly-marked screencast banner indicating "This is a demo recording" — which actually INCREASES approval odds because it shows you understand the review process.

---

## WHAT YOU'RE RECORDING

One single screencast showing the complete **Meta Channels Connection Flow** with successful API calls.

**This demonstrates:**
- WhatsApp phone number retrieval (fixes your 400/500 errors)
- Messenger page connection
- Instagram business account connection
- Real-time API calls to your Edge Functions
- Data being pulled from Meta Graph API

**Why this works:** You're showing the EXACT permission usage that justifies `whatsapp_business_phone_number_info` and `whatsapp_business_messaging`.

---

## PRE-RECORDING CHECKLIST (Do RIGHT NOW)

### 1. Verify Your Edge Functions Are Live

```bash
# Test your live functions
curl -X GET https://xrycghxaxqzvkmzqzzkx.supabase.co/functions/v1/list-waba-templates \
  -H "Authorization: Bearer YOUR_USER_JWT" \
  -H "Content-Type: application/json"

# Expected response: list of WhatsApp templates (or empty array if no templates yet)
```

If these don't work, the screencast won't work. Fix them first.

### 2. Verify Your App Loads

```bash
# Start dev server
npm run dev

# Open http://localhost:5173
# Check console for errors (should be clean except for normal dev noise)
```

### 3. Create a Fresh Test Account (if not done)

You need a test Meta account that:
- [ ] Can log in with "Login with Meta Business Account"
- [ ] Has access to a WhatsApp Business Account
- [ ] Has access to a Facebook Page (for Messenger demo)
- [ ] Has access to an Instagram Business Account

**If you don't have these, set them up now:**
1. WhatsApp Business Account: https://www.whatsapp.com/business/
2. Facebook Page: https://facebook.com/pages/create
3. Instagram Business Account: Convert existing Instagram or create new

### 4. Clear Browser State

```javascript
// In browser console BEFORE recording
localStorage.clear();
sessionStorage.clear();
// Manual: Settings → Privacy → Clear all cookies/site data
```

### 5. Have These Ready

- [ ] Test account credentials (username/password)
- [ ] A phone number to text to (for message test) — can be YOUR phone
- [ ] Screenshot of your privacy policy at digitivia.com/privacy
- [ ] Screenshot of your terms at digitivia.com/terms

---

## RECORDING SETUP (30 minutes)

### Tool: OBS Studio (Free, Recommended)

Download: https://obsproject.com/

**OBS Settings:**
```
Video:
  Base (Canvas) Resolution: 1920x1080
  Output Scaling: 1920x1080
  FPS: 30

Output (Recording):
  Path: /path/to/screencast.mp4
  Container: MP4
  Video Codec: H.264
  Bitrate: 4000 kbps (good quality, manageable file size)
  Keyframe Interval: 2 seconds

Audio:
  Sample Rate: 44.1 kHz
  Channels: Stereo
  Bitrate: 128 kbps
```

### Microphone Setup

- Use your laptop mic (fine quality)
- Speak clearly, not too fast
- Record in a quiet room (no background noise)
- Test audio levels — should be -12dB to -6dB during speaking

### App Setup Before Recording

```javascript
// In browser console
enableScreencastMode()

// You should see:
// 1. Page reloads
// 2. Amber "SCREENCAST MODE ACTIVE" banner appears at top
// 3. localStorage now has digitivia_screencast_mode = '1'
```

Then wait 5 seconds for page to fully render.

---

## THE ACTUAL RECORDING SCRIPT

### SCENE 1: Login (0:00 - 1:00)

**Narration:**
> "Welcome to Omnio. This is a demonstration of how Omnio uses Meta's WhatsApp, Messenger, and Instagram APIs to unify customer communications. We're starting logged out."

**Visual:**
- Show login screen (full page)
- Screencast banner should be visible at top in amber

**Action:**
1. Click "Login with Meta Business Account"
2. Wait for Meta login modal
3. Enter test credentials (type slowly so visible)
4. Click "Login" button
5. Wait for redirect back to Omnio
6. Page loads, showing dashboard

**Result:** Logged in, dashboards visible, no errors in console

**Timing:** Slow, clear actions. Each click holds for 1-2 seconds.

---

### SCENE 2: Navigate to WhatsApp Tab (1:00 - 1:30)

**Narration:**
> "Once logged in, Omnio displays the channels management interface. Here we can connect WhatsApp, Messenger, and Instagram accounts. Let's start with WhatsApp."

**Visual:**
- Show left sidebar navigation
- Click "Channels" or navigate to WhatsApp tab
- Dashboard for WhatsApp visible

**Action:**
1. Click WhatsApp tab in sidebar
2. Wait 2 seconds for page to load
3. Show existing WhatsApp card (or "Not Connected" state)

**Result:** WhatsApp tab visible, connection card shown

---

### SCENE 3: Click "Connect Channel" (1:30 - 2:15)

**Narration:**
> "To connect WhatsApp, we click the 'Connect Channel' button. This will show Omnio requesting the necessary permissions from Meta."

**Visual:**
- Show the "Connect Channel" button
- Click it
- Modal appears with 3-step pill indicator
- First step: "Authenticate with Meta"

**Action:**
1. Click "Connect Channel" button
2. Modal opens
3. Show the pills at top: Step 1 ○ | Step 2 ○ | Step 3 ○
4. Tooltip hovers (move mouse over buttons to show tooltips):
   - "Continue with Facebook" 
   - "Reconnect"
   - "Clear Saved State"
   - "Copy JSON"
5. Click "Continue with Facebook"

**Result:** Meta authorization dialog appears (or localhost permission dialog)

---

### SCENE 4: Grant Permissions (2:15 - 3:00)

**Narration:**
> "Meta is now requesting permission for Omnio to access WhatsApp phone number details and messaging functionality. We can see the specific permissions being requested."

**Visual:**
- Meta permission dialog visible (showing requested scopes)
- Highlight permission list
- Click "Confirm" or "Allow"

**Action:**
1. Show permission dialog on screen (take screenshot so it's clear)
2. Highlight these permissions in the dialog:
   - `whatsapp_business_phone_number_info`
   - `whatsapp_business_messaging`
   - `pages_manage_metadata`
3. Click "Confirm" button
4. Wait for redirect back to Omnio

**Result:** Redirect happens, modal progresses to Step 2

**Tip:** If this happens fast, slow down your screen recording replay or record it twice.

---

### SCENE 5: Phone Number Verification (3:00 - 4:00)

**Narration:**
> "Once authorized, Omnio retrieves the verified WhatsApp business phone number directly from Meta's Graph API. This phone number, quality rating, and verified name are now displayed in the dashboard."

**Visual:**
- Modal shows Step 2: "Verify Phone Number"
- Display showing:
  - Phone Number: +1 (555) 123-4567
  - Verified Name: Omnio Inc
  - Quality Rating: GREEN
  - Connected At: [timestamp]

**Action:**
1. Wait for Step 2 to populate (API call to `list-waba-templates` function)
2. Show the phone number card displaying data
3. Hover tooltip over "Quality Rating" to show explanation
4. Take 3 seconds to let this sink in visually
5. Click "Next" or "Continue" button

**Result:** Step 2 complete, moving to Step 3

**Chrome DevTools (Optional but Strong):**
```
While on Step 2, open DevTools (F12) → Network tab
Filter for API calls to your Edge Functions
Show the successful call to list-waba-templates with:
  - Status: 200
  - Response showing phone number data
Close DevTools (takes up screen space)
```

---

### SCENE 6: Message Templates View (4:00 - 5:00)

**Narration:**
> "Step 3 shows the WhatsApp message templates available through this business account. Omnio caches these from Meta's API for easy reference."

**Visual:**
- Modal shows Step 3: "View Templates"
- List of WhatsApp templates visible
- Each template has: name, language, status badge

**Action:**
1. Wait for templates to load (or show placeholder if none exist)
2. Hover over a template to show details
3. Show the status badge (e.g., "APPROVED", "PENDING")
4. Click "Complete Setup" or "Finish"

**Result:** Modal closes, connection complete, WhatsApp card now shows "Connected"

---

### SCENE 7: WhatsApp Dashboard Updated (5:00 - 6:00)

**Narration:**
> "The connection is now complete. The WhatsApp tab shows the connected account with the verified phone number, quality rating, and available actions."

**Visual:**
- WhatsApp card now shows:
  - Status: CONNECTED
  - Phone: +1 (555) 123-4567
  - Verified Name: Omnio Inc
  - Quality Rating: GREEN
  - Action buttons: Send Message, View Templates, Disconnect

**Action:**
1. Show the dashboard card fully
2. Scroll to show all details
3. Hover over "View Message Templates" to show tooltip
4. Optional: Show that clicking would retrieve templates again

**Result:** Clear demonstration of successful connection

---

### SCENE 8: Messenger Connection (6:00 - 7:00)

**Narration:**
> "Omnio also supports Messenger for Facebook Pages. The process is identical — connect once, and all messages from the page are unified in the inbox."

**Visual:**
- Navigate to Messenger tab
- Show "Messenger Channel Connection" card with BETA badge
- Show "Connect Channel" button

**Action:**
1. Scroll to Messenger tab
2. Show the card with BETA badge (professional touch)
3. Click "Connect Channel"
4. Follow same flow as WhatsApp (Steps 1-3)
5. Complete connection

**Result:** Messenger account connected, showing page name and status

---

### SCENE 9: Instagram Connection (7:00 - 8:00)

**Narration:**
> "Finally, Omnio supports Instagram Business accounts for Direct Messages. The same API flow applies — connect once and manage all customer conversations in one place."

**Visual:**
- Navigate to Instagram tab
- Show the Instagram Business Account connection card
- Note about Professional accounts requirement

**Action:**
1. Scroll to Instagram tab
2. Show helper text: "Requires Instagram Business Account (free to convert)"
3. Click "Connect Channel"
4. Follow same flow
5. Complete connection

**Result:** Instagram account connected

---

### SCENE 10: API Call Evidence (8:00 - 9:00)

**Narration:**
> "In the browser developer console, we can verify these are real API calls to Meta's Graph API. Each connection triggered successful calls to retrieve account information."

**Visual:**
- Open Chrome DevTools (F12)
- Go to Network tab
- Scroll to show requests to:
  - `graph.facebook.com/v20.0/...` (WhatsApp phone_numbers endpoint)
  - Status: 200 OK
  - Response showing phone number details

**Action:**
1. Open DevTools
2. Filter for "graph.facebook.com" or "xrycghxaxqzvkmzqzzkx" (your Supabase domain)
3. Show these requests:
   - GET /list-waba-templates (or the actual phone_numbers call)
   - Status 200
   - Response JSON showing:
     ```json
     {
       "id": "1234567890123456",
       "display_phone_number": "+1 (555) 123-4567",
       "verified_name": "Omnio Inc",
       "quality_rating": "GREEN"
     }
     ```
4. Zoom into important parts so readable
5. Take 3-5 seconds per important request

**Result:** Clear evidence of real API integration

---

### SCENE 11: Closing Statement (9:00 - 9:30)

**Narration:**
> "That's how Omnio uses Meta's Graph API to streamline multi-channel communication. By requesting access to WhatsApp phone number information and messaging capabilities, Omnio can display verified account details and facilitate seamless business communication. All data is handled securely and in compliance with Meta's platform policies."

**Visual:**
- Show dashboard with all three channels connected
- Show the screencast banner (proof of professional recording)
- Fade to black or show Omnio logo

**Action:**
1. Navigate back to main dashboard
2. Show all three channel cards (WhatsApp, Messenger, Instagram)
3. All showing CONNECTED status
4. Hold for 3 seconds
5. Fade to black or end recording

**Result:** Professional closing, clear demonstration of all capabilities

---

## TOTAL SCREENCAST TIME: ~9-10 minutes

This is perfect for Meta review. It's:
- ✅ Long enough to show complete flows (not rushed)
- ✅ Short enough to be consumable (not boring)
- ✅ Professional (includes DevTools proof)
- ✅ Clear narrative throughout
- ✅ Shows actual API integration
- ✅ Demonstrates all three permissions

---

## RECORDING CHECKLIST

Before hitting **Record** in OBS:

- [ ] Clear browser cache/cookies
- [ ] Logged out completely
- [ ] OBS is set to 1920x1080 at 30 FPS
- [ ] Audio levels tested (speak into mic, check -12 to -6 dB)
- [ ] Screencast mode will be enabled after logging in
- [ ] Phone numbers/credentials ready but NOT written down on camera
- [ ] No other browser tabs open (looks unprofessional)
- [ ] Slack/Teams notifications DISABLED (don't let pop-ups appear)
- [ ] Phone on silent
- [ ] Lighting is good (can see screen clearly)
- [ ] Recording location: `/path/to/screencast_meta_channels.mp4`

---

## DURING RECORDING

### Pacing
- Move mouse slowly — 2-3 seconds between actions
- Pause 2 seconds after each action completes before speaking again
- Let UI animations finish before moving to next action

### Audio
- Speak clearly, not too fast (like you're explaining to someone on a call)
- Pause between sentences (gives reviewers time to process)
- Use professional tone (not casual, not robotic)

### If You Mess Up
- **Keep recording** — don't stop and restart
- Fix the mistake onscreen and continue
- You can edit it down in post (see step below)

### If Component Doesn't Load
- Wait 5 seconds (network might be slow)
- If still broken, pause recording, fix it, restart from that scene
- This is normal — Supabase cold starts happen

---

## POST-RECORDING EDITING (30 minutes)

Use DaVinci Resolve (free) or Camtasia:

1. **Import the raw video** into editor
2. **Trim** any dead time or mistakes (but keep it natural)
3. **Add text overlays** for these sections:
   - "Step 1: Authenticate with Meta" (at 1:30)
   - "Step 2: Verify Phone Number" (at 3:00)
   - "Step 3: View Templates" (at 4:00)
   - "API Request to Meta Graph API" (at 8:00)
4. **Export** as MP4 (H.264, AAC, 1920x1080)
5. **Check file size** — should be 200-400 MB for 10-minute video

---

## UPLOAD TO DRIVE

Once encoded:

1. Go to https://drive.google.com
2. Create new folder: `omnio-meta-review`
3. Upload `screencast_meta_channels.mp4`
4. Right-click → Share → "Anyone with link can view"
5. Copy the share link
6. Save this link — you'll paste it into Meta submission

**Format:** `https://drive.google.com/file/d/[FILE_ID]/view?usp=sharing`

---

## FINAL CHECKLIST BEFORE SUBMITTING TO META

- [ ] Screencast is 9-12 minutes long
- [ ] Resolution is 1080p or higher (check properties)
- [ ] Audio is clear (test on different speakers/headphones)
- [ ] All three connection flows shown (WhatsApp, Messenger, Instagram)
- [ ] All three API calls evidenced (DevTools shows 200 responses)
- [ ] No sensitive data visible (passwords, real tokens, etc.)
- [ ] Screencast is in English throughout
- [ ] Google Drive link works and is publicly accessible
- [ ] Tried watching link on different browser/computer — still works
- [ ] All actions are slow enough to follow (not rushed)
- [ ] Narrative is clear and professional

---

## WHAT TO DO AFTER RECORDING

1. **Upload to Google Drive** (see above)
2. **Update your Meta submission** with the video link
3. **Add reviewer instructions** (use template from previous checklist)
4. **Add permission justifications** (use templates from previous checklist)
5. **Submit to Meta** — click "Submit for Review"

---

## TIMING BREAKDOWN

```
9:00 AM  - OBS setup, test recording
9:30 AM  - Clear browser, prepare for main recording
10:00 AM - RECORD main screencast (~15 min recording time)
10:30 AM - Edit and trim (~30 min)
11:00 AM - Export and upload to Google Drive (~30 min)
11:30 AM - Test the link, verify quality
12:00 PM - DONE — ready to submit to Meta
```

You can have this done by **lunchtime**.

---

## IF SOMETHING DOESN'T WORK

### "Login fails"
→ Test login on main app first. If it works there, it's a one-off. Record again.

### "API call fails (500 error)"
→ Check Edge Function logs: `supabase functions logs list-waba-templates --project-ref xrycghxaxqzvkmzqzzkx`
→ Most likely: Supabase cold start. Wait 10 seconds and try again.

### "Screencast mode banner not showing"
→ Run `enableScreencastMode()` in console again
→ Check that localStorage has `digitivia_screencast_mode = '1'`
→ Reload page (Cmd+R)

### "Video is blurry or pixelated"
→ You encoded at wrong resolution. Re-encode at 1920x1080.
→ Use HandBrake if OBS export failed: https://handbrake.fr/

### "Permission dialog doesn't appear"
→ You're logged in already. Log out completely.
→ Clear cookies: Settings → Privacy → Clear browsing data
→ Try again.

---

## SUCCESS = 

Recording done, uploaded, and submitted to Meta by **5 PM today**.

Then you're in queue for review. Meta will test this exact flow next week.

Your 400/500 errors will disappear once they approve.

---

**Good luck. You've got this. 🚀**
