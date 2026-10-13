window.justiceUi = (() => {
  const dialog=document.createElement('dialog');dialog.className='justice-dialog';dialog.setAttribute('aria-labelledby','justice-title');document.body.append(dialog);
  const notice=document.createElement('aside');notice.className='justice-notice';notice.hidden=true;notice.setAttribute('role','status');document.body.append(notice);
  let countdown=null,poll=null,pending=false,owner=null;
  const remaining=()=>{const seconds=Math.max(0,Math.ceil(((account?.justice?.jailedUntil||0)-Date.now())/1000));return `${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds%3600/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;};
  function paint(){
    const justice=account.justice,result=justice.lastConsequence;
    dialog.innerHTML=`<div class="justice-content"><div class="justice-bars" aria-hidden="true"><span>JG</span></div><h1 id="justice-title" tabindex="-1">${t('You are in jail','Du sitzt im Gefängnis')}</h1><p>${t('The bailiff found no inventory left to cover your fine. The unpaid remainder became a prison sentence. Your account is locked until release.','Der Gerichtsvollzieher hat kein Inventar mehr gefunden, um dein Bußgeld zu decken. Der offene Rest wurde in eine Haftstrafe umgewandelt. Dein Konto ist bis zur Entlassung gesperrt.')}</p><strong class="justice-countdown" data-jail-countdown aria-label="${t('Time remaining','Verbleibende Zeit')}">${remaining()}</strong><p>${t('Release','Entlassung')}: ${new Date(justice.jailedUntil).toLocaleString(uiLocale())}</p><p>${number(justice.offences)} ${t('recorded offence(s). Repeat offences bring longer sentences, up to 24 hours.','erfasste Vergehen. Wiederholte Vergehen führen zu längeren Strafen, bis zu 24 Stunden.')}</p>${result?`<div class="justice-receipt"><p>${t('Cash collected','Guthaben eingezogen')}: ${justizEuro(result.paidCash)} · ${number(result.seized.length)} ${t('items seized','Artikel gepfändet')}</p><p>${t('Fine converted to sentence','In Haft umgewandeltes Bußgeld')}: ${justizEuro(result.convertedToSentence)}</p>${result.seized.length?`<ul>${result.seized.map(item=>`<li>${accountEscape(item.title)} · ${justizEuro(item.value)}</li>`).join('')}</ul>`:''}</div>`:''}<p class="account-error" role="alert"></p><div class="justice-actions"><button class="primary-button" data-justice-check>${t('Check release','Entlassung prüfen')}</button><button class="secondary-button" data-justice-logout>${t('Sign out','Abmelden')}</button></div></div>`;
  }
  async function check(){if(pending||!account||owner!==account.id)return;const checkingOwner=owner;pending=true;try{const result=await accountApi('me');if(checkingOwner!==account?.id||owner!==checkingOwner)return;updateAccount(result.user);}catch(error){if(dialog.open)dialog.querySelector('.account-error').textContent=error.message;}finally{pending=false;}}
  function sync(user){
    const wasOpen=dialog.open;
    if(!user?.justice?.jailed){
      clearInterval(countdown);clearInterval(poll);countdown=null;poll=null;owner=null;if(dialog.open)dialog.close();
      notice.hidden=!user?.justice?.fineDue;
      if(!notice.hidden)notice.textContent=t(`Bailiff collection pending: ${justizEuro(user.justice.fineDue)}. New theft attempts are blocked until paid.`,`Pfändung offen: ${justizEuro(user.justice.fineDue)}. Neue Diebstahlversuche sind bis zur Zahlung gesperrt.`);
      if(wasOpen&&user){if(location.pathname==='/'){showGamePage();if(typeof renderStart==='function')renderStart();}else navigateAccountPage(location.pathname+location.search,false);}
      return;
    }
    notice.hidden=true;owner=user.id;
    if(!wasOpen){
      window.storeUi?.stop();window.businessUi?.stop();window.economyUi?.stop();window.townUi?.stop();window.netWorthUi?.stop();
      document.querySelectorAll('dialog[open]').forEach(other=>{if(other!==dialog)other.close();});
      clearInterval(countdownTimer);higherLowerRequest++;
      paint();dialog.showModal();dialog.querySelector('h1').focus({preventScroll:true});
      countdown=setInterval(()=>{const output=dialog.querySelector('[data-jail-countdown]');if(output)output.textContent=remaining();if(account?.justice?.jailedUntil<=Date.now())check();},1000);
      poll=setInterval(check,15000);
    }
  }
  dialog.addEventListener('cancel',event=>event.preventDefault());
  dialog.addEventListener('click',async event=>{if(event.target.closest('[data-justice-check]'))await check();if(event.target.closest('[data-justice-logout]')){await accountApi('logout',{});updateAccount(null);showGamePage();}});
  document.addEventListener('jg:language',()=>{if(dialog.open)paint();else sync(account);});
  return {sync};
})();
