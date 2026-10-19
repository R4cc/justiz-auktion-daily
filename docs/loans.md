# Loans

The `/loans` page offers in-game credit under Trading. Both requirements must be met when borrowing, using the current server-side level and net worth after all debts.

| Loan | Cash received | Level | Minimum net worth | Fee | Interest per real day |
|---|---:|---:|---:|---:|---:|
| Starter | J€500 | 2 | J€2,000 | J€100 | J€120 |
| Trader | J€2,500 | 4 | J€10,000 | J€500 | J€600 |
| Business | J€10,000 | 7 | J€25,000 | J€2,000 | J€2,400 |
| Enterprise | J€50,000 | 10 | J€125,000 | J€10,000 | J€12,000 |

Every offer has a 20% borrowing fee added to the debt immediately, a three-real-day term, and 24% simple daily interest on remaining principal. After maturity, the daily rate becomes 36%. Fees and accrued interest do not themselves earn interest. Time passes offline; there are no free daily windows or reset-time tricks. A confirmation shows cash received and debt immediately, after 24 hours and after three days. For example, borrowing J€500 creates J€600 debt, rising to J€720 after one day, J€960 at maturity and J€1,140 after four days without payments.

One loan can be active at a time. At least 24 hours must pass from the previous borrowing before another loan can begin, even if it is repaid immediately. Borrowing is at most 25% of the required equity for Starter and Trader, and 40% for Business and Enterprise, and borrowed cash never raises net worth: the full remaining principal, fee and interest are liabilities. Loan principal is not earned income, gives no XP or Prestige profit bonus, and cannot unlock a larger loan by itself. These costs and limits make credit expensive temporary liquidity rather than a recurring reward.

Partial and full repayments use available wallet cash, covering fees and interest first and principal next. Only principal reduction lowers future interest. Fractions of J€ carry at fixed precision, independent of polling frequency; settling the last fractional interest token rounds up to one J€. Server time and frozen contract rates determine the balance. Later offer changes affect new contracts only.

After maturity, the economy runtime and profile/loan reads automatically collect available wallet cash up to the debt. Further cash income can be collected on subsequent ticks or reads. Cash never becomes negative; escrow, inventory and store tills are not seized by this feature. Remaining debt keeps accruing, prevents a second loan and blocks Prestige. Settled loan history, cooldowns and transaction receipts survive Prestige. An explicit administrative economy reset clears loans and receipts together with all other economic state.

Borrowing requires a human account with a normal password, no ban, no jail and no unpaid fine. Authenticated repayment remains available to jailed players through the API. Ownership checks, the existing CSRF header and per-user mutation rate limit apply. Client amounts, rates, levels and net worth cannot override loan terms. The offer revision must match at borrowing.

Every borrow and repayment has an actor-scoped request receipt. A lost response retries the same request, including after page reload; changed payloads cannot reuse a receipt. Wallet changes, loan changes, receipts and net-worth observations commit atomically. Concurrent runtimes and requests share SQLite's immediate write lock and the unique active-loan constraint. Net-worth totals and chart breakdowns subtract current debt, including offline interest; historical totals retain the observations made at each timestamp.

Implementation: `src/loans.mjs` owns offers and commands; `src/loan-ledger.mjs` owns exact accrual, balances and collection. `test/loans.test.mjs` covers gates, equity, receipts, restart, accrual, maturity, partial payments, atomic failures, concurrency, permissions, HTTP, runtime, statistics, Prestige and reset. `scripts/loans-ui-smoke.mjs` checks real browser borrowing and repayment, lost-response retries across reload, confirmation/focus, overdue collection, locked offers, guests and EN/DE layouts at 1440/768/390/320px.
