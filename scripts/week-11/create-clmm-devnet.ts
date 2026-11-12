import 'dotenv/config'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js'
import { Raydium, DEVNET_PROGRAM_ID, TxVersion, getPdaAmmConfigId, TickUtil, PoolUtils, type ApiV3Token } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const rpcUrl = process.env.SOLANA_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : clusterApiUrl('devnet'))
const keypairPath = process.env.SOLANA_KEYPAIR ?? resolve(homedir(), '.config/solana/id.json')
const secretKey = Uint8Array.from(JSON.parse(await readFile(keypairPath, 'utf8')) as number[])
const owner = Keypair.fromSecretKey(secretKey)
const connection = new Connection(rpcUrl, 'confirmed')
const balance = await connection.getBalance(owner.publicKey, 'confirmed')
if (balance < 1.5 * 1_000_000_000) {
  throw new Error(`Wallet has ${(balance / 1_000_000_000).toFixed(3)} devnet SOL. Get at least 1.5 SOL from a devnet faucet, then run this script again.`)
}

const mintA = await createMint(connection, owner, owner.publicKey, null, 6)
const mintB = await createMint(connection, owner, owner.publicKey, null, 6)
const tokenA = await getOrCreateAssociatedTokenAccount(connection, owner, mintA, owner.publicKey)
const tokenB = await getOrCreateAssociatedTokenAccount(connection, owner, mintB, owner.publicKey)
await mintTo(connection, owner, mintA, tokenA.address, owner, 1_000_000_000_000n)
await mintTo(connection, owner, mintB, tokenB.address, owner, 1_000_000_000_000n)

const raydium = await Raydium.load({
  owner,
  connection,
  cluster: 'devnet',
  disableFeatureCheck: true,
  disableLoadToken: true,
  blockhashCommitment: 'confirmed'
})
const configInfo = (await raydium.api.getClmmConfigs())[0]
if (!configInfo) throw new Error('Raydium devnet did not return a CLMM configuration.')
const configId = getPdaAmmConfigId(DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID, configInfo.index).publicKey
const configAccount = await connection.getAccountInfo(configId, 'confirmed')
if (!configAccount) throw new Error(`CLMM configuration account ${configId.toBase58()} is missing on devnet.`)
const ammConfig = {
  id: configId,
  index: configInfo.index,
  protocolFeeRate: configInfo.protocolFeeRate,
  tradeFeeRate: configInfo.tradeFeeRate,
  tickSpacing: configInfo.tickSpacing,
  fundFeeRate: configInfo.fundFeeRate,
  fundOwner: owner.publicKey.toBase58(),
  description: 'Raydium CLMM devnet configuration'
}
const tokenAInfo: ApiV3Token = { chainId: 103, address: mintA.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), logoURI: '', symbol: 'STUDENT_A', name: 'Student Token A', decimals: 6, tags: [], extensions: {} }
const tokenBInfo: ApiV3Token = { chainId: 103, address: mintB.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), logoURI: '', symbol: 'STUDENT_B', name: 'Student Token B', decimals: 6, tags: [], extensions: {} }
const poolCreation = await raydium.clmm.createPool({
  programId: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID,
  mint1: tokenAInfo,
  mint2: tokenBInfo,
  ammConfig,
  initialPrice: new Decimal.Decimal(1),
  txVersion: TxVersion.V0
})
const poolResult = await poolCreation.execute({ sendAndConfirm: true })
const poolSignature = poolResult.txId
const poolId = new PublicKey(poolCreation.extInfo.address.id)
const poolData = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58())
const rangeLower = new Decimal.Decimal('0.9')
const rangeUpper = new Decimal.Decimal('1.1')
const spacing = poolData.poolInfo.config.tickSpacing
const tickAtLower = TickUtil.getPriceAndTick({ price: rangeLower, mintADecimals: 6, mintBDecimals: 6, zeroForOne: true, tickSpacing: spacing }).tick
const tickAtUpper = TickUtil.getPriceAndTick({ price: rangeUpper, mintADecimals: 6, mintBDecimals: 6, zeroForOne: true, tickSpacing: spacing }).tick
const tickLower = Math.min(tickAtLower, tickAtUpper)
const tickUpper = Math.max(tickAtLower, tickAtUpper)
const baseAmount = new BN('100000000')
const positionAmounts = await PoolUtils.getLiquidityAmountOutFromAmountIn({
  poolInfo: poolData.poolInfo as never,
  inputA: true,
  tickLower,
  tickUpper,
  amount: baseAmount,
  slippage: 1,
  add: true,
  epochInfo: await raydium.fetchEpochInfo(),
  amountHasFee: true
})
const position = await raydium.clmm.openPositionFromBase({
  poolInfo: poolData.poolInfo,
  poolKeys: poolData.poolKeys,
  ownerInfo: { useSOLBalance: true },
  tickLower,
  tickUpper,
  base: 'MintA',
  baseAmount,
  otherAmountMax: positionAmounts.amountSlippageB.amount,
  txVersion: TxVersion.V0
})
const positionResult = await position.execute({ sendAndConfirm: true })
const positionSignature = positionResult.txId
const result = {
  network: 'devnet',
  owner: owner.publicKey.toBase58(),
  tokens: [{ symbol: 'STUDENT_A', mint: mintA.toBase58(), decimals: 6 }, { symbol: 'STUDENT_B', mint: mintB.toBase58(), decimals: 6 }],
  pool: poolId.toBase58(),
  initialPrice: '1 STUDENT_B per STUDENT_A',
  position: { tickLower, tickUpper, priceLower: rangeLower.toString(), priceUpper: rangeUpper.toString(), baseAmount: '100 STUDENT_A', nftMint: position.extInfo.nftMint.toBase58() },
  signatures: { pool: poolSignature, position: positionSignature }
}
await writeFile('week-11-devnet-results.json', `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
