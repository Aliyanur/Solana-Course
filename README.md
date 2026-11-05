# Solana Superteams — Course Work

This repository tracks my assignments for the Solana Superteams course.

## Assignments

- **РК1 — topics from Weeks 1–7 (РО2, 5%)**: the brief says there will be questions on these topics. The question list was not included in the materials I received.
- **Week 8 — BUILD SPRINT: Liquidity Vault**: see the [`week-8` branch](https://github.com/Aliyanur/Solana-Course/tree/week-8). The requested scaffold is implemented: vault settings account, user PDA, and share-token mint. The brief does not name a liquidity-pool protocol, so pool integration is not included.
- **Week 9 — Vault: Deposit and Share Tokens (РО2, 5%)**: see the [`week-9` branch](https://github.com/Aliyanur/Solana-Course/tree/week-9). Deposit, share calculation, and share-token minting are implemented. Withdrawal and external pool integration are not part of this brief.

`cargo check` passes. SBF build/deployment still needs clean verification because the local build emitted unknown-syscall warnings.

Keep API keys and wallet secrets local; never commit `.env` or secret keys.
