window.adminStatisticsUi = (() => {
  const esc = accountEscape;
  let data = null, owner = null, visit = 0, request = 0, days = 30, busy = false, error = '';
  const date = value => new Date(value).toLocaleDateString(uiLocale(),{timeZone:'UTC',year:'numeric',month:'short',day:'numeric'});
  const metric = (label,value,help='') => `<div class="admin-stats-metric"><span>${label}${help?infoTip(help,label):''}</span><strong>${value}</strong></div>`;
  function table(title,columns,rows) {
    return `<div class="admin-stats-table-wrap" tabindex="0"><table class="admin-stats-table"><caption class="sr-only">${title}</caption><thead><tr>${columns.map(column=>`<th scope="col">${column}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((cell,index)=>index?`<td>${cell}</td>`:`<th scope="row">${cell}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function chart(title,key) {
    const series=data.series.filter(row=>row[key]!==null),max = Math.max(0,...series.map(row=>row[key]));
    return `<section class="admin-stats-chart"><h3>${title}</h3>${max?`<div class="admin-stats-bars" style="--days:${series.length}" aria-hidden="true">${series.map(row=>`<span title="${esc(date(row.date)+' · '+number(row[key]))}"><i style="--bar-height:${row[key]/max*100}%"></i></span>`).join('')}</div><div class="admin-stats-chart-dates"><span>${date(series[0].date)}</span><span>${date(series.at(-1).date)}</span></div>`:`<p class="admin-empty">${t('No activity in this period.','Keine Aktivität in diesem Zeitraum.')}</p>`}</section>`;
  }
  function content() {
    const {users,economy,traffic} = data, games=data.games.reduce((sum,row)=>sum+row.started,0),completed=data.games.reduce((sum,row)=>sum+row.completed,0);
    const gameName = mode => ({daily:'Daily','higher-lower':t('Higher or Lower','Höher oder Tiefer'),random:t('Practice','Übung')})[mode]||esc(mode);
    const gameRows = [...data.games.map(row=>[gameName(row.mode),number(row.started),number(row.completed),number(row.players)]),...data.guests.map(row=>[`${gameName(row.mode)} · ${t('Guest','Gast')}`,number(row.started),number(row.completed),'—'])];
    return `<section class="admin-stats-section"><h3>${t('Accounts','Konten')}</h3><div class="admin-stats-metrics">
      ${metric(t('Player accounts','Spielerkonten'),number(users.total))}${metric(t('New accounts','Neue Konten'),number(users.registered))}
      ${metric(t('Players who played','Aktive Spieler'),number(users.playing),t('Distinct registered players who started a game in the selected UTC period. NPCs are excluded.','Unterschiedliche registrierte Spieler mit einem gestarteten Spiel im gewählten UTC-Zeitraum. NPCs sind ausgeschlossen.'))}
      ${metric(t('Signed-in accounts','Angemeldete Konten'),number(users.signedIn),t('Accounts with an unexpired login session. This is not an online-user count.','Konten mit einer gültigen Sitzung. Dies ist keine Anzahl aktuell anwesender Nutzer.'))}
      ${metric(t('Administrators','Administratoren'),number(users.admins))}${metric(t('Banned accounts','Gesperrte Konten'),number(users.banned))}
      ${metric(t('Games started','Gestartete Spiele'),number(games))}${metric(t('Games completed','Abgeschlossene Spiele'),number(completed))}
    </div></section>
    <div class="admin-stats-charts">${chart(t('New accounts per day','Neue Konten pro Tag'),'registrations')}${chart(t('Player games per day','Spielerpartien pro Tag'),'games')}</div>
    <section class="admin-stats-section"><h3>${t('Game usage','Spielnutzung')}${infoTip(t('Registered games in the selected period. Guest counts cover only runs still retained by the server; guest history expires. Dates use UTC.','Registrierte Spiele im gewählten Zeitraum. Gastzahlen umfassen nur noch gespeicherte Partien; Gastverläufe laufen ab. Datumsangaben verwenden UTC.'))}</h3>${gameRows.length?table(t('Game usage','Spielnutzung'),[t('Mode','Modus'),t('Started','Gestartet'),t('Completed','Abgeschlossen'),t('Players','Spieler')],gameRows):`<p class="admin-empty">${t('No games in this period.','Keine Spiele in diesem Zeitraum.')}</p>`}</section>
    <section class="admin-stats-section"><h3>${t('Economy','Wirtschaft')}${infoTip(t('Current balances and assets belong to human accounts, including banned accounts. Rewards paid use the selected period. These reads do not advance store sales or settle auctions.','Aktuelle Guthaben und Bestände gehören menschlichen Konten inklusive gesperrter Konten. Ausgezahlte Belohnungen beziehen sich auf den gewählten Zeitraum. Die Abfrage löst keine Ladenverkäufe oder Auktionsabrechnungen aus.'))}</h3><div class="admin-stats-metrics">
      ${metric(t('Available balances','Verfügbare Guthaben'),justizEuro(users.availableBalance))}${metric(t('Store registers','Ladenkassen'),justizEuro(economy.storeCash))}
      ${metric(t('Items held','Gegenstände im Besitz'),number(economy.items))}${metric(t('Active stores','Aktive Läden'),number(economy.stores))}
      ${metric(t('Store owners','Ladenbesitzer'),number(economy.storeOwners))}${metric(t('Live player auctions','Laufende Spielerauktionen'),number(economy.activeAuctions))}
      ${metric(t('Game rewards paid','Ausgezahlte Spielbelohnungen'),justizEuro(economy.rewardsPaid))}
    </div></section>
    <section class="admin-stats-section"><h3>${t('HTTP usage','HTTP-Nutzung')}${infoTip(t('Completed page and API requests, including guests. Static assets, health checks and admin API requests are excluded. SPA navigation normally appears as API requests. No IP addresses, cookies or query strings are recorded. Up to 90 UTC days are retained.','Abgeschlossene Seiten- und API-Anfragen inklusive Gästen. Statische Dateien, Zustandsprüfungen und Admin-API-Anfragen sind ausgeschlossen. SPA-Navigation erscheint meist als API-Anfragen. IP-Adressen, Cookies und Abfrageparameter werden nicht erfasst. Bis zu 90 UTC-Tage werden gespeichert.'))}</h3>
      ${traffic.trackingSince?`<p class="admin-stats-updated">${t('Recording since','Erfasst seit')} ${date(traffic.trackingSince)} · UTC</p><div class="admin-stats-metrics">
        ${metric(t('Requests','Anfragen'),number(traffic.requests||0))}${metric(t('API requests','API-Anfragen'),number(traffic.apiRequests||0))}
        ${metric(t('Client errors (4xx)','Clientfehler (4xx)'),number(traffic.clientErrors||0))}${metric(t('Server errors (5xx)','Serverfehler (5xx)'),number(traffic.serverErrors||0))}
        ${metric(t('Average response','Mittlere Antwortzeit'),`${number(traffic.averageMs||0,1)} ms`)}
      </div>${chart(t('HTTP requests per day','HTTP-Anfragen pro Tag'),'requests')}${traffic.routes.length?table(t('Request groups','Anfragegruppen'),[t('Route','Route'),t('Requests','Anfragen'),'4xx','5xx',t('Average','Durchschnitt')],traffic.routes.map(row=>[esc(row.route),number(row.requests),number(row.clientErrors),number(row.serverErrors),`${number(row.averageMs,1)} ms`])):''}`:`<p class="admin-empty">${t('HTTP tracking starts with the updated server.','Die HTTP-Erfassung beginnt mit dem aktualisierten Server.')}</p>`}
    </section>
    <details class="admin-stats-section"><summary>${t('Daily data (UTC)','Tagesdaten (UTC)')}</summary>${table(t('Daily data','Tagesdaten'),[t('Date','Datum'),t('New accounts','Neue Konten'),t('Games','Spiele'),t('Completed','Abgeschlossen'),t('Players','Spieler'),t('Guest games','Gastspiele'),t('Requests','Anfragen')],data.series.map(row=>[date(row.date),number(row.registrations),number(row.games),number(row.completed),number(row.players),number(row.guestGames),row.requests===null?'—':number(row.requests)]))}</details>
    <div class="admin-stats-details"><section class="admin-stats-section"><h3>${t('Player levels','Spielerlevel')}</h3>${table(t('Player levels','Spielerlevel'),[t('Level','Level'),t('Players','Spieler')],data.levels.map(row=>[number(row.level),number(row.players)]))}</section>
    <section class="admin-stats-section"><h3>${t('Recent accounts','Neueste Konten')}</h3>${table(t('Recent accounts','Neueste Konten'),[t('Username','Benutzername'),t('Joined (UTC)','Registriert (UTC)'),t('Level','Level'),t('Games','Spiele')],data.recentUsers.map(row=>[`${esc(row.username)}${row.banned?` <span class="admin-status is-banned">${t('Banned','Gesperrt')}</span>`:''}`,date(row.createdAt),number(row.level),number(row.games)]))}</section></div>`;
  }
  function markup() {
    if (!account?.admin) return '';
    return `<div data-admin-statistics aria-busy="${busy}"><div class="admin-stats-toolbar"><h2>${t('Statistics','Statistiken')}</h2><label>${t('Period','Zeitraum')}<select data-admin-stats-days>${[7,30,90].map(value=>`<option value="${value}" ${value===days?'selected':''}>${value} ${t('days','Tage')}</option>`).join('')}</select></label><button type="button" class="secondary-button" data-admin-stats-refresh ${busy?'disabled':''}>${adminIcon('refresh')}${t('Refresh','Aktualisieren')}</button></div>
      ${error?`<p class="account-error" role="alert">${esc(error)}</p>`:''}${busy?`<p role="status">${t('Loading…','Wird geladen …')}</p>`:''}
      ${data&&owner===account.id?`<p class="admin-stats-updated">${t('Updated','Aktualisiert')}: ${new Date(data.generatedAt).toLocaleString(uiLocale(),{timeZone:'UTC'})} UTC</p>${content()}`:''}</div>`;
  }
  function paint(restoreRefresh=false) {
    const panel=document.querySelector('#admin-panel-statistics');if(!panel||currentAccountPage!=='/admin')return;
    const active=document.activeElement,periodFocused=active?.matches('[data-admin-stats-days]');panel.innerHTML=markup();
    if(periodFocused)panel.querySelector('[data-admin-stats-days]')?.focus({preventScroll:true});
    else if(restoreRefresh&&!busy&&active===document.body)panel.querySelector('[data-admin-stats-refresh]')?.focus({preventScroll:true});
  }
  function stop() { request++;data=null;owner=null;visit=0;busy=false;error='';document.querySelector('[data-admin-statistics]')?.replaceChildren(); }
  async function load(currentVisit,{force=false,repaint=true,period=days}={}) {
    if(!account?.admin)return stop();
    if(owner!==account.id||visit!==currentVisit||period!==days){data=null;error='';}
    if(!force&&data&&owner===account.id&&visit===currentVisit&&period===days)return;
    if(!force&&busy&&visit===currentVisit)return;
    const restoreRefresh=document.activeElement?.matches('[data-admin-stats-refresh]');
    days=period;owner=account.id;visit=currentVisit;busy=true;error='';const current=++request,actor=owner;
    if(repaint)paint();
    try{const result=await accountApi('admin/statistics?days='+days);if(current===request&&currentVisit===accountVisit&&account?.id===actor&&account.admin)data=result;}
    catch(failure){if(current===request&&currentVisit===accountVisit&&account?.id===actor)error=failure.message;}
    finally{if(current===request){busy=false;if(repaint)paint(restoreRefresh);}}
  }
  document.addEventListener('click',event=>{if(event.target.closest('[data-admin-stats-refresh]')&&currentAccountPage==='/admin')void load(accountVisit,{force:true});});
  document.addEventListener('change',event=>{if(event.target.matches('[data-admin-stats-days]')&&currentAccountPage==='/admin')void load(accountVisit,{force:true,period:Number(event.target.value)});});
  return {load,markup,stop};
})();
