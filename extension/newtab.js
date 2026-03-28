(() => {
  const YOGOOSE_URL = 'https://yogoose.com';
  const input = document.getElementById('searchInput');
  const container = document.getElementById('searchContainer');
  const dropdown = document.getElementById('autocomplete');

  let selectedIndex = -1;
  let suggestions = [];
  let debounceTimer = null;

  input.focus();

  function fetchSuggestions(query) {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.trim().length === 0) { hideSuggestions(); return; }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`${YOGOOSE_URL}/api/autocomplete?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        suggestions = await res.json();
        renderSuggestions();
      } catch (e) {}
    }, 50);
  }

  function renderSuggestions() {
    if (suggestions.length === 0) { hideSuggestions(); return; }
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
      window.location.href = `${YOGOOSE_URL}/results.html?q=${encodeURIComponent(s.text)}`;
    }
  }

  function doSearch(query) {
    if (!query || query.trim().length === 0) return;
    window.location.href = `${YOGOOSE_URL}/results.html?q=${encodeURIComponent(query.trim())}`;
  }

  input.addEventListener('input', () => fetchSuggestions(input.value));

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIndex));
    } else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      if (suggestions[idx]) { input.value = suggestions[idx].text; fetchSuggestions(input.value); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        selectSuggestion(selectedIndex);
      } else {
        doSearch(input.value);
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) hideSuggestions();
  });

  document.addEventListener('keydown', (e) => {
    if (document.activeElement !== input && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      input.focus();
    }
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
