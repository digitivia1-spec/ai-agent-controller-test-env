/**
 * Edge Function: analyze-sentiment
 *
 * Analyzes sentiment of incoming messages.
 * Can be called per-message or in batch mode.
 *
 * Deploy: supabase functions deploy analyze-sentiment
 * Env vars needed: OPENAI_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
    try {
        const { message_id, message_ids, org_id } = await req.json();

        if (!org_id) {
            return new Response(JSON.stringify({ error: 'org_id required' }), { status: 400 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const ids = message_ids || (message_id ? [message_id] : []);

        if (ids.length === 0) {
            return new Response(JSON.stringify({ error: 'message_id or message_ids required' }), { status: 400 });
        }

        // Fetch messages
        const { data: messages, error: fetchErr } = await supabase
            .from('inbox_messages')
            .select('id, content, conversation_id')
            .in('id', ids);

        if (fetchErr || !messages?.length) {
            return new Response(JSON.stringify({ error: 'Messages not found' }), { status: 404 });
        }

        // Analyze each message
        const results = [];
        for (const msg of messages) {
            if (!msg.content || msg.content.trim().length < 3) {
                results.push({ id: msg.id, sentiment: 'neutral', score: 0 });
                continue;
            }

            const { sentiment, score } = await classifySentiment(msg.content);

            // Update message
            await supabase.from('inbox_messages').update({
                sentiment,
                sentiment_score: score,
                sentiment_analyzed_at: new Date().toISOString(),
            }).eq('id', msg.id);

            // Update conversation's last sentiment
            await supabase.from('inbox_conversations').update({
                last_sentiment: sentiment,
                sentiment_updated_at: new Date().toISOString(),
            }).eq('id', msg.conversation_id);

            results.push({ id: msg.id, sentiment, score });
        }

        return new Response(JSON.stringify({ success: true, results }));

    } catch (err) {
        console.error('analyze-sentiment error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});

async function classifySentiment(text: string): Promise<{ sentiment: string; score: number }> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a sentiment classifier for customer messages. Classify the message into exactly one category and provide a score.

Categories:
- "positive" (happy, grateful, satisfied) → score 0.5 to 1.0
- "neutral" (informational, question, neither positive nor negative) → score -0.2 to 0.2
- "negative" (unhappy, frustrated, complaining) → score -1.0 to -0.5
- "urgent" (angry, threatening to leave, demanding immediate help) → score -1.0 to -0.7

Respond ONLY with valid JSON: {"sentiment": "...", "score": 0.0}`
                },
                { role: 'user', content: text.slice(0, 500) } // limit to 500 chars
            ],
            max_tokens: 50,
            temperature: 0,
        }),
    });

    if (!res.ok) {
        throw new Error(`OpenAI error: ${res.status}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    try {
        const parsed = JSON.parse(reply);
        const validSentiments = ['positive', 'neutral', 'negative', 'urgent'];
        return {
            sentiment: validSentiments.includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
            score: typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0,
        };
    } catch {
        return { sentiment: 'neutral', score: 0 };
    }
}
