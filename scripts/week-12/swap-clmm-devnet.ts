import 'dotenv/config'
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token'
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js'
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const rpcUrl = process.env.SOLANA_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : clusterApiUrl('devnet'))
const keypairPath = process.env.SOLANA_KEYPAIR ?? resolve(homedir(), '.config/solana/id.json')
const resultsPath = process.env.WEEK11_RESULTS ?? 'week-11-devnet-results.json'
const outputPath = 'week-12-devnet-results.json'
const amountInUi = process.env.SWAP_AMOUNT ?? '0.1'
const slippageBps = Number(process.env.SWAP_SLIPPAGE_BPS ?? '500')

if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) {
  throw new Error('SWAP_SLIPPAGE_BPS must be an integer between 0 and 9999.')
}

const [secretKey, saved] = await Promise.all([
  readFile(keypairPath, 'utf8').then((value) => Uint8Array.from(JSON.parse(value) as number[])),
  readFile(resultsPath, 'utf8').then((value) => JSON.parse(value) as {
    network: string
    owner: string
    tokens: { symbol: string; mint: string; decimals: number }[]
    pool: string | null
  })
])

if (saved.network !== 'devnet' || !saved.pool) throw new Error('Week 11 devnet pool results are missing.')

const owner = Keypair.fromSecretKey(secretKey)
if (owner.publicKey.toBase58() !== saved.owner) throw new Error('The configured wallet is not the wallet used for the Week 11 pool.')

const input = saved.tokens.find((token) => token.symbol === 'STUDENT_A')
const output = saved.tokens.find((token) => token.symbol === 'STUDENT_B')
if (!input || !output || input.decimals !== output.decimals) throw new Error('Expected matching STUDENT_A and STUDENT_B mints in the Week 11 results.')

const scale = 10 ** input.decimals
const amountInNumber = Number(amountInUi)
if (!Number.isFinite(amountInNumber) || amountInNumber <= 0 || !Number.isSafeInteger(amountInNumber * scale)) {
  throw new Error('SWAP_AMOUNT must be a positive amount with supported token precision.')
}

const amountIn = Math.round(amountInNumber * scale)
const minAmountOut = Math.floor(amountIn * (10000 - slippageBps) / 10000)
const connection = new Connection(rpcUrl, 'confirmed')
const raydium = await Raydium.load({
  owner,
  connection,
  cluster: 'devnet',
  disableFeatureCheck: true,
  disableLoadToken: true,
  blockhashCommitment: 'confirmed'
})
const poolId = new PublicKey(saved.pool)
const { poolInfo, rpcData, tickArrays } = await raydium.clmm.getSwapPoolInfo(poolId)
const inputMint = new PublicKey(input.mint)
const outputMint = new PublicKey(output.mint)

if (!poolInfo.mintA.address || !poolInfo.mintB.address) throw new Error('Raydium pool mint information is incomplete.')
if (![poolInfo.mintA.address, poolInfo.mintB.address].includes(inputMint.toBase58()) || ![poolInfo.mintA.address, poolInfo.mintB.address].includes(outputMint.toBase58())) {
  throw new Error('The Week 11 token mints do not match the selected Raydium pool.')
}

const inputAta = await getAssociatedTokenAddress(inputMint, owner.publicKey)
const outputAta = await getAssociatedTokenAddress(outputMint, owner.publicKey)
const inputBefore = await getAccount(connection, inputAta, 'confirmed')
const outputBefore = await getAccount(connection, outputAta, 'confirmed')
if (inputBefore.amount < BigInt(amountIn)) throw new Error(`Not enough STUDENT_A. Available raw amount: ${inputBefore.amount.toString()}`)

const transaction = await raydium.clmm.swap({
  poolInfo,
  inputMint,
  amountIn: new BN(amountIn),
  amountOutMin: new BN(minAmountOut),
  observationId: rpcData.observationId,
  remainingAccounts: tickArrays.map((item) => item.address),
  ownerInfo: { useSOLBalance: true },
  txVersion: TxVersion.V0
})
const swapResult = await transaction.execute({ sendAndConfirm: true })
const inputAfter = await getAccount(connection, inputAta, 'confirmed')
const outputAfter = await getAccount(connection, outputAta, 'confirmed')
const actualInput = inputBefore.amount - inputAfter.amount
const actualOutput = outputAfter.amount - outputBefore.amount

if (actualInput !== BigInt(amountIn)) throw new Error(`Unexpected input change: expected ${amountIn}, received ${actualInput.toString()}`)
if (actualOutput < BigInt(minAmountOut)) throw new Error(`Slippage check failed: received ${actualOutput.toString()}, minimum was ${minAmountOut}`)

const result = {
  network: 'devnet',
  owner: owner.publicKey.toBase58(),
  pool: poolId.toBase58(),
  input: { symbol: input.symbol, mint: input.mint, amount: amountInUi, rawAmount: amountIn.toString() },
  output: { symbol: output.symbol, mint: output.mint, amountRaw: actualOutput.toString() },
  minAmountOut: minAmountOut.toString(),
  slippageBps,
  inputBalanceBefore: inputBefore.amount.toString(),
  inputBalanceAfter: inputAfter.amount.toString(),
  outputBalanceBefore: outputBefore.amount.toString(),
  outputBalanceAfter: outputAfter.amount.toString(),
  signature: swapResult.txId
}

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
