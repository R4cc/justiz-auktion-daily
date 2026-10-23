window.changelogUi = (() => {
  // Curated manually. Only update for a feature when the user explicitly asks.
  const entries = [
    {
      "date": "2026-10-23",
      "title": "Navigation Performance",
      "changes": [
        {
          "en": "Backend dashboard processing: 205.38 → 48.22 ms (157.16 ms faster). Account profile: 29.97 → 12.49 ms (17.48 ms faster).",
          "de": "Backend-Verarbeitung der Ladenübersicht: 205,38 → 48,22 ms (157,16 ms schneller). Kontoprofil: 29,97 → 12,49 ms (17,48 ms schneller)."
        },
        {
          "en": "Your Stores navigation: 729.0 → 342.5 ms (386.5 ms faster). Opening your own store: 730.3 → 460.3 ms (270.0 ms faster). Visiting another store: 350.8 → 300.4 ms (50.4 ms faster).",
          "de": "Navigation zu deinen Läden: 729,0 → 342,5 ms (386,5 ms schneller). Eigenen Laden öffnen: 730,3 → 460,3 ms (270,0 ms schneller). Anderen Laden besuchen: 350,8 → 300,4 ms (50,4 ms schneller)."
        },
        {
          "en": "Local benchmark medians with 5,000 inventory items on Node 22.23.4: five backend samples, three navigation samples. Navigation used a 390 px viewport, 4× CPU slowdown and 100 ms added per API request; these are not production timings.",
          "de": "Lokale Benchmark-Mediane mit 5.000 Inventarartikeln unter Node 22.23.4: fünf Backend-Messungen, drei Navigationsmessungen. Navigation mit 390 px Ansichtsbreite, 4× CPU-Verlangsamung und zusätzlich 100 ms je API-Anfrage; keine Produktionszeiten."
        },
        {
          "en": "Cold Stores directory loading showed no speedup: 578.1 → 595.0 ms in one sample each.",
          "de": "Das erstmalige Laden des Ladenverzeichnisses wurde nicht schneller: 578,1 → 595,0 ms bei jeweils einer Messung."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Faster Loading",
      "changes": [
        {
          "en": "Stores load with fewer requests. Browsing no longer downloads your full business inventory, and opening a store records the visit and loads its shelves together.",
          "de": "Läden laden mit weniger Anfragen. Beim Stöbern wird nicht mehr dein gesamtes Ladeninventar geladen; beim Öffnen werden Besuch und Regale gemeinsam geladen."
        },
        {
          "en": "Page skeletons appear immediately during navigation. Session loading no longer waits for the case catalog.",
          "de": "Beim Seitenwechsel erscheinen sofort Ladeplatzhalter. Das Laden der Sitzung wartet nicht mehr auf den Kistenkatalog."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Theft Security",
      "changes": [
        {
          "en": "Expensive items now require clearing more Blackjack security stages before they can be stolen. Each stage uses fair cards, and only the final win awards the item.",
          "de": "Teure Artikel erfordern jetzt mehr gewonnene Blackjack-Sicherheitsstufen, bevor sie gestohlen werden können. Jede Stufe verwendet faire Karten; erst der letzte Sieg bringt den Artikel."
        },
        {
          "en": "Theft dialogs show the required stages and saved progress. A loss leads to the police wheel, while a tie ends the attempt without loot or a fine. Existing attempts retain their saved terms.",
          "de": "Diebstahldialoge zeigen die erforderlichen Stufen und den gespeicherten Fortschritt. Eine Niederlage führt zum Polizeirad; ein Gleichstand beendet den Versuch ohne Beute oder Bußgeld. Laufende Versuche behalten ihre gespeicherten Bedingungen."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Category Cases",
      "changes": [
        {
          "en": "Replaced mixed Case Store offers with category-specific cases. Choose a category, then select a tier with its own price and reward odds.",
          "de": "Gemischte Angebote im Kisten-Shop durch kategoriespezifische Kisten ersetzt. Wähle eine Kategorie und anschließend eine Stufe mit eigenem Preis und eigenen Gewinnchancen."
        },
        {
          "en": "Possible case contents stay hidden before opening. More expensive tiers offer better legendary odds, with improved value balance across the selection.",
          "de": "Mögliche Kisteninhalte bleiben vor dem Öffnen verborgen. Teurere Stufen bieten bessere Chancen auf legendäre Funde; die Werte sind über das Angebot hinweg besser ausbalanciert."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Quality of Life",
      "changes": [
        {
          "en": "Game loading and page navigation recover more reliably when switching pages or cancelling a request.",
          "de": "Das Laden von Spielen und die Seitennavigation reagieren zuverlässiger auf Seitenwechsel und abgebrochene Anfragen."
        },
        {
          "en": "Improved keyboard controls, image galleries and focus handling in inventory and auction winnings. Item details remain expanded while browsing.",
          "de": "Tastatursteuerung, Bildergalerien und Fokusführung im Inventar und bei Auktionsgewinnen verbessert. Artikeldetails bleiben beim Durchsehen aufgeklappt."
        },
        {
          "en": "Restocking controls respect available shelf space, tip buttons match accepted amounts, and loan repayment drafts survive errors and language changes.",
          "de": "Beim Auffüllen berücksichtigen die Mengenregler den verfügbaren Regalplatz. Trinkgeld-Schaltflächen verwenden gültige Beträge; Eingaben zur Kreditrückzahlung bleiben bei Fehlern und Sprachwechseln erhalten."
        },
        {
          "en": "Notification updates preserve scroll position and keyboard focus.",
          "de": "Aktualisierte Benachrichtigungen behalten Scrollposition und Tastaturfokus bei."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Economy Balance",
      "changes": [
        {
          "en": "Improved Higher or Lower rewards and eased overdue penalties for new loans after reviewing the connected game economy. Existing loan contracts retain their saved terms.",
          "de": "Nach einer Prüfung der zusammenhängenden Spielwirtschaft wurden die Belohnungen bei Höher oder Niedriger verbessert und Verzugszinsen für neue Kredite gesenkt. Bestehende Kreditverträge behalten ihre gespeicherten Bedingungen."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Simpler Modals",
      "changes": [
        {
          "en": "Streamlined result dialogs across cases, palettes, games and store activities with clear continuation actions.",
          "de": "Ergebnisdialoge für Kisten, Paletten, Spiele und Ladenaktionen mit klaren Weiter-Aktionen vereinfacht."
        },
        {
          "en": "Removed unrelated navigation from completion dialogs. Case results offer buying another case where appropriate, and confirmations stay focused on the current task.",
          "de": "Sachfremde Navigation aus Abschlussdialogen entfernt. Kistenergebnisse bieten bei Bedarf einen weiteren Kauf an; Bestätigungen bleiben auf die aktuelle Aktion ausgerichtet."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Police & Fine Clarity",
      "changes": [
        {
          "en": "High wanted levels can now trigger police recognition during everyday activities. Choose to pay a fine or serve a timed jail sentence.",
          "de": "Ein hoher Fahndungslevel kann jetzt auch bei alltäglichen Aktionen zur Erkennung durch die Polizei führen. Wähle zwischen der Zahlung eines Bußgelds und einer zeitlich begrenzten Haftstrafe."
        },
        {
          "en": "Fines rise sharply with Heat, and repeat offences can bring longer jail sentences. Police encounters and penalties remain saved when returning to the game.",
          "de": "Bußgelder steigen mit Heat stark an; wiederholte Vergehen können längere Haftstrafen nach sich ziehen. Polizeibegegnungen und Strafen bleiben bei der Rückkehr ins Spiel gespeichert."
        },
        {
          "en": "Potential theft fines use a visual severity scale with unused levels dimmed. Higher Heat is reflected in the fine display without separate multiplier labels.",
          "de": "Mögliche Diebstahlbußgelder werden als visuelle Schweregradskala mit ausgegrauten inaktiven Stufen angezeigt. Höheres Heat fließt in diese Anzeige ein, ohne separate Multiplikator-Angaben."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "More Rewarding Cases",
      "changes": [
        {
          "en": "Rebalanced case rewards so ordinary pulls offer better value and very low-value finds are much rarer in expensive cases. Legendary odds improve with more expensive tiers.",
          "de": "Kistengewinne neu ausbalanciert: Gewöhnliche Funde bieten mehr Wert und sehr geringwertige Artikel sind in teuren Kisten deutlich seltener. Teurere Stufen bieten bessere Chancen auf legendäre Funde."
        },
        {
          "en": "Existing unopened paid cases can also receive a better-value find when opened. Valuable saved wins stay intact, and confirmed opening results remain saved.",
          "de": "Auch bestehende ungeöffnete, bezahlte Kisten können beim Öffnen einen höherwertigen Fund erhalten. Wertvolle gespeicherte Gewinne bleiben erhalten und bestätigte Öffnungsergebnisse werden dauerhaft gespeichert."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Timed Case Rebates",
      "changes": [
        {
          "en": "Admins can schedule percentage rebates for a selected case or the entire Case Store. Active offers apply automatically during the chosen period.",
          "de": "Admins können prozentuale Rabatte für eine ausgewählte Kiste oder den gesamten Kisten-Shop planen. Aktive Angebote gelten automatisch im gewählten Zeitraum."
        }
      ]
    },
    {
      "date": "2026-10-23",
      "title": "Theft Heat",
      "changes": [
        {
          "en": "Removed player and store stealing cooldowns. Finish your active attempt before starting another.",
          "de": "Wartezeiten für Diebstähle pro Spieler und Laden entfernt. Beende deinen laufenden Versuch, bevor du einen neuen startest."
        },
        {
          "en": "Stealing builds a star-based wanted level. Attempts add Heat, while the value and quantity of stolen items increase it further.",
          "de": "Diebstähle bauen einen Fahndungslevel mit Sternen auf. Versuche erhöhen Heat; Wert und Anzahl gestohlener Artikel steigern es zusätzlich."
        },
        {
          "en": "Heat fades over time, including offline, and raises the chance of being caught. Track your wanted level in stores and your profile.",
          "de": "Heat sinkt mit der Zeit, auch offline, und erhöht die Chance, erwischt zu werden. Dein Fahndungslevel ist in Läden und deinem Profil sichtbar."
        }
      ]
    },
    {
      date: '2026-10-20', title: 'Store Upgrades',
      changes: [
        {en:'Upgrade an existing store one size at a time for 10% less than buying the target size at the same location. Pop-up to Small takes 2 hours, Small to Medium 8 hours, and Medium to Large 48 hours. Target-size level requirements apply.',de:'Baue bestehende Läden schrittweise aus: 10% günstiger als ein Neukauf der Zielgröße am selben Standort. Vom Straßenstand zu Klein dauert es 2 Stunden, von Klein zu Mittel 8 Stunden und von Mittel zu Groß 48 Stunden. Die Level-Anforderungen der Zielgröße gelten.'},
        {en:'Stores keep trading at their current size during construction. Larger capacity and visitor traffic activate when the upgrade finishes, even after time offline.',de:'Während des Ausbaus handeln Läden in ihrer bisherigen Größe weiter. Größere Kapazität und mehr Laufkundschaft werden bei Fertigstellung aktiv, auch nach Zeit offline.'}
      ]
    },
    {
      date: '2026-10-20', title: 'Car Lot Stock',
      changes: [
        {en:'Car lots now accept all items categorized as Vehicles, including motorcycles, scooters, trailers, tires and vehicle accessories. Existing inventory can be stocked too.',de:'Autohäuser nehmen jetzt alle Artikel der Kategorie Fahrzeuge an, einschließlich Motorrädern, Rollern, Anhängern, Reifen und Fahrzeugzubehör. Das gilt auch für vorhandene Inventarartikel.'}
      ]
    },
    {
      date: '2026-10-19', title: 'Palette Return Protection',
      changes: [
        {en:'Mystery palettes now have an 80% chance of contents worth at least 110% of the winning price. Every opening returns at least 90%, limiting the opening-value loss to 10%. Extra item quantities cover any shortfall; jackpots remain.',de:'Überraschungspaletten haben jetzt 80% Chance auf Inhalte im Wert von mindestens 110% des Gewinnerpreises. Jede Öffnung liefert mindestens 90%, sodass der Wertverlust beim Öffnen höchstens 10% beträgt. Zusätzliche Artikelmengen gleichen Fehlbeträge aus; Jackpots bleiben erhalten.'},
        {en:'Applies to all unopened mystery palettes, including existing wins, using live market value at opening. Starting bids and NPC budgets stay the same. Later market prices and actual sale proceeds can vary.',de:'Gilt für alle ungeöffneten Überraschungspaletten, auch bereits gewonnene, anhand des aktuellen Marktwerts beim Öffnen. Startgebote und NPC-Budgets bleiben gleich. Spätere Marktpreise und tatsächliche Verkaufserlöse können abweichen.'}
      ]
    },
    {
      date: '2026-10-15', title: 'Store Activity & Balance',
      changes: [
        {en:'Stores become Abandoned after 20 days without new stock. Manual and automatic restocking count; moving the same items off and back onto shelves does not. Existing stores receive a 20-day grace period.',de:'Läden gelten nach 20 Tagen ohne neue Waren als verlassen. Manuelles und automatisches Auffüllen zählt; dieselben Waren aus- und wieder einzuräumen zählt nicht. Bestehende Läden erhalten 20 Tage Schonfrist.'},
        {en:'Other players can purchase abandoned locations at the normal opening price. Remaining goods and cash return to the previous owner. Add new stock before a purchase to recover your store.',de:'Andere Spieler können verlassene Standorte zum regulären Eröffnungspreis kaufen. Übrige Waren und Kasseneinnahmen bleiben beim bisherigen Besitzer. Neue Waren vor einem Kauf reaktivieren deinen Laden.'},
        {en:'Daily store events run automatically. Empty shelves do not reset pending checks, and event buyers pay fixed market-based prices independent of your markup.',de:'Tägliche Ladenereignisse laufen automatisch. Leere Regale setzen fällige Prüfungen nicht zurück; Ereigniskäufer zahlen feste marktbasierte Preise unabhängig vom Aufschlag.'},
        {en:'Foot traffic for large-store residential locations increased from 0.65× to 1.25×.',de:'Die Laufkundschaft an Wohnstraßen-Standorten großer Läden wurde von 0,65× auf 1,25× erhöht.'}
      ]
    },
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

  // Compare entry identities rather than dates so multiple same-day updates
  // reappear as NEW. One storage value replaces the previous revision.
  const revision = JSON.stringify(entries.map(entry => [entry.date, entry.title || entry.en || entry.de]));
  const seenKey = 'jg:changelog-seen';
  let seenInMemory = false;
  function hasUnread() {
    if (!entries.length || seenInMemory) return false;
    try { return localStorage.getItem(seenKey) !== revision; } catch { return true; }
  }
  function markRead() {
    seenInMemory = true;
    try { localStorage.setItem(seenKey, revision); } catch {}
    window.updateNavigation?.();
  }

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
    markRead();
  }

  window.addEventListener('storage', event => {
    if (event.key === seenKey || event.key === null) window.updateNavigation?.();
  });
  return { render, hasUnread };
})();

// Core navigation initializes before this deferred script. Refresh its badge
// once the curated entries are available, without waiting for a page visit.
window.updateNavigation?.();
