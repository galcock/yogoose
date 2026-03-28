const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { detectIntent, getAutocompleteSuggestions, getRelatedSites } = require('./services/intent');
const { streamResponse, streamFollowup } = require('./services/claude');
const { getTopHeadlines, timeAgo } = require('./services/news');
const { get7DayForecast } = require('./services/weather');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & performance middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://s3.tradingview.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://s3.tradingview.com"],
      frameSrc: ["'self'", "https://s.tradingview.com"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(compression());
app.use(cors());
app.use(express.json());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Serve static files with aggressive caching
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  etag: true
}));

// --- API Routes ---

// Autocomplete endpoint — must be FAST
app.get('/api/autocomplete', (req, res) => {
  const q = req.query.q || '';
  if (q.trim().length === 0) return res.json([]);
  const suggestions = getAutocompleteSuggestions(q);
  res.json(suggestions);
});

// Search endpoint — intent detection + response
app.get('/api/search', (req, res) => {
  const q = req.query.q || '';
  if (q.trim().length === 0) return res.json({ type: 'empty' });

  const intent = detectIntent(q);

  if (intent.type === 'navigate') {
    return res.json(intent);
  }

  // Check if this is a news query — serve news feed directly (no AI needed)
  const newsWords = ['news', 'headlines', 'breaking news', 'today news', 'current events', 'top stories'];
  const isNews = newsWords.some(w => (intent.query || q).toLowerCase().trim() === w || (intent.query || q).toLowerCase().includes(w));
  if (isNews) {
    return res.json({ type: 'news' });
  }

  // Check if this is a weather query — include forecast widget
  const weatherWords = ['weather', 'forecast', 'temperature', 'rain today', 'weather today', 'weather tomorrow', 'weather this week'];
  const isWeather = weatherWords.some(w => (intent.query || q).toLowerCase().trim() === w || (intent.query || q).toLowerCase().includes(w));
  if (isWeather) {
    return res.json({ type: 'weather' });
  }

  // AI response — stream it with user's timezone
  const tz = req.query.tz || 'America/Los_Angeles';
  streamResponse(intent.query || q, res, tz);
});

// Weather forecast API
app.get('/api/weather', async (req, res) => {
  const forecast = await get7DayForecast();
  res.json(forecast || []);
});

// Link map — returns brand names mapped to URLs for auto-linking
app.get('/api/linkmap', (req, res) => {
  const sites = require('./data/sites.json');
  const map = {};
  for (const site of sites) {
    // Only include sites with recognizable names (4+ chars, not abbreviations)
    if (site.name.length >= 4) {
      map[site.name] = site.url;
    }
  }
  // Add extra common services/brands not in our nav DB
  Object.assign(map, {
    'Apple TV': 'https://tv.apple.com',
    'Apple TV+': 'https://tv.apple.com',
    'Fandango': 'https://fandango.com',
    'AMC Theatres': 'https://amctheatres.com',
    'Regal': 'https://regmovies.com',
    'Cinemark': 'https://cinemark.com',
    'NBA League Pass': 'https://nba.com/watch',
    'NFL Sunday Ticket': 'https://tv.youtube.com/nfl',
    'ESPN+': 'https://plus.espn.com',
    'Peacock': 'https://peacocktv.com',
    'Paramount+': 'https://paramountplus.com',
    'Crunchyroll': 'https://crunchyroll.com',
    'Amazon Prime': 'https://primevideo.com',
    'Prime Video': 'https://primevideo.com',
    'Spectrum SportsNet': 'https://spectrum.net',
    'YES Network': 'https://yesnetwork.com',
    'TNT': 'https://tntdrama.com',
    'TBS': 'https://tbs.com',
    'ABC': 'https://abc.com',
    'CBS': 'https://cbs.com',
    'NBC': 'https://nbc.com',
    'FOX': 'https://fox.com',
    'NBATV': 'https://nba.com/watch',
    'MLB.TV': 'https://mlb.com/tv',
    'NFL Network': 'https://nfl.com/network',
    'Rotten Tomatoes': 'https://rottentomatoes.com',
    'Fresh Kernels': 'https://freshkernels.com',
    'Metacritic': 'https://metacritic.com',
    'Letterboxd': 'https://letterboxd.com',
    'Google Maps': 'https://maps.google.com',
    'Uber Eats': 'https://ubereats.com',
    'DoorDash': 'https://doordash.com',
    'Instacart': 'https://instacart.com',
    'GoodRx': 'https://goodrx.com',
    'Zillow': 'https://zillow.com',
    'Fidelity': 'https://fidelity.com',
    'Vanguard': 'https://vanguard.com',
    // Sports networks & streaming
    'truTV': 'https://trutv.com',
    'March Madness': 'https://www.ncaa.com/march-madness',
    'March Madness Live': 'https://www.ncaa.com/march-madness-live',
    'Final Four': 'https://www.ncaa.com/final-four',
    'NCAA': 'https://ncaa.com',
    'Lucas Oil Stadium': 'https://www.lucasoilstadium.com',
    // College teams
    'Duke': 'https://goduke.com',
    'UConn': 'https://uconnhuskies.com',
    'Arizona': 'https://arizonawildcats.com',
    'Purdue': 'https://purduesports.com',
    'Iowa': 'https://hawkeyesports.com',
    'Illinois': 'https://fightingillini.com',
    'Michigan': 'https://mgoblue.com',
    'Alabama': 'https://rolltide.com',
    'Tennessee': 'https://utsports.com',
    'Michigan State': 'https://msuspartans.com',
    'Iowa State': 'https://cyclones.com',
    "St. John's": 'https://redstormsports.com',
  });
  res.json(map);
});

// News feed API
app.get('/api/news', async (req, res) => {
  try {
    const articles = await getTopHeadlines(10);
    res.json(articles.map(a => ({
      ...a,
      timeAgo: timeAgo(a.publishedAt)
    })));
  } catch (err) {
    res.json([]);
  }
});

// Ambient ticker — lazy-loaded tidbits for the homepage
app.get('/api/ambient', async (req, res) => {
  const tz = req.query.tz || 'America/Los_Angeles';
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz
    });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      tools: [{ name: 'web_search', type: 'web_search_20250305' }],
      messages: [{ role: 'user', content: `Today is ${dateStr}. Give me exactly 10 short one-line tidbits for someone in Los Angeles, SORTED BY POPULARITY/INTEREST (most interesting first). Priority order:
1. Lakers game today/tonight (ALWAYS first if they play)
2. Dodgers game today/tonight (ALWAYS second if they play)
3. Other major LA sports (Rams, Chargers, Clippers, Kings, Galaxy, LAFC)
4. Weather
5. Biggest national news headline
6. Entertainment/movies in theaters
7. Local events this weekend
8. Stock market if notable move
Also include 2-3 major NON-local items like:
- Big national/global sports events (F1 race, UFC, March Madness, World Cup, etc.)
- Major movie releases this weekend
- Biggest national news story
Format as a JSON array of strings. Each under 80 chars. Example: ["Lakers vs Nets tonight at 7:30 PM PT", "F1 Japanese Grand Prix Sunday 10 PM PT"]` }]
    });

    // Extract JSON from the response, strip citation tags
    const textBlocks = response.content.filter(b => b.type === 'text');
    let text = textBlocks[textBlocks.length - 1]?.text || '[]';
    // Strip <cite> tags that come from web search
    text = text.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '');
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const items = JSON.parse(match[0]);
      // Clean any remaining HTML tags from items
      res.json(items.map(item => item.replace(/<[^>]*>/g, '').trim()));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error('Ambient error:', err.message);
    res.json([]);
  }
});

// Follow-up with conversation history
app.post('/api/followup', (req, res) => {
  const { query, history, tz } = req.body;
  if (!query || !query.trim()) return res.json({ error: 'No query' });
  const timezone = tz || 'America/Los_Angeles';
  streamFollowup(query, history || [], res, timezone);
});

// Related sites for AI queries
app.get('/api/related', (req, res) => {
  const q = req.query.q || '';
  res.json(getRelatedSites(q));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// SPA fallback — serve index.html for unmatched routes (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const filePath = path.join(__dirname, '..', 'public', req.path);
  res.sendFile(filePath, (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }
  });
});

// Local dev: listen on port. Vercel: export the app.
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Yogoose running at http://localhost:${PORT}`);
  });
}
