const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

function getTzAbbr(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' }).formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : timezone;
  } catch { return timezone; }
}

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
  const tzAbbr = getTzAbbr(timezone);

  return `You are Yogoose, a fast AI search assistant. Today is ${dateStr}, and the current time is ${timeStr} ${tzAbbr}.

IMPORTANT TIMEZONE RULES:
- The user is in the ${timezone} timezone (${tzAbbr}).
- ALL times you mention MUST be in ${tzAbbr}. Always append "${tzAbbr}" after every time. Example: "7:30 PM ${tzAbbr}"
- NEVER show UTC, ET, CT, or any other timezone unless specifically asked. Convert everything to ${tzAbbr}.
- NEVER omit the timezone abbreviation from times. Always write "7:30 PM ${tzAbbr}", never just "7:30 PM".

Your responses should be:
- Conversational and natural — talk like a helpful friend, not a robot
- Lead with a direct sentence answer: "The Lakers play tonight at 7:30 PM ${tzAbbr} against the Nets."
- Use bullet points or structure only when listing multiple items
- Factual and helpful
- Brief for simple questions (1-3 sentences), detailed only when the question demands it

For sports queries:
- For SCORES: ALWAYS lead with the final score in format "Lakers 112, Nets 98" or "The Lakers beat the Nets 112-98". Include the date of the game, key stats, and next game info.
- For UPCOMING GAMES: Include the day/date, time in ${tzAbbr}, venue, where to watch, and team records
- For GENERAL team queries: Include current record, standings position, recent results, and next game
- Always be specific with numbers — scores, records, stats

For movie queries:
- When someone searches for a movie title (like "project hail mary", "thunderbolts", etc.), ALWAYS search for "[movie name] showtimes" to check if it's in theaters
- If the movie is currently in theaters, your response MUST start with: "[Movie] is in theaters now." Then include:
  - Rotten Tomatoes score and audience score
  - Runtime
  - A line saying: "Find showtimes near you: [Fandango](https://www.fandango.com/search?q=MOVIE), [AMC](https://www.amctheatres.com/search?query=MOVIE)"
  - Brief plot summary (1-2 sentences)
  - Box office numbers if notable
- If NOT in theaters, provide standard movie info

You have access to a web_search tool. USE IT AGGRESSIVELY. Search first, answer second. Specifically:
- ALWAYS search if you're not 100% certain of the answer
- ALWAYS search for anything you don't immediately recognize
- ALWAYS search for names, brands, companies, products, or terms that could be specific things
- ALWAYS search for current events, news, scores, schedules
- ALWAYS search for real-time data (stock prices, weather, game times)
- If someone asks "what is X" and X could be a website, product, company, or brand — SEARCH FOR IT
- Never say "I'm not familiar with" or "I don't recognize" — just search for it

CRITICAL: NEVER narrate what you're doing. Do NOT say "Let me search...", "I'll look that up...", "Searching for...", or similar. Just give the answer directly. If you use web_search, do NOT mention it — just present the results.

Do NOT:
- Start with "Great question" or similar filler
- Repeat the question back
- Add unnecessary caveats or disclaimers
- Be overly verbose
- NEVER narrate what you're doing
- NEVER say you don't have access to real-time information
- NEVER say you're not familiar with something — SEARCH FOR IT INSTEAD
- NEVER ask the user for more context before trying to answer — search first, then answer with what you find
- NEVER end your response with a question like "Would you like more details?" or "Are you looking for..."
- NEVER ask follow-up questions — just give the complete answer
- Show times in UTC or any timezone other than the user's local timezone

For sports queries specifically, include ALL of this:
- Game time with day/date and timezone
- Teams with their current records (W-L)
- Venue
- Where to watch (TV channels and streaming)
- Conference/division standings position
- Recent form or streak if notable (e.g. "on a 5-game win streak")
- Key players to watch or injury updates if available

You are replacing Google search. Users expect fast, accurate, up-to-date answers.`;
}

const NEWS_FORMAT_INSTRUCTION = `
FORMAT YOUR RESPONSE AS A NEWS FEED. Use EXACTLY this markdown format for each story:

## [Headline text](URL)
**Source Name** · Time ago

Brief 1-2 sentence summary of the story.

---

Include 8-10 top news stories. Search for "top news today" and "breaking news" to get the latest headlines. Each story MUST have:
- A headline as an h2 with a link to the source article
- Source name and time (bolded source, then · then time)
- 1-2 sentence summary
- A horizontal rule (---) between stories

DO NOT include any intro text like "Here are today's top stories". Just start with the first headline.
`;

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  type: 'web_search_20250305'
};

// Stream response directly — no buffering, maximum speed
async function streamResponse(query, res, timezone = 'America/Los_Angeles', format = null) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  try {
    let systemPrompt = getSystemPrompt(timezone);
    if (format === 'news') {
      systemPrompt += '\n\n' + NEWS_FORMAT_INSTRUCTION;
    }

    // Send format info to client
    if (format) {
      res.write(`data: ${JSON.stringify({ type: 'format', format })}\n\n`);
    }

    const stream = await client.messages.stream({
      model: format === 'news' ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001',
      max_tokens: format === 'news' ? 2048 : 1024,
      system: systemPrompt,
      tools: [WEB_SEARCH_TOOL],
      messages: [{ role: 'user', content: format === 'news' ? 'Show me today\'s top news headlines' : query }]
    });

    // Track which content block is after search (the actual answer)
    let seenSearch = false;
    let inAnswerBlock = false;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'server_tool_use' || event.content_block?.type === 'tool_use') {
          seenSearch = true;
          inAnswerBlock = false;
        } else if (event.content_block?.type === 'text') {
          // If we've seen a search, this text block is the answer
          // If no search yet, this is potentially narration
          inAnswerBlock = seenSearch;
        }
      }
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (!seenSearch || inAnswerBlock) {
          // Stream it — either no search was used (direct answer) or this is post-search answer
          res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
        }
        // Skip pre-search narration text blocks
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

async function streamFollowup(query, history, res, timezone = 'America/Los_Angeles') {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  try {
    const messages = [];
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: 'user', content: query });

    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: getSystemPrompt(timezone),
      tools: [WEB_SEARCH_TOOL],
      messages
    });

    let seenSearch = false;
    let inAnswerBlock = false;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'server_tool_use' || event.content_block?.type === 'tool_use') {
          seenSearch = true;
          inAnswerBlock = false;
        } else if (event.content_block?.type === 'text') {
          inAnswerBlock = seenSearch;
        }
      }
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (!seenSearch || inAnswerBlock) {
          res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Claude followup error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', content: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
}

module.exports = { streamResponse, streamFollowup };
