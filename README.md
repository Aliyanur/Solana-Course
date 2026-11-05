# Week 9 — Vault Deposit and Share Tokens

For Week 9, I added a deposit instruction to the Week 8 vault scaffold. A user deposits the vault's SPL token and receives share tokens in their associated token account.

The first deposit converts between asset and share decimals. Later deposits calculate shares from the vault's asset balance and current share supply. The instruction checks the user's minimum shares, rejects zero or too-small deposits, and does not run while the vault is paused.

## What I learned

The token transfer and share mint happen in one transaction, so both succeed or neither does. I also added checked arithmetic and validation for inconsistent vault balances.

The brief does not name a liquidity-pool protocol, so this branch does not add a pool integration or deposit assets into an external pool.
