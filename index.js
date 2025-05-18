import { ethers } from 'ethers';
import FACTORY_ABI from './abis/factory.json' assert { type: 'json' };
import QUOTER_ABI from './abis/quoter.json' assert { type: 'json' };
import SWAP_ROUTER_ABI from './abis/swaprouter.json' assert { type: 'json' };
import POOL_ABI from './abis/pool.json' assert { type: 'json' };
import TOKEN_ABI from './abis/weth.json' assert { type: 'json' };
import 'dotenv/config';

// ========================
// CONFIGURATION CONSTANTS
// ========================
// Dynamic URLs
const RPC_URL = 'http://127.0.0.1:8545';
const EXPLORER_URL = 'https://sepolia.etherscan.io';

// Configuration Constants
// ========================
// Swap Amount Configuration
const SWAP_AMOUNT = 10; // Reduced to an even smaller amount for testing
const SLIPPAGE_TOLERANCE = 0.05; // 5% slippage tolerance

// Additional Configuration Options
const DEBUG_MODE = true; // Enable extra logging
const TRY_EXACT_OUTPUT = true; // If true, try exactOutputSingle if exactInputSingle fails

// Contract Addresses
const POOL_FACTORY_CONTRACT_ADDRESS = '0x0227628f3F023bb0B980b67D528571c95c6DaC1c';
const QUOTER_CONTRACT_ADDRESS = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3';
const SWAP_ROUTER_CONTRACT_ADDRESS = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E';

// Token Addresses - Only thing needed to start a swap
const TOKEN_IN_ADDRESS = '0xb0a61F0dB0a24393DaaF5DE9A4164A22f79c49d6';
const TOKEN_OUT_ADDRESS = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';

// Chain ID
const CHAIN_ID = 11155111; // Sepolia

// ========================
// PROVIDER & CONTRACT SETUP
// ========================
const provider = new ethers.JsonRpcProvider(RPC_URL);
const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, provider);
const quoterContract = new ethers.Contract(QUOTER_CONTRACT_ADDRESS, QUOTER_ABI, provider);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

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
// TOKEN INFO HELPERS
// ========================

// Fetch token information
async function fetchTokenInfo(tokenAddress) {
  try {
    log(`Fetching token info for address: ${tokenAddress}`);
    
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
    
    // Fetch token details
    const [symbol, name, decimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.name(),
      tokenContract.decimals()
    ]);
    
    const tokenInfo = {
      chainId: CHAIN_ID,
      address: tokenAddress,
      decimals: Number(decimals),
      symbol: symbol,
      name: name,
      isToken: true,
    };
    
    log(`Token info retrieved:`, tokenInfo);
    
    return tokenInfo;
  } catch (error) {
    logError(`Error fetching token info for ${tokenAddress}`, error);
    throw new Error(`Failed to retrieve token info for ${tokenAddress}`);
  }
}

// ========================
// BALANCE CHECKING FUNCTIONS
// ========================

// Check all relevant token balances
async function logBalances(wallet, tokenIn, tokenOut) {
  try {
    log(`Checking wallet balances for ${wallet.address}...`);
    
    const tokenInContract = new ethers.Contract(tokenIn.address, TOKEN_ABI, provider);
    const tokenOutContract = new ethers.Contract(tokenOut.address, TOKEN_ABI, provider);
    
    const [tokenInBalance, tokenOutBalance, ethBalance] = await Promise.all([
      tokenInContract.balanceOf(wallet.address),
      tokenOutContract.balanceOf(wallet.address),
      provider.getBalance(wallet.address),
    ]);

    const balances = {
      ETH: formatBigInt(ethBalance, 18),
      [tokenIn.symbol]: formatBigInt(tokenInBalance, tokenIn.decimals),
      [tokenOut.symbol]: formatBigInt(tokenOutBalance, tokenOut.decimals)
    };
    
    log(`Wallet Balances for ${wallet.address}:`, balances);
    return { tokenInBalance, tokenOutBalance, ethBalance };
  } catch (error) {
    logError('Error fetching balances', error);
    throw new Error('Failed to check balances');
  }
}

// ========================
// TOKEN WRAPPING FUNCTIONS
// ========================

// Wrap ETH to WETH (only needed for WETH tokens)
async function wrapEthToWeth(wallet, ethAmount, wethAddress) {
  try {
    log(`Wrapping ${ethAmount} ETH to WETH...`);
    
    const wethContract = new ethers.Contract(wethAddress, TOKEN_ABI, wallet);
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
    const wethBalance = await wethContract.balanceOf(wallet.address);
    log(`New WETH Balance: ${formatBigInt(wethBalance, 18)} WETH`);
    
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
async function checkBalance(tokenInfo, wallet) {
  try {
    const tokenContract = new ethers.Contract(tokenInfo.address, TOKEN_ABI, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    log(`${tokenInfo.symbol} Balance: ${formatBigInt(balance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
    return balance;
  } catch (error) {
    logError(`Error checking ${tokenInfo.symbol} balance`, error);
    throw new Error(`Failed to check ${tokenInfo.symbol} balance`);
  }
}

// Approve token spending
async function approveToken(tokenInfo, amount, wallet) {
  try {
    log(`Approving ${formatBigInt(amount, tokenInfo.decimals)} ${tokenInfo.symbol} for spending...`);
    
    const tokenContract = new ethers.Contract(tokenInfo.address, TOKEN_ABI, wallet);
    
    // Check balance first
    const balance = await checkBalance(tokenInfo, wallet);
    
    if (balance < amount) {
      throw new Error(`Insufficient ${tokenInfo.symbol} balance: ${formatBigInt(balance, tokenInfo.decimals)} < ${formatBigInt(amount, tokenInfo.decimals)}`);
    }

    // Check current allowance
    const allowance = await tokenContract.allowance(wallet.address, SWAP_ROUTER_CONTRACT_ADDRESS);
    log(`Current allowance: ${formatBigInt(allowance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
    
    if (allowance >= amount) {
      log(`Sufficient allowance already exists for ${tokenInfo.symbol}`);
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
    log(`New allowance: ${formatBigInt(newAllowance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
    
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
    
    // Check pool with multiple fee tiers
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
async function getQuote(quoterContract, params, tokenOut) {
  try {
    log(`Getting quote for swap...`, params);
    
    const quotedResult = await quoterContract.quoteExactInputSingle.staticCall(params);
    
    // Safely handle BigInt in the result
    const amountOut = quotedResult[0];
    
    log(`Quote received: ${formatBigInt(amountOut, tokenOut.decimals)} ${tokenOut.symbol}`);
    
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

// Try exactOutputSingle swap
async function tryExactOutputSwap(quoterContract, swapRouter, poolInfo, desiredOutputAmount, tokenIn, tokenOut, signer) {
  try {
    log(`Trying exactOutputSingle swap instead...`);
    
    // Convert output amount to proper decimal format
    const amountOut = ethers.parseUnits(desiredOutputAmount.toString(), tokenOut.decimals);
    
    // Get quote for exact output
    log(`Getting quote for exactOutputSingle...`);
    const quoteParams = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: poolInfo.fee,
      recipient: signer.address,
      amountOut: amountOut,
      sqrtPriceLimitX96: BigInt(0)
    };
    
    const quotedResult = await quoterContract.quoteExactOutputSingle.staticCall(quoteParams);
    const amountInMaximum = quotedResult[0];
    
    // Add slippage to max input amount
    const slippageFactor = BigInt(Math.floor((1 + SLIPPAGE_TOLERANCE) * 1000));
    const adjustedAmountInMaximum = (amountInMaximum * slippageFactor) / BigInt(1000);
    
    log(`Quote for exactOutputSingle:`, {
      amountOut: formatBigInt(amountOut, tokenOut.decimals),
      amountInMaximum: formatBigInt(amountInMaximum, tokenIn.decimals),
      adjustedAmountInMaximum: formatBigInt(adjustedAmountInMaximum, tokenIn.decimals)
    });
    
    // Prepare swap parameters
    const swapParams = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: poolInfo.fee,
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000 + 60 * 10),
      amountOut: amountOut,
      amountInMaximum: adjustedAmountInMaximum,
      sqrtPriceLimitX96: BigInt(0)
    };
    
    log(`Preparing exactOutputSingle transaction...`);
    
    // Approve enough tokens
    await approveToken(tokenIn, adjustedAmountInMaximum, signer);
    
    // Populate transaction
    const transaction = await swapRouter.exactOutputSingle.populateTransaction(swapParams);
    
    // Add gas limit
    const txWithGas = {
      ...transaction,
      gasLimit: ethers.parseUnits('1000000', 'wei'),
    };
    
    log(`Sending exactOutputSingle transaction...`);
    const transactionResponse = await signer.sendTransaction(txWithGas);
    
    log(`ExactOutputSingle Transaction Sent: ${EXPLORER_URL}/txn/${transactionResponse.hash}`);
    
    log(`Waiting for transaction confirmation...`);
    const receipt = await transactionResponse.wait();
    
    log(`ExactOutputSingle Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
    
    return receipt;
  } catch (error) {
    logError('ExactOutputSingle swap failed', error);
    throw new Error('ExactOutputSingle swap failed');
  }
}

// ========================
// SWAP EXECUTION FUNCTIONS
// ========================

// Execute swap
async function executeSwap(swapRouter, params, signer, tokenIn, tokenOut) {
  try {
    log(`Preparing swap transaction...`, params);
    
    // First, try to estimate gas
    try {
      log(`Estimating gas for swap transaction...`);
      const gasEstimate = await swapRouter.exactInputSingle.estimateGas(params);
      log(`Gas estimate: ${gasEstimate.toString()}`);
      
      // Add 30% buffer to gas estimate
      const gasLimit = gasEstimate * BigInt(130) / BigInt(100);
      log(`Using gas limit: ${gasLimit.toString()}`);
      
      // Populate transaction
      const transaction = await swapRouter.exactInputSingle.populateTransaction(params);
      
      // Add gas limit
      const txWithGas = {
        ...transaction,
        gasLimit: gasLimit,
      };
      
      log(`Sending swap transaction...`);
      const transactionResponse = await signer.sendTransaction(txWithGas);
      
      log(`Swap Transaction Sent: ${EXPLORER_URL}/txn/${transactionResponse.hash}`);
      
      log(`Waiting for transaction confirmation...`);
      const receipt = await transactionResponse.wait();
      
      log(`Swap Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
      
      return receipt;
    } catch (gasError) {
      // If gas estimation fails, log error and try with fixed gas limit
      logError('Gas estimation failed, using fixed gas limit', gasError);
      
      // Populate transaction
      const transaction = await swapRouter.exactInputSingle.populateTransaction(params);
      
      // Add high fixed gas limit
      const txWithGas = {
        ...transaction,
        gasLimit: ethers.parseUnits('1000000', 'wei'),
      };
      
      log(`Sending swap transaction with fixed gas limit...`);
      const transactionResponse = await signer.sendTransaction(txWithGas);
      
      log(`Swap Transaction Sent: ${EXPLORER_URL}/txn/${transactionResponse.hash}`);
      
      log(`Waiting for transaction confirmation...`);
      const receipt = await transactionResponse.wait();
      
      log(`Swap Transaction Confirmed: ${EXPLORER_URL}/txn/${receipt.hash}`);
      
      return receipt;
    }
  } catch (error) {
    logError('Swap execution failed', error);
    
    // If there's a transaction hash in the error, log it
    if (error.transactionHash) {
      log(`Failed Transaction: ${EXPLORER_URL}/txn/${error.transactionHash}`);
    }
    
    // Check if this is a "Transaction reverted without a reason string" error
    if (error.message && error.message.includes('Transaction reverted without a reason')) {
      // Try to get more context by checking if the pool has sufficient liquidity for this swap
      log(`Detected "Transaction reverted without a reason" error. Performing additional diagnostics...`);
      
      try {
        // Get the pool contract
        const poolAddress = await factoryContract.getPool(params.tokenIn, params.tokenOut, params.fee);
        const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
        
        // Check current liquidity
        const liquidity = await poolContract.liquidity();
        log(`Current pool liquidity: ${liquidity.toString()}`);
        
        // Try smaller amount - reduce by 90%
        const smallerAmount = params.amountIn * BigInt(10) / BigInt(100);
        log(`Trying to get quote for smaller amount: ${formatBigInt(smallerAmount, tokenIn.decimals)} ${tokenIn.symbol}`);
        
        try {
          const smallerQuote = await quoterContract.quoteExactInputSingle.staticCall({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            fee: params.fee,
            amountIn: smallerAmount,
            sqrtPriceLimitX96: BigInt(0)
          });
          
          log(`Quote for smaller amount: ${formatBigInt(smallerQuote[0], tokenOut.decimals)} ${tokenOut.symbol}`);
          log(`DIAGNOSTIC: Smaller amount quote successful, likely issue is with swap amount/price impact`);
        } catch (smallerQuoteError) {
          logError('Even smaller quote failed', smallerQuoteError);
          log(`DIAGNOSTIC: Both large and small quotes failing, likely issue with pool configuration`);
        }
      } catch (diagnosticError) {
        logError('Diagnostic checks failed', diagnosticError);
      }
      
      log(`
LIKELY ISSUES:
1. Insufficient liquidity for swap amount
2. Price impact too high (try smaller amount)
3. Pool configuration issue - check token ordering and fee
4. Router configuration issue - check router address and permissions
      `);
    }
    
    throw new Error('Swap transaction failed');
  }
}

// ========================
// MAIN EXECUTION FUNCTION
// ========================

async function main(swapAmount) {
  try {
    // Fetch token information dynamically
    const tokenIn = await fetchTokenInfo(TOKEN_IN_ADDRESS);
    const tokenOut = await fetchTokenInfo(TOKEN_OUT_ADDRESS);
    
    log(`Starting swap process for ${swapAmount} ${tokenIn.symbol} to ${tokenOut.symbol}...`);
    
    // Get initial balances
    const initialBalances = await logBalances(signer, tokenIn, tokenOut);
    
    // Convert input amount to BigInt with proper decimals
    const inputAmount = swapAmount;
    const amountIn = ethers.parseUnits(inputAmount.toString(), tokenIn.decimals);
    
    log(`Swap amount in wei: ${amountIn.toString()}`);
    
    // Approve token for spending
    await approveToken(tokenIn, amountIn, signer);
    
    // Get pool information
    const { poolContract, token0, token1, fee, liquidity, slot0, tokenInIsToken0 } = 
      await getPoolInfo(tokenIn, tokenOut);
    
    log(`Fetching quote for: ${tokenIn.symbol} to ${tokenOut.symbol} with fee ${fee}`);
    
    // Create quote parameters
    const quoteParams = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: fee,
      amountIn: amountIn,
      sqrtPriceLimitX96: BigInt(0)
    };
    
    // Get quote
    const quotedAmountOut = await getQuote(quoterContract, quoteParams, tokenOut);
    
    // Calculate minimum amount out with slippage protection
    // Convert slippage percentage to factor (e.g., 5% -> 0.95)
    const slippageFactor = BigInt(Math.floor((1 - SLIPPAGE_TOLERANCE) * 1000));
    let amountOutMinimum = (quotedAmountOut * slippageFactor) / BigInt(1000);
    
    // Ensure amountOutMinimum is never zero
    if (amountOutMinimum === BigInt(0)) {
      log(`WARNING: Calculated amountOutMinimum is zero. Setting to a minimum value.`);
      // Set to a very small value (1 unit in the smallest denomination)
      amountOutMinimum = BigInt(1);
    }
    
    log(`Quote details:`, {
      amountIn: formatBigInt(amountIn, tokenIn.decimals),
      quotedAmountOut: formatBigInt(quotedAmountOut, tokenOut.decimals),
      slippageTolerance: `${SLIPPAGE_TOLERANCE * 100}%`,
      amountOutMinimum: formatBigInt(amountOutMinimum, tokenOut.decimals)
    });
    
    // Prepare swap parameters
    const swapParams = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      fee: fee,
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000 + 60 * 10), // 10 minutes from now
      amountIn: amountIn,
      amountOutMinimum: amountOutMinimum,
      sqrtPriceLimitX96: BigInt(0)
    };
    
    log(`Final swap parameters:`, {
      ...swapParams,
      amountIn: formatBigInt(amountIn, tokenIn.decimals),
      amountOutMinimum: formatBigInt(amountOutMinimum, tokenOut.decimals),
      deadline: new Date(swapParams.deadline * 1000).toISOString()
    });
    
    // Initialize swap router contract
    const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
    
    try {
      // Execute swap
      const receipt = await executeSwap(swapRouter, swapParams, signer, tokenIn, tokenOut);
      
      // Get final balances
      const finalBalances = await logBalances(signer, tokenIn, tokenOut);
      
      // Calculate and display the difference
      const initialTokenIn = initialBalances.tokenInBalance;
      const initialTokenOut = initialBalances.tokenOutBalance;
      const finalTokenIn = finalBalances.tokenInBalance;
      const finalTokenOut = finalBalances.tokenOutBalance;
      
      log(`Swap Results:`, {
        [`${tokenIn.symbol}Change`]: `-${formatBigInt(initialTokenIn - finalTokenIn, tokenIn.decimals)} ${tokenIn.symbol}`,
        [`${tokenOut.symbol}Change`]: `+${formatBigInt(finalTokenOut - initialTokenOut, tokenOut.decimals)} ${tokenOut.symbol}`
      });
      
      log(`Swap completed successfully!`);
      
      return {
        success: true,
        txHash: receipt.hash,
        amountIn: formatBigInt(amountIn, tokenIn.decimals),
        amountOut: formatBigInt(finalTokenOut - initialTokenOut, tokenOut.decimals)
      };
    } catch (swapError) {
      logError('ExactInputSingle swap failed, trying alternative approach', swapError);
      
      if (TRY_EXACT_OUTPUT) {
        // Try exactOutputSingle as an alternative approach
        log(`Attempting alternative approach: exactOutputSingle`);
        
        // Use a slightly smaller output amount than quoted to account for price impact
        const desiredOutputAmount = Number(formatBigInt(quotedAmountOut, tokenOut.decimals)) * 0.9;
        
        log(`Using desired output amount: ${desiredOutputAmount} ${tokenOut.symbol}`);
        
        const receipt = await tryExactOutputSwap(
          quoterContract, 
          swapRouter, 
          { fee: fee },
          desiredOutputAmount, 
          tokenIn,
          tokenOut,
          signer
        );
        
        // Get final balances
        const finalBalances = await logBalances(signer, tokenIn, tokenOut);
        
        // Calculate and display the difference
        const initialTokenIn = initialBalances.tokenInBalance;
        const initialTokenOut = initialBalances.tokenOutBalance;
        const finalTokenIn = finalBalances.tokenInBalance;
        const finalTokenOut = finalBalances.tokenOutBalance;
        
        log(`Swap Results (using exactOutputSingle):`, {
          [`${tokenIn.symbol}Change`]: `-${formatBigInt(initialTokenIn - finalTokenIn, tokenIn.decimals)} ${tokenIn.symbol}`,
          [`${tokenOut.symbol}Change`]: `+${formatBigInt(finalTokenOut - initialTokenOut, tokenOut.decimals)} ${tokenOut.symbol}`
        });
        
        log(`Swap completed successfully using exactOutputSingle!`);
        
        return {
          success: true,
          txHash: receipt.hash,
          amountIn: formatBigInt(initialTokenIn - finalTokenIn, tokenIn.decimals),
          amountOut: formatBigInt(finalTokenOut - initialTokenOut, tokenOut.decimals),
          method: 'exactOutputSingle'
        };
      } else {
        throw new Error('Swap failed and TRY_EXACT_OUTPUT is disabled');
      }
    }
  } catch (error) {
    logError('An error occurred during swap execution', error);
    throw error;
  }
}

// ========================
// SCRIPT EXECUTION
// ========================

log(`Starting script with swap amount: ${SWAP_AMOUNT}`);

main(SWAP_AMOUNT).catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});