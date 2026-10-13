window.netWorthUi = (() => {
  const ranges = [['1d','1d','1T'],['1w','1w','1W'],['1m','1m','1M'],['all','All time','Gesamt']];
  let data = null, range = '1d', sequence = 0, loading = false, error = '', selection = null, timer = null, refreshTimer = null;
  const date = value => new Date(value).toLocaleString(uiLocale(), {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const esc = accountEscape;
  function stop() { clearInterval(timer);clearTimeout(refreshTimer);timer=null;refreshTimer=null;sequence++; data = null; loading = false; error = ''; selection = null; }
  async function read(visit, selected) {
    const request = ++sequence, owner = account?.id;
    loading = true; error = '';
    try {
      const result = await accountApi('net-worth?range=' + selected);
      if (request !== sequence || visit !== accountVisit || owner !== account?.id || selected !== range) return;
      data = result;
    } catch (failure) { if (request === sequence && visit === accountVisit && owner === account?.id) error = failure.message; }
    finally {
      if (request === sequence && visit === accountVisit && owner === account?.id) {
        loading = false;
        if (currentAccountPage === '/inventory') update();
      }
    }
  }
  async function load(visit) {
    const requested = new URLSearchParams(location.search).get('worth');
    range = ranges.some(([id]) => id === requested) ? requested : '1d';
    await read(visit, range);
    if (visit === accountVisit && account) timer=setInterval(()=>{if(currentAccountPage==='/inventory'&&!document.hidden&&!loading)read(accountVisit,range);},60000);
  }
  function geometry(points) {
    const width = window.matchMedia('(max-width: 600px)').matches ? 360 : 800;
    const left = 76, right = width - 20, top = 18, bottom = 214;
    const values = points.map(point => point.total), low = Math.min(...values), high = Math.max(...values);
    const padding = Math.max(10, (high - low) * .15);
    const min = low<0 ? low-padding : Math.max(0, low - padding), max = Math.max(min + 20, high + padding);
    const start = points[0].capturedAt, end = points.at(-1).capturedAt;
    return {width,left,right,top,bottom,min,max,start,end,
      x: point => start === end ? (left + right) / 2 : left + (right - left) * (point.capturedAt - start) / (end - start),
      y: point => bottom - (point.total - min) / (max - min) * (bottom - top)};
  }
  function plot(points) {
    if (!points.length) return '';
    const g = geometry(points), {width,left,right,top,bottom,min,max,start,end,x,y} = g;
    const short = value => 'J€ ' + new Intl.NumberFormat(uiLocale(), {notation:'compact',maximumFractionDigits:1}).format(value);
    const ticks = [min, (min+max)/2, max].map(value => {
      const at = y({total:value});
      return `<line x1="${left}" x2="${right}" y1="${at}" y2="${at}" class="worth-grid"/><text x="${left-10}" y="${at+4}" text-anchor="end">${esc(short(value))}</text>`;
    }).join('');
    const line = points.map(point => `${x(point)},${y(point)}`).join(' ');
    const labels = (start === end ? [start] : [start,end]).map((value,index) => `<text x="${start===end?(left+right)/2:index?right:left}" y="242" text-anchor="${start===end?'middle':index?'end':'start'}">${esc(new Date(value).toLocaleDateString(uiLocale(),{day:'numeric',month:'short',...(end-start<86400000?{hour:'2-digit',minute:'2-digit'}:{})}))}</text>`).join('');
    return `<div class="worth-plot"><svg viewBox="0 0 ${width} 258" data-worth-plot tabindex="0" role="group" aria-label="${t('Net worth history. Use left and right arrows to inspect snapshots.', 'Vermögensverlauf. Prüfe Momentaufnahmen mit den Pfeiltasten links und rechts.')}"><title>${t('Your net worth in J€', 'Dein Gesamtvermögen in J€')}</title>${ticks}${points.length>1?`<polygon points="${x(points[0])},${bottom} ${line} ${x(points.at(-1))},${bottom}" class="worth-area"/><polyline points="${line}" class="worth-line"/>`:''}<circle cx="${x(points.at(-1))}" cy="${y(points.at(-1))}" r="4" class="worth-latest"/>${labels}<line data-worth-crosshair x1="0" x2="0" y1="${top}" y2="${bottom}" class="worth-crosshair" visibility="hidden"/><circle data-worth-marker cx="0" cy="0" r="5" class="worth-marker" visibility="hidden"/></svg></div><p class="worth-inspection" data-worth-inspection role="status" aria-live="polite">${t('Hover, touch, or use arrow keys to inspect your history.', 'Prüfe den Verlauf mit Maus, Berührung oder Pfeiltasten.')}</p>`;
  }
  function markup() {
    if (!account) return '';
    const points = data?.range === range ? data.points : [], current = data?.current;
    const first = points[0]?.total, last = points.at(-1)?.total, change = points.length>1 ? last-first : null;
    const direction = change === null || change === 0 ? 'is-flat' : change>0 ? 'is-up' : 'is-down';
    return `<section class="net-worth-chart ${direction}" aria-labelledby="net-worth-title" aria-busy="${loading}"><div class="worth-heading"><div><p class="eyebrow">${t('YOUR WEALTH', 'DEIN VERMÖGEN')}</p><h2 id="net-worth-title">${t('Net worth', 'Gesamtvermögen')}</h2></div><div class="worth-ranges" role="group" aria-label="${t('Net worth time range', 'Zeitraum des Vermögensverlaufs')}">${ranges.map(([id,en,de])=>`<button type="button" data-worth-range="${id}" aria-pressed="${range===id}">${t(en,de)}</button>`).join('')}</div></div>
      ${current?`<div class="worth-summary"><strong>${justizEuro(current.total)}</strong><span class="worth-change">${change===null?t('Your first snapshot is saved.', 'Deine erste Momentaufnahme ist gespeichert.'):`${change>0?'+':change<0?'−':''}${justizEuro(Math.abs(change))}${first>0?` (${change>0?'+':''}${number(change/first*100,1)}%)`:''} · ${t('in this view', 'in dieser Ansicht')}`}</span></div>`:''}
      ${error?`<p class="account-error" role="alert">${esc(error)}</p><button class="secondary-button" type="button" data-worth-retry>${t('Try again', 'Erneut versuchen')}</button>`:loading?`<p class="worth-loading" role="status">${t('Loading your wealth history…', 'Dein Vermögensverlauf wird geladen …')}</p>`:plot(points)}
      ${current?`<dl class="worth-breakdown">${[[t('Cash','Guthaben'),current.cash],[t('Store tills','Ladenkassen'),current.storeCash||0],[t('Held in bids','In Geboten gebunden'),current.heldBids],[t('Items & sealed palettes','Artikel & versiegelte Paletten'),current.items+current.sealedPalettes],[t('Store properties','Ladengrundstücke'),current.businesses],...(current.fineDebt?[[t('Outstanding fine','Offenes Bußgeld'),-current.fineDebt]]:[])].map(([label,value])=>`<div><dt>${label}</dt><dd>${justizEuro(value)}</dd></div>`).join('')}</dl>`:''}
      <p class="worth-note">${t('Items include listed finds and store stock at market estimates. Unopened palettes use their purchase or winning price; properties use current store opening costs. History records activity and five-minute snapshots from when tracking begins.', 'Artikel umfassen angebotene Funde und Ladenbestand zu Marktschätzungen. Ungeöffnete Paletten zählen mit ihrem Kauf- oder Zuschlagspreis, Grundstücke mit den aktuellen Ladeneröffnungskosten. Der Verlauf speichert Aktivität und Fünf-Minuten-Momentaufnahmen ab Beginn der Aufzeichnung.')}</p>
      ${data?`<p class="worth-since">${t('Tracking since', 'Aufzeichnung seit')} ${date(data.trackedSince)}</p>`:''}</section>`;
  }
  function update() {
    const root = accountContent.querySelector('.net-worth-chart');
    if (!root) return;
    const focus = root.contains(document.activeElement) ? document.activeElement?.dataset?.worthRange : null;
    root.outerHTML = markup(); wire();
    if (focus) accountContent.querySelector(`[data-worth-range="${focus}"]`)?.focus({preventScroll:true});
  }
  function wire() {
    const root = accountContent.querySelector('.net-worth-chart'), svg = root?.querySelector('[data-worth-plot]');
    if (!svg || !data?.points.length || loading || data.range!==range) return;
    const points=data.points,g=geometry(points),cross=root.querySelector('[data-worth-crosshair]'),marker=root.querySelector('[data-worth-marker]'),status=root.querySelector('[data-worth-inspection]');
    let at = selection===null?points.length-1:Math.min(selection,points.length-1);
    function show(index) {
      at=Math.max(0,Math.min(points.length-1,index));selection=at;const point=points[at];
      cross.setAttribute('x1',g.x(point));cross.setAttribute('x2',g.x(point));cross.setAttribute('visibility','visible');marker.setAttribute('cx',g.x(point));marker.setAttribute('cy',g.y(point));marker.setAttribute('visibility','visible');status.textContent=`${date(point.capturedAt)} · ${justizEuro(point.total)}`;
    }
    function near(event) {
      const box=svg.getBoundingClientRect(),position=(event.clientX-box.left)/box.width*g.width;
      let closest=0;for(let i=1;i<points.length;i++)if(Math.abs(g.x(points[i])-position)<Math.abs(g.x(points[closest])-position))closest=i;show(closest);
    }
    svg.addEventListener('pointermove',near);svg.addEventListener('pointerdown',near);svg.addEventListener('focus',()=>show(at));
    svg.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();show(event.key==='Home'?0:event.key==='End'?points.length-1:at+(event.key==='ArrowLeft'?-1:1));});
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-worth-range], [data-worth-retry]');if(!button||currentAccountPage!=='/inventory'||!account)return;
    if(button.dataset.worthRange){range=button.dataset.worthRange;selection=null;const query=new URLSearchParams(location.search);if(range==='1d')query.delete('worth');else query.set('worth',range);history.replaceState({},'', '/inventory'+(query.size?'?'+query:''));}
    const promise=read(accountVisit,range);update();await promise;
  });
  function accountChanged() { if(!data||currentAccountPage!=='/inventory'||!account)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>read(accountVisit,range),200); }
  return {load,stop,markup,wire,accountChanged};
})();
