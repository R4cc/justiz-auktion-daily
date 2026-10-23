window.adminPlayerResetUi = (() => {
  const dialog = document.createElement('dialog');
  dialog.className = 'admin-player-reset-dialog';
  dialog.setAttribute('aria-labelledby', 'player-reset-title');
  document.body.append(dialog);
  let target = null, requestId = null, owner = null, busy = false, returnFocus = null, pendingKey = null;
  function open(userId) {
    const player = account?.admin && accountAdmin.users.find(user => user.id === userId && !user.admin);
    if (!player || busy) return;
    target = player; owner = account.id; pendingKey = `jg:player-reset:${owner}:${userId}`;
    requestId = null; try { requestId = localStorage.getItem(pendingKey); } catch {}
    requestId ||= crypto.randomUUID(); returnFocus = document.activeElement;
    dialog.innerHTML = `<form><h2 id="player-reset-title">${t('Reset Player','Spieler zurücksetzen')}: ${accountEscape(player.username)}</h2>
      <p>${t('Clears all progress, items, stores, skills, prestige, loans, records, rewards and friendships. Restores J€ 1,000 and signs the player out. Username, password and ban status stay unchanged. This cannot be undone.','Löscht Fortschritt, Gegenstände, Läden, Skills, Prestige, Kredite, Vorstrafen, Belohnungen und Freundschaften. Setzt auf J€ 1.000 zurück und meldet den Spieler ab. Benutzername, Passwort und Sperrstatus bleiben erhalten. Dies kann nicht rückgängig gemacht werden.')}</p>
      <label>${t('Type the username to confirm','Zur Bestätigung den Benutzernamen eingeben')}<input name="confirmation" required autocomplete="off" spellcheck="false" aria-label="${t('Confirm username','Benutzernamen bestätigen')}"></label>
      <p class="account-error" role="alert"></p><div class="player-reset-actions"><button class="secondary-button" type="button" data-reset-cancel>${t('Cancel','Abbrechen')}</button><button class="danger-button" type="submit">${t('Reset Player','Spieler zurücksetzen')}</button></div></form>`;
    dialog.showModal(); dialog.querySelector('input').focus();
  }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
  dialog.addEventListener('click', event => { if (event.target.closest('[data-reset-cancel]') && !busy) dialog.close(); });
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !target || account?.id !== owner || !account.admin) return;
    const form = event.target, confirmation = form.elements.confirmation.value;
    const errorNode = form.querySelector('.account-error');
    errorNode.textContent = '';
    if (confirmation !== target.username) { errorNode.textContent = accountError('invalid_player_reset_confirmation'); return; }
    const visit = accountVisit; busy = true;
    try { localStorage.setItem(pendingKey, requestId); } catch {}
    for (const button of form.querySelectorAll('button,input')) button.disabled = true;
    try {
      const result = await accountApi('admin/reset-player', { userId: target.id, confirmation, requestId });
      try { localStorage.removeItem(pendingKey); } catch {}
      if (account?.id !== owner) { dialog.close(); return; }
      updateAccount(result.user); dialog.close();
      if (visit === accountVisit) {
        await navigateAccountPage('/admin?tab=players', false);
        accountContent.querySelector(`[data-account="reset-player"][data-id="${CSS.escape(result.reset.userId)}"]`)?.focus({ preventScroll: true });
        showToast(t(`${result.reset.username} was reset.`,`${result.reset.username} wurde zurückgesetzt.`));
      }
    } catch (error) {
      if (account?.id === owner) errorNode.textContent = error.message;
      else dialog.close();
    } finally {
      busy = false;
      for (const button of form.querySelectorAll('button,input')) button.disabled = false;
    }
  });
  return { open };
})();
