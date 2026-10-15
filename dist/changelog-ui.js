window.changelogUi = (() => {
  // Curated manually. Only update for a feature when the user explicitly asks.
  const entries = [
    {
      date: '2026-10-15', title: 'Item Categorization',
      changes: [
        {en:'Improved item matching using 1,976 archived listings, including German compounds, product descriptions and accessory types. Product names take priority over incidental brands, colors and seller boilerplate.',de:'Artikelerkennung anhand von 1.976 archivierten Angeboten verbessert, einschließlich zusammengesetzter Begriffe, Produktbeschreibungen und Zubehörarten. Produktnamen haben Vorrang vor beiläufigen Marken, Farben und Verkäuferhinweisen.'},
        {en:'Existing archive, inventory, case and palette items receive corrected categories automatically. Incompatible store stock returns to inventory once active theft or auction locks clear; saved prices, ownership and rewards are preserved.',de:'Bestehende Archiv-, Inventar-, Kisten- und Palettenartikel erhalten automatisch korrigierte Kategorien. Unpassender Ladenbestand kehrt nach laufenden Diebstahl- oder Auktionssperren ins Inventar zurück; gespeicherte Preise, Eigentümer und Belohnungen bleiben erhalten.'}
      ]
    },
    {
      date: '2026-10-15', title: 'Palette Profit',
      changes: [
        {en:'Improved mystery-palette quantity odds across all sizes, targeting roughly 20% more profitable openings at the starting bid.',de:'Mengenchancen aller Überraschungspaletten verbessert: Ziel sind rund 20% mehr gewinnbringende Öffnungen zum Startgebot.'},
        {en:'Starting prices and NPC bidding budgets keep their previous baseline. Existing auctions retain their saved odds.',de:'Startpreise und NPC-Gebotsbudgets behalten ihre bisherige Grundlage. Bestehende Auktionen behalten ihre gespeicherten Chancen.'}
      ]
    },
    {
      date: '2026-10-15', title: 'Toy Categories',
      changes: [
        {en:'Expanded toy matching to include board and card games, puzzles, dolls, plush toys, building sets, model trains, model vehicles and more toy brands.',de:'Spielzeug-Erkennung um Brett- und Kartenspiele, Puzzles, Puppen, Plüschtiere, Bausätze, Modelleisenbahnen, Modellfahrzeuge und weitere Spielzeugmarken erweitert.'},
        {en:'Toy shops now accept these individual finds, including older items. New toy stock rotations use the same expanded selection.',de:'Spielzeugläden nehmen diese Einzelfunde jetzt auch aus älteren Beständen an. Neue Spielzeug-Vorratsrotationen nutzen dieselbe erweiterte Auswahl.'}
      ]
    },
    {
      date: '2026-10-14', title: 'Profile Statistics',
      changes: [
        {en:'Added a Statistics tab next to Overview with grouped money, cases, trading, business, theft and game totals.',de:'Statistiken-Tab neben der Übersicht mit gruppierten Summen zu Geld, Kisten, Handel, Läden, Diebstahl und Spielen hinzugefügt.'},
        {en:'Track money earned and spent, cases opened and their value and costs, stolen and sold items, auction wins, store visitors, best scores and more.',de:'Verdientes und ausgegebenes Geld, geöffnete Kisten mit Werten und Kosten, gestohlene und verkaufte Artikel, Auktionssiege, Ladenbesucher, Bestwerte und mehr verfolgen.'},
        {en:'Receipt-backed lifetime totals survive Prestige. Bid deposits, refunds and cash collection do not inflate earnings; older missing costs are identified.',de:'Beleggestützte Gesamtsummen bleiben bei Prestige erhalten. Gebotskautionen, Erstattungen und Kassenleerungen erhöhen Einnahmen nicht doppelt; fehlende ältere Kosten werden gekennzeichnet.'}
      ]
    },
    {
      date: '2026-10-14', title: 'Prestige',
      changes: [
        {en:'Prestige is available in your profile from level 10. Reset your money, items, stores, XP and skills to choose one permanent buff. Each buff unlocks once; reach level 10 again for another choice.',de:'Prestige ist im Profil ab Level 10 verfügbar. Geld, Gegenstände, Läden, XP und Skills zurücksetzen und einen dauerhaften Bonus wählen. Jeder Bonus ist einmal freischaltbar; für die nächste Wahl erneut Level 10 erreichen.'},
        {en:'Choose 25% more positive profit on business sales and auctions, 25% lower theft catch odds, 50% lower case purchase costs, or 25% more relative Luck.',de:'Zur Wahl stehen 25% mehr positive Gewinne bei Ladenverkäufen und Auktionen, 25% geringere Fangchance bei Diebstahl, 50% niedrigere Kistenkosten oder 25% mehr relatives Glück.'},
        {en:'Login, friends and Prestige buffs remain. Committed auctions, theft attempts and unpaid penalties must finish before a reset; claimed Daily rewards cannot be reclaimed.',de:'Login, Freunde und Prestige-Boni bleiben erhalten. Verbindliche Auktionen, Diebstahlversuche und offene Strafen müssen vor dem Reset abgeschlossen sein; erhaltene Daily-Belohnungen lassen sich nicht erneut beanspruchen.'}
      ]
    },
    {
      date: '2026-10-14', title: 'Market Intelligence',
      changes: [
        {en:'Unlock Market Intelligence for 5 skill points to see how far single-item auction bids are below or above current market value.',de:'Marktkenntnis für 5 Skillpunkte freischalten: Bei Einzelauktionen wird angezeigt, wie weit Gebote unter oder über dem aktuellen Marktwert liegen.'},
        {en:'Current market value is visible on individual item listings for everyone.',de:'Der aktuelle Marktwert wird bei Einzelangeboten für alle angezeigt.'},
        {en:'Added regular NPC item listings with varied starting prices below and above market value. The six daily half-price bargain events remain active.',de:'Regelmäßige NPC-Einzelangebote mit wechselnden Startpreisen unter und über dem Marktwert hinzugefügt. Die sechs täglichen Schnäppchenaktionen zum halben Marktwert bleiben aktiv.'}
      ]
    },
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
        { en: 'Reviews affect popularity and visitor traffic 150% more strongly.', de: 'Bewertungen beeinflussen Beliebtheit und Besucherzahlen um 150% stärker.' },
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
    const releases = new Map();
    for (const entry of entries) {
      if (!releases.has(entry.date)) releases.set(entry.date, []);
      releases.get(entry.date).push(entry);
    }
    accountContent.innerHTML = `<div class="changelog-page">
      <header class="changelog-heading"><h1 tabindex="-1"><span aria-hidden="true"># </span>Changelog</h1></header>
      <ol class="changelog-list">${[...releases].map(([date, updates]) => `<li class="changelog-release">
        <h2><span aria-hidden="true">## </span><time datetime="${accountEscape(date)}">${accountEscape(date)}</time></h2>
        <ol class="changelog-sections">${updates.map(entry => `<li class="changelog-entry">
        <div class="changelog-copy">${entry.title ? `<h3><span aria-hidden="true">### </span>${accountEscape(entry.title)}</h3>` : ''}${entry.changes
          ? `<ul>${entry.changes.map(change => `<li>${accountEscape(t(change.en, change.de))}</li>`).join('')}</ul>`
          : `<ul><li>${accountEscape(t(entry.en, entry.de))}</li></ul>`}</div>
      </li>`).join('')}</ol></li>`).join('')}</ol>
    </div>`;
  }

  return { render };
})();
