(() => {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';
  const input = document.getElementById('resultsInput');
  const responseArea = document.getElementById('responseArea');
  const loading = document.getElementById('loading');
  const poweredBy = document.getElementById('poweredBy');
  const relatedSites = document.getElementById('relatedSites');
  const container = document.getElementById('resultsSearchContainer');
  const dropdown = document.getElementById('resultsAutocomplete');

  let selectedIndex = -1;
  let suggestions = [];
  let debounceTimer = null;

  if (query) {
    input.value = query;
    document.title = `${query} — Yogoose`;
    executeSearch(query);
  }

  // --- Search execution ---

  async function executeSearch(q) {
    loading.style.display = 'flex';
    responseArea.innerHTML = '';
    responseArea.appendChild(loading);
    poweredBy.style.display = 'none';

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        // AI streaming response
        streamAIResponse(res);
      } else {
        const data = await res.json();
        if (data.type === 'navigate') {
          // Redirect immediately
          window.location.href = data.url;
          return;
        }
      }
    } catch (err) {
      loading.style.display = 'none';
      responseArea.innerHTML = '<div class="ai-response"><p>Something went wrong. Please try again.</p></div>';
    }
  }

  // --- SSE streaming ---

  async function streamAIResponse(res) {
    loading.style.display = 'none';

    const aiDiv = document.createElement('div');
    aiDiv.className = 'ai-response';
    responseArea.innerHTML = '';
    responseArea.appendChild(aiDiv);

    const cursor = document.createElement('span');
    cursor.className = 'cursor';

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
        const jsonStr = line.slice(6);

        try {
          const event = JSON.parse(jsonStr);
          if (event.type === 'text') {
            fullText += event.content;
            aiDiv.innerHTML = renderMarkdown(fullText);
            aiDiv.appendChild(cursor);
            // Auto-scroll to bottom if needed
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          } else if (event.type === 'done') {
            cursor.remove();
            poweredBy.style.display = 'block';
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

    // Fetch related sites
    fetchRelatedSites(query);
  }

  // --- Related sites ---

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
      relatedSites.style.display = 'block';
    } catch (e) {}
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

  // --- Utility ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
