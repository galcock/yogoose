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

  // 6. Prefix match via trie (for partial site names like "rotten" -> rottentomatoes)
  if (words.length <= 2) {
    const searchKey = normalized.replace(/[^a-z0-9]/g, '');
    if (searchKey.length >= 3) {
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
  if (words.length === 1 && normalized.length >= 3) {
    let bestMatch = null;
    let bestDist = Infinity;
    const maxDist = normalized.length <= 4 ? 1 : 2;

    for (const [alias, entry] of aliasMap) {
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

function getRelatedSites(query, limit = 3) {
  if (!query) return [];

  const normalized = query.toLowerCase().trim();
  const stopWords = new Set(['the', 'what', 'how', 'why', 'where', 'when', 'who', 'which', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'should', 'will', 'would', 'has', 'have', 'had', 'for', 'and', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'from', 'they', 'been', 'its', 'than', 'into', 'about', 'between', 'through', 'best', 'most', 'more', 'some', 'any', 'all', 'very', 'just', 'also', 'much', 'many', 'way', 'make', 'like', 'get', 'use']);
  const words = normalized.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
  const results = [];
  const seen = new Set();

  for (const entry of allEntries) {
    const nameLower = entry.name.toLowerCase();
    const allText = [nameLower, ...entry.aliases].join(' ');

    // Check if any query word matches a site name or alias
    for (const word of words) {
      if (allText.includes(word) && !seen.has(entry.url)) {
        seen.add(entry.url);
        results.push({ name: entry.name, url: entry.url });
        break;
      }
    }

    if (results.length >= limit) break;
  }

  // If no word matches, try category-based matching
  if (results.length === 0) {
    const categoryKeywords = {
      sports: ['score', 'game', 'team', 'player', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball'],
      news: ['news', 'today', 'latest', 'breaking', 'politics', 'election', 'war', 'president'],
      entertainment: ['movie', 'film', 'show', 'tv', 'actor', 'actress', 'rating', 'review', 'trailer'],
      shopping: ['buy', 'price', 'cheap', 'deal', 'coupon', 'sale', 'order', 'shop', 'store'],
      food: ['restaurant', 'recipe', 'food', 'cook', 'eat', 'dinner', 'lunch', 'breakfast', 'delivery'],
      travel: ['flight', 'hotel', 'travel', 'trip', 'vacation', 'book', 'airline', 'airport'],
      health: ['symptom', 'health', 'doctor', 'medicine', 'treatment', 'disease', 'pain', 'medical'],
      finance: ['stock', 'invest', 'bank', 'credit', 'loan', 'mortgage', 'tax', 'money', 'crypto', 'bitcoin'],
      tech: ['code', 'programming', 'developer', 'software', 'bug', 'api', 'github', 'deploy'],
      education: ['learn', 'course', 'study', 'tutorial', 'class', 'university', 'college', 'school'],
      realestate: ['house', 'apartment', 'rent', 'home', 'property', 'real estate', 'mortgage'],
      gaming: ['game', 'gaming', 'play', 'console', 'pc', 'steam', 'xbox', 'playstation', 'nintendo'],
      music: ['song', 'music', 'album', 'artist', 'playlist', 'listen', 'concert']
    };

    let matchedCategory = null;
    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      for (const word of words) {
        if (keywords.some(k => word.startsWith(k) || k.startsWith(word))) {
          matchedCategory = cat;
          break;
        }
      }
      if (matchedCategory) break;
    }

    if (matchedCategory) {
      for (const site of sites) {
        if (site.category === matchedCategory && !seen.has(site.url)) {
          seen.add(site.url);
          results.push({ name: site.name, url: site.url });
          if (results.length >= limit) break;
        }
      }
    }
  }

  return results;
}

module.exports = { detectIntent, getAutocompleteSuggestions, getRelatedSites };
