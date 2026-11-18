# Solana Course

Solana Superteams course assignments.

- Week 8 — Liquidity Vault: [week-8 branch](https://github.com/Aliyanur/Solana-Course/tree/week-8)
- Week 9 — Vault deposits and share tokens: [week-9 branch](https://github.com/Aliyanur/Solana-Course/tree/week-9)
- Week 10 — CPI and vault withdrawals: [week-10 branch](https://github.com/Aliyanur/Solana-Course/tree/week-10)
- Week 11 — Raydium CLMM: [week-11 branch](https://github.com/Aliyanur/Solana-Course/tree/week-11)
- Week 12 — Swap through Raydium CLMM: [week-12 branch](https://github.com/Aliyanur/Solana-Course/tree/week-12)
- Week 13 — CLMM position from the vault: [week-13 branch](https://github.com/Aliyanur/Solana-Course/tree/week-13)

# Week 12 — Swap through Raydium CLMM

Swap tokens from the vault through a Raydium CLMM pool, with a minimum output amount set to limit slippage.

# Week 13 — Raydium CLMM Position

This week I made the vault open a Raydium position from its PDA. It use a selected price range. The script move price out of this range, removes liquidity to get fees, closes old position and opens a new one. I learned the vault PDA need to sign for position and fees are collected when liquidity is decreased.
