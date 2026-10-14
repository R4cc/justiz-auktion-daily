window.changelogUi = (() => {
  // Curated manually. Only update for a feature when the user explicitly asks.
  const entries = [
    {
      date: '2026-10-14', title: 'New Stores',
      changes: [
        {en:'Added Jeweler stores for jewelry and watches, and Hardware stores for tools and Other items.',de:'Juweliere für Schmuck und Uhren sowie Baumärkte für Werkzeuge und sonstige Artikel hinzugefügt.'},
        {en:'Base opening prices start at J€1,800 for a Jeweler and J€1,100 for a Hardware store. Plot size and location adjust the price.',de:'Grundpreise beginnen bei J€1.800 für einen Juwelier und J€1.100 für einen Baumarkt. Grundstücksgröße und Standort passen den Preis an.'},
        {en:'Both stores support stock management, reviews, security guards, theft and cash collection. Turnover is balanced for their stock values.',de:'Beide Ladentypen unterstützen Warenverwaltung, Bewertungen, Sicherheitsdienst, Diebstahl und Kasseneinnahmen. Der Absatz ist auf ihre Warenwerte abgestimmt.'}
      ]
    },
    {
      date: '2026-10-14',
      title: 'Security Guard',
      changes: [
        { en: 'Replaced Goose Guard with a Security Guard that can be activated or deactivated in store management.', de: 'Die Wachgans wird durch einen Sicherheitsdienst ersetzt, der in der Ladenverwaltung ein- und ausgeschaltet werden kann.' },
        { en: 'An active guard costs 5% of tracked store profits earned while active.', de: 'Ein aktiver Sicherheitsdienst kostet 5% der während seines Einsatzes erfassten Ladengewinne.' },
        { en: 'Failed thefts have a 30% catch chance, increased to 50% with an active guard. Guards no longer double fines.', de: 'Nach gescheitertem Diebstahl beträgt die Fangchance 30%, mit aktivem Sicherheitsdienst 50%. Der Sicherheitsdienst verdoppelt das Bußgeld nicht mehr.' },
        { en: 'When a thief is caught, the store owner receives the fine value.', de: 'Wird ein Dieb erwischt, erhält der Ladenbesitzer den Bußgeldbetrag.' }
      ]
    },
    {
      date: '2026-10-14',
      title: 'Balance Patch',
      changes: [
        { en: 'Store visitors increased by 25% across all store sizes.', de: '25% mehr Ladenbesucher bei allen Ladengrößen.' },
        { en: 'Reviews affect popularity and visitor traffic 25% more strongly.', de: 'Bewertungen beeinflussen Beliebtheit und Besucherzahlen um 25% stärker.' },
        { en: 'Theft fines reduced by 50%, with a minimum of 1.5× the item’s value.', de: 'Diebstahlbußgelder um 50% gesenkt, mindestens jedoch das 1,5-Fache des Warenwerts.' },
        { en: 'NPCs consider bids on normal-item auctions 20% more frequently.', de: 'NPCs bieten bei Auktionen gewöhnlicher Gegenstände 20% häufiger.' },
        { en: 'Daily completion pays J€1,000 at every score. Case rarity still depends on score.', de: 'Jedes abgeschlossene Daily zahlt J€1.000, unabhängig von der Punktzahl. Die Kistenseltenheit hängt weiterhin von der Punktzahl ab.' }
      ]
    },
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
        <div class="changelog-copy">${entry.title ? `<h2>${accountEscape(entry.title)}</h2>` : ''}${entry.changes
          ? `<ul>${entry.changes.map(change => `<li>${accountEscape(t(change.en, change.de))}</li>`).join('')}</ul>`
          : `<p>${accountEscape(t(entry.en, entry.de))}</p>`}</div>
      </li>`).join('')}</ol>
    </div>`;
  }

  return { render };
})();
