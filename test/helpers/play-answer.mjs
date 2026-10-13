// Existing economy scenarios play through the same start-next-round step as
// the browser. Exploit tests call Accounts.answer directly to test rejection.
export function playAnswer(accounts, user, id, position, answer, catalog) {
  const row = accounts.db(db => db.prepare('SELECT payload FROM account_games WHERE id=? AND user_id=?').get(String(id), user.id));
  const run = row ? JSON.parse(row.payload) : null;
  if (run?.mode === 'daily' && !run.complete && position === run.answers.length && !run.roundDeadlineAt)
    accounts.startRound(user, id, position);
  return accounts.answer(user, id, position, answer, catalog);
}
