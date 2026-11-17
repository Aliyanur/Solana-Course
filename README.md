# Solana Course

Solana Superteams course assignments.

- Week 8 — Liquidity Vault: [week-8 branch](https://github.com/Aliyanur/Solana-Course/tree/week-8)
- Week 9 — Vault deposits and share tokens: [week-9 branch](https://github.com/Aliyanur/Solana-Course/tree/week-9)
- Week 10 — CPI and vault withdrawals: [week-10 branch](https://github.com/Aliyanur/Solana-Course/tree/week-10)
- Week 11 — Raydium CLMM: [week-11 branch](https://github.com/Aliyanur/Solana-Course/tree/week-11)
- Week 12 — Swap through Raydium CLMM: [week-12 branch](https://github.com/Aliyanur/Solana-Course/tree/week-12)

# Week 11 — Raydium CLMM

This week I worked with Raydium CLMM and tried to understand how the price range works. I created two test tokens and a pool on devnet, with starting price 1:1. After this I opened a position from 0.9 to 1.1 using 100 STUDENT_B.

I got some errors at first. Decimal import was wrong, and later my slippage value was too small so the position transaction failed. I fixed it after few tries and run it again. Now the pool and position is created on devnet.

Pool: [open in Explorer](https://explorer.solana.com/address/G4a4wNJX5wm1FwgtFCN5Df6cjNmMEvbbstbuJ47iLene?cluster=devnet)

Pool transaction: [open in Explorer](https://explorer.solana.com/tx/5TxdiQ3h6fKGsb4ic1S3LdsApicQRkZmyA4TrcNqesigvQtEGPzj9Z1XkT1YSmU8aBYz3xPsEg2h4i4xzug717JJ?cluster=devnet)

Position transaction: [open in Explorer](https://explorer.solana.com/tx/59zwnhGfoK1UBXwBx2Y5ajsfiQdnAzHUoMqKBjGLJcVLJqSbKGKh9TVty5SLz3j98wSjnsH4t6z4vKUURvxrLd6s?cluster=devnet)

I saved the token, pool and position addresses in `week-11-devnet-results.json`.

# Week 12 — Swap through Raydium CLMM

This week I made a swap script for the pool from last week. It swaps STUDENT_A to STUDENT_B and I set minimum amount, so it should fail if slippage is too high. I checked token balances before and after the swap on devnet. I used the token accounts from my devnet wallet for this swap, I did not connect it with the vault PDA yet.

I had some trouble with the tick array accounts first, but after loading pool info from RPC it was working. I swapped 0.1 STUDENT_A and got 0.099745 STUDENT_B. I saved the swap result in `week-12-devnet-results.json`.

Swap transaction: [open in Explorer](https://explorer.solana.com/tx/3nYiSCvBDe2WoQJAoqrDfgDnyZJjpVtQDdQrJrAkYtU8bMGFPhUdPaKx1ohzMCdfBZysvovP381EB1fxzHbHzGQD?cluster=devnet)
