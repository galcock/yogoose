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

You have access to a web_search tool. USE IT AGGRESSIVELY. Search first, answer second. Specifically:
- ALWAYS search if you're not 100% certain of the answer
- ALWAYS search for anything you don't immediately recognize
- ALWAYS search for names, brands, companies, products, or terms that could be specific things
- ALWAYS search for current events, news, scores, schedules
- ALWAYS search for real-time data (stock prices, weather, game times)
- If someone asks "what is X" and X could be a website, product, company, or brand — SEARCH FOR IT
- Never say "I'm not familiar with" or "I don't recognize" — just search for it

Do NOT:
- Start with "Great question" or similar filler
- Repeat the question back
- Add unnecessary caveats or disclaimers
- Be overly verbose
- NEVER narrate what you're doing ("Let me search...", "I'll look that up...", "Searching for..."). Just give the answer directly.
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

    // Collect the full response, then stream only the final text content
    // This prevents narration ("Let me search...", "I'll look that up...") from leaking
    const response = await stream.finalMessage();

    // Extract only text blocks from the final response
    let finalText = '';
    let hasSearch = response.content.some(b => b.type === 'server_tool_use' || b.type === 'tool_use');

    // Get all text blocks
    const allText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n\n');

    if (hasSearch) {
      // Try to get text after the last search tool
      let lastSearchIdx = -1;
      response.content.forEach((b, i) => {
        if (b.type === 'server_tool_use' || b.type === 'tool_use' || b.type === 'server_tool_result' || b.type === 'tool_result') {
          lastSearchIdx = i;
        }
      });
      const afterSearch = response.content
        .filter((b, i) => b.type === 'text' && i > lastSearchIdx)
        .map(b => b.text)
        .join('\n\n')
        .trim();

      if (afterSearch.length > 5) {
        // Good — we have a real answer after the search
        finalText = afterSearch;
      } else {
        // Fallback — strip common narration patterns from all text
        finalText = allText
          .replace(/^(Let me|I'll|I will|Searching|Looking|Let me search)[^.]*\.\s*/gi, '')
          .replace(/^(I'll search|Let me look|Let me find)[^.]*\.\s*/gi, '')
          .trim();
      }
    } else {
      finalText = allText;
    }

    // Final safety: if we ended up with nothing, use all text
    if (!finalText || finalText.length <= 2) {
      finalText = allText.trim();
    }

    // Stream the clean text in chunks for the typing effect
    // Send full text at once for clean rendering
    res.write(`data: ${JSON.stringify({ type: 'text', content: finalText })}\n\n`);

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
    // Build messages from conversation history + new query
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

    const response = await stream.finalMessage();

    let finalText = '';
    let hasSearch = response.content.some(b => b.type === 'server_tool_use' || b.type === 'tool_use');

    const allText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n\n');

    if (hasSearch) {
      let lastSearchIdx = -1;
      response.content.forEach((b, i) => {
        if (b.type === 'server_tool_use' || b.type === 'tool_use' || b.type === 'server_tool_result' || b.type === 'tool_result') {
          lastSearchIdx = i;
        }
      });
      const afterSearch = response.content
        .filter((b, i) => b.type === 'text' && i > lastSearchIdx)
        .map(b => b.text)
        .join('\n\n')
        .trim();

      if (afterSearch.length > 5) {
        finalText = afterSearch;
      } else {
        finalText = allText
          .replace(/^(Let me|I'll|I will|Searching|Looking|Let me search)[^.]*\.\s*/gi, '')
          .replace(/^(I'll search|Let me look|Let me find)[^.]*\.\s*/gi, '')
          .trim();
      }
    } else {
      finalText = allText;
    }

    if (!finalText || finalText.length <= 2) {
      finalText = allText.trim();
    }

    // Send full text at once for clean rendering
    res.write(`data: ${JSON.stringify({ type: 'text', content: finalText })}\n\n`);

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Claude followup error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', content: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
}

module.exports = { streamResponse, streamFollowup };
