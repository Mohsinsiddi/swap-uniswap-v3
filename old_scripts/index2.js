import { ethers } from 'ethers';
import FACTORY_ABI from '../abis/factory.json' assert { type: 'json' };
import QUOTER_ABI from '../abis/quoter.json' assert { type: 'json' };
import SWAP_ROUTER_ABI from '../abis/swaprouter.json' assert { type: 'json' };
import POOL_ABI from '../abis/pool.json' assert { type: 'json' };
import TOKEN_IN_ABI from '../abis/weth.json' assert { type: 'json' };
import 'dotenv/config';

// ========================
// CONFIGURATION CONSTANTS
// ========================
// Dynamic URLs
const RPC_URL = 'http://127.0.0.1:8545';
const EXPLORER_URL = 'https://sepolia.etherscan.io';

// Swap Amount Configuration
const SWAP_AMOUNT = 0.1; // Start with a small amount for testing
const SLIPPAGE_TOLERANCE = 0.05; // 5% slippage tolerance

// Contract Addresses
const POOL_FACTORY_CONTRACT_ADDRESS = '0x0227628f3F023bb0B980b67D528571c95c6DaC1c';
const QUOTER_CONTRACT_ADDRESS = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3';
const SWAP_ROUTER_CONTRACT_ADDRESS = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E';

// ========================
// PROVIDER & CONTRACT SETUP
// ========================
const provider = new ethers.JsonRpcProvider(RPC_URL);
const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, provider);
const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, provider);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// ========================
// TOKEN CONFIGURATION
// ========================
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

// ========================
// DEBUGGING & LOGGING HELPERS
// ========================

// Logging function with timestamps
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data !== null) {
    console.log(JSON.stringify(data, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 2));
  }
  console.log('-------------------------------');
}

// Error logging
function logError(message, error) {
  console.error(`-------------------------------`);
  console.error(`ERROR: ${message}`);
  if (error) {
    console.error(`Message: ${error.message || 'Unknown error'}`);
    if (error.code) console.error(`Code: ${error.code}`);
    if (error.data) console.error(`Data: ${JSON.stringify(error.data)}`);
    if (error.stack) console.error(`Stack: ${error.stack}`);
  }
  console.error(`-------------------------------`);
}

// Format BigInt for display
function formatBigInt(value, decimals) {
  return ethers.formatUnits(value, decimals);
}

// ========================
// BALANCE CHECKING FUNCTIONS
// ========================

// Check all relevant token balances
async function logBalances(wallet) {
  try {
    log(`Checking wallet balances for ${wallet.address}...`);
    
    const wethContract = new ethers.Contract(WETH.address, TOKEN_IN_ABI, provider);
    const usdcContract = new ethers.Contract(USDC.address, TOKEN_IN_ABI, provider);
    
    const [wethBalance, usdcBalance, ethBalance] = await Promise.all([
      wethContract.balanceOf(wallet.address),
      usdcContract.balanceOf(wallet.address),
      provider.getBalance(wallet.address),
    ]);

    const balances = {
      ETH: formatBigInt(ethBalance, 18),
      [WETH.symbol]: formatBigInt(wethBalance, WETH.decimals),
      [USDC.symbol]: formatBigInt(usdcBalance, USDC.decimals)
    };
    
    log(`Wallet Balances for ${wallet.address}:`, balances);
    return { wethBalance, usdcBalance, ethBalance };
  } catch (error) {
    logError('Error fetching balances', error);
    throw new Error('Failed to check balances');
  }
}

// ========================
// TOKEN WRAPPING FUNCTIONS
// ========================

// Wrap ETH to WETH
async function wrapEthToWeth(wallet, ethAmount) {
  try {
    log(`Wrapping ${ethAmount} ETH to WETH...`);
    
    const wethContract = new ethers.Contract(WETH.address, TOKEN_IN_ABI, wallet);
    const ethToWrap = ethers.parseEther(ethAmount.toString());
    
    // Check ETH balance
    const ethBalance = await provider.getBalance(wallet.address);
    log(`Current ETH balance: ${formatBigInt(ethBalance, 18)} ETH`);
    
    if (ethBalance < ethToWrap) {
      throw new Error(`Insufficient ETH balance: ${formatBigInt(ethBalance, 18)} ETH available`);
    }

    // Deposit ETH to get WETH
    const depositTx = await wethContract.deposit.populateTransaction({
      value: ethToWrap,
    });
    
    const txResponse = await wallet.sendTransaction({
      ...depositTx,
      gasLimit: ethers.parseUnits('200000', 'wei'),
    });
    
    log(`Wrapping ${formatBigInt(ethToWrap, 18)} ETH to WETH...`);
    log(`Transaction Sent: ${EXPLORER_URL}/txn/${txResponse.hash}`);
    
    const receipt = await txResponse.wait();
    log(`Wrap Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
    
    // Log new WETH balance
    const wethContractView = new ethers.Contract(WETH.address, TOKEN_IN_ABI, provider);
    const wethBalance = await wethContractView.balanceOf(wallet.address);
    log(`New WETH Balance: ${formatBigInt(wethBalance, WETH.decimals)} ${WETH.symbol}`);
    
    return receipt;
  } catch (error) {
    logError('Error wrapping ETH to WETH', error);
    throw new Error('ETH wrapping failed');
  }
}

// ========================
// TOKEN APPROVAL FUNCTIONS
// ========================

// Check token balance
async function checkBalance(tokenAddress, tokenDecimals, tokenSymbol, wallet) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_IN_ABI, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    log(`${tokenSymbol} Balance: ${formatBigInt(balance, tokenDecimals)} ${tokenSymbol}`);
    return balance;
  } catch (error) {
    logError(`Error checking ${tokenSymbol} balance`, error);
    throw new Error(`Failed to check ${tokenSymbol} balance`);
  }
}

// Approve token spending
async function approveToken(tokenAddress, tokenABI, amount, wallet) {
  try {
    log(`Approving ${formatBigInt(amount, WETH.decimals)} ${WETH.symbol} for spending...`);
    
    const tokenContract = new ethers.Contract(tokenAddress, tokenABI, wallet);
    
    // Check balance first
    const balance = await checkBalance(tokenAddress, WETH.decimals, WETH.symbol, wallet);
    
    if (balance < amount) {
      throw new Error(`Insufficient ${WETH.symbol} balance: ${formatBigInt(balance, WETH.decimals)} < ${formatBigInt(amount, WETH.decimals)}`);
    }

    // Check current allowance
    const allowance = await tokenContract.allowance(wallet.address, SWAP_ROUTER_CONTRACT_ADDRESS);
    log(`Current allowance: ${formatBigInt(allowance, WETH.decimals)} ${WETH.symbol}`);
    
    if (allowance >= amount) {
      log(`Sufficient allowance already exists for ${WETH.symbol}`);
      return { success: true, message: "Already approved" };
    }

    // Approve tokens
    const approveTransaction = await tokenContract.approve.populateTransaction(
      SWAP_ROUTER_CONTRACT_ADDRESS,
      amount
    );

    const transactionResponse = await wallet.sendTransaction({
      ...approveTransaction,
      gasLimit: ethers.parseUnits('100000', 'wei'),
    });
    
    log(`Approval Transaction Sent: ${EXPLORER_URL}/txn/${transactionResponse.hash}`);
    
    const receipt = await transactionResponse.wait();
    log(`Approval Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
    
    // Verify new allowance
    const newAllowance = await tokenContract.allowance(wallet.address, SWAP_ROUTER_CONTRACT_ADDRESS);
    log(`New allowance: ${formatBigInt(newAllowance, WETH.decimals)} ${WETH.symbol}`);
    
    return { success: true, txHash: receipt.hash };
  } catch (error) {
    logError('Error during token approval', error);
    throw new Error('Token approval failed');
  }
}

// ========================
// POOL VERIFICATION FUNCTIONS
// ========================

// Get and verify pool information
async function getPoolInfo(tokenIn, tokenOut) {
  try {
    log(`Checking pool for ${tokenIn.symbol}/${tokenOut.symbol}...`);
    
    // Check pool with both fee tiers
    const feeTiers = [500, 3000, 10000];
    let poolAddress = null;
    let usedFee = null;
    
    // Try to find pool with different fee tiers
    for (const fee of feeTiers) {
      log(`Checking for pool with fee tier ${fee}...`);
      const address = await factoryContract.getPool(tokenIn.address, tokenOut.address, fee);
      
      if (address !== ethers.ZeroAddress) {
        log(`Found pool with fee ${fee}: ${address}`);
        poolAddress = address;
        usedFee = fee;
        break;
      }
    }
    
    // Try reverse token order if pool not found
    if (poolAddress === null) {
      log(`No pool found with standard ordering. Trying reverse token order...`);
      
      for (const fee of feeTiers) {
        const address = await factoryContract.getPool(tokenOut.address, tokenIn.address, fee);
        
        if (address !== ethers.ZeroAddress) {
          log(`Found pool with reverse token order and fee ${fee}: ${address}`);
          poolAddress = address;
          usedFee = fee;
          break;
        }
      }
    }
    
    if (poolAddress === null || poolAddress === ethers.ZeroAddress) {
      throw new Error(`No pool exists for ${tokenIn.symbol}/${tokenOut.symbol} with any standard fee tier`);
    }
    
    // Get pool details
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    
    log(`Getting pool details for ${poolAddress}...`);
    
    const [token0, token1, fee, liquidity, slot0] = await Promise.all([
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
      poolContract.liquidity(),
      poolContract.slot0()
    ]);
    
    // Determine token ordering in the pool
    const tokenInIsToken0 = token0.toLowerCase() === tokenIn.address.toLowerCase();
    
    const poolInfo = {
      address: poolAddress,
      token0,
      token1,
      fee: Number(fee),
      liquidity: liquidity.toString(),
      currentSqrtPrice: slot0.sqrtPriceX96.toString(),
      currentTick: Number(slot0.tick),
      tokenOrdering: tokenInIsToken0 ? 
        `${tokenIn.symbol} is token0, ${tokenOut.symbol} is token1` : 
        `${tokenOut.symbol} is token0, ${tokenIn.symbol} is token1`
    };
    
    log(`Pool Details:`, poolInfo);
    
    // Check if pool has liquidity
    if (liquidity.toString() === '0') {
      log(`WARNING: Pool has ZERO liquidity! Swap may fail.`);
    } else {
      log(`Pool has liquidity: ${liquidity.toString()}`);
    }
    
    return { poolContract, token0, token1, fee, liquidity, slot0, tokenInIsToken0 };
  } catch (error) {
    logError('Error retrieving pool information', error);
    throw error;
  }
}

// ========================
// QUOTING FUNCTIONS
// ========================

// Get quote for swap
async function getQuote(quoterContract, params) {
  try {
    log(`Getting quote for swap...`, params);
    
    const quotedResult = await quoterContract.quoteExactInputSingle.staticCall(params);
    
    // Safely handle BigInt in the result
    const amountOut = quotedResult[0];
    
    log(`Quote received: ${formatBigInt(amountOut, USDC.decimals)} ${USDC.symbol}`);
    
    return amountOut;
  } catch (error) {
    logError('Error getting quote', error);
    
    // If error contains revert data, try to decode it
    if (error.data) {
      log(`Error data: ${error.data}`);
    }
    
    throw new Error('Failed to get quote for swap');
  }
}

// ========================
// SWAP EXECUTION FUNCTIONS
// ========================

// Execute swap
async function executeSwap(swapRouter, params, signer) {
  try {
    log(`Preparing swap transaction...`, params);
    
    // Populate transaction
    const transaction = await swapRouter.exactInputSingle.populateTransaction(params);
    
    // Add gas limit
    const txWithGas = {
      ...transaction,
      gasLimit: ethers.parseUnits('500000', 'wei'),
    };
    
    log(`Sending swap transaction...`);
    const transactionResponse = await signer.sendTransaction(txWithGas);
    
    log(`Swap Transaction Sent: ${EXPLORER_URL}/txn/${transactionResponse.hash}`);
    
    log(`Waiting for transaction confirmation...`);
    const receipt = await transactionResponse.wait();
    
    log(`Swap Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
    
    return receipt;
  } catch (error) {
    logError('Swap execution failed', error);
    
    // If there's a transaction hash in the error, log it
    if (error.transactionHash) {
      log(`Failed Transaction: ${EXPLORER_URL}/txn/${error.transactionHash}`);
    }
    
    throw new Error('Swap transaction failed');
  }
}

// ========================
// MAIN EXECUTION FUNCTION
// ========================

async function main(swapAmount) {
  try {
    log(`Starting swap process for ${swapAmount} ${WETH.symbol}...`);
    
    // Get initial balances
    const initialBalances = await logBalances(signer);
    
    // Convert input amount to BigInt

    await wrapEthToWeth(signer, swapAmount);
    const inputAmount = swapAmount;
    const amountIn = ethers.parseUnits(inputAmount.toString(), WETH.decimals);
    
    log(`Swap amount in wei: ${amountIn.toString()}`);
    
    // Approve token for spending
    await approveToken(WETH.address, TOKEN_IN_ABI, amountIn, signer);
    
    // Get pool information
    const { poolContract, token0, token1, fee, liquidity, slot0, tokenInIsToken0 } = 
      await getPoolInfo(WETH, USDC);
    
    log(`Fetching quote for: ${WETH.symbol} to ${USDC.symbol} with fee ${fee}`);
    
    // Check if fee from pool matches expected fee
    if (fee !== 3000) {
      log(`WARNING: Pool fee (${fee}) differs from expected fee (3000)`);
    }
    
    // Create quote parameters
    const quoteParams = {
      tokenIn: WETH.address,
      tokenOut: USDC.address,
      fee: fee,
      amountIn: amountIn,
      sqrtPriceLimitX96: BigInt(0)
    };
    
    // Get quote
    const quotedAmountOut = await getQuote(quoterContract, quoteParams);
    
    // Calculate minimum amount out with slippage protection
    // Convert slippage percentage to factor (e.g., 5% -> 0.95)
    const slippageFactor = BigInt(Math.floor((1 - SLIPPAGE_TOLERANCE) * 1000)) / BigInt(1000);
    const amountOutMinimum = (quotedAmountOut * slippageFactor) / BigInt(1);
    
    log(`Quote details:`, {
      amountIn: formatBigInt(amountIn, WETH.decimals),
      quotedAmountOut: formatBigInt(quotedAmountOut, USDC.decimals),
      slippageTolerance: `${SLIPPAGE_TOLERANCE * 100}%`,
      amountOutMinimum: formatBigInt(amountOutMinimum, USDC.decimals)
    });
    
    // Prepare swap parameters
    const swapParams = {
      tokenIn: WETH.address,
      tokenOut: USDC.address,
      fee: fee,
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000 + 60 * 10), // 10 minutes from now
      amountIn: amountIn,
      amountOutMinimum: amountOutMinimum,
      sqrtPriceLimitX96: BigInt(0)
    };
    
    // Initialize swap router contract
    const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
    
    // Execute swap
    const receipt = await executeSwap(swapRouter, swapParams, signer);
    
    // Get final balances
    const finalBalances = await logBalances(signer);
    
    // Calculate and display the difference
    const initialWETH = initialBalances.wethBalance;
    const initialUSDC = initialBalances.usdcBalance;
    const finalWETH = finalBalances.wethBalance;
    const finalUSDC = finalBalances.usdcBalance;
    
    log(`Swap Results:`, {
      WETHChange: `-${formatBigInt(initialWETH - finalWETH, WETH.decimals)} ${WETH.symbol}`,
      USDCChange: `+${formatBigInt(finalUSDC - initialUSDC, USDC.decimals)} ${USDC.symbol}`
    });
    
    log(`Swap completed successfully!`);
    
    return {
      success: true,
      txHash: receipt.hash,
      amountIn: formatBigInt(amountIn, WETH.decimals),
      amountOut: formatBigInt(finalUSDC - initialUSDC, USDC.decimals)
    };
  } catch (error) {
    logError('An error occurred during swap execution', error);
    throw error;
  }
}

// ========================
// SCRIPT EXECUTION
// ========================

log(`Starting script with swap amount: ${SWAP_AMOUNT} ${WETH.symbol}`);

main(SWAP_AMOUNT).catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});