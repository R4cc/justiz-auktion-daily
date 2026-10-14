window.profileUi = (() => {
  const esc=accountEscape;
  const icons={star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',daily:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-12 6 3 3 5-6"/>',find:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7 5l10 4v5"/>',sale:'<path d="M3 7h18l-2 6H5L3 7Zm2 6v8h14v-8m-9 8v-6h4v6M5 7V3h14v4"/>',reinvest:'<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16"/>',friends:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5"/>',record:'<path d="M6 3h12v18H6V3Zm3 5h6m-6 4h6m-6 4h4"/>',check:'<path d="m5 12 4 4L19 6"/>'};
  const icon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id]||icons.star}</svg>`;
  const selectedTab=()=>['overview','friends','record'].includes(new URLSearchParams(location.search).get('tab'))?new URLSearchParams(location.search).get('tab'):'overview';
  function hero(){
    const p=account.progression,level=p.level;
    return `<header class="profile-hero"><div class="profile-level-seal" aria-hidden="true"><span>${icon('star')}</span><small>LEVEL</small><strong>${number(level)}</strong><svg class="profile-laurel" viewBox="0 0 140 160" fill="none"><path d="M37 133C5 110 5 64 32 37m-12 18-8-14m6 32L4 62m15 28L3 85m23 22-18-3m95 29c32-23 32-69 5-96m12 18 8-14m-6 32 14-11m-15 28 16-5m-23 22 18-3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div><div class="profile-identity"><h1 tabindex="-1">${esc(account.username)}</h1><p class="profile-title">${t('Level','Level')} ${number(level)}</p><div class="profile-xp-caption"><span>${number(p.xp)} XP</span><strong>${p.nextLevelXp===null?t('Max level reached','Maximallevel erreicht'):t(`${number(p.nextLevelXp-p.xp)} XP to level ${level+1}`,`${number(p.nextLevelXp-p.xp)} XP bis Level ${level+1}`)}</strong></div><progress class="profile-xp" max="1" value="${p.progress}" aria-label="${t('Level progress','Levelfortschritt')}"></progress></div><a class="profile-skill-bank" href="/skills" data-page><span>${icon('star')}</span><strong>${number(account.skills?.available||0)}</strong><small>${t(account.skills?.available===1?'skill point':'skill points',account.skills?.available===1?'Skillpunkt':'Skillpunkte')}</small><b>${t('Skills','Skills')} →</b></a></header>`;
  }
  function tabs(tab){
    const accepted=accountFriends.friends.filter(friend=>friend.status==='accepted').length,incoming=accountFriends.friends.filter(friend=>friend.status==='incoming').length;
    const entries=[['overview',t('Overview','Übersicht'),'star',null],['friends',t('Friends','Freunde'),'friends',incoming?`${incoming} ${t('new','neu')}`:accepted||null],['record',t('Criminal record','Strafregister'),'record',accountCriminalRecord.total||null]];
    return `<div class="profile-tabs" role="tablist" aria-label="${t('Profile sections','Profilbereiche')}">${entries.map(([id,label,symbol,count])=>`<button type="button" role="tab" id="profile-tab-${id}" data-profile-tab="${id}" aria-controls="profile-panel" aria-selected="${tab===id}" tabindex="${tab===id?0:-1}">${icon(symbol)}<span>${label}</span>${count!==null?`<small>${esc(count)}</small>`:''}</button>`).join('')}</div>`;
  }
  function journey(){
    const {done,steps,next}=traderMilestoneState(),completed=steps.filter(([id])=>done.has(id)).length;
    return `<section class="profile-journey" aria-labelledby="profile-journey-title"><header><div><h2 id="profile-journey-title">${t('Milestones','Meilensteine')}</h2></div>${next?`<a class="primary-button profile-next-goal" href="${next[2]}" data-page>${next[1]} →</a>`:`<a class="secondary-button" href="/inventory" data-page>${t('Inventory','Inventar')} →</a>`}</header><div class="profile-journey-caption"><span>${t('Milestones earned','Erreichte Meilensteine')}</span><strong>${completed} / ${steps.length}</strong></div><progress max="${steps.length}" value="${completed}" aria-label="${t('Trader milestones','Händler-Meilensteine')}"></progress><ol class="profile-milestone-path">${steps.map(([id,label],index)=>{const earned=done.has(id),current=next?.[0]===id;return `<li class="profile-milestone ${earned?'is-earned':current?'is-current':'is-upcoming'}" data-milestone="${id}"><span class="profile-milestone-emblem">${icon(earned?'check':id)}</span><div><small>${earned?t('EARNED','ERREICHT'):current?t('UP NEXT','ALS NÄCHSTES'):t('MILESTONE','MEILENSTEIN')} ${!earned?index+1:''}</small><strong>${label}</strong></div></li>`;}).join('')}</ol></section>`;
  }
  function dailyCard(){
    const daily=account.daily,complete=daily?.status==='completed',active=daily?.status==='in_progress',rewards=accountCatalog?.rewards||{daily:1000,dailyScoreBonus:0};
    const earned=account.rewardsByMode?.daily?.earned||0;
    return `<article class="profile-play-card profile-daily-card ${complete?'is-complete':''}"><span class="profile-card-icon">${icon(complete?'check':'daily')}</span><div><h2>${t('Daily','Daily')}</h2><p>${dailyFriendLabel(daily)}</p><span class="profile-reward-chip">${complete?`${justizEuro(earned)} ${t('earned today','heute verdient')}`:`${justizEuro(rewards.daily)} · ${t('1 case','1 Kiste')}`}</span></div><a class="primary-button" href="${complete?'/leaderboard?view=daily':'/'}" data-page>${complete?t('Leaderboard','Rangliste'):active?t('Resume Daily','Daily fortsetzen'):t('Play Daily','Daily spielen')} →</a></article>`;
  }
  function overview(){
    return `${journey()}<div class="profile-play-grid">${dailyCard()}<a class="profile-play-card profile-collection-card" href="/inventory" data-page><span class="profile-card-icon">${icon('find')}</span><div><h2>${number(account.itemCount)} ${t(account.itemCount===1?'item':'items',account.itemCount===1?'Gegenstand':'Gegenstände')}</h2></div><strong>${t('Inventory','Inventar')} →</strong></a></div><section class="profile-wallet" aria-label="${t('Your trading stats','Deine Handelsbilanz')}"><div><span>${t('Trading profit','Handelsgewinn')}</span><strong>${justizEuro(account.realizedTradingProfit||0)}</strong></div><a href="/leaderboard?view=collection" data-page><span>${t('Collection rank','Sammlungsrang')}</span><strong>${t('Leaderboard','Rangliste')} →</strong></a></section><details class="profile-breakdown"><summary>${t('Trading breakdown & rewards','Handelsdetails & Belohnungen')}</summary>${economyOverviewMarkup()}${rewardBanner()}</details>`;
  }
  function render(){
    if(!account){accountContent.innerHTML=pageHeading(t('Profile','Profil'))+loginNotice('profile');return;}
    const tab=selectedTab();
    const content=tab==='record'?criminalRecordMarkup():tab==='friends'?`<section class="profile-friends"><div class="friends-heading"><div><h2>${t('Friends','Freunde')}</h2></div><button type="button" class="secondary-button" data-account="refresh">${t('Refresh','Aktualisieren')}</button></div>${friendsMarkup()}</section>`:overview();
    accountContent.innerHTML=`<div class="profile-hub">${hero()}${tabs(tab)}<div id="profile-panel" role="tabpanel" aria-labelledby="profile-tab-${tab}">${content}</div><footer class="profile-account-controls"><button type="button" class="secondary-button" data-account="logout">${t('Log out','Abmelden')}</button></footer></div>`;
  }
  function select(tab){
    if(currentAccountPage!=='/profile'||!account||!['overview','friends','record'].includes(tab))return;
    const query=new URLSearchParams(location.search);if(tab==='overview')query.delete('tab');else query.set('tab',tab);
    history.replaceState({},'','/profile'+(query.size?'?'+query:''));render();accountContent.querySelector(`[data-profile-tab="${tab}"]`)?.focus({preventScroll:true});
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-profile-tab]');if(button)select(button.dataset.profileTab);});
  document.addEventListener('keydown',event=>{
    const button=event.target.closest('[data-profile-tab]');if(!button||currentAccountPage!=='/profile')return;
    const ids=['overview','friends','record'],index=ids.indexOf(button.dataset.profileTab);
    const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:null;
    if(next!==null){event.preventDefault();select(ids[next]);}
  });
  return {render};
})();
