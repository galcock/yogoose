(() => {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';
  const input = document.getElementById('resultsInput');
  const responseArea = document.getElementById('responseArea');
  const loading = document.getElementById('loading');
  const poweredBy = document.getElementById('poweredBy');
  const relatedSites = document.getElementById('relatedSites');
  const followupBar = document.getElementById('followupBar');
  const followupInput = document.getElementById('followupInput');
  const followupSend = document.getElementById('followupSend');
  const container = document.getElementById('resultsSearchContainer');
  const dropdown = document.getElementById('resultsAutocomplete');

  let selectedIndex = -1;
  let suggestions = [];
  let conversationHistory = []; // Track Q&A for follow-ups
  let debounceTimer = null;

  if (query) {
    input.value = query;
    document.title = `${query} — Yogoose`;
    executeSearch(query);
  }

  // --- Search execution ---

  async function executeSearch(q) {
    // Show dancing goose while working
    responseArea.innerHTML = `
      <div class="goose-loading">
        <svg class="dancing-goose" width="80" height="100" viewBox="0 0 120 140" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="60" cy="88" rx="28" ry="22" fill="white"/>
          <path d="M52 72 C48 50, 38 38, 42 28" stroke="white" stroke-width="12" stroke-linecap="round" fill="none"/>
          <circle cx="40" cy="26" r="12" fill="white"/>
          <circle cx="36" cy="24" r="2.5" fill="#1a1a1a"/>
          <path d="M28 28 L18 26 L28 32 Z" fill="#f59e0b"/>
          <path d="M68 78 C78 68, 88 72, 85 85 C82 95, 72 92, 68 88" fill="#e8eaed"/>
          <path d="M50 108 L42 120 M50 108 L50 120 M50 108 L58 120" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
          <path d="M70 108 L62 120 M70 108 L70 120 M70 108 L78 120" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
          <path d="M32 30 Q28 32, 30 34" stroke="#1a1a1a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
        </svg>
        <p class="goose-loading-text">Goose is on it...</p>
        <p class="goose-status-text" id="gooseStatus"></p>
      </div>
    `;

    // Show contextual status based on query type
    const lower = q.toLowerCase();
    const statusEl = document.getElementById('gooseStatus');
    if (statusEl) {
      if (['news', 'headlines', 'breaking news', 'top stories'].some(w => lower.includes(w))) {
        statusEl.textContent = 'Building your news feed...';
      } else if (['score', 'tonight', 'game'].some(w => lower.includes(w)) ||
                 ['lakers', 'warriors', 'celtics', 'cowboys', 'yankees', 'dodgers', 'chiefs', 'eagles'].some(w => lower.includes(w))) {
        statusEl.textContent = 'Checking live scores & schedules...';
      } else if (['weather', 'forecast', 'rain', 'temperature'].some(w => lower.includes(w))) {
        statusEl.textContent = 'Checking the forecast...';
      } else if (['stock', 'market', 'djia', 'sp500', 'nasdaq', 'bitcoin', 'btc', 'eth'].some(w => lower.includes(w))) {
        statusEl.textContent = 'Pulling market data...';
      } else if (['showtime', 'theater', 'movie'].some(w => lower.includes(w))) {
        statusEl.textContent = 'Finding showtimes near you...';
      } else if (['recipe', 'cook', 'bake'].some(w => lower.includes(w))) {
        statusEl.textContent = 'Finding the best recipe...';
      } else if (['flight', 'hotel', 'travel'].some(w => lower.includes(w))) {
        statusEl.textContent = 'Searching travel options...';
      }
    }

    poweredBy.style.display = 'none';
    relatedSites.style.display = 'none';

    // Fire related sites fetch in parallel — don't wait for AI
    fetchRelatedSites(q);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&tz=${encodeURIComponent(tz)}`);
      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        streamAIResponse(res);
      } else {
        const data = await res.json();
        if (data.type === 'navigate') {
          window.location.href = data.url;
          return;
        }
      }
    } catch (err) {
      responseArea.innerHTML = '<div class="ai-response"><p>Something went wrong. Please try again.</p></div>';
    }
  }

  // --- SSE streaming ---

  async function streamAIResponse(res) {
    const aiDiv = document.createElement('div');
    aiDiv.className = 'ai-response';
    // DON'T clear the goose yet — wait for first token

    const cursor = document.createElement('span');
    cursor.className = 'cursor';

    let fullText = '';
    let firstToken = true;
    let responseFormat = null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);

        try {
          const event = JSON.parse(jsonStr);
          if (event.type === 'format') {
            responseFormat = event.format;
            if (responseFormat === 'news') {
              aiDiv.className = 'ai-response news-feed';
            }
            continue;
          }
          if (event.type === 'text') {
            // On first token: fade out goose, then replace with AI response
            if (firstToken) {
              firstToken = false;
              const goose = responseArea.querySelector('.goose-loading');
              if (goose) {
                goose.classList.add('goose-fade-out');
                setTimeout(() => {
                  responseArea.innerHTML = '';
                  // Insert financial chart if this is a market query
                  const chart = getFinancialChart(currentSearchQuery);
                  if (chart) responseArea.appendChild(chart);
                  responseArea.appendChild(aiDiv);
                }, 400);
              } else {
                responseArea.innerHTML = '';
                const chart = getFinancialChart(currentSearchQuery);
                if (chart) responseArea.appendChild(chart);
                responseArea.appendChild(aiDiv);
              }
            }
            fullText += event.content;
            aiDiv.innerHTML = renderMarkdown(fullText);
            aiDiv.appendChild(cursor);
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          } else if (event.type === 'done') {
            cursor.remove();
            poweredBy.style.display = 'block';
            showRelatedSites();
          } else if (event.type === 'error') {
            aiDiv.innerHTML = `<p>${escapeHtml(event.content)}</p>`;
            cursor.remove();
          }
        } catch (e) {
          // Skip malformed events
        }
      }
    }

    // Final render
    cursor.remove();
    aiDiv.innerHTML = renderMarkdown(fullText);
    poweredBy.style.display = 'block';
    showRelatedSites();
    followupBar.style.display = 'flex';
    followupInput.focus();

    // Store in conversation history
    conversationHistory.push({ role: 'user', content: currentSearchQuery });
    conversationHistory.push({ role: 'assistant', content: fullText });
  }

  let currentSearchQuery = query;

  // --- Related sites ---

  let relatedSitesReady = false;

  async function fetchRelatedSites(q) {
    try {
      const res = await fetch(`/api/related?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const sites = await res.json();
      if (sites.length === 0) return;

      relatedSites.innerHTML = `
        <h4>Were you looking for...</h4>
        ${sites.map(s => `
          <a href="${s.url}" class="related-link">
            <span class="related-link-icon">&rarr;</span>
            <span class="related-link-name">${escapeHtml(s.name)}</span>
            <span class="related-link-url">${s.url.replace('https://', '')}</span>
          </a>
        `).join('')}
      `;
      // Don't show yet — wait until AI response starts streaming
      relatedSitesReady = true;
    } catch (e) {}
  }

  function showRelatedSites() {
    if (relatedSitesReady) {
      relatedSites.style.display = 'block';
    }
  }

  // --- Markdown renderer ---

  function renderMarkdown(text) {
    if (!text) return '';

    let html = text;

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

    // Unordered lists
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Paragraphs — wrap loose lines
    html = html.replace(/^(?!<[hulob]|<pre|<code|<strong|<em|<a )(.+)$/gm, '<p>$1</p>');

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  // --- Autocomplete for results page ---

  function fetchSuggestions(q) {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.trim().length === 0) {
      hideSuggestions();
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        suggestions = await res.json();
        renderSuggestions();
      } catch (e) {}
    }, 50);
  }

  function renderSuggestions() {
    if (suggestions.length === 0) {
      hideSuggestions();
      return;
    }
    selectedIndex = -1;
    dropdown.innerHTML = suggestions.map((s, i) => {
      const icon = s.type === 'navigate'
        ? '<span class="autocomplete-icon navigate">&#8594;</span>'
        : '<span class="autocomplete-icon ai">&#10024;</span>';
      const typeLabel = s.type === 'navigate' ? 'Go to site' : 'Ask AI';
      return `<div class="autocomplete-item" data-index="${i}">
        ${icon}
        <span class="autocomplete-text">${escapeHtml(s.text)}</span>
        <span class="autocomplete-type">${typeLabel}</span>
      </div>`;
    }).join('');
    dropdown.classList.add('active');
    container.classList.add('ac-open');
    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectSuggestion(parseInt(item.dataset.index));
      });
    });
  }

  function hideSuggestions() {
    dropdown.classList.remove('active');
    container.classList.remove('ac-open');
    suggestions = [];
    selectedIndex = -1;
  }

  function selectSuggestion(index) {
    const s = suggestions[index];
    if (!s) return;
    if (s.type === 'navigate' && s.url) {
      window.location.href = s.url;
    } else {
      input.value = s.text;
      hideSuggestions();
      window.location.href = `/results.html?q=${encodeURIComponent(s.text)}`;
    }
  }

  input.addEventListener('input', () => fetchSuggestions(input.value));

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      items.forEach((item, i) => item.classList.toggle('selected', i === selectedIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      items.forEach((item, i) => item.classList.toggle('selected', i === selectedIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        selectSuggestion(selectedIndex);
      } else {
        hideSuggestions();
        window.location.href = `/results.html?q=${encodeURIComponent(input.value.trim())}`;
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) hideSuggestions();
  });

  // --- Follow-up ---

  async function sendFollowup() {
    const q = followupInput.value.trim();
    if (!q) return;
    followupInput.value = '';
    followupBar.style.display = 'none';
    currentSearchQuery = q;

    // Add the user's follow-up as a visible question
    const userQ = document.createElement('div');
    userQ.className = 'followup-question';
    userQ.textContent = q;
    responseArea.appendChild(userQ);

    // Add a new AI response div with cursor
    const aiDiv = document.createElement('div');
    aiDiv.className = 'ai-response';
    responseArea.appendChild(aiDiv);

    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    aiDiv.appendChild(cursor);

    // Scroll to the follow-up
    userQ.scrollIntoView({ behavior: 'smooth' });

    // Stream follow-up with conversation history
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          history: conversationHistory,
          tz: tz
        })
      });

      let fullText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text') {
              fullText += event.content;
              aiDiv.innerHTML = renderMarkdown(fullText);
              aiDiv.appendChild(cursor);
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            } else if (event.type === 'done') {
              cursor.remove();
            }
          } catch (e) {}
        }
      }

      cursor.remove();
      aiDiv.innerHTML = renderMarkdown(fullText);
      conversationHistory.push({ role: 'user', content: q });
      conversationHistory.push({ role: 'assistant', content: fullText });

      followupBar.style.display = 'flex';
      followupInput.focus();
    } catch (err) {
      cursor.remove();
      aiDiv.innerHTML = '<p>Something went wrong. Please try again.</p>';
      followupBar.style.display = 'flex';
    }
  }

  followupSend.addEventListener('click', sendFollowup);
  followupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendFollowup();
    }
  });

  // --- Utility ---

  // --- Financial charts ---

  function getFinancialChart(q) {
    const lower = q.toLowerCase();
    const MARKET_KEYWORDS = {
      'djia': 'TVC:DJI', 'dow': 'TVC:DJI', 'dow jones': 'TVC:DJI',
      'sp500': 'FOREXCOM:SPXUSD', 's&p': 'FOREXCOM:SPXUSD', 's&p 500': 'FOREXCOM:SPXUSD', 'sp 500': 'FOREXCOM:SPXUSD',
      'nasdaq': 'NASDAQ:NDX', 'nasdaq composite': 'TVC:IXIC',
      'stock market': 'FOREXCOM:SPXUSD', 'markets': 'FOREXCOM:SPXUSD', 'market today': 'FOREXCOM:SPXUSD',
      'bitcoin': 'BITSTAMP:BTCUSD', 'btc': 'BITSTAMP:BTCUSD',
      'ethereum': 'BITSTAMP:ETHUSD', 'eth': 'BITSTAMP:ETHUSD',
      'apple stock': 'NASDAQ:AAPL', 'aapl': 'NASDAQ:AAPL',
      'tesla stock': 'NASDAQ:TSLA', 'tsla': 'NASDAQ:TSLA',
      'nvidia stock': 'NASDAQ:NVDA', 'nvda': 'NASDAQ:NVDA',
      'google stock': 'NASDAQ:GOOGL', 'googl': 'NASDAQ:GOOGL',
      'amazon stock': 'NASDAQ:AMZN', 'amzn': 'NASDAQ:AMZN',
      'meta stock': 'NASDAQ:META',
      'microsoft stock': 'NASDAQ:MSFT', 'msft': 'NASDAQ:MSFT',
    };

    let symbol = null;
    // Check longest matches first
    const sorted = Object.entries(MARKET_KEYWORDS).sort((a, b) => b[0].length - a[0].length);
    for (const [keyword, sym] of sorted) {
      if (lower.includes(keyword)) {
        symbol = sym;
        break;
      }
    }

    if (!symbol) return null;

    const container = document.createElement('div');
    container.className = 'financial-chart';
    container.innerHTML = `
      <div class="tradingview-widget-container">
        <div id="tradingview-chart"></div>
      </div>
    `;

    // Load TradingView widget after DOM insert
    setTimeout(() => {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js';
      script.async = true;
      script.textContent = JSON.stringify({
        symbols: [[symbol]],
        chartOnly: false,
        width: '100%',
        height: 300,
        locale: 'en',
        colorTheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        autosize: true,
        showVolume: false,
        showMA: false,
        hideDateRanges: false,
        hideMarketStatus: false,
        hideSymbolLogo: false,
        scalePosition: 'right',
        scaleMode: 'Normal',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        fontSize: '10',
        noTimeScale: false,
        valuesTracking: '1',
        changeMode: 'price-and-percent',
        chartType: 'area',
        lineWidth: 2,
        lineType: 0,
        dateRanges: ['1d|1', '1m|30', '3m|60', '12m|1D', '60m|1W', 'all|1M']
      });
      const target = container.querySelector('.tradingview-widget-container');
      if (target) target.appendChild(script);
    }, 100);

    return container;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
