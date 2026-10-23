// Server-confirmed XP only: opening a case or replaying a response earns nothing extra.
let progressionOwner = null, progressionHighXp = 0, progressionHighLevel = 1;
let xpFeedbackTimer, pendingXpGain = 0, pendingLevelUp = false;

function persistentProgressionMarkup(p, compact = false) {
  if (!p) return '';
  const percent = Math.round(Math.max(0, Math.min(1, p.progress || 0)) * 100);
  const total = `${number(p.xp)} XP`, level = `${t('Level', 'Level')} ${number(p.level)}`;
  const progressText = p.nextLevelXp === null ? t('Maximum level', 'Höchstes Level')
    : `${number(p.xpIntoLevel)} / ${number(p.xpNeededForNextLevel)} XP`;
  const accessibleProgress = p.nextLevelXp === null ? progressText
    : t(`${number(p.nextLevelXp - p.xp)} XP to level ${p.level + 1}`, `${number(p.nextLevelXp - p.xp)} XP bis Level ${p.level + 1}`);
  return `<span class="xp-level">${level}</span><span class="xp-total">${total}</span><span class="xp-meter" role="progressbar" aria-label="${accessibleProgress}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${progressText}"><span style="--xp-progress:${percent}%"></span></span>${compact ? '' : `<span class="xp-next">${progressText}</span><span class="xp-hint">${t('Daily +150 XP · Sales +10–200 XP', 'Daily +150 XP · Verkäufe +10–200 XP')}</span>`}`;
}

function renderPersistentProgression(user) {
  const node = document.getElementById('sidebar-progression');
  if (!node) return;
  node.hidden = !user?.progression;
  node.innerHTML = persistentProgressionMarkup(user?.progression, true);
}

function updatePersistentProgression(user, { reset = false } = {}) {
  const p = user?.progression;
  const sameOwner = !reset && Boolean(user && user.id === progressionOwner);
  const gained = sameOwner && p ? Math.max(0, p.xp - progressionHighXp) : 0;
  const leveledUp = gained > 0 && p.level > progressionHighLevel;
  if (!sameOwner) {
    clearTimeout(xpFeedbackTimer); pendingXpGain = 0; pendingLevelUp = false;
    document.getElementById('xp-feedback')?.remove();
    const announcement = document.getElementById('xp-announcement');
    if (announcement) announcement.textContent = '';
  }
  progressionOwner = user?.id || null;
  progressionHighXp = p ? sameOwner ? Math.max(progressionHighXp, p.xp) : p.xp : 0;
  progressionHighLevel = p ? sameOwner ? Math.max(progressionHighLevel, p.level) : p.level : 1;
  renderPersistentProgression(user);
  if (!gained) return;
  pendingXpGain += gained; pendingLevelUp ||= leveledUp;
  const message = `+${number(pendingXpGain)} XP${pendingLevelUp ? ` · ${t('Level up!', 'Levelaufstieg!')} ${t('Level', 'Level')} ${p.level}` : ''}`;
  const announcement = document.getElementById('xp-announcement');
  if (announcement) announcement.textContent = message;
  document.getElementById('xp-feedback')?.remove();
  const feedback = document.createElement('div');
  feedback.id = 'xp-feedback'; feedback.className = `xp-feedback${pendingLevelUp ? ' is-level-up' : ''}`;
  feedback.setAttribute('aria-hidden', 'true'); feedback.textContent = message;
  // Keep the feedback visible in the browser's top layer during modal actions.
  (document.querySelector('dialog[open]') || document.body).append(feedback);
  clearTimeout(xpFeedbackTimer);
  xpFeedbackTimer = setTimeout(() => { feedback.remove(); pendingXpGain = 0; pendingLevelUp = false; }, 4200);
}
