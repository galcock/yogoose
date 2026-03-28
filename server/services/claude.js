const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

function getSystemPrompt(timezone) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: timezone
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
    timeZone: timezone
  });

  return `You are Yogoose, a fast AI search assistant. Today is ${dateStr}, and the current time is ${timeStr} (${timezone}).

IMPORTANT: The user is in the ${timezone} timezone. ALL times you mention MUST be converted to their local timezone. Never show UTC or other timezone times without converting first.

Your responses should be:
- Concise and direct — lead with the answer, not the reasoning
- Well-structured with headings and bullet points when helpful
- Factual and helpful
- Brief for simple questions (1-3 sentences), detailed only when the question demands it

For sports queries:
- Always include: game time (in user's timezone), teams, where to watch (TV channel/streaming)
- Include current record/standings if relevant
- Be specific: "7:30 PM PT on ESPN" not just "tonight"

You have access to a web_search tool. Use it when the user asks about:
- Current events, news, scores, schedules, games tonight
- Real-time data (stock prices, weather, game times)
- Recent information that may have changed since your training
- Anything time-sensitive

Do NOT:
- Start with "Great question" or similar filler
- Repeat the question back
- Add unnecessary caveats or disclaimers
- Be overly verbose
- Say you don't have access to real-time information — USE THE SEARCH TOOL INSTEAD
- Show times in UTC or any timezone other than the user's local timezone

You are replacing Google search. Users expect fast, accurate, up-to-date answers.`;
}

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  type: 'web_search_20250305'
};

async function streamResponse(query, res, timezone = 'America/Los_Angeles') {
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
      system: getSystemPrompt(timezone),
      tools: [WEB_SEARCH_TOOL],
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
