# 📱 GUIA DE IMPLEMENTAÇÃO FRONTEND - LUNEX DEX

**Data:** 04 de Dezembro de 2025  
**Stack:** React + TypeScript + Lunex SDK  
**Blockchain:** Lunes Network

---

## 📋 ÍNDICE

1. [Setup Inicial](#1-setup-inicial)
2. [Autenticação com Wallet](#2-autenticação-com-wallet)
3. [Swap Interface](#3-swap-interface)
4. [Liquidity Management](#4-liquidity-management)
5. [Staking Dashboard](#5-staking-dashboard)
6. [Governance](#6-governance)
7. [Real-time Updates](#7-real-time-updates)
8. [Error Handling](#8-error-handling)
9. [Best Practices](#9-best-practices)

---

## 1. SETUP INICIAL

### **Instalação de Dependências**

```bash
npm install --save lunex-sdk @polkadot/extension-dapp axios socket.io-client

# Tipos TypeScript
npm install --save-dev @types/node @types/react
```

### **package.json**

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "lunex-sdk": "^1.0.0",
    "@polkadot/extension-dapp": "^0.46.6",
    "axios": "^1.6.0",
    "socket.io-client": "^4.6.0",
    "zustand": "^4.4.0"
  }
}
```

### **Configuração Inicial**

```typescript
// src/config/lunex.ts
import LunexSDK from 'lunex-sdk';

const isProduction = process.env.NODE_ENV === 'production';

export const lunexConfig = {
  baseURL: isProduction 
    ? 'https://api.lunex.io/v1'
    : 'https://api-testnet.lunex.io/v1',
  wsURL: isProduction
    ? 'wss://api.lunex.io'
    : 'wss://api-testnet.lunex.io',
  rpcURL: isProduction
    ? 'wss://rpc.lunes.network'
    : 'wss://rpc-testnet.lunes.network',
};

export const lunexSDK = new LunexSDK(lunexConfig);
```

### **Contract Addresses**

```typescript
// src/config/contracts.ts
export const CONTRACTS = {
  factory: '5Factory...',
  router: '5Router...',
  wnative: '5WNative...',
  staking: '5Staking...',
  rewards: '5Rewards...',
};

export const WLUNES_ADDRESS = CONTRACTS.wnative;
```

---

## 2. AUTENTICAÇÃO COM WALLET

### **Polkadot Extension Integration**

```typescript
// src/hooks/useWallet.ts
import { useState, useEffect } from 'react';
import { web3Accounts, web3Enable, web3FromSource } from '@polkadot/extension-dapp';
import { lunexSDK } from '../config/lunex';

interface Account {
  address: string;
  meta: {
    name?: string;
    source: string;
  };
}

export const useWallet = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    const savedAddress = localStorage.getItem('lunex_connected_address');
    const savedToken = localStorage.getItem('lunex_auth_token');
    
    if (savedAddress && savedToken) {
      lunexSDK.setAuthToken(savedToken);
      // Load account from extension
      const extensions = await web3Enable('Lunex DEX');
      if (extensions.length > 0) {
        const allAccounts = await web3Accounts();
        const account = allAccounts.find(acc => acc.address === savedAddress);
        if (account) {
          setSelectedAccount(account);
          setIsConnected(true);
        }
      }
    }
  };

  const connectWallet = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Enable extension
      const extensions = await web3Enable('Lunex DEX');
      
      if (extensions.length === 0) {
        throw new Error('Please install Polkadot.js extension');
      }

      // 2. Get accounts
      const allAccounts = await web3Accounts();
      
      if (allAccounts.length === 0) {
        throw new Error('No accounts found in extension');
      }

      setAccounts(allAccounts);
      
      // Auto-select first account or show selection modal
      if (allAccounts.length === 1) {
        await selectAccount(allAccounts[0]);
      }
      
    } catch (err: any) {
      setError(err.message);
      console.error('Connect wallet error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectAccount = async (account: Account) => {
    setIsLoading(true);
    try {
      // 1. Get nonce from API
      const { nonce } = await lunexSDK.getNonce(account.address);

      // 2. Sign nonce with wallet
      const injector = await web3FromSource(account.meta.source);
      const signRaw = injector?.signer?.signRaw;

      if (!signRaw) {
        throw new Error('Signer not available');
      }

      const { signature } = await signRaw({
        address: account.address,
        data: nonce,
        type: 'bytes',
      });

      // 3. Authenticate with API
      const { token, refreshToken } = await lunexSDK.login(
        account.address,
        signature,
        nonce
      );

      // 4. Save to localStorage
      localStorage.setItem('lunex_auth_token', token);
      localStorage.setItem('lunex_refresh_token', refreshToken);
      localStorage.setItem('lunex_connected_address', account.address);

      setSelectedAccount(account);
      setIsConnected(true);
      
    } catch (err: any) {
      setError(err.message);
      console.error('Select account error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectWallet = () => {
    localStorage.removeItem('lunex_auth_token');
    localStorage.removeItem('lunex_refresh_token');
    localStorage.removeItem('lunex_connected_address');
    
    setSelectedAccount(null);
    setIsConnected(false);
    setAccounts([]);
  };

  return {
    accounts,
    selectedAccount,
    isConnected,
    isLoading,
    error,
    connectWallet,
    selectAccount,
    disconnectWallet,
  };
};
```

### **Wallet Connect Button**

```typescript
// src/components/WalletButton.tsx
import React from 'react';
import { useWallet } from '../hooks/useWallet';

export const WalletButton: React.FC = () => {
  const { 
    selectedAccount, 
    isConnected, 
    isLoading, 
    connectWallet, 
    disconnectWallet 
  } = useWallet();

  if (isConnected && selectedAccount) {
    return (
      <div className="wallet-connected">
        <span>{selectedAccount.meta.name || 'Account'}</span>
        <span className="address">
          {selectedAccount.address.slice(0, 6)}...{selectedAccount.address.slice(-4)}
        </span>
        <button onClick={disconnectWallet}>Disconnect</button>
      </div>
    );
  }

  return (
    <button 
      onClick={connectWallet} 
      disabled={isLoading}
      className="wallet-connect-btn"
    >
      {isLoading ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
};
```

---

## 3. SWAP INTERFACE

### **Swap Hook**

```typescript
// src/hooks/useSwap.ts
import { useState, useEffect } from 'react';
import { lunexSDK } from '../config/lunex';
import { Quote } from 'lunex-sdk';

export const useSwap = () => {
  const [tokenIn, setTokenIn] = useState<string>('');
  const [tokenOut, setTokenOut] = useState<string>('');
  const [amountIn, setAmountIn] = useState<string>('');
  const [amountOut, setAmountOut] = useState<string>('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [slippage, setSlippage] = useState(1.0); // 1%

  useEffect(() => {
    if (tokenIn && tokenOut && amountIn && parseFloat(amountIn) > 0) {
      debouncedGetQuote();
    }
  }, [tokenIn, tokenOut, amountIn]);

  const debouncedGetQuote = (() => {
    let timeout: NodeJS.Timeout;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(getQuote, 500);
    };
  })();

  const getQuote = async () => {
    if (!tokenIn || !tokenOut || !amountIn) return;

    setIsLoadingQuote(true);
    try {
      const path = [tokenIn, tokenOut];
      const quoteData = await lunexSDK.getQuote(amountIn, path);
      
      setQuote(quoteData);
      setAmountOut(quoteData.amountOut);
    } catch (error) {
      console.error('Get quote error:', error);
    } finally {
      setIsLoadingQuote(false);
    }
  };

  const executeSwap = async (userAddress: string) => {
    if (!quote || !tokenIn || !tokenOut) {
      throw new Error('Invalid swap parameters');
    }

    setIsSwapping(true);
    try {
      const deadline = lunexSDK.calculateDeadline(20); // 20 minutes
      
      const result = await lunexSDK.swapExactTokensForTokens({
        amountIn,
        amountOutMin: quote.minimumReceived,
        path: [tokenIn, tokenOut],
        to: userAddress,
        deadline,
      });

      return result;
    } finally {
      setIsSwapping(false);
    }
  };

  const switchTokens = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn(amountOut);
    setAmountOut('');
    setQuote(null);
  };

  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    quote,
    isLoadingQuote,
    isSwapping,
    slippage,
    setTokenIn,
    setTokenOut,
    setAmountIn,
    setSlippage,
    switchTokens,
    executeSwap,
  };
};
```

### **Swap Component**

```typescript
// src/components/SwapInterface.tsx
import React from 'react';
import { useSwap } from '../hooks/useSwap';
import { useWallet } from '../hooks/useWallet';

export const SwapInterface: React.FC = () => {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    quote,
    isLoadingQuote,
    isSwapping,
    setTokenIn,
    setTokenOut,
    setAmountIn,
    switchTokens,
    executeSwap,
  } = useSwap();

  const { selectedAccount, isConnected } = useWallet();

  const handleSwap = async () => {
    if (!selectedAccount) return;

    try {
      const result = await executeSwap(selectedAccount.address);
      console.log('Swap successful:', result);
      alert(`Swap successful! TX: ${result.transactionHash}`);
    } catch (error: any) {
      console.error('Swap error:', error);
      alert(`Swap failed: ${error.message}`);
    }
  };

  return (
    <div className="swap-container">
      <h2>Swap</h2>

      {/* Token In */}
      <div className="token-input">
        <label>From</label>
        <input
          type="number"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="0.0"
        />
        <select value={tokenIn} onChange={(e) => setTokenIn(e.target.value)}>
          <option value="">Select token</option>
          <option value="WLUNES_ADDRESS">WLUNES</option>
          <option value="USDT_ADDRESS">USDT</option>
        </select>
      </div>

      {/* Switch Button */}
      <button onClick={switchTokens} className="switch-btn">⇅</button>

      {/* Token Out */}
      <div className="token-input">
        <label>To</label>
        <input
          type="number"
          value={amountOut}
          readOnly
          placeholder="0.0"
        />
        <select value={tokenOut} onChange={(e) => setTokenOut(e.target.value)}>
          <option value="">Select token</option>
          <option value="WLUNES_ADDRESS">WLUNES</option>
          <option value="USDT_ADDRESS">USDT</option>
        </select>
      </div>

      {/* Quote Info */}
      {quote && (
        <div className="quote-info">
          <div className="quote-row">
            <span>Rate:</span>
            <span>1 TOKEN = {quote.priceImpact}</span>
          </div>
          <div className="quote-row">
            <span>Price Impact:</span>
            <span className={parseFloat(quote.priceImpact) > 2 ? 'warning' : ''}>
              {quote.priceImpact}%
            </span>
          </div>
          <div className="quote-row">
            <span>Minimum Received:</span>
            <span>{quote.minimumReceived}</span>
          </div>
          <div className="quote-row">
            <span>Fee:</span>
            <span>{quote.fee}</span>
          </div>
        </div>
      )}

      {/* Swap Button */}
      {isConnected ? (
        <button
          onClick={handleSwap}
          disabled={!quote || isSwapping || isLoadingQuote}
          className="swap-btn"
        >
          {isSwapping ? 'Swapping...' : isLoadingQuote ? 'Loading...' : 'Swap'}
        </button>
      ) : (
        <button className="connect-btn">Connect Wallet to Swap</button>
      )}
    </div>
  );
};
```

---

## 4. LIQUIDITY MANAGEMENT

### **Add Liquidity Hook**

```typescript
// src/hooks/useLiquidity.ts
import { useState } from 'react';
import { lunexSDK } from '../config/lunex';

export const useLiquidity = () => {
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const addLiquidity = async (params: {
    tokenA: string;
    tokenB: string;
    amountA: string;
    amountB: string;
    slippage: number;
    userAddress: string;
  }) => {
    setIsAdding(true);
    try {
      const slippageMultiplier = (100 - params.slippage) / 100;
      const amountAMin = (parseFloat(params.amountA) * slippageMultiplier).toString();
      const amountBMin = (parseFloat(params.amountB) * slippageMultiplier).toString();
      
      const deadline = lunexSDK.calculateDeadline(20);

      const result = await lunexSDK.addLiquidity({
        tokenA: params.tokenA,
        tokenB: params.tokenB,
        amountADesired: params.amountA,
        amountBDesired: params.amountB,
        amountAMin,
        amountBMin,
        to: params.userAddress,
        deadline,
      });

      return result;
    } finally {
      setIsAdding(false);
    }
  };

  const removeLiquidity = async (params: {
    tokenA: string;
    tokenB: string;
    liquidity: string;
    slippage: number;
    userAddress: string;
  }) => {
    setIsRemoving(true);
    try {
      // Calculate minimum amounts based on slippage
      const slippageMultiplier = (100 - params.slippage) / 100;
      // You would get expected amounts from pair reserves
      const amountAMin = '0'; // Calculate properly
      const amountBMin = '0'; // Calculate properly
      
      const deadline = lunexSDK.calculateDeadline(20);

      const result = await lunexSDK.removeLiquidity({
        tokenA: params.tokenA,
        tokenB: params.tokenB,
        liquidity: params.liquidity,
        amountAMin,
        amountBMin,
        to: params.userAddress,
        deadline,
      });

      return result;
    } finally {
      setIsRemoving(false);
    }
  };

  return {
    isAdding,
    isRemoving,
    addLiquidity,
    removeLiquidity,
  };
};
```

---

## 5. STAKING DASHBOARD

### **Staking Component**

```typescript
// src/components/StakingDashboard.tsx
import React, { useState, useEffect } from 'react';
import { lunexSDK } from '../config/lunex';
import { useWallet } from '../hooks/useWallet';
import { StakePosition } from 'lunex-sdk';

export const StakingDashboard: React.FC = () => {
  const { selectedAccount } = useWallet();
  const [position, setPosition] = useState<StakePosition | null>(null);
  const [amount, setAmount] = useState('');
  const [duration, setDuration] = useState(7); // days
  const [isStaking, setIsStaking] = useState(false);

  useEffect(() => {
    if (selectedAccount) {
      loadPosition();
    }
  }, [selectedAccount]);

  const loadPosition = async () => {
    if (!selectedAccount) return;

    try {
      const pos = await lunexSDK.getStakingPosition(selectedAccount.address);
      setPosition(pos);
    } catch (error) {
      console.error('Load position error:', error);
    }
  };

  const handleStake = async () => {
    if (!selectedAccount || !amount) return;

    setIsStaking(true);
    try {
      const durationSeconds = duration * 24 * 60 * 60;
      
      const result = await lunexSDK.stake(amount, durationSeconds);
      
      console.log('Stake successful:', result);
      alert(`Staked successfully! Tier: ${result.tier}, APR: ${result.apr}%`);
      
      await loadPosition();
    } catch (error: any) {
      console.error('Stake error:', error);
      alert(`Stake failed: ${error.message}`);
    } finally {
      setIsStaking(false);
    }
  };

  const handleUnstake = async () => {
    setIsStaking(true);
    try {
      const result = await lunexSDK.unstake();
      
      console.log('Unstake successful:', result);
      alert(`Unstaked! Amount: ${result.amount}, Rewards: ${result.rewards}`);
      
      await loadPosition();
    } catch (error: any) {
      alert(`Unstake failed: ${error.message}`);
    } finally {
      setIsStaking(false);
    }
  };

  return (
    <div className="staking-dashboard">
      <h2>Staking</h2>

      {/* Current Position */}
      {position && position.active && (
        <div className="current-position">
          <h3>Your Position</h3>
          <div className="stat">
            <label>Staked:</label>
            <span>{position.amount} LUNES</span>
          </div>
          <div className="stat">
            <label>Tier:</label>
            <span className={`tier-${position.tier.toLowerCase()}`}>
              {position.tier}
            </span>
          </div>
          <div className="stat">
            <label>Pending Rewards:</label>
            <span>{position.pendingRewards} LUNES</span>
          </div>
          <div className="stat">
            <label>Voting Power:</label>
            <span>{position.votingPower}</span>
          </div>
          <button onClick={handleUnstake} disabled={isStaking}>
            Unstake
          </button>
        </div>
      )}

      {/* Stake Form */}
      <div className="stake-form">
        <h3>New Stake</h3>
        <input
          type="number"
          placeholder="Amount (LUNES)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          <option value="7">7 days - Bronze (8% APY)</option>
          <option value="31">1 month - Silver (10% APY)</option>
          <option value="91">3 months - Gold (12% APY)</option>
          <option value="181">6 months - Platinum (15% APY)</option>
        </select>
        <button onClick={handleStake} disabled={isStaking || !amount}>
          {isStaking ? 'Staking...' : 'Stake'}
        </button>
      </div>
    </div>
  );
};
```

---

## 6. GOVERNANCE

### **Proposals List**

```typescript
// src/components/ProposalsList.tsx
import React, { useState, useEffect } from 'react';
import { lunexSDK } from '../config/lunex';
import { Proposal } from 'lunex-sdk';

export const ProposalsList: React.FC = () => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadProposals();
  }, []);

  const loadProposals = async () => {
    setIsLoading(true);
    try {
      const { proposals: data } = await lunexSDK.getAllProposals({
        status: 'active',
      });
      setProposals(data);
    } catch (error) {
      console.error('Load proposals error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVote = async (proposalId: number, inFavor: boolean) => {
    try {
      await lunexSDK.voteOnProposal(proposalId, inFavor);
      alert('Vote successful!');
      await loadProposals();
    } catch (error: any) {
      alert(`Vote failed: ${error.message}`);
    }
  };

  if (isLoading) return <div>Loading proposals...</div>;

  return (
    <div className="proposals-list">
      <h2>Active Proposals</h2>
      {proposals.map((proposal) => (
        <div key={proposal.id} className="proposal-card">
          <h3>{proposal.name}</h3>
          <p>{proposal.description}</p>
          <div className="votes">
            <div className="vote-bar">
              <span>For: {proposal.votesFor}</span>
              <span>Against: {proposal.votesAgainst}</span>
            </div>
          </div>
          <div className="actions">
            <button onClick={() => handleVote(proposal.id, true)}>
              Vote For
            </button>
            <button onClick={() => handleVote(proposal.id, false)}>
              Vote Against
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
```

---

## 7. REAL-TIME UPDATES

### **WebSocket Hook**

```typescript
// src/hooks/useRealtimeUpdates.ts
import { useEffect } from 'react';
import { lunexSDK } from '../config/lunex';

export const useRealtimeUpdates = () => {
  useEffect(() => {
    const socket = lunexSDK.connectWebSocket();

    // Swap events
    lunexSDK.on('swap:executed', (data) => {
      console.log('New swap:', data);
      // Update UI
    });

    // Price updates
    lunexSDK.on('price:update', (data) => {
      console.log('Price update:', data);
      // Update price displays
    });

    // Proposal events
    lunexSDK.on('proposal:created', (data) => {
      console.log('New proposal:', data);
      // Show notification
    });

    return () => {
      lunexSDK.disconnectWebSocket();
    };
  }, []);
};
```

---

## 8. ERROR HANDLING

### **Global Error Handler**

```typescript
// src/utils/errorHandler.ts
export const handleError = (error: any): string => {
  // API errors
  if (error.code) {
    switch (error.code) {
      case 'SWAP_001':
        return 'Slippage tolerance exceeded. Try increasing slippage or reducing amount.';
      case 'SWAP_002':
        return 'Transaction deadline expired. Please try again.';
      case 'STAKE_001':
        return 'Insufficient balance to stake.';
      case 'AUTH_002':
        return 'Session expired. Please reconnect your wallet.';
      default:
        return error.message || 'An error occurred';
    }
  }

  // Network errors
  if (error.message === 'Network Error') {
    return 'Network connection failed. Please check your internet.';
  }

  return error.message || 'Unknown error occurred';
};
```

---

## 9. BEST PRACTICES

### **✅ DO**

1. **Always validate inputs**
```typescript
if (!amount || parseFloat(amount) <= 0) {
  throw new Error('Invalid amount');
}
```

2. **Handle loading states**
```typescript
const [isLoading, setIsLoading] = useState(false);
```

3. **Use debouncing for quotes**
```typescript
const debounce = setTimeout(getQuote, 500);
```

4. **Display clear errors**
```typescript
try {
  // ...
} catch (error) {
  const message = handleError(error);
  showNotification(message, 'error');
}
```

5. **Implement retry logic**
```typescript
const retryWithBackoff = async (fn: Function, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};
```

### **❌ DON'T**

1. **Don't store private keys**
2. **Don't trust client-side calculations for critical operations**
3. **Don't skip error handling**
4. **Don't hardcode gas limits without explaining to users**
5. **Don't ignore rate limiting**

---

## 📚 RECURSOS ADICIONAIS

- **API Docs:** `/docs/API_SPECIFICATION.md`
- **OpenAPI Spec:** `/docs/api/openapi.json`
- **SDK Source:** `/docs/api/lunex-sdk.ts`

---

**FIM DO GUIA DE IMPLEMENTAÇÃO**
