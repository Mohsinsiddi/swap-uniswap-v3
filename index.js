import { ethers } from 'ethers';
import FACTORY_ABI from './abis/factory.json' assert { type: 'json' };
import QUOTER_ABI from './abis/quoter.json' assert { type: 'json' };
import SWAP_ROUTER_ABI from './abis/swaprouter.json' assert { type: 'json' };
import POOL_ABI from './abis/pool.json' assert { type: 'json' };
import TOKEN_IN_ABI from './abis/weth.json' assert { type: 'json' };
import 'dotenv/config';

// Dynamic URLs
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const EXPLORER_URL = 'https://sepolia.etherscan.io'

const amount = 0.01

// Deployment Addresses
const POOL_FACTORY_CONTRACT_ADDRESS = '0x0227628f3F023bb0B980b67D528571c95c6DaC1c';
const QUOTER_CONTRACT_ADDRESS = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3';
const SWAP_ROUTER_CONTRACT_ADDRESS = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E';

// Provider, Contract & Signer Instances
const provider = new ethers.JsonRpcProvider(RPC_URL);
const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, provider);
const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, provider);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Token Configuration
const WETH = {
  chainId: 11155111,
  address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
  decimals: 18,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  isToken: true,
  isNative: true,
  wrapped: true,
};

const USDC = {
  chainId: 11155111,
  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  decimals: 6,
  symbol: 'USDC',
  name: 'USD//C',
  isToken: true,
  isNative: true,
  wrapped: false,
};

// Handler to log WETH and USDC balances
async function logBalances(wallet) {
  try {
    const wethContract = new ethers.Contract(WETH.address, TOKEN_IN_ABI, provider);
    const usdcContract = new ethers.Contract(USDC.address, TOKEN_IN_ABI, provider);
    const [wethBalance, usdcBalance, ethBalance] = await Promise.all([
      wethContract.balanceOf(wallet.address),
      usdcContract.balanceOf(wallet.address),
      provider.getBalance(wallet.address),
    ]);

    console.log(`-------------------------------`);
    console.log(`Wallet Balances at ${new Date().toISOString()}:`);
    console.log(`ETH: ${ethers.formatEther(ethBalance)} ETH`);
    console.log(`WETH: ${ethers.formatUnits(wethBalance, WETH.decimals)} ${WETH.symbol}`);
    console.log(`USDC: ${ethers.formatUnits(usdcBalance, USDC.decimals)} ${USDC.symbol}`);
    console.log(`-------------------------------`);
  } catch (error) {
    console.error('Error fetching balances:', error.message);
  }
}

// Handler to wrap ETH to WETH
async function wrapEthToWeth(wallet, ethAmount) {
  try {
    const wethContract = new ethers.Contract(WETH.address, TOKEN_IN_ABI, wallet);
    const ethToWrap = ethers.parseEther(ethAmount.toString());
    
    // Check ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    if (ethBalance < ethToWrap) {
      throw new Error(`Insufficient ETH balance: ${ethers.formatEther(ethBalance)} ETH available`);
    }

    // Deposit ETH to get WETH
    const depositTx = await wethContract.deposit.populateTransaction({
      value: ethToWrap,
    });
    
    const txResponse = await wallet.sendTransaction({
      ...depositTx,
      gasLimit: ethers.parseUnits('100000', 'wei'),
    });
    
    console.log(`-------------------------------`);
    console.log(`Wrapping ${ethers.formatEther(ethToWrap)} ETH to WETH...`);
    console.log(`Transaction Sent: ${EXPLORER_URL}/txn/${txResponse.hash}`);
    console.log(`-------------------------------`);
    
    const receipt = await txResponse.wait();
    console.log(`Wrap Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
    
    // Log new WETH balance
    const wethContractView = new ethers.Contract(WETH.address, TOKEN_IN_ABI, provider);
    const wethBalance = await wethContractView.balanceOf(wallet.address);
    console.log(`New WETH Balance: ${ethers.formatUnits(wethBalance, WETH.decimals)} ${WETH.symbol}`);
    console.log(`-------------------------------`);
    
    return receipt;
  } catch (error) {
    console.error('Error wrapping ETH to WETH:', error.message);
    throw error;
  }
}

async function checkBalance(tokenAddress, tokenDecimals, tokenSymbol, wallet) {
  const tokenContract = new ethers.Contract(tokenAddress, TOKEN_IN_ABI, provider);
  const balance = await tokenContract.balanceOf(wallet.address);
  console.log(`Wallet ${tokenSymbol} Balance: ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol}`);
  return balance;
}

async function approveToken(tokenAddress, tokenABI, amount, wallet) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, tokenABI, wallet);
    const balance = await checkBalance(tokenAddress, WETH.decimals, WETH.symbol, wallet);
    if (balance < amount) {
      throw new Error(`Insufficient ${WETH.symbol} balance`);
    }

    const allowance = await tokenContract.allowance(wallet.address, SWAP_ROUTER_CONTRACT_ADDRESS);
    if (allowance >= amount) {
      console.log(`-------------------------------`);
      console.log(`Sufficient allowance already exists for ${WETH.symbol}`);
      console.log(`-------------------------------`);
      return;
    }

    const approveTransaction = await tokenContract.approve.populateTransaction(
      SWAP_ROUTER_CONTRACT_ADDRESS,
      amount
    );

    const transactionResponse = await wallet.sendTransaction(approveTransaction);
    console.log(`-------------------------------`);
    console.log(`Sending Approval Transaction...`);
    console.log(`-------------------------------`);
    console.log(`Transaction Sent: ${EXPLORER_URL}/txn/${transactionResponse.hash}`);
    console.log(`-------------------------------`);
    const receipt = await transactionResponse.wait();
    console.log(`Approval Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
  } catch (error) {
    console.error('An error occurred during token approval:', error);
    throw new Error('Token approval failed');
  }
}

async function getPoolInfo(factoryContract, tokenIn, tokenOut) {
  const poolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, 3000);
  if (poolAddress === ethers.AddressZero) {
    throw new Error('Pool does not exist for this token pair with fee 3000');
  }
  const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [token0, token1, fee] = await Promise.all([
    poolContract.token0(),
    poolContract.token1(),
    poolContract.fee(),
  ]);
  return { poolContract, token0, token1, fee };
}

async function quoteAndLogSwap(quoterContract, fee, signer, amountIn) {
  const quotedAmountOut = await quoterContract.quoteExactInputSingle.staticCall({
    tokenIn: WETH.address,
    tokenOut: USDC.address,
    fee: fee,
    recipient: signer.address,
    deadline: Math.floor(Date.now() / 1000 + 60 * 10),
    amountIn: amountIn,
    sqrtPriceLimitX96: 0,
  });

  const amountOut = quotedAmountOut[0];
  console.log(`-------------------------------`);
  console.log(
    `Token Swap will result in: ${ethers.formatUnits(amountOut, USDC.decimals)} ${
      USDC.symbol
    } for ${ethers.formatUnits(amountIn, WETH.decimals)} ${WETH.symbol}`
  );
  console.log(`-------------------------------`);
  return amountOut;
}

async function prepareSwapParams(poolContract, signer, amountIn, amountOut) {
  const slippageTolerance = 0.005;
  const amountOutMinimum = amountOut * BigInt(Math.floor(1000 * (1 - slippageTolerance))) / BigInt(1000);

  return {
    tokenIn: WETH.address,
    tokenOut: USDC.address,
    fee: await poolContract.fee(),
    recipient: signer.address,
    deadline: Math.floor(Date.now() / 1000 + 60 * 10),
    amountIn: amountIn,
    amountOutMinimum: amountOutMinimum,
    sqrtPriceLimitX96: 0,
  };
}

async function executeSwap(swapRouter, params, signer) {
  try {
    const transaction = await swapRouter.exactInputSingle.populateTransaction(params);
    const transactionResponse = await signer.sendTransaction({
      ...transaction,
      gasLimit: ethers.parseUnits('300000', 'wei'),
    });
    console.log(`-------------------------------`);
    console.log(`Swap Transaction Sent: ${EXPLORER_URL}/txn/${transactionResponse.hash}`);
    console.log(`-------------------------------`);
    const receipt = await transactionResponse.wait();
    console.log(`Swap Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
    console.log(`-------------------------------`);
  } catch (error) {
    console.error('Swap execution failed:', error);
    throw new Error('Swap transaction failed');
  }
}

async function main(swapAmount) {
  try {
    // Log initial balances
    await logBalances(signer);

    // Wrap amount ETH to WETH
    await wrapEthToWeth(signer, amount);

    // Log balances after wrapping
    await logBalances(signer);

    // Perform swap
    const inputAmount = swapAmount;
    const amountIn = ethers.parseUnits(inputAmount.toString(), WETH.decimals);

    await approveToken(WETH.address, TOKEN_IN_ABI, amountIn, signer);
    const { poolContract, token0, token1, fee } = await getPoolInfo(factoryContract, WETH, USDC);
    console.log(`-------------------------------`);
    console.log(`Fetching Quote for: ${WETH.symbol} to ${USDC.symbol}`);
    console.log(`-------------------------------`);
    console.log(`Swap Amount: ${ethers.formatUnits(amountIn, WETH.decimals)} ${WETH.symbol}`);
    const quotedAmountOut = await quoteAndLogSwap(quoterContract, fee, signer, amountIn);
    const params = await prepareSwapParams(poolContract, signer, amountIn, quotedAmountOut);
    const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
    await executeSwap(swapRouter, params, signer);

    // Log balances after swap
    await logBalances(signer);
  } catch (error) {
    console.error('An error occurred:', error.message);
    throw error;
  }
}

main(amount).catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});