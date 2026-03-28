const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { detectIntent, getAutocompleteSuggestions, getRelatedSites } = require('./services/intent');
const { streamResponse, streamFollowup } = require('./services/claude');

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

  // AI response — stream it with user's timezone
  const tz = req.query.tz || 'America/Los_Angeles';
  // Check if this is a news query
  const newsWords = ['news', 'headlines', 'breaking news', 'today news', 'current events', 'top stories'];
  const isNews = newsWords.some(w => (intent.query || q).toLowerCase().includes(w));
  streamResponse(intent.query || q, res, tz, isNews ? 'news' : null);
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
