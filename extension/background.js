const YOGOOSE_URL = 'https://yogoose.com';

// Omnibox: type "yg" then space/tab, then your query
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const query = text.trim();
  if (!query) {
    chrome.tabs.update({ url: YOGOOSE_URL });
    return;
  }
  const url = `${YOGOOSE_URL}/results.html?q=${encodeURIComponent(query)}`;

  if (disposition === 'currentTab') {
    chrome.tabs.update({ url });
  } else {
    chrome.tabs.create({ url });
  }
});

// Provide suggestions in the omnibox
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  if (text.trim().length === 0) return;

  try {
    const res = await fetch(`${YOGOOSE_URL}/api/autocomplete?q=${encodeURIComponent(text)}`);
    if (!res.ok) return;
    const suggestions = await res.json();

    const results = suggestions.map(s => {
      if (s.type === 'navigate') {
        return {
          content: s.url,
          description: `<match>${s.text}</match> <dim>— Go to site</dim>`
        };
      }
      return {
        content: s.text,
        description: `<match>${s.text}</match> <dim>— Ask AI</dim>`
      };
    });

    suggest(results);
  } catch (e) {
    // Silently fail
  }
});

// Set default suggestion text
chrome.omnibox.setDefaultSuggestion({
  description: 'Search Yogoose: <match>%s</match>'
});

// On install: open Chrome search settings so user can set Yogoose as default
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open the setup guide first, then the Chrome settings
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
  }
});
