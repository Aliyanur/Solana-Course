# Solana Course

Solana Superteams course assignments.

- Week 8 — Liquidity Vault: [week-8 branch](https://github.com/Aliyanur/Solana-Course/tree/week-8)
- Week 9 — Vault deposits and share tokens: [week-9 branch](https://github.com/Aliyanur/Solana-Course/tree/week-9)
- Week 10 — CPI and vault withdrawals: [week-10 branch](https://github.com/Aliyanur/Solana-Course/tree/week-10)
- Week 11 — Raydium CLMM: [week-11 branch](https://github.com/Aliyanur/Solana-Course/tree/week-11)

## Week 11 — Raydium CLMM

This week I learned how liquidity pools and price ranges works. I created two test tokens on devnet, made a Raydium CLMM pool and opened a position from 0.9 to 1.1. I used 100 STUDENT_B for the position.

At first I had some mistakes with Decimal import and the slippage amount. I also got an error when I tried to read the new pool info. I fixed it and run the script again. Now both pool and position transaction is confirmed on devnet.

- Token A: [STUDENT_A mint](https://explorer.solana.com/address/8SbNbt2fXwpALoegEDGhUt2n9KnCbFTG4xg6LU18WQYZ?cluster=devnet)
- Token B: [STUDENT_B mint](https://explorer.solana.com/address/4WW32cTZrLnPBvdD9eAmVaYdyAm2Gvp3KzGyU9t7F2c8?cluster=devnet)
- [CLMM pool](https://explorer.solana.com/address/G4a4wNJX5wm1FwgtFCN5Df6cjNmMEvbbstbuJ47iLene?cluster=devnet)
- [Pool transaction](https://explorer.solana.com/tx/5TxdiQ3h6fKGsb4ic1S3LdsApicQRkZmyA4TrcNqesigvQtEGPzj9Z1XkT1YSmU8aBYz3xPsEg2h4i4xzug717JJ?cluster=devnet)
- [Position NFT](https://explorer.solana.com/address/AwnFVmv9AhcfymNfxc4Hr9K3WW4D3wDbMvzd9gYoP7rP?cluster=devnet)
- [Position transaction](https://explorer.solana.com/tx/59zwnhGfoK1UBXwBx2Y5ajsfiQdnAzHUoMqKBjGLJcVLJqSbKGKh9TVty5SLz3j98wSjnsH4t6z4vKUURvxrLd6s?cluster=devnet)

Full results are in `week-11-devnet-results.json`.
