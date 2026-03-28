// GNews API — free tier, returns headlines with images
// Sign up at https://gnews.io to get an API key

const GNEWS_API_KEY = process.env.GNEWS_API_KEY || '';

async function getTopHeadlines(count = 10) {
  if (!GNEWS_API_KEY) {
    // Fallback: use a free RSS-to-JSON approach
    return getFallbackNews(count);
  }

  try {
    const url = `https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=us&max=${count}&apikey=${GNEWS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return getFallbackNews(count);
    const data = await res.json();

    return data.articles.map(a => ({
      title: a.title,
      description: a.description,
      url: a.url,
      image: a.image,
      source: a.source?.name || 'News',
      publishedAt: a.publishedAt
    }));
  } catch (err) {
    console.error('GNews error:', err.message);
    return getFallbackNews(count);
  }
}

// Fallback using free RSS feeds via rss2json
async function getFallbackNews(count = 10) {
  try {
    const feeds = [
      'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
      'https://feeds.bbci.co.uk/news/rss.xml',
      'https://feeds.npr.org/1001/rss.xml'
    ];
    
    const results = [];
    for (const feed of feeds) {
      try {
        const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.items) {
          for (const item of data.items) {
            results.push({
              title: item.title,
              description: item.description?.replace(/<[^>]*>/g, '').substring(0, 150) || '',
              url: item.link,
              image: item.enclosure?.link || item.thumbnail || null,
              source: data.feed?.title || 'News',
              publishedAt: item.pubDate
            });
          }
        }
      } catch (e) { continue; }
      if (results.length >= count) break;
    }
    return results.slice(0, count);
  } catch (err) {
    return [];
  }
}

function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

module.exports = { getTopHeadlines, timeAgo };
