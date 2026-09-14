// Shared API error type. Lives in its own module so the economy domains
// (news, market, resale) can throw it without importing accounts.mjs,
// which itself depends on those domains for inventory locking.
export class AccountError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
