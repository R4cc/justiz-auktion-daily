window.loansUi = (() => {
  const esc=accountEscape;
  let data=null,sequence=0,timer=null,busy=false,error='',success='',selected=null,repaymentDraft=null;
  const dialog=document.createElement('dialog');dialog.className='loan-confirm';dialog.setAttribute('aria-labelledby','loan-confirm-title');document.body.append(dialog);
  const date=value=>new Date(value).toLocaleString(uiLocale(),{dateStyle:'medium',timeStyle:'short'});
  const key=()=>`jg:loan-request:${account?.id}`;
  let memoryPending=null;
  function pending(){try{return JSON.parse(localStorage.getItem(key())||'null')||memoryPending;}catch{return memoryPending;}}
  function savePending(value){memoryPending=value;try{if(value)localStorage.setItem(key(),JSON.stringify(value));else localStorage.removeItem(key());}catch{}}
  function stop(){sequence++;clearInterval(timer);timer=null;data=null;busy=false;error='';success='';selected=null;memoryPending=null;repaymentDraft=null;dialog.close();}
  async function refresh(visit){
    const request=++sequence,owner=account?.id;
    const result=await accountApi('loans');
    if(request!==sequence||visit!==accountVisit||owner!==account?.id||currentAccountPage!=='/loans')return;
    data=result;updateAccount({...account,tokens:result.tokens,loanDebt:result.active?.total||0});render();
  }
  async function load(visit){
    if(!account){render();return;}
    await refresh(visit);
    if(visit===accountVisit)timer=setInterval(()=>{if(!busy&&!document.hidden&&!dialog.open&&!accountContent.querySelector('[data-loan-repay]')?.contains(document.activeElement))void refresh(accountVisit).catch(()=>{});},30000);
  }
  const blocked=()=>data?.blocked==='loan_active'?t('Repay your current loan to borrow again.','Zahle deinen laufenden Kredit vor dem nächsten zurück.'):data?.blocked==='loan_cooldown'?`${t('Next loan available','Nächster Kredit verfügbar')}: ${date(data.availableAt)}`:data?.blocked==='loan_justice_pending'?t('Settle fines and finish your sentence before borrowing.','Begleiche Bußgelder und verbüße deine Haftstrafe vor einer Kreditaufnahme.'):'';
  function offerCard(offer){
    const disabled=busy||pending()||!offer.available;
    return `<article class="loan-offer ${offer.unlocked?'is-unlocked':'is-locked'}"><header><span class="loan-tier">${esc(t(offer.name,offer.nameDe))}</span><span aria-hidden="true">${offer.unlocked?'✦':'🔒'}</span></header><h2>${justizEuro(offer.principal)}</h2><dl><div><dt>${t('Borrowing fee','Kreditgebühr')}</dt><dd>${justizEuro(offer.fee)} · ${offer.feePercent}%</dd></div><div><dt>${t('Starting interest / real day','Anfangszinsen / echtem Tag')}</dt><dd>${offer.dailyInterestPercent}% · ${justizEuro(offer.interestPerDay)}</dd></div><div><dt>${t('After','Nach')} ${offer.termDays} ${t('real days','echten Tagen')}</dt><dd>${offer.overdueInterestPercent}% ${t('/ day','/ Tag')}</dd></div></dl><p class="loan-requirements"><span class="${data.level>=offer.requiredLevel?'is-met':''}">${t('Level','Level')} ${offer.requiredLevel}</span><span class="${data.netWorth>=offer.requiredNetWorth?'is-met':''}">${t('Net worth','Gesamtvermögen')} ${justizEuro(offer.requiredNetWorth)}</span></p><button class="primary-button" type="button" data-loan="review" data-offer="${esc(offer.id)}" ${disabled?'disabled':''}>${offer.unlocked?t('Review loan','Kredit prüfen'):t('Locked','Gesperrt')}</button></article>`;
  }
  function activeMarkup(loan){
    if(repaymentDraft?.loanId!==loan.id)repaymentDraft={loanId:loan.id,value:null};
    const amount=repaymentDraft.value??(Math.min(data.tokens,loan.total)||'');
    return `<section class="loan-active ${loan.status==='overdue'?'is-overdue':''}" aria-labelledby="loan-active-title"><header><div><span class="loan-tier">${loan.status==='overdue'?t('OVERDUE','ÜBERFÄLLIG'):t('ACTIVE LOAN','LAUFENDER KREDIT')}</span><h2 id="loan-active-title">${esc(t(loan.name,loan.nameDe))}</h2></div><strong>${justizEuro(loan.total)}</strong></header><dl><div><dt>${t('Remaining principal','Offener Kreditbetrag')}</dt><dd>${justizEuro(loan.principal)}</dd></div><div><dt>${t('Fees & interest due','Offene Gebühren & Zinsen')}</dt><dd>${justizEuro(loan.interest)}</dd></div><div><dt>${t('Due','Fällig')}</dt><dd>${esc(date(loan.dueAt))}</dd></div><div><dt>${t('Current interest / real day','Aktuelle Zinsen / echtem Tag')}</dt><dd>${loan.status==='overdue'?loan.overdueInterestPercent:loan.dailyInterestPercent}%</dd></div><div><dt>${t('Interest after deadline','Zinsen nach Fälligkeit')}</dt><dd>${loan.overdueInterestPercent}% ${t('/ day','/ Tag')}</dd></div></dl><p>${t('Interest accrues continuously, including offline. Payments cover fees and interest first, then reduce principal. After the deadline, available wallet cash is collected automatically until the debt is cleared.','Zinsen laufen fortlaufend weiter, auch offline. Zahlungen decken zuerst Gebühren und Zinsen, danach den Kreditbetrag. Nach Fälligkeit wird verfügbares Guthaben automatisch eingezogen, bis die Schuld beglichen ist.')}</p><form data-loan-repay><label>${t('Repayment amount','Rückzahlungsbetrag')}<input name="amount" type="number" min="1" max="${Math.min(data.tokens,loan.total)}" step="1" inputmode="numeric" value="${esc(amount)}" required ${busy||pending()||!data.tokens?'disabled':''}></label><button class="primary-button" type="submit" ${busy||pending()||!data.tokens?'disabled':''}>${t('Repay','Zurückzahlen')}</button></form></section>`;
  }
  function render(){
    if(currentAccountPage!=='/loans')return;
    if(!account){accountContent.innerHTML=pageHeading(t('Loans','Kredite'))+`<a href="/login" data-page class="primary-button">${t('Sign in','Anmelden')}</a>`;return;}
    if(!data){accountContent.innerHTML=pageHeading(t('Loans','Kredite'))+`<p role="status">${t('Loading…','Wird geladen …')}</p>`;return;}
    accountContent.innerHTML=`<div class="loans-page"><header class="loans-heading"><div><p class="loan-tier">${t('AUCTION CREDIT OFFICE','AUKTIONS-KREDITBÜRO')}</p><h1 tabindex="-1">${t('Loans','Kredite')}</h1></div><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="m6 23 26-15 26 15H6Zm7 6v20m13-20v20m12-20v20m13-20v20M6 56h52" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="17" r="3" fill="currentColor"/></svg></header><dl class="loan-wallet"><div><dt>${t('Available cash','Verfügbares Guthaben')}</dt><dd>${justizEuro(data.tokens)}</dd></div><div><dt>${t('Net worth after debts','Vermögen nach Schulden')}</dt><dd>${justizEuro(data.netWorth)}</dd></div><div><dt>${t('Level','Level')}</dt><dd>${data.level}</dd></div></dl><p class="loan-rules">${t('One active loan. Interest runs daily on remaining principal, including offline. At least 24 hours between loans. Debt reduces net worth and blocks Prestige.','Ein laufender Kredit. Tageszinsen auf den offenen Kreditbetrag laufen auch offline weiter. Mindestens 24 Stunden zwischen Kreditaufnahmen. Schulden mindern das Vermögen und sperren Prestige.')}</p>${error?`<p class="account-error" role="alert">${esc(error)}</p>`:''}${success?`<p class="loan-success" role="status">${esc(success)}</p>`:''}${pending()?`<button class="secondary-button" type="button" data-loan="retry" ${busy?'disabled':''}>${t('Retry pending request','Ausstehende Anfrage wiederholen')}</button>`:''}${data.active?activeMarkup(data.active):''}${blocked()?`<p role="status">${esc(blocked())}</p>`:''}<div class="loan-offers">${data.offers.map(offerCard).join('')}</div>${data.history.length?`<section class="loan-history"><h2>${t('Repaid loans','Zurückgezahlte Kredite')}</h2>${data.history.map(loan=>`<div><span>${esc(t(loan.name,loan.nameDe))}<small>${esc(date(loan.paidAt))}</small></span><strong>${justizEuro(loan.repaid)} ${t('repaid','zurückgezahlt')}</strong></div>`).join('')}</section>`:''}</div>`;
  }
  function confirmOffer(offer){
    selected=offer;dialog.innerHTML=`<h2 id="loan-confirm-title">${t('Confirm borrowing','Kreditaufnahme bestätigen')}</h2><dl><div><dt>${t('Cash received','Ausgezahltes Guthaben')}</dt><dd>${justizEuro(offer.principal)}</dd></div><div><dt>${t('Immediate debt','Sofortige Schuld')}</dt><dd>${justizEuro(offer.principal+offer.fee)}</dd></div><div><dt>${t('Debt after 24 hours','Schuld nach 24 Stunden')}</dt><dd>${justizEuro(offer.principal+offer.fee+offer.interestPerDay)}</dd></div><div><dt>${t('Debt after','Schuld nach')} ${offer.termDays} ${t('days','Tagen')}</dt><dd>${justizEuro(offer.principal+offer.fee+offer.termDays*offer.interestPerDay)}</dd></div></dl><p>${offer.dailyInterestPercent}% ${t('daily interest for','Tageszinsen für')} ${offer.termDays} ${t('real days, then','echte Tage, danach')} ${offer.overdueInterestPercent}% ${t('per day. Interest accrues offline. After the deadline, available wallet cash is collected automatically.','pro Tag. Zinsen laufen auch offline. Nach Fälligkeit wird verfügbares Guthaben automatisch eingezogen.')}</p><div class="loan-confirm-actions"><button class="secondary-button" type="button" data-loan="cancel">${t('Cancel','Abbrechen')}</button><button class="primary-button" type="button" data-loan="borrow">${t('Borrow','Aufnehmen')} ${justizEuro(offer.principal)}</button></div>`;dialog.showModal();dialog.querySelector('[data-loan="cancel"]').focus();
  }
  async function mutate(operation,payload){
    if(busy||!account)return;
    const visit=accountVisit,owner=account.id,request=++sequence;
    const item={operation,payload};savePending(item);busy=true;error='';success='';dialog.close();render();
    try{
      const result=await accountApi(`loans/${operation}`,payload);
      if(request!==sequence||visit!==accountVisit||owner!==account?.id)return;
      savePending(null);repaymentDraft=null;data=result.loans;updateAccount(result.user);
      success=operation==='borrow'?t('Loan paid into your wallet.','Kredit wurde deinem Guthaben gutgeschrieben.'):t('Repayment received.','Rückzahlung eingegangen.');
    }catch(failure){
      if(request!==sequence||visit!==accountVisit||owner!==account?.id)return;
      if(failure.code&&failure.code!=='internal_error')savePending(null);
      error=failure.message;
    }finally{
      if(request===sequence&&visit===accountVisit&&owner===account?.id){busy=false;render();accountContent.querySelector('[role="alert"],[role="status"]')?.setAttribute('tabindex','-1');accountContent.querySelector('[role="alert"],[role="status"]')?.focus({preventScroll:true});}
    }
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-loan]');if(!button||currentAccountPage!=='/loans')return;
    const action=button.dataset.loan;
    if(action==='cancel'){dialog.close();return;}
    if(!account||busy)return;
    if(action==='review'){const offer=data?.offers.find(offer=>offer.id===button.dataset.offer);if(offer?.available&&!pending())confirmOffer(offer);}
    if(action==='borrow'&&selected&&!pending())void mutate('borrow',{offerId:selected.id,termsVersion:data.termsVersion,requestId:crypto.randomUUID()});
    if(action==='retry'){const item=pending();if(item&&['borrow','repay'].includes(item.operation))void mutate(item.operation,item.payload);}
  });
  document.addEventListener('input',event=>{if(currentAccountPage==='/loans'&&event.target.matches('[data-loan-repay] [name="amount"]')&&data?.active)repaymentDraft={loanId:data.active.id,value:event.target.value};});
  document.addEventListener('submit',event=>{
    if(!event.target.matches('[data-loan-repay]'))return;
    event.preventDefault();if(busy||pending()||!data?.active)return;
    const amount=Number(new FormData(event.target).get('amount'));
    if(Number.isSafeInteger(amount)&&amount>0)void mutate('repay',{loanId:data.active.id,amount,requestId:crypto.randomUUID()});
  });
  dialog.addEventListener('close',()=>{accountContent.querySelector(`[data-loan="review"][data-offer="${CSS.escape(selected?.id||'')}"]`)?.focus({preventScroll:true});});
  document.addEventListener('jg:language',()=>{if(dialog.open&&selected){dialog.close();confirmOffer(selected);}});
  return {load,render,stop};
})();
