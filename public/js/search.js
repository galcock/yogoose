(() => {
  const input = document.getElementById('searchInput');
  const container = document.getElementById('searchContainer');
  const dropdown = document.getElementById('autocomplete');

  let selectedIndex = -1;
  let suggestions = [];
  let debounceTimer = null;
  let currentQuery = '';

  // Ensure focus on load
  input.focus();

  // --- Autocomplete ---

  function fetchSuggestions(query) {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.trim().length === 0) {
      hideSuggestions();
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        suggestions = await res.json();
        currentQuery = query;
        renderSuggestions();
      } catch (e) {
        // Silently fail — autocomplete is non-critical
      }
    }, 50); // 50ms debounce — fast enough to feel instant
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

    // Click handlers
    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt(item.dataset.index);
        selectSuggestion(idx);
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
      // Go directly to the site
      window.location.href = s.url;
    } else {
      // AI query — go to results page
      input.value = s.text;
      doSearch(s.text);
    }
  }

  // --- Search ---

  function doSearch(query) {
    if (!query || query.trim().length === 0) return;
    window.location.href = `/results.html?q=${encodeURIComponent(query.trim())}`;
  }

  // --- Event Listeners ---

  input.addEventListener('input', () => {
    fetchSuggestions(input.value);
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      updateSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      updateSelection(items);
    } else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      // Tab accepts the first (or selected) suggestion text
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      if (suggestions[idx]) {
        input.value = suggestions[idx].text;
        fetchSuggestions(input.value);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        selectSuggestion(selectedIndex);
      } else {
        doSearch(input.value);
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
      input.blur();
    }
  });

  function updateSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === selectedIndex);
    });
  }

  // Close autocomplete when clicking outside
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      hideSuggestions();
    }
  });

  // Re-focus on any keypress if not focused
  document.addEventListener('keydown', (e) => {
    if (document.activeElement !== input && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key.length === 1) {
        input.focus();
      }
    }
  });

  // --- Utility ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
