# Loans

The `/loans` page offers in-game credit under Trading. Both requirements must be met when borrowing, using the current server-side level and net worth after all debts.

| Loan | Cash received | Level | Minimum net worth | Fee | Daily interest for first 5 days | Daily interest after 5 days |
|---|---:|---:|---:|---:|---:|---:|
| Starter | J€500 | 2 | J€2,000 | J€0 | 3% (J€15) | 30% (J€150) |
| Trader | J€2,500 | 4 | J€10,000 | J€0 | 4% (J€100) | 30% (J€750) |
| Business | J€10,000 | 7 | J€25,000 | J€0 | 5% (J€500) | 30% (J€3,000) |
| Enterprise | J€50,000 | 10 | J€125,000 | J€0 | 6% (J€3,000) | 30% (J€15,000) |

New offers have no borrowing fee and a five-real-day term. Simple daily interest on remaining principal starts at 3% for Starter, 4% for Trader, 5% for Business and 6% for Enterprise. At maturity, the daily rate jumps to 30%. Accrued interest does not itself earn interest. Time passes offline; there are no free daily windows or reset-time tricks. A confirmation shows cash received and debt immediately, after 24 hours and at the five-day deadline, alongside both daily rates. For example, borrowing J€500 creates J€500 debt, rising to J€515 after one day, J€575 at maturity and J€725 after six days without payments. Daily J€ amounts in the table assume the full original principal remains unpaid.

One loan can be active at a time. At least 24 hours must pass from the previous borrowing before another loan can begin, even if it is repaid immediately. Borrowing is at most 25% of the required equity for Starter and Trader, and 40% for Business and Enterprise, and borrowed cash never raises net worth: the full remaining principal, fee and interest are liabilities. Loan principal is not earned income, gives no XP or Prestige profit bonus, and cannot unlock a larger loan by itself. The steep overdue rate and borrowing limits keep credit temporary liquidity rather than a recurring reward.

Partial and full repayments use available wallet cash, covering fees and interest first and principal next. Only principal reduction lowers future interest. Fractions of J€ carry at fixed precision, independent of polling frequency; settling the last fractional interest token rounds up to one J€. Server time and frozen contract rates determine the balance. Later offer changes affect new contracts only. Existing loans retain their saved fees, rates and deadlines, including five-day contracts at 36% overdue interest and the original 20% fee, 24% daily rate, three-day term and 36% overdue rate.

After maturity, the economy runtime and profile/loan reads automatically collect available wallet cash up to the debt. Further cash income can be collected on subsequent ticks or reads. Cash never becomes negative; escrow, inventory and store tills are not seized by this feature. Remaining debt keeps accruing, prevents a second loan and blocks Prestige. Settled loan history, cooldowns and transaction receipts survive Prestige. An explicit administrative economy reset clears loans and receipts together with all other economic state.

Borrowing requires a human account with a normal password, no ban, no jail and no unpaid fine. Authenticated repayment remains available to jailed players through the API. Ownership checks, the existing CSRF header and per-user mutation rate limit apply. Client amounts, rates, levels and net worth cannot override loan terms. The offer revision must match at borrowing.

Every borrow and repayment has an actor-scoped request receipt. A lost response retries the same request, including after page reload; changed payloads cannot reuse a receipt. Wallet changes, loan changes, receipts and net-worth observations commit atomically. Concurrent runtimes and requests share SQLite's immediate write lock and the unique active-loan constraint. Net-worth totals and chart breakdowns subtract current debt, including offline interest; historical totals retain the observations made at each timestamp.

Implementation: `src/loans.mjs` owns offers and commands; `src/loan-ledger.mjs` owns exact accrual, balances and collection. `test/loans.test.mjs` covers gates, equity, receipts, restart, accrual, maturity, partial payments, atomic failures, concurrency, permissions, HTTP, runtime, statistics, Prestige and reset. `scripts/loans-ui-smoke.mjs` checks real browser borrowing and repayment, lost-response retries across reload, confirmation/focus, overdue collection, locked offers, guests and EN/DE layouts at 1440/768/390/320px.
