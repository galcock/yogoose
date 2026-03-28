const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Yogoose, a fast AI search assistant. Your responses should be:
- Concise and direct — lead with the answer, not the reasoning
- Well-structured with headings and bullet points when helpful
- Factual and helpful
- Brief for simple questions (1-3 sentences), detailed only when the question demands it

Do NOT:
- Start with "Great question" or similar filler
- Repeat the question back
- Add unnecessary caveats or disclaimers
- Be overly verbose

You are replacing Google search. Users expect fast, accurate, useful answers.`;

async function streamResponse(query, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  try {
    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: query }]
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Claude API error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', content: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
}

module.exports = { streamResponse };
