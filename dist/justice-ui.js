window.justiceUi = (() => {
  const dialog=document.createElement('dialog');dialog.className='justice-dialog';dialog.setAttribute('aria-labelledby','justice-title');document.body.append(dialog);
  const notice=document.createElement('aside');notice.className='justice-notice';notice.hidden=true;notice.setAttribute('role','status');document.body.append(notice);
  let countdown=null,poll=null,pending=false,owner=null,mode=null,paintedEncounter=null;
  const remaining=()=>{const seconds=Math.max(0,Math.ceil(((account?.justice?.jailedUntil||0)-Date.now())/1000));return `${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds%3600/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;};
  function paint(){
    const justice=account.justice,result=justice.lastConsequence,encounter=justice.policeEncounter;
    if(encounter){
      paintedEncounter=encounter.id+':'+account.tokens;
      const canPay=account.tokens>=encounter.fine;
      dialog.innerHTML=`<div class="justice-content police-recognition-content"><div class="justice-bars" aria-hidden="true"><span>!</span></div><h1 id="justice-title" tabindex="-1">${t('Police recognized you','Die Polizei hat dich erkannt')}</h1><p>${t('Officers spotted you during an ordinary activity and matched you to a wanted suspect in their database. Your completed activity is saved.','Beamte haben dich bei einer gewöhnlichen Aktion gesehen und in ihrer Datenbank als gesuchte Person erkannt. Deine abgeschlossene Aktion ist gespeichert.')}</p><div class="justice-receipt"><p><strong>${number(encounter.heatStars)} ${t('wanted stars','Fahndungssterne')} · ${number(encounter.fineMultiplier)}× ${t('fine multiplier','Bußgeld-Multiplikator')}</strong></p><p>${t('Fine','Bußgeld')}: <strong>${justizEuro(encounter.fine)}</strong></p><p>${t('Sentence','Haftstrafe')}: <strong>${number(encounter.sentenceMinutes)} ${t('minutes','Minuten')}</strong></p></div><p>${t('Pay from your available balance or serve the sentence. Both choices reduce Heat below the recognition threshold.','Bezahle aus deinem verfügbaren Guthaben oder verbüße die Haftstrafe. Beide Möglichkeiten senken Heat unter die Erkennungsschwelle.')}</p>${!canPay?`<p>${t('Not enough available cash to pay the fine.','Nicht genügend verfügbares Guthaben, um das Bußgeld zu bezahlen.')}</p>`:''}<div class="justice-actions"><button class="primary-button" data-police-choice="pay" ${!canPay||pending?'disabled':''}>${t('Pay fine','Bußgeld zahlen')} · ${justizEuro(encounter.fine)}</button><button class="secondary-button" data-police-choice="jail" ${pending?'disabled':''}>${t('Serve sentence','Haftstrafe verbüßen')} · ${number(encounter.sentenceMinutes)} ${t('min','Min.')}</button><button class="secondary-button" data-justice-logout>${t('Sign out','Abmelden')}</button></div><p class="account-error" role="alert"></p></div>`;
      return;
    }
    dialog.innerHTML=`<div class="justice-content"><div class="justice-bars" aria-hidden="true"><span>JG</span></div><h1 id="justice-title" tabindex="-1">${t('You are in jail','Du sitzt im Gefängnis')}</h1><p>${result?.reason==='police_recognition'?t('You chose to serve the sentence instead of paying the recognition fine. Your account is locked until release.','Du hast die Haftstrafe statt der Zahlung des Bußgelds gewählt. Dein Konto ist bis zur Entlassung gesperrt.'):t('The bailiff found no inventory left to cover your fine. The unpaid remainder became a prison sentence. Your account is locked until release.','Der Gerichtsvollzieher hat kein Inventar mehr gefunden, um dein Bußgeld zu decken. Der offene Rest wurde in eine Haftstrafe umgewandelt. Dein Konto ist bis zur Entlassung gesperrt.')}</p><strong class="justice-countdown" data-jail-countdown aria-label="${t('Time remaining','Verbleibende Zeit')}">${remaining()}</strong><p>${t('Release','Entlassung')}: ${new Date(justice.jailedUntil).toLocaleString(uiLocale())}</p><p>${number(justice.offences)} ${t('recorded offence(s). Repeat offences bring longer sentences, up to 24 hours.','erfasste Vergehen. Wiederholte Vergehen führen zu längeren Strafen, bis zu 24 Stunden.')}</p>${result?`<div class="justice-receipt"><p>${t('Cash collected','Guthaben eingezogen')}: ${justizEuro(result.paidCash)} · ${number(result.seized.length)} ${t('items seized','Artikel gepfändet')}</p><p>${t('Fine converted to sentence','In Haft umgewandeltes Bußgeld')}: ${justizEuro(result.convertedToSentence)}</p>${result.seized.length?`<ul>${result.seized.map(item=>`<li>${accountEscape(item.title)} · ${justizEuro(item.value)}</li>`).join('')}</ul>`:''}</div>`:''}<p class="account-error" role="alert"></p><div class="justice-actions"><button class="primary-button" data-justice-check>${t('Check release','Entlassung prüfen')}</button><button class="secondary-button" data-justice-logout>${t('Sign out','Abmelden')}</button></div></div>`;
  }
  async function check(){if(pending||!account||owner!==account.id)return;const checkingOwner=owner;pending=true;try{const result=await accountApi('me');if(checkingOwner!==account?.id||owner!==checkingOwner)return;updateAccount(result.user);}catch(error){if(dialog.open)dialog.querySelector('.account-error').textContent=error.message;}finally{pending=false;}}
  function sync(user){
    const wasOpen=dialog.open;
    if(!user?.justice?.jailed&&!user?.justice?.policeEncounter){
      clearInterval(countdown);clearInterval(poll);countdown=null;poll=null;owner=null;mode=null;if(dialog.open)dialog.close();
      notice.hidden=!user?.justice?.fineDue;
      if(!notice.hidden)notice.textContent=t(`Bailiff collection pending: ${justizEuro(user.justice.fineDue)}. New theft attempts are blocked until paid.`,`Pfändung offen: ${justizEuro(user.justice.fineDue)}. Neue Diebstahlversuche sind bis zur Zahlung gesperrt.`);
      if(wasOpen&&user){if(location.pathname==='/'){showGamePage();if(typeof renderStart==='function')renderStart();}else navigateAccountPage(location.pathname+location.search,false);}
      return;
    }
    notice.hidden=true;owner=user.id;
    const nextMode=user.justice.policeEncounter?'police':'jail';
    if(!wasOpen||mode!==nextMode){
      mode=nextMode;clearInterval(countdown);clearInterval(poll);countdown=null;poll=null;
      window.storeUi?.stop();window.businessUi?.stop();window.economyUi?.stop();window.townUi?.stop();window.netWorthUi?.stop();
      document.querySelectorAll('dialog[open]').forEach(other=>{if(other!==dialog)other.close();});
      clearInterval(countdownTimer);higherLowerRequest++;
      paint();if(!dialog.open)dialog.showModal();dialog.querySelector('h1').focus({preventScroll:true});
      if(mode==='jail')countdown=setInterval(()=>{const output=dialog.querySelector('[data-jail-countdown]');if(output)output.textContent=remaining();if(account?.justice?.jailedUntil<=Date.now())check();},1000);
      poll=setInterval(check,15000);
    }else if(mode==='police'&&paintedEncounter!==user.justice.policeEncounter.id+':'+user.tokens)paint();
  }
  async function resolve(choice){
    if(pending||!account?.justice?.policeEncounter)return;
    const id=account.justice.policeEncounter.id,checkingOwner=account.id;let message='';pending=true;
    for(const button of dialog.querySelectorAll('[data-police-choice]'))button.disabled=true;
    try{const result=await accountApi('police/resolve',{id,choice});if(account?.id===checkingOwner)updateAccount(result.user);}
    catch(error){message=error.message;}
    finally{pending=false;if(account?.id===checkingOwner&&account?.justice?.policeEncounter){paint();dialog.querySelector('.account-error').textContent=message;}}
  }
  dialog.addEventListener('cancel' ,event=>event.preventDefault());
  dialog.addEventListener('click',async event=>{const choice=event.target.closest('[data-police-choice]');if(choice)await resolve(choice.dataset.policeChoice);if(event.target.closest('[data-justice-check]'))await check();if(event.target.closest('[data-justice-logout]')){await accountApi('logout',{});updateAccount(null);showGamePage();}});
  document.addEventListener('jg:language',()=>{if(dialog.open)paint();else sync(account);});
  return {sync};
})();
