import 'dotenv/config'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js'
import { Raydium, DEVNET_PROGRAM_ID, TxVersion, getPdaAmmConfigId, TickUtil, PoolUtils, clmmComputeInfoToApiInfo, fetchMultipleMintInfos, type ApiV3Token, type ApiV3PoolInfoConcentratedItem, type ClmmKeys } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import { Decimal } from 'decimal.js'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const rpcUrl = process.env.SOLANA_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : clusterApiUrl('devnet'))
const keypairPath = process.env.SOLANA_KEYPAIR ?? resolve(homedir(), '.config/solana/id.json')
const outputPath = 'week-11-devnet-results.json'
const secretKey = Uint8Array.from(JSON.parse(await readFile(keypairPath, 'utf8')) as number[])
const owner = Keypair.fromSecretKey(secretKey)
const connection = new Connection(rpcUrl, 'confirmed')
const balance = await connection.getBalance(owner.publicKey, 'confirmed')
if (balance < 1.5 * 1_000_000_000) {
  throw new Error(`Wallet has ${(balance / 1_000_000_000).toFixed(3)} devnet SOL. Get at least 1.5 SOL from a devnet faucet, then run this script again.`)
}

const raydium = await Raydium.load({
  owner,
  connection,
  cluster: 'devnet',
  disableFeatureCheck: true,
  disableLoadToken: true,
  blockhashCommitment: 'confirmed'
})

type Result = {
  network: string
  owner: string
  tokens: { symbol: string; mint: string; decimals: number }[]
  poolTokenOrder: { tokenA: string; tokenB: string }
  pool: string | null
  initialPrice: string
  position: { tickLower: number; tickUpper: number; priceLower: string; priceUpper: string; priceUnit: string; baseAmount: string; nftMint: string } | null
  signatures: { tokenA: string[]; tokenB: string[]; pool: string | null; position: string | null }
}

let result: Result | null = null
try {
  const saved = JSON.parse(await readFile(outputPath, 'utf8')) as Result
  if (saved.owner === owner.publicKey.toBase58() && saved.network === 'devnet') result = saved
} catch {}

if (result?.position) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

let mintA: PublicKey
let mintB: PublicKey
let poolInfo: ApiV3PoolInfoConcentratedItem
let poolKeys: ClmmKeys
let poolId: PublicKey

if (result?.pool) {
  mintA = new PublicKey(result.tokens[0].mint)
  mintB = new PublicKey(result.tokens[1].mint)
  poolId = new PublicKey(result.pool)
  const rpcPoolInfo = await raydium.clmm.getRpcClmmPoolInfo({ poolId })
  const mintInfos = await fetchMultipleMintInfos({ connection, mints: [rpcPoolInfo.mintA, rpcPoolInfo.mintB] })
  const computed = await raydium.clmm.getComputeClmmPoolInfos({ clmmPoolsRpcInfo: { [poolId.toBase58()]: rpcPoolInfo }, mintInfos })
  const computePoolInfo = computed.computeClmmPoolInfo[poolId.toBase58()]
  poolInfo = clmmComputeInfoToApiInfo(computePoolInfo, mintInfos)
  poolKeys = {
    ...computePoolInfo,
    exBitmapAccount: computePoolInfo.exBitmapAccount.toBase58(),
    observationId: computePoolInfo.observationId.toBase58(),
    id: poolId.toBase58(),
    programId: rpcPoolInfo.programId.toBase58(),
    openTime: rpcPoolInfo.startTime.toString(),
    vault: { A: rpcPoolInfo.vaultA.toBase58(), B: rpcPoolInfo.vaultB.toBase58() },
    config: poolInfo.config,
    rewardInfos: []
  }
} else {
  mintA = await createMint(connection, owner, owner.publicKey, null, 6)
  mintB = await createMint(connection, owner, owner.publicKey, null, 6)
  const tokenA = await getOrCreateAssociatedTokenAccount(connection, owner, mintA, owner.publicKey)
  const tokenB = await getOrCreateAssociatedTokenAccount(connection, owner, mintB, owner.publicKey)
  await mintTo(connection, owner, mintA, tokenA.address, owner, 1_000_000_000_000n)
  await mintTo(connection, owner, mintB, tokenB.address, owner, 1_000_000_000_000n)
  const poolTokenOrder = Buffer.compare(mintA.toBuffer(), mintB.toBuffer()) < 0
    ? { tokenA: 'STUDENT_A', tokenB: 'STUDENT_B' }
    : { tokenA: 'STUDENT_B', tokenB: 'STUDENT_A' }
  const tokenASignatures = (await connection.getSignaturesForAddress(mintA, { limit: 10 })).filter((item) => !item.err).map((item) => item.signature)
  const tokenBSignatures = (await connection.getSignaturesForAddress(mintB, { limit: 10 })).filter((item) => !item.err).map((item) => item.signature)

  result = {
    network: 'devnet',
    owner: owner.publicKey.toBase58(),
    tokens: [{ symbol: 'STUDENT_A', mint: mintA.toBase58(), decimals: 6 }, { symbol: 'STUDENT_B', mint: mintB.toBase58(), decimals: 6 }],
    poolTokenOrder,
    pool: null,
    initialPrice: `1 ${poolTokenOrder.tokenB} per ${poolTokenOrder.tokenA}`,
    position: null,
    signatures: { tokenA: tokenASignatures, tokenB: tokenBSignatures, pool: null, position: null }
  }
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)

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
    initialPrice: new Decimal(1),
    txVersion: TxVersion.V0
  })
  const poolResult = await poolCreation.execute({ sendAndConfirm: true })
  poolId = new PublicKey(poolCreation.extInfo.address.id)
  poolInfo = poolCreation.extInfo.mockPoolInfo
  poolKeys = poolCreation.extInfo.address
  result.pool = poolId.toBase58()
  result.signatures.pool = poolResult.txId
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
}

const rangeLower = new Decimal('0.9')
const rangeUpper = new Decimal('1.1')
const spacing = poolInfo.config.tickSpacing
const tickAtLower = TickUtil.getPriceAndTick({ price: rangeLower, mintADecimals: poolInfo.mintA.decimals, mintBDecimals: poolInfo.mintB.decimals, zeroForOne: true, tickSpacing: spacing }).tick
const tickAtUpper = TickUtil.getPriceAndTick({ price: rangeUpper, mintADecimals: poolInfo.mintA.decimals, mintBDecimals: poolInfo.mintB.decimals, zeroForOne: true, tickSpacing: spacing }).tick
const tickLower = Math.min(tickAtLower, tickAtUpper)
const tickUpper = Math.max(tickAtLower, tickAtUpper)
const baseAmount = new BN('100000000')
const positionAmounts = await PoolUtils.getLiquidityAmountOutFromAmountIn({
  poolInfo,
  inputA: true,
  tickLower,
  tickUpper,
  amount: baseAmount,
  slippage: 0,
  add: true,
  epochInfo: await raydium.fetchEpochInfo(),
  amountHasFee: true
})
const position = await raydium.clmm.openPositionFromBase({
  poolInfo,
  poolKeys,
  ownerInfo: { useSOLBalance: true },
  tickLower,
  tickUpper,
  base: 'MintA',
  baseAmount,
  otherAmountMax: positionAmounts.amountB.amount.muln(10100).divn(10000),
  txVersion: TxVersion.V0
})
const positionResult = await position.execute({ sendAndConfirm: true })
result.position = {
  tickLower,
  tickUpper,
  priceLower: rangeLower.toString(),
  priceUpper: rangeUpper.toString(),
  priceUnit: `${result.poolTokenOrder.tokenB} per ${result.poolTokenOrder.tokenA}`,
  baseAmount: `100 ${result.poolTokenOrder.tokenA}`,
  nftMint: position.extInfo.nftMint.toBase58()
}
result.signatures.position = positionResult.txId
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
