window.theftHeatUi = (() => {
  function markup(heat) {
    if (!heat) return '';
    const elapsed=heat.nextDecayAt&&Date.now()>=heat.nextDecayAt?1+Math.floor((Date.now()-heat.nextDecayAt)/1800000):0;
    const stars=Math.max(0,heat.stars-elapsed/2);
    const label=t(`${number(stars)} of 5 wanted stars`,`${number(stars)} von 5 Fahndungssternen`);
    const help=t('Each attempt adds half a star. Each stolen item adds another half-star below J€500, 1 star from J€500, 1½ from J€2,500, or 2 from J€10,000. Half a star fades every 30 minutes, including offline. Each full star adds 10 percentage points to police catch odds on later attempts, up to 95%.','Jeder Versuch bringt einen halben Stern. Pro gestohlenem Artikel kommen unter J€500 ein halber Stern, ab J€500 ein Stern, ab J€2.500 anderthalb oder ab J€10.000 zwei Sterne hinzu. Alle 30 Minuten verschwindet ein halber Stern, auch offline. Jeder volle Stern erhöht die Fangchance späterer Versuche um 10 Prozentpunkte, bis maximal 95%.');
    return `<div class="theft-heat"><strong>Heat</strong><span class="heat-stars" role="img" aria-label="${accountEscape(label)}">${Array.from({length:5},(_,index)=>`<span class="heat-star" aria-hidden="true"><span>★</span><span class="heat-star-fill" style="width:${Math.max(0,Math.min(1,stars-index))*100}%">★</span></span>`).join('')}</span><span class="info-tooltip" tabindex="0" role="note" aria-label="${accountEscape(help)}" data-tooltip="${accountEscape(help)}">?</span></div>`;
  }
  return { markup };
})();
