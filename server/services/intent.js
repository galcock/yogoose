const sites = require('../data/sites.json');

// --- Build lookup structures at startup ---

// Exact match map: alias -> { name, url }
const aliasMap = new Map();
// Name map: normalized name -> { name, url }
const nameMap = new Map();
// All entries for prefix/fuzzy matching
const allEntries = [];

for (const site of sites) {
  const entry = { name: site.name, url: site.url };
  nameMap.set(site.name.toLowerCase(), entry);
  for (const alias of site.aliases) {
    aliasMap.set(alias.toLowerCase().trim(), entry);
  }
  allEntries.push({ name: site.name, url: site.url, aliases: site.aliases.map(a => a.toLowerCase().trim()) });
}

// --- Trie for prefix matching ---

class TrieNode {
  constructor() {
    this.children = {};
    this.entries = [];
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(key, entry) {
    let node = this.root;
    for (const ch of key) {
      if (!node.children[ch]) node.children[ch] = new TrieNode();
      node = node.children[ch];
    }
    node.entries.push(entry);
  }

  search(prefix) {
    let node = this.root;
    for (const ch of prefix) {
      if (!node.children[ch]) return [];
      node = node.children[ch];
    }
    // Collect all entries in subtree
    const results = [];
    const stack = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      results.push(...current.entries);
      for (const child of Object.values(current.children)) {
        stack.push(child);
      }
      if (results.length >= 5) break;
    }
    return results;
  }
}

const trie = new Trie();
for (const entry of allEntries) {
  // Insert the site name
  trie.insert(entry.name.toLowerCase().replace(/[^a-z0-9]/g, ''), { name: entry.name, url: entry.url });
  // Insert all aliases
  for (const alias of entry.aliases) {
    trie.insert(alias.replace(/[^a-z0-9]/g, ''), { name: entry.name, url: entry.url });
  }
}

// --- Question detection ---

const QUESTION_STARTERS = new Set([
  'what', 'how', 'why', 'where', 'when', 'who', 'which',
  'is', 'are', 'can', 'do', 'does', 'should', 'will', 'would',
  'could', 'did', 'has', 'have', 'was', 'were',
  'compare', 'explain', 'tell', 'define', 'describe',
  'show', 'list', 'give', 'find', 'calculate', 'convert',
  'translate', 'summarize', 'write', 'create', 'make',
  'help', 'suggest', 'recommend'
]);

const QUESTION_PHRASES = [
  'how to', 'how do', 'how can', 'how much', 'how many', 'how long',
  'what is', 'what are', 'what does', 'what do', 'what was', 'what were',
  'why is', 'why are', 'why do', 'why does', 'why did',
  'where is', 'where are', 'where do', 'where can',
  'when is', 'when was', 'when did', 'when does',
  'who is', 'who are', 'who was', 'who did',
  'which is', 'which are',
  'is it', 'is there', 'are there',
  'can i', 'can you', 'can we',
  'should i', 'should we',
  'difference between', 'vs ', 'versus ',
  'best way to', 'how to fix', 'how to make',
  'pros and cons', 'advantages of', 'disadvantages of',
  'meaning of', 'definition of',
  'recipe for', 'ingredients for',
  'price of', 'cost of',
  'review of', 'reviews for',
  'distance from', 'directions to',
  'symptoms of', 'treatment for', 'cure for',
  'history of', 'origin of',
  'example of', 'examples of'
];

// --- Levenshtein distance for fuzzy matching ---

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// --- URL detection ---

const URL_REGEX = /\.(com|org|net|io|gov|edu|co|ai|app|dev|me|tv|us|uk|ca|au|de|fr|jp|info|biz|xyz|tech|site|online|store|shop)$/i;
const FULL_URL_REGEX = /^(https?:\/\/)?[\w.-]+\.(com|org|net|io|gov|edu|co|ai|app|dev|me|tv|us|uk|ca|au|de|fr|jp|info|biz|xyz|tech|site|online|store|shop)(\/.*)?$/i;

// --- Main intent detection ---

function detectIntent(query) {
  if (!query || !query.trim()) {
    return { type: 'empty' };
  }

  const raw = query.trim();
  const normalized = raw.toLowerCase().trim();
  const words = normalized.split(/\s+/);

  // 1. Check for full URL — redirect directly
  if (FULL_URL_REGEX.test(normalized)) {
    let url = normalized;
    if (!url.startsWith('http')) url = 'https://' + url;
    return { type: 'navigate', url, name: url, confidence: 1.0 };
  }

  // 2. Check for question patterns FIRST (multi-word queries)
  if (words.length >= 2) {
    // Check question phrases
    for (const phrase of QUESTION_PHRASES) {
      if (normalized.startsWith(phrase)) {
        return { type: 'ai', query: raw, confidence: 1.0 };
      }
    }
    // Check question starter + it's clearly not a site name
    if (QUESTION_STARTERS.has(words[0]) && words.length >= 3) {
      return { type: 'ai', query: raw, confidence: 0.95 };
    }
  }

  // 3. Check if ends with question mark
  if (raw.endsWith('?')) {
    return { type: 'ai', query: raw, confidence: 1.0 };
  }

  // 4. Exact alias match
  const exactMatch = aliasMap.get(normalized);
  if (exactMatch) {
    return { type: 'navigate', url: exactMatch.url, name: exactMatch.name, confidence: 1.0 };
  }

  // 5. URL pattern match (has TLD)
  if (URL_REGEX.test(normalized)) {
    let url = normalized;
    if (!url.startsWith('http')) url = 'https://' + url;
    return { type: 'navigate', url, name: normalized, confidence: 0.95 };
  }

  // Common English words that should NOT fuzzy/prefix match to sites
  const GENERIC_WORDS = new Set([
    'cooking', 'booking', 'looking', 'working', 'talking', 'walking', 'making', 'taking',
    'going', 'being', 'doing', 'having', 'getting', 'saying', 'thinking', 'feeling',
    'running', 'coming', 'playing', 'reading', 'writing', 'eating', 'sleeping', 'buying',
    'selling', 'living', 'dying', 'giving', 'finding', 'telling', 'asking', 'trying',
    'using', 'calling', 'moving', 'leaving', 'turning', 'starting', 'showing', 'hearing',
    'growing', 'keeping', 'setting', 'putting', 'standing', 'losing', 'paying', 'meeting',
    'sitting', 'speaking', 'rising', 'opening', 'closing', 'holding', 'learning',
    'weather', 'water', 'world', 'place', 'house', 'money', 'phone', 'paper',
    'power', 'light', 'night', 'story', 'point', 'woman', 'child', 'thing', 'party',
    'state', 'school', 'heart', 'human', 'young', 'small', 'large', 'great', 'right',
    'still', 'every', 'after', 'other', 'never', 'again', 'under', 'often', 'early',
    'later', 'three', 'seven', 'eight', 'black', 'white', 'green', 'space', 'short',
    'price', 'order', 'store', 'stock', 'trade', 'board', 'class', 'court', 'round',
    'watch', 'drive', 'stand', 'break', 'clear', 'plant', 'cover', 'table', 'blood',
    'sports', 'games', 'movies', 'books', 'travel', 'health', 'finance', 'music',
    'photos', 'video', 'design', 'nature', 'animal', 'garden', 'market', 'search',
    'social', 'media', 'email', 'cloud', 'mobile', 'dating', 'style', 'beauty',
    'drink', 'hotel', 'legal', 'taxes', 'loans', 'cards', 'paint', 'floor',
    'dream', 'sleep', 'brain', 'teeth', 'mouth', 'smile', 'happy', 'angry',
    'funny', 'scary', 'clean', 'cheap', 'fresh', 'quick', 'smart', 'sound',
    'color', 'shape', 'print', 'track', 'train', 'truck', 'build', 'craft',
    'hunting', 'fishing', 'hiking', 'skiing', 'surfing', 'camping', 'climbing',
    'racing', 'boxing', 'diving', 'flying', 'riding', 'sailing', 'rowing',
    'singing', 'dancing', 'painting', 'drawing', 'typing', 'coding',
    'science', 'physics', 'biology', 'english', 'french', 'german', 'spanish',
    'history', 'culture', 'energy', 'change', 'growth', 'trust', 'value',
    'testing', 'review', 'update', 'report', 'status', 'guide', 'advice',
    'recipe', 'dinner', 'lunch', 'snack', 'pizza', 'chicken', 'steak',
    'coffee', 'juice', 'cream', 'sugar', 'bread', 'fruit', 'salad',
    'news', 'food', 'cars', 'jobs', 'maps', 'pets', 'home', 'shop',
    'blog', 'wiki', 'chat', 'mail', 'help', 'info', 'tips', 'deals',
    'math', 'work', 'play', 'love', 'life', 'time', 'call', 'plan',
    'save', 'send', 'post', 'link', 'note', 'file', 'code', 'data',
    'test', 'edit', 'copy', 'move', 'open', 'close', 'list', 'sort',
    'find', 'view', 'show', 'hide', 'lock', 'vote', 'pick', 'rate',
    'box', 'dice', 'kick', 'mint', 'loom', 'hike', 'match', 'rover',
    'bolt', 'rush', 'drop', 'push', 'pull', 'jump',
    'rock', 'wave', 'ring', 'ball', 'star', 'moon', 'wind'
  ]);

  // 6. Prefix match via trie (for partial site names like "rotten" -> rottentomatoes)
  // Skip for single generic words
  if (words.length <= 2 && !(words.length === 1 && GENERIC_WORDS.has(normalized))) {
    const searchKey = normalized.replace(/[^a-z0-9]/g, '');
    if (searchKey.length >= 5) {
      const trieResults = trie.search(searchKey);
      if (trieResults.length > 0) {
        // Deduplicate
        const seen = new Set();
        const unique = trieResults.filter(r => {
          if (seen.has(r.url)) return false;
          seen.add(r.url);
          return true;
        });
        return { type: 'navigate', url: unique[0].url, name: unique[0].name, confidence: 0.85 };
      }
    }
  }

  // 7. Fuzzy match for single-word queries (typo correction)
  // Only triggers when: first letter matches, not a common English word, distance is small
  if (words.length === 1 && normalized.length >= 3) {
    if (!GENERIC_WORDS.has(normalized)) {
      let bestMatch = null;
      let bestDist = Infinity;
      const maxDist = 1; // Only allow 1 character difference to prevent false matches

      for (const [alias, entry] of aliasMap) {
        // First letter must match (typos rarely change the first letter)
        if (alias[0] !== normalized[0]) continue;
        // Only compare similar-length strings
        if (Math.abs(alias.length - normalized.length) > maxDist) continue;
        const dist = levenshtein(normalized, alias);
        if (dist <= maxDist && dist < bestDist) {
          bestDist = dist;
          bestMatch = entry;
        }
      }

      if (bestMatch) {
        return { type: 'navigate', url: bestMatch.url, name: bestMatch.name, confidence: 0.7 };
      }
    }
  }

  // 8. Single word that's a question starter — treat as AI
  if (words.length === 1 && QUESTION_STARTERS.has(words[0])) {
    return { type: 'ai', query: raw, confidence: 0.5 };
  }

  // 9. Multi-word query with no site match — default to AI
  if (words.length >= 2) {
    return { type: 'ai', query: raw, confidence: 0.8 };
  }

  // 10. Single word, no match — default to AI
  return { type: 'ai', query: raw, confidence: 0.6 };
}

// --- Autocomplete suggestions ---

function getAutocompleteSuggestions(query, limit = 7) {
  if (!query || query.trim().length === 0) return [];

  const normalized = query.toLowerCase().trim();
  const results = [];
  const seen = new Set();

  // 1. Exact prefix match on aliases
  for (const [alias, entry] of aliasMap) {
    if (alias.startsWith(normalized) && !seen.has(entry.url)) {
      seen.add(entry.url);
      results.push({
        text: entry.name,
        url: entry.url,
        type: 'navigate'
      });
      if (results.length >= limit) return results;
    }
  }

  // 2. Trie prefix match
  const searchKey = normalized.replace(/[^a-z0-9]/g, '');
  if (searchKey.length >= 2) {
    const trieResults = trie.search(searchKey);
    for (const entry of trieResults) {
      if (!seen.has(entry.url)) {
        seen.add(entry.url);
        results.push({
          text: entry.name,
          url: entry.url,
          type: 'navigate'
        });
        if (results.length >= limit) return results;
      }
    }
  }

  // 3. Contains match (if few results)
  if (results.length < 3 && normalized.length >= 3) {
    for (const [alias, entry] of aliasMap) {
      if (alias.includes(normalized) && !seen.has(entry.url)) {
        seen.add(entry.url);
        results.push({
          text: entry.name,
          url: entry.url,
          type: 'navigate'
        });
        if (results.length >= limit) return results;
      }
    }
  }

  // 4. If no site matches or query looks like a question, suggest AI
  if (results.length === 0 || normalized.split(/\s+/).length >= 2) {
    results.push({
      text: query.trim(),
      type: 'ai'
    });
  }

  return results.slice(0, limit);
}

// --- Related sites for AI queries ---
// Find sites that might be relevant to what the user searched

// Topic-to-sites mapping — includes external sites not in our nav DB
const TOPIC_SITES = {
  physics: [
    { name: 'Phys.org', url: 'https://phys.org' },
    { name: 'Physics Today', url: 'https://physicstoday.org' },
    { name: 'HyperPhysics', url: 'http://hyperphysics.phy-astr.gsu.edu' }
  ],
  chemistry: [
    { name: 'PubChem', url: 'https://pubchem.ncbi.nlm.nih.gov' },
    { name: 'Royal Society of Chemistry', url: 'https://rsc.org' },
    { name: 'ChemSpider', url: 'https://chemspider.com' }
  ],
  biology: [
    { name: 'Nature', url: 'https://nature.com' },
    { name: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov' },
    { name: 'Biology Online', url: 'https://biologyonline.com' }
  ],
  science: [
    { name: 'Nature', url: 'https://nature.com' },
    { name: 'Science Magazine', url: 'https://science.org' },
    { name: 'Phys.org', url: 'https://phys.org' }
  ],
  math: [
    { name: 'Wolfram MathWorld', url: 'https://mathworld.wolfram.com' },
    { name: 'Khan Academy', url: 'https://khanacademy.org' },
    { name: 'Desmos', url: 'https://desmos.com' }
  ],
  history: [
    { name: 'History.com', url: 'https://history.com' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org' },
    { name: 'Britannica', url: 'https://britannica.com' }
  ],
  sports: [
    { name: 'ESPN', url: 'https://espn.com' },
    { name: 'CBS Sports', url: 'https://cbssports.com' },
    { name: 'Bleacher Report', url: 'https://bleacherreport.com' }
  ],
  news: [
    { name: 'Fox News', url: 'https://foxnews.com' },
    { name: 'CNN', url: 'https://cnn.com' },
    { name: 'Planck Standard', url: 'https://planckstandard.com' }
  ],
  politics: [
    { name: 'Politico', url: 'https://politico.com' },
    { name: 'AP News', url: 'https://apnews.com' },
    { name: 'The Hill', url: 'https://thehill.com' }
  ],
  movies: [
    { name: 'Rotten Tomatoes', url: 'https://rottentomatoes.com' },
    { name: 'IMDb', url: 'https://imdb.com' },
    { name: 'Fresh Kernels', url: 'https://freshkernels.com' }
  ],
  tv: [
    { name: 'IMDb', url: 'https://imdb.com' },
    { name: 'TV Guide', url: 'https://tvguide.com' },
    { name: 'Rotten Tomatoes', url: 'https://rottentomatoes.com' }
  ],
  music: [
    { name: 'Spotify', url: 'https://open.spotify.com' },
    { name: 'Genius', url: 'https://genius.com' },
    { name: 'Pitchfork', url: 'https://pitchfork.com' }
  ],
  food: [
    { name: 'Allrecipes', url: 'https://allrecipes.com' },
    { name: 'Serious Eats', url: 'https://seriouseats.com' },
    { name: 'Bon Appetit', url: 'https://bonappetit.com' }
  ],
  cooking: [
    { name: 'Allrecipes', url: 'https://allrecipes.com' },
    { name: 'Serious Eats', url: 'https://seriouseats.com' },
    { name: 'Food Network', url: 'https://foodnetwork.com' }
  ],
  restaurants: [
    { name: 'Yelp', url: 'https://yelp.com' },
    { name: 'OpenTable', url: 'https://opentable.com' },
    { name: 'TripAdvisor', url: 'https://tripadvisor.com' }
  ],
  travel: [
    { name: 'TripAdvisor', url: 'https://tripadvisor.com' },
    { name: 'Google Flights', url: 'https://google.com/flights' },
    { name: 'Booking.com', url: 'https://booking.com' }
  ],
  flights: [
    { name: 'Google Flights', url: 'https://google.com/flights' },
    { name: 'Kayak', url: 'https://kayak.com' },
    { name: 'Skyscanner', url: 'https://skyscanner.com' }
  ],
  hotels: [
    { name: 'Booking.com', url: 'https://booking.com' },
    { name: 'Hotels.com', url: 'https://hotels.com' },
    { name: 'Airbnb', url: 'https://airbnb.com' }
  ],
  health: [
    { name: 'WebMD', url: 'https://webmd.com' },
    { name: 'Mayo Clinic', url: 'https://mayoclinic.org' },
    { name: 'Healthline', url: 'https://healthline.com' }
  ],
  medical: [
    { name: 'Mayo Clinic', url: 'https://mayoclinic.org' },
    { name: 'WebMD', url: 'https://webmd.com' },
    { name: 'NIH', url: 'https://nih.gov' }
  ],
  fitness: [
    { name: 'MyFitnessPal', url: 'https://myfitnesspal.com' },
    { name: 'Strava', url: 'https://strava.com' },
    { name: 'Healthline', url: 'https://healthline.com' }
  ],
  finance: [
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com' },
    { name: 'Bloomberg', url: 'https://bloomberg.com' },
    { name: 'NerdWallet', url: 'https://nerdwallet.com' }
  ],
  stocks: [
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com' },
    { name: 'MarketWatch', url: 'https://marketwatch.com' },
    { name: 'Bloomberg', url: 'https://bloomberg.com' }
  ],
  crypto: [
    { name: 'CoinGecko', url: 'https://coingecko.com' },
    { name: 'CoinMarketCap', url: 'https://coinmarketcap.com' },
    { name: 'Coinbase', url: 'https://coinbase.com' }
  ],
  shopping: [
    { name: 'Amazon', url: 'https://amazon.com' },
    { name: 'Google Shopping', url: 'https://shopping.google.com' },
    { name: 'Wirecutter', url: 'https://nytimes.com/wirecutter' }
  ],
  tech: [
    { name: 'TechCrunch', url: 'https://techcrunch.com' },
    { name: 'The Verge', url: 'https://theverge.com' },
    { name: 'Ars Technica', url: 'https://arstechnica.com' }
  ],
  programming: [
    { name: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { name: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
    { name: 'GitHub', url: 'https://github.com' }
  ],
  coding: [
    { name: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: 'MDN Web Docs', url: 'https://developer.mozilla.org' }
  ],
  ai: [
    { name: 'ChatGPT', url: 'https://chatgpt.com' },
    { name: 'Hugging Face', url: 'https://huggingface.co' },
    { name: 'Papers With Code', url: 'https://paperswithcode.com' }
  ],
  gaming: [
    { name: 'IGN', url: 'https://ign.com' },
    { name: 'Steam', url: 'https://store.steampowered.com' },
    { name: 'Polygon', url: 'https://polygon.com' }
  ],
  education: [
    { name: 'Khan Academy', url: 'https://khanacademy.org' },
    { name: 'Coursera', url: 'https://coursera.org' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org' }
  ],
  realestate: [
    { name: 'Zillow', url: 'https://zillow.com' },
    { name: 'Redfin', url: 'https://redfin.com' },
    { name: 'Realtor.com', url: 'https://realtor.com' }
  ],
  jobs: [
    { name: 'LinkedIn', url: 'https://linkedin.com' },
    { name: 'Indeed', url: 'https://indeed.com' },
    { name: 'Glassdoor', url: 'https://glassdoor.com' }
  ],
  weather: [
    { name: 'Weather.com', url: 'https://weather.com' },
    { name: 'AccuWeather', url: 'https://accuweather.com' },
    { name: 'Weather Underground', url: 'https://wunderground.com' }
  ],
  cars: [
    { name: 'Edmunds', url: 'https://edmunds.com' },
    { name: 'Kelley Blue Book', url: 'https://kbb.com' },
    { name: 'CarGurus', url: 'https://cargurus.com' }
  ],
  legal: [
    { name: 'FindLaw', url: 'https://findlaw.com' },
    { name: 'Nolo', url: 'https://nolo.com' },
    { name: 'Avvo', url: 'https://avvo.com' }
  ],
  parenting: [
    { name: 'BabyCenter', url: 'https://babycenter.com' },
    { name: 'What to Expect', url: 'https://whattoexpect.com' },
    { name: 'Parents', url: 'https://parents.com' }
  ],
  fashion: [
    { name: 'Vogue', url: 'https://vogue.com' },
    { name: 'GQ', url: 'https://gq.com' },
    { name: 'Who What Wear', url: 'https://whowhatwear.com' }
  ],
  space: [
    { name: 'NASA', url: 'https://nasa.gov' },
    { name: 'Space.com', url: 'https://space.com' },
    { name: 'SpaceX', url: 'https://spacex.com' }
  ],
  astronomy: [
    { name: 'NASA', url: 'https://nasa.gov' },
    { name: 'Space.com', url: 'https://space.com' },
    { name: 'Sky & Telescope', url: 'https://skyandtelescope.org' }
  ],
  psychology: [
    { name: 'Psychology Today', url: 'https://psychologytoday.com' },
    { name: 'APA', url: 'https://apa.org' },
    { name: 'Verywell Mind', url: 'https://verywellmind.com' }
  ],
  environment: [
    { name: 'National Geographic', url: 'https://nationalgeographic.com' },
    { name: 'EPA', url: 'https://epa.gov' },
    { name: 'Climate.gov', url: 'https://climate.gov' }
  ],
  pets: [
    { name: 'PetMD', url: 'https://petmd.com' },
    { name: 'AKC', url: 'https://akc.org' },
    { name: 'Chewy', url: 'https://chewy.com' }
  ],
  books: [
    { name: 'Goodreads', url: 'https://goodreads.com' },
    { name: 'Amazon Books', url: 'https://amazon.com/books' },
    { name: 'Audible', url: 'https://audible.com' }
  ],
  diy: [
    { name: 'Instructables', url: 'https://instructables.com' },
    { name: 'Home Depot', url: 'https://homedepot.com' },
    { name: 'YouTube', url: 'https://youtube.com' }
  ],
  outdoors: [
    { name: 'AllTrails', url: 'https://alltrails.com' },
    { name: 'REI', url: 'https://rei.com' },
    { name: 'Outside Magazine', url: 'https://outsideonline.com' }
  ],
  fishing: [
    { name: 'Bass Pro Shops', url: 'https://basspro.com' },
    { name: 'FishingBooker', url: 'https://fishingbooker.com' },
    { name: 'Field & Stream', url: 'https://fieldandstream.com' }
  ],
  hunting: [
    { name: 'Cabela\'s', url: 'https://cabelas.com' },
    { name: 'Bass Pro Shops', url: 'https://basspro.com' },
    { name: 'Field & Stream', url: 'https://fieldandstream.com' }
  ],
  gardening: [
    { name: 'The Spruce', url: 'https://thespruce.com' },
    { name: 'Gardening Know How', url: 'https://gardeningknowhow.com' },
    { name: 'Home Depot', url: 'https://homedepot.com' }
  ]
};

// Keywords that map to topics
const TOPIC_KEYWORDS = {
  physics: ['physics', 'quantum', 'relativity', 'gravity', 'atom', 'particle', 'energy', 'force', 'velocity', 'acceleration', 'momentum', 'electron', 'photon', 'neutron', 'proton', 'thermodynamic', 'electromagnetic', 'nuclear', 'optic', 'wave', 'light', 'speed'],
  chemistry: ['chemistry', 'chemical', 'molecule', 'element', 'compound', 'reaction', 'acid', 'base', 'periodic', 'bond', 'ion', 'organic', 'inorganic'],
  biology: ['biology', 'cell', 'dna', 'gene', 'evolution', 'species', 'organism', 'ecosystem', 'bacteria', 'virus', 'protein', 'enzyme'],
  science: ['science', 'scientific', 'research', 'experiment', 'hypothesis', 'theory', 'laboratory'],
  math: ['math', 'calculus', 'algebra', 'geometry', 'equation', 'formula', 'theorem', 'probability', 'statistics', 'integral', 'derivative', 'matrix', 'logarithm', 'trigonometry', 'fraction', 'percentage', 'calculate'],
  history: ['history', 'historical', 'ancient', 'medieval', 'century', 'civilization', 'empire', 'dynasty', 'revolution', 'war', 'battle', 'king', 'queen', 'president'],
  sports: ['sport', 'score', 'team', 'player', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis', 'golf', 'boxing', 'ufc', 'mma', 'championship', 'playoff', 'tournament', 'athlete', 'coach', 'league', 'lakers', 'celtics', 'warriors', 'bulls', 'knicks', 'nets', 'heat', 'bucks', 'sixers', 'nuggets', 'suns', 'mavericks', 'clippers', 'cowboys', 'patriots', 'chiefs', 'eagles', 'packers', 'niners', '49ers', 'steelers', 'ravens', 'bills', 'broncos', 'dolphins', 'yankees', 'dodgers', 'mets', 'cubs', 'braves', 'astros', 'phillies', 'padres', 'redsox', 'red sox', 'standings', 'roster', 'schedule', 'halftime', 'super bowl', 'world series', 'march madness', 'final four'],
  news: ['news', 'latest', 'breaking', 'headline', 'current event', 'update'],
  politics: ['politic', 'election', 'democrat', 'republican', 'congress', 'senate', 'governor', 'policy', 'legislation', 'vote', 'ballot', 'campaign'],
  movies: ['movie', 'film', 'actor', 'actress', 'director', 'oscar', 'cinema', 'box office', 'trailer', 'rating', 'review', 'screenplay', 'documentary', 'showtime', 'showtimes', 'theater', 'theatre', 'imax'],
  tv: ['tv show', 'television', 'series', 'episode', 'season', 'streaming', 'sitcom', 'drama', 'reality show'],
  music: ['music', 'song', 'album', 'artist', 'band', 'singer', 'concert', 'lyric', 'genre', 'rap', 'hip hop', 'rock', 'pop', 'jazz', 'classical', 'playlist', 'Grammy'],
  food: ['food', 'recipe', 'cook', 'bake', 'ingredient', 'meal', 'dish', 'cuisine', 'diet', 'nutrition', 'calorie', 'vegan', 'vegetarian', 'gluten'],
  cooking: ['cooking', 'baking', 'roast', 'grill', 'fry', 'saut', 'stew', 'soup', 'pasta', 'bread', 'cake', 'dessert', 'sauce'],
  restaurants: ['restaurant', 'dining', 'dine', 'eat out', 'takeout', 'delivery', 'brunch', 'cafe', 'bistro', 'bar'],
  travel: ['travel', 'trip', 'vacation', 'destination', 'tourism', 'itinerary', 'passport', 'visa', 'backpack', 'sightseeing'],
  flights: ['flight', 'airline', 'airport', 'plane', 'ticket', 'layover', 'boarding', 'baggage'],
  hotels: ['hotel', 'motel', 'resort', 'hostel', 'accommodation', 'lodging', 'check-in', 'booking'],
  health: ['health', 'symptom', 'treatment', 'cure', 'diagnos', 'condition', 'disease', 'illness', 'pain', 'remedy', 'wellness', 'vitamin', 'supplement'],
  medical: ['medical', 'doctor', 'hospital', 'surgery', 'prescription', 'medication', 'patient', 'diagnosis', 'clinic', 'therapy', 'pharmaceutical'],
  fitness: ['fitness', 'exercise', 'workout', 'gym', 'weight', 'cardio', 'muscle', 'training', 'running', 'yoga', 'stretch'],
  finance: ['finance', 'financial', 'money', 'budget', 'saving', 'tax', 'income', 'expense', 'interest', 'loan', 'mortgage', 'insurance', 'retire', 'pension'],
  stocks: ['stock', 'invest', 'market', 'share', 'dividend', 'portfolio', 'bull', 'bear', 'trading', 'ipo', 'nasdaq', 'dow', 'index', 'fund', 'etf'],
  crypto: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'token', 'defi', 'nft', 'wallet', 'mining', 'altcoin', 'binance', 'coinbase'],
  shopping: ['buy', 'price', 'cheap', 'deal', 'coupon', 'discount', 'sale', 'shop', 'store', 'product', 'purchase', 'compare', 'cost'],
  tech: ['tech', 'technology', 'gadget', 'device', 'smartphone', 'laptop', 'tablet', 'startup', 'silicon valley', 'innovation'],
  programming: ['programming', 'code', 'developer', 'software', 'bug', 'api', 'function', 'variable', 'loop', 'array', 'database', 'server', 'frontend', 'backend', 'framework', 'library', 'python', 'javascript', 'java', 'react', 'node', 'css', 'html', 'sql'],
  coding: ['coding', 'debug', 'compile', 'runtime', 'syntax', 'algorithm', 'data structure'],
  ai: ['artificial intelligence', 'machine learning', 'neural network', 'deep learning', 'nlp', 'gpt', 'llm', 'chatbot', 'model', 'training data'],
  gaming: ['gaming', 'video game', 'gamer', 'esport', 'rpg', 'fps', 'mmorpg', 'multiplayer', 'indie game', 'console', 'fortnite', 'minecraft', 'roblox', 'valorant', 'overwatch', 'zelda', 'mario', 'elden ring', 'playstation', 'xbox', 'nintendo', 'steam'],
  education: ['education', 'learn', 'course', 'study', 'tutor', 'degree', 'university', 'college', 'school', 'scholarship', 'exam', 'test', 'homework', 'assignment', 'lecture'],
  realestate: ['real estate', 'house', 'apartment', 'rent', 'property', 'condo', 'townhouse', 'listing', 'sqft', 'bedroom', 'landlord', 'tenant'],
  jobs: ['job', 'career', 'hiring', 'resume', 'interview', 'salary', 'remote work', 'freelance', 'employer', 'applicant', 'position', 'opening'],
  weather: ['weather', 'forecast', 'temperature', 'rain', 'snow', 'storm', 'humidity', 'wind', 'climate', 'sunny', 'cloudy', 'hurricane', 'tornado'],
  cars: ['car', 'vehicle', 'auto', 'truck', 'suv', 'sedan', 'electric vehicle', 'hybrid', 'mpg', 'horsepower', 'engine', 'transmission', 'dealer', 'lease'],
  legal: ['law', 'legal', 'lawyer', 'attorney', 'court', 'lawsuit', 'sue', 'contract', 'liability', 'rights', 'regulation', 'statute', 'tort', 'litigation'],
  parenting: ['parent', 'baby', 'child', 'toddler', 'newborn', 'pregnancy', 'pregnant', 'breastfeed', 'diaper', 'pediatric', 'daycare', 'preschool'],
  fashion: ['fashion', 'style', 'outfit', 'clothing', 'designer', 'trend', 'wardrobe', 'accessories', 'shoes', 'handbag', 'runway'],
  space: ['space', 'nasa', 'rocket', 'satellite', 'astronaut', 'mars', 'moon', 'planet', 'solar system', 'orbit', 'launch', 'spacex'],
  astronomy: ['astronomy', 'star', 'galaxy', 'nebula', 'telescope', 'comet', 'asteroid', 'constellation', 'cosmos', 'universe', 'black hole', 'supernova'],
  psychology: ['psychology', 'mental health', 'anxiety', 'depression', 'therapy', 'therapist', 'cognitive', 'behavior', 'emotion', 'stress', 'ptsd', 'disorder', 'adhd', 'ocd'],
  environment: ['environment', 'climate change', 'global warming', 'pollution', 'renewable', 'solar', 'sustainability', 'carbon', 'emission', 'recycle', 'ecosystem', 'biodiversity', 'endangered'],
  pets: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'breed', 'vet', 'veterinar', 'grooming', 'adoption', 'shelter', 'leash', 'kibble'],
  books: ['book', 'novel', 'author', 'reading', 'fiction', 'nonfiction', 'literary', 'bestseller', 'chapter', 'publisher', 'genre', 'memoir', 'biography'],
  diy: ['diy', 'how to build', 'how to fix', 'repair', 'install', 'assemble', 'craft', 'woodwork', 'plumbing', 'renovation'],
  outdoors: ['outdoor', 'hiking', 'camping', 'backpacking', 'trail', 'mountain', 'climbing', 'kayaking', 'canoeing', 'surfing', 'skiing', 'snowboarding', 'rock climbing', 'national park'],
  fishing: ['fishing', 'fish', 'bass', 'trout', 'salmon', 'angling', 'tackle', 'lure', 'bait', 'fly fishing', 'deep sea'],
  hunting: ['hunting', 'hunt', 'deer', 'elk', 'duck hunting', 'archery', 'bow hunting', 'rifle', 'shotgun', 'game bird', 'pheasant'],
  gardening: ['gardening', 'garden', 'plant', 'flower', 'seed', 'soil', 'compost', 'fertilizer', 'pruning', 'landscaping', 'lawn', 'vegetable garden', 'herb garden']
};

// Generate search-specific fallback links using the query
function getDefaultSites(query) {
  const q = encodeURIComponent(query);
  // For proper-noun-like queries (could be a movie, show, person, place),
  // show IMDb + Rotten Tomatoes + Wikipedia instead of Reddit/YouTube
  const words = query.trim().split(/\s+/);
  const looksLikeProperNoun = words.length >= 2 && words.every(w => /^[A-Z]/.test(w) || w.length <= 3);
  const looksLikeTitle = words.length >= 2;

  if (looksLikeTitle) {
    return [
      { name: `${query} on IMDb`, url: `https://www.imdb.com/find/?q=${q}` },
      { name: `${query} on Rotten Tomatoes`, url: `https://www.rottentomatoes.com/search?search=${q}` },
      { name: `${query} on Wikipedia`, url: `https://en.wikipedia.org/w/index.php?search=${q}` }
    ];
  }

  return [
    { name: `${query} on Wikipedia`, url: `https://en.wikipedia.org/w/index.php?search=${q}` },
    { name: `${query} on Reddit`, url: `https://www.reddit.com/search/?q=${q}` },
    { name: `${query} on YouTube`, url: `https://www.youtube.com/results?search_query=${q}` }
  ];
}

function getRelatedSites(query, limit = 3) {
  if (!query) return getDefaultSites('search');

  const normalized = query.toLowerCase().trim();
  const stopWords = new Set(['the', 'what', 'how', 'why', 'where', 'when', 'who', 'which', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'will', 'would', 'has', 'have', 'had', 'for', 'and', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'from', 'they', 'been', 'its', 'than', 'into', 'about', 'between', 'through', 'best', 'most', 'more', 'some', 'any', 'all', 'very', 'just', 'also', 'much', 'many', 'way', 'make', 'like', 'get', 'use']);
  const words = normalized.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
  const results = [];
  const seen = new Set();

  // 0. Check for sports team names — generate contextual links
  const NBA_TEAMS = { 'lakers': 'Los Angeles Lakers', 'celtics': 'Boston Celtics', 'warriors': 'Golden State Warriors', 'bulls': 'Chicago Bulls', 'knicks': 'New York Knicks', 'nets': 'Brooklyn Nets', 'heat': 'Miami Heat', 'bucks': 'Milwaukee Bucks', 'sixers': 'Philadelphia 76ers', '76ers': 'Philadelphia 76ers', 'nuggets': 'Denver Nuggets', 'suns': 'Phoenix Suns', 'mavericks': 'Dallas Mavericks', 'mavs': 'Dallas Mavericks', 'clippers': 'LA Clippers', 'raptors': 'Toronto Raptors', 'spurs': 'San Antonio Spurs', 'thunder': 'Oklahoma City Thunder', 'grizzlies': 'Memphis Grizzlies', 'pelicans': 'New Orleans Pelicans', 'hawks': 'Atlanta Hawks', 'cavaliers': 'Cleveland Cavaliers', 'cavs': 'Cleveland Cavaliers', 'pacers': 'Indiana Pacers', 'pistons': 'Detroit Pistons', 'wizards': 'Washington Wizards', 'hornets': 'Charlotte Hornets', 'magic': 'Orlando Magic', 'timberwolves': 'Minnesota Timberwolves', 'wolves': 'Minnesota Timberwolves', 'blazers': 'Portland Trail Blazers', 'kings': 'Sacramento Kings', 'jazz': 'Utah Jazz', 'rockets': 'Houston Rockets' };
  const NFL_TEAMS = { 'cowboys': 'Dallas Cowboys', 'patriots': 'New England Patriots', 'chiefs': 'Kansas City Chiefs', 'eagles': 'Philadelphia Eagles', 'packers': 'Green Bay Packers', '49ers': 'San Francisco 49ers', 'niners': 'San Francisco 49ers', 'steelers': 'Pittsburgh Steelers', 'ravens': 'Baltimore Ravens', 'bills': 'Buffalo Bills', 'broncos': 'Denver Broncos', 'dolphins': 'Miami Dolphins', 'bears': 'Chicago Bears', 'giants': 'New York Giants', 'jets': 'New York Jets', 'rams': 'Los Angeles Rams', 'chargers': 'Los Angeles Chargers', 'seahawks': 'Seattle Seahawks', 'saints': 'New Orleans Saints', 'falcons': 'Atlanta Falcons', 'vikings': 'Minnesota Vikings', 'bengals': 'Cincinnati Bengals', 'browns': 'Cleveland Browns', 'lions': 'Detroit Lions', 'titans': 'Tennessee Titans', 'colts': 'Indianapolis Colts', 'texans': 'Houston Texans', 'jaguars': 'Jacksonville Jaguars', 'commanders': 'Washington Commanders', 'panthers': 'Carolina Panthers', 'buccaneers': 'Tampa Bay Buccaneers', 'bucs': 'Tampa Bay Buccaneers', 'cardinals': 'Arizona Cardinals', 'raiders': 'Las Vegas Raiders' };
  const MLB_TEAMS = { 'yankees': 'New York Yankees', 'dodgers': 'Los Angeles Dodgers', 'mets': 'New York Mets', 'cubs': 'Chicago Cubs', 'braves': 'Atlanta Braves', 'astros': 'Houston Astros', 'phillies': 'Philadelphia Phillies', 'padres': 'San Diego Padres', 'red sox': 'Boston Red Sox', 'redsox': 'Boston Red Sox', 'white sox': 'Chicago White Sox', 'giants': 'San Francisco Giants', 'cardinals': 'St. Louis Cardinals', 'mariners': 'Seattle Mariners', 'rangers': 'Texas Rangers', 'twins': 'Minnesota Twins', 'guardians': 'Cleveland Guardians', 'orioles': 'Baltimore Orioles', 'rays': 'Tampa Bay Rays', 'royals': 'Kansas City Royals', 'tigers': 'Detroit Tigers', 'angels': 'Los Angeles Angels', 'athletics': 'Oakland Athletics', 'brewers': 'Milwaukee Brewers', 'reds': 'Cincinnati Reds', 'pirates': 'Pittsburgh Pirates', 'rockies': 'Colorado Rockies', 'marlins': 'Miami Marlins', 'nationals': 'Washington Nationals', 'diamondbacks': 'Arizona Diamondbacks', 'dbacks': 'Arizona Diamondbacks', 'blue jays': 'Toronto Blue Jays' };

  for (const word of words) {
    const teamName = NBA_TEAMS[word] || NFL_TEAMS[word] || MLB_TEAMS[word];
    if (teamName) {
      return [
        { name: `${teamName} on ESPN`, url: `https://www.espn.com/search/_/q/${encodeURIComponent(teamName)}` },
        { name: `${teamName} on NBA.com`, url: NBA_TEAMS[word] ? `https://www.nba.com/search?filters=&q=${encodeURIComponent(teamName)}` : NFL_TEAMS[word] ? `https://www.nfl.com/search?query=${encodeURIComponent(teamName)}` : `https://www.mlb.com/search?q=${encodeURIComponent(teamName)}` },
        { name: `${teamName} on Reddit`, url: `https://www.reddit.com/search/?q=${encodeURIComponent(teamName)}` }
      ];
    }
  }

  // 0.5. Check if the query contains a known site name (multi-word match)
  for (const entry of allEntries) {
    for (const alias of entry.aliases) {
      if (alias.length >= 5 && normalized.includes(alias) && !seen.has(entry.url)) {
        seen.add(entry.url);
        results.push({ name: entry.name, url: entry.url });
        if (results.length >= limit) return results;
        break;
      }
    }
  }

  // 1. Match topics by keywords FIRST (most reliable)
  const matchedTopics = new Set();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const word of words) {
      if (keywords.some(k => {
          if (k.includes(' ')) return normalized.includes(k); // multi-word keywords match full query
          return word === k || (word.length >= 4 && k.length >= 4 && (word.startsWith(k) || k.startsWith(word)));
        })) {
        matchedTopics.add(topic);
        break;
      }
    }
  }

  // Add sites from matched topics
  for (const topic of matchedTopics) {
    const topicSites = TOPIC_SITES[topic] || [];
    for (const site of topicSites) {
      if (!seen.has(site.url)) {
        seen.add(site.url);
        results.push(site);
        if (results.length >= limit) return results;
      }
    }
  }

  // 3. Always return at least 3 — fill with search-specific defaults
  const defaults = getDefaultSites(query);
  for (const site of defaults) {
    if (!seen.has(site.url)) {
      seen.add(site.url);
      results.push(site);
      if (results.length >= limit) return results;
    }
  }

  return results.slice(0, limit);
}

module.exports = { detectIntent, getAutocompleteSuggestions, getRelatedSites };
