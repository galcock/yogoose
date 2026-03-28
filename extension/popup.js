document.getElementById('copyUrl').addEventListener('click', () => {
  const url = 'https://yogoose.com/results.html?q=%s';
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copyUrl');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Search URL'; }, 2000);
  });
});

document.getElementById('openSettings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://settings/search' });
});
