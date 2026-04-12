/**
 * Edge Function: chunk-documents
 *
 * Triggered when a file is uploaded to the knowledge base.
 * 1. Downloads the file from Supabase Storage
 * 2. Extracts text content (PDF, DOCX, TXT, CSV)
 * 3. Splits into semantic chunks (~500 tokens each)
 * 4. Generates embeddings via OpenAI text-embedding-3-small
 * 5. Stores chunks + embeddings in kb_chunks table
 *
 * Deploy: supabase functions deploy chunk-documents
 * Env vars needed: OPENAI_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CHUNK_SIZE = 500; // target tokens per chunk
const CHUNK_OVERLAP = 50; // overlap tokens between chunks
const EMBEDDING_MODEL = 'text-embedding-3-small';

Deno.serve(async (req) => {
    try {
        const { file_id, org_id, agent_id } = await req.json();

        if (!file_id || !org_id) {
            return new Response(JSON.stringify({ error: 'file_id and org_id required' }), { status: 400 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // 1. Update status to processing
        await supabase.from('agent_kb_files').update({ chunking_status: 'processing' }).eq('id', file_id);

        // 2. Fetch file metadata
        const { data: fileRecord, error: fileErr } = await supabase
            .from('agent_kb_files')
            .select('*')
            .eq('id', file_id)
            .single();

        if (fileErr || !fileRecord) {
            throw new Error('File not found: ' + (fileErr?.message || 'unknown'));
        }

        // 3. Download file from storage
        const { data: fileBlob, error: dlErr } = await supabase.storage
            .from('knowledge_base')
            .download(fileRecord.file_path);

        if (dlErr || !fileBlob) {
            throw new Error('Download failed: ' + (dlErr?.message || 'unknown'));
        }

        // 4. Extract text based on file type
        const text = await extractText(fileBlob, fileRecord.file_name);

        // 5. Split into chunks
        const chunks = splitIntoChunks(text, CHUNK_SIZE, CHUNK_OVERLAP);

        // 6. Generate embeddings in batches
        const embeddings = await generateEmbeddings(chunks);

        // 7. Store in kb_chunks
        const rows = chunks.map((chunk, i) => ({
            org_id,
            agent_id: agent_id || null,
            source_type: 'file',
            source_id: file_id,
            source_name: fileRecord.file_name,
            chunk_index: i,
            content: chunk,
            token_count: Math.ceil(chunk.length / 4), // rough estimate
            embedding: embeddings[i],
        }));

        // Delete existing chunks for this source
        await supabase.from('kb_chunks').delete().eq('source_id', file_id);

        // Insert in batches of 50
        for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50);
            const { error: insertErr } = await supabase.from('kb_chunks').insert(batch);
            if (insertErr) throw new Error('Insert failed: ' + insertErr.message);
        }

        // 8. Update status
        await supabase.from('agent_kb_files').update({
            chunking_status: 'done',
            chunk_count: chunks.length,
            chunking_error: null,
        }).eq('id', file_id);

        return new Response(JSON.stringify({ success: true, chunks: chunks.length }));

    } catch (err) {
        console.error('chunk-documents error:', err);

        // Try to update error status
        try {
            const { file_id } = await req.clone().json().catch(() => ({}));
            if (file_id) {
                const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
                await supabase.from('agent_kb_files').update({
                    chunking_status: 'error',
                    chunking_error: String(err.message || err),
                }).eq('id', file_id);
            }
        } catch (_e) { /* ignore */ }

        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});

// --- Text Extraction ---
async function extractText(blob: Blob, filename: string): Promise<string> {
    const ext = filename.split('.').pop()?.toLowerCase();

    if (ext === 'txt' || ext === 'csv') {
        return await blob.text();
    }

    // For PDF/DOCX, you'd use a parsing library (pdf-parse, mammoth, etc.)
    // For now, attempt to read as text — replace with proper parser in production
    // TODO: Add pdf-parse for PDF, mammoth for DOCX
    return await blob.text();
}

// --- Chunking ---
function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let i = 0;

    while (i < words.length) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        if (chunk.trim()) chunks.push(chunk.trim());
        i += chunkSize - overlap;
    }

    return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

// --- Embeddings ---
async function generateEmbeddings(chunks: string[]): Promise<number[][]> {
    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const res = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI error: ${res.status} ${err}`);
        }

        const data = await res.json();
        for (const item of data.data) {
            allEmbeddings.push(item.embedding);
        }
    }

    return allEmbeddings;
}
