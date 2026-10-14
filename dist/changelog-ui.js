window.changelogUi = (() => {
  // Curated manually. Only update for a feature when the user explicitly asks.
  const entries = [
    {
      date: '2026-10-14',
      en: 'Added a Changelog page in the sidebar with dated updates.',
      de: 'Changelog mit datierten Änderungen zur Seitenleiste hinzugefügt.'
    }
  ];

  function render() {
    const dates = new Intl.DateTimeFormat(t('en-GB', 'de-AT'), {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    });
    accountContent.innerHTML = `<div class="changelog-page">
      <header class="changelog-heading"><h1 tabindex="-1">Changelog</h1><span class="changelog-seal" aria-hidden="true">✦</span></header>
      <ol class="changelog-list">${entries.map(entry => `<li class="changelog-entry">
        <time datetime="${accountEscape(entry.date)}">${accountEscape(dates.format(new Date(`${entry.date}T00:00:00Z`)))}</time>
        <p>${accountEscape(t(entry.en, entry.de))}</p>
      </li>`).join('')}</ol>
    </div>`;
  }

  return { render };
})();
