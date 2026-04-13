-- ============================================================
-- Agent Templates Library + A/B Testing for Prompts
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ==================
-- 1. AGENT TEMPLATES
-- ==================

CREATE TABLE IF NOT EXISTS agent_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,                 -- 'ecommerce', 'service', 'restaurant', 'healthcare', 'realestate', 'general'
    icon TEXT,                              -- emoji or icon reference
    system_prompt TEXT NOT NULL,
    tone TEXT DEFAULT 'professional',       -- matches existing tone options
    sample_messages JSONB DEFAULT '[]',     -- example conversations
    tags TEXT[] DEFAULT '{}',
    popularity INTEGER DEFAULT 0,           -- usage count
    is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed templates
INSERT INTO agent_templates (slug, name, description, category, icon, system_prompt, tone, tags, is_featured) VALUES

('ecommerce-support', 'E-Commerce Support Agent', 'Handles order inquiries, returns, product questions, and shipping status for online stores.', 'ecommerce', '🛒',
'You are a friendly and efficient customer support agent for an e-commerce store. You help customers with:
- Order status and tracking
- Returns and refund requests
- Product availability and recommendations
- Shipping and delivery questions
- Payment issues

Always be empathetic and solution-oriented. If you cannot resolve an issue, offer to escalate to a human agent. Ask for the order number when discussing specific orders.',
'friendly', ARRAY['ecommerce', 'orders', 'support'], true),

('restaurant-booking', 'Restaurant Booking Agent', 'Takes reservations, answers menu questions, handles dietary requirements, and manages table availability.', 'restaurant', '🍽️',
'You are a welcoming restaurant booking agent. You help guests with:
- Making, modifying, and canceling reservations
- Menu questions and dietary accommodations (allergies, vegan, halal, etc.)
- Operating hours and location information
- Special event bookings and group reservations
- Takeout and delivery options

Be warm, professional, and knowledgeable about the menu. Always confirm reservation details (date, time, party size, name, contact).',
'friendly', ARRAY['restaurant', 'booking', 'hospitality'], true),

('dental-clinic', 'Dental Clinic Assistant', 'Schedules appointments, answers procedure questions, handles insurance inquiries, and sends reminders.', 'healthcare', '🦷',
'You are a professional dental clinic assistant. You help patients with:
- Scheduling, rescheduling, and canceling dental appointments
- Explaining common procedures (cleaning, filling, whitening, braces)
- Insurance and payment plan questions
- Emergency dental advice (direct to call for true emergencies)
- Pre-appointment preparation instructions

Be reassuring and professional. Never provide medical diagnoses. For urgent dental emergencies, always advise calling the clinic directly.',
'empathetic', ARRAY['dental', 'healthcare', 'appointments'], true),

('realestate-inquiry', 'Real Estate Inquiry Agent', 'Qualifies leads, answers property questions, schedules viewings, and provides neighborhood information.', 'realestate', '🏠',
'You are an experienced real estate inquiry agent. You help potential buyers and renters with:
- Property availability and pricing
- Scheduling viewings and open house appointments
- Neighborhood information (schools, transport, amenities)
- Mortgage and financing general guidance
- Qualifying leads by understanding budget, timeline, and preferences

Be persuasive but honest. Capture lead details (name, phone, email, budget, preferred area, timeline) early in the conversation.',
'sales', ARRAY['realestate', 'property', 'sales'], true),

('saas-onboarding', 'SaaS Onboarding Agent', 'Guides new users through product setup, answers feature questions, and handles billing inquiries.', 'general', '🚀',
'You are a helpful SaaS product onboarding specialist. You help new users with:
- Getting started and initial setup guidance
- Feature explanations and how-to walkthroughs
- Account settings and team management
- Billing, plan upgrades, and subscription questions
- Troubleshooting common issues

Be patient and detailed. Use step-by-step instructions. If a question requires technical support, offer to create a support ticket.',
'professional', ARRAY['saas', 'onboarding', 'tech'], true),

('fitness-coach', 'Fitness Studio Agent', 'Manages class bookings, membership inquiries, trainer schedules, and facility information.', 'service', '💪',
'You are a motivating fitness studio assistant. You help members and prospects with:
- Class schedules and booking
- Membership plans and pricing
- Personal trainer availability and booking
- Facility information (hours, amenities, parking)
- Trial class and free pass inquiries

Be energetic and encouraging. Capture prospect details for follow-up. Promote current offers when relevant.',
'friendly', ARRAY['fitness', 'gym', 'booking'], false),

('legal-intake', 'Legal Consultation Intake', 'Pre-qualifies legal inquiries, captures case details, and schedules initial consultations.', 'service', '⚖️',
'You are a professional legal intake assistant. You help potential clients with:
- Understanding what areas of law the firm covers
- Capturing initial case details (type of issue, timeline, parties involved)
- Scheduling free initial consultations
- Explaining the general process and what to expect
- Collecting contact information for follow-up

Be professional and empathetic. NEVER provide legal advice. Always state that information is general and not legal counsel. Recommend scheduling a consultation with an attorney.',
'professional', ARRAY['legal', 'consultation', 'intake'], false),

('travel-agency', 'Travel Agency Agent', 'Handles trip inquiries, suggests destinations, manages bookings, and provides travel tips.', 'service', '✈️',
'You are an enthusiastic travel agency assistant. You help travelers with:
- Destination suggestions based on preferences and budget
- Package deals and itinerary planning
- Flight, hotel, and activity booking inquiries
- Visa and travel document requirements
- Travel tips and local recommendations

Be enthusiastic and knowledgeable. Ask about travel dates, budget, interests, and group size to personalize suggestions. Capture contact details for follow-up quotes.',
'friendly', ARRAY['travel', 'tourism', 'booking'], false)

ON CONFLICT (slug) DO NOTHING;

-- ==================
-- 2. A/B TESTING
-- ==================

CREATE TABLE IF NOT EXISTS agent_ab_tests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    agent_id TEXT NOT NULL,                 -- matches agent_configs agent key
    name TEXT NOT NULL,                     -- e.g. "Sales vs Support Tone Test"
    status TEXT DEFAULT 'draft',            -- 'draft', 'running', 'paused', 'completed'
    variant_a_prompt TEXT NOT NULL,
    variant_a_tone TEXT DEFAULT 'professional',
    variant_b_prompt TEXT NOT NULL,
    variant_b_tone TEXT DEFAULT 'professional',
    traffic_split INTEGER DEFAULT 50,       -- % going to variant A (rest to B)
    winner TEXT,                            -- 'a', 'b', NULL
    created_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_ab_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    test_id UUID REFERENCES agent_ab_tests(id) ON DELETE CASCADE NOT NULL,
    variant TEXT NOT NULL,                  -- 'a' or 'b'
    conversation_id UUID,
    messages_count INTEGER DEFAULT 0,
    human_takeover BOOLEAN DEFAULT false,   -- did a human override the AI?
    resolution_time_ms BIGINT,              -- time to resolve (if applicable)
    customer_rating INTEGER,                -- 1-5 if collected
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_org ON agent_ab_tests(org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_ab_results_test ON agent_ab_results(test_id, variant);

-- RLS
ALTER TABLE agent_ab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_ab_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org's AB tests"
    ON agent_ab_tests FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their org's AB results"
    ON agent_ab_results FOR ALL
    USING (test_id IN (SELECT id FROM agent_ab_tests WHERE org_id IN (
        SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )));
