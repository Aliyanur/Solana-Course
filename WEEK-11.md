# Week 11 — Raydium CLMM

This week I learned how liquidity pools and price ranges works. I wrote a script for make two test tokens, create a Raydium CLMM pool on devnet and add a position from 0.9 to 1.1.

At first I had some TypeScript errors and fixed it. The script compile now. I could not finish the devnet transactions because my wallet has no devnet SOL and the airdrop from RPC returned error. After I get devnet SOL, I can run the script and check the pool on explorer.

Run `npm install` and `npm run week11:create`. The script saves the addresses and transaction signatures in `week-11-devnet-results.json` when it finish.
