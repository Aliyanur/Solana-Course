# Week 11 — Raydium CLMM

This week I learned how liquidity pools and price ranges works. I made a script for create two test tokens and a Raydium CLMM pool on devnet. I also added a position with price range from 0.9 to 1.1.

At first I got some TypeScript errors and fixed them. The script compiles now, but I could not create the pool because devnet airdrop returned error 500. So the pool and position is not created yet.

To try it again, the wallet need devnet SOL. Then run `npm install` and `npm run week11:create`. The addresses and signatures will be saved in `week-11-devnet-results.json` if it works.
