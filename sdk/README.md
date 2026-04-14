# @lunex/sdk

Official TypeScript/JavaScript SDK for [Lunex DEX](https://lunex.io) - Decentralized Exchange on Lunes Network.

## Features

- 🔐 Wallet-based authentication
- 💱 Swap operations with slippage protection
- 💧 Liquidity management
- 🔒 Staking and governance
- 🎁 Trading rewards
- 🌯 LUNES wrapping/unwrapping
- 📡 Real-time updates via WebSocket
- 📦 TypeScript support with full type definitions
- ⚡ Modular and tree-shakeable

## Installation

```bash
npm install @lunex/sdk
# or
yarn add @lunex/sdk
# or
pnpm add @lunex/sdk
```

## Quick Start

```typescript
import LunexSDK from '@lunex/sdk';

// Initialize SDK
const sdk = new LunexSDK({
  baseURL: 'https://api.lunex.io/v1',
  wsURL: 'wss://api.lunex.io'
});

// Authenticate with wallet
const { nonce } = await sdk.auth.getNonce(walletAddress);
// ... sign nonce with wallet (use Polkadot.js extension)
await sdk.auth.login(walletAddress, signature, nonce);

// Get all pairs
const { pairs } = await sdk.factory.getAllPairs({ page: 1, limit: 20 });

// Get swap quote
const quote = await sdk.router.getQuote('1000000000', [tokenA, tokenB]);
console.log('You will receive:', quote.amountOut);
console.log('Price impact:', quote.priceImpact);

// Execute swap
const deadline = sdk.utils.calculateDeadline(20); // 20 minutes
const result = await sdk.router.swapExactTokensForTokens({
  amountIn: '1000000000',
  amountOutMin: quote.minimumReceived,
  path: [tokenA, tokenB],
  to: walletAddress,
  deadline
});
console.log('Swap successful! TX:', result.transactionHash);
```

## Core Modules

### Authentication

```typescript
// Get nonce
const { nonce, expiresIn } = await sdk.auth.getNonce(address);

// Login
const tokens = await sdk.auth.login(address, signature, nonce);

// Refresh token
const newTokens = await sdk.auth.refreshToken(refreshToken);

// Logout
sdk.auth.logout();
```

### Factory

```typescript
// Get all pairs
const { pairs, pagination } = await sdk.factory.getAllPairs({
  page: 1,
  limit: 20,
  sort: 'volume',
  order: 'desc'
});

// Get specific pair
const pair = await sdk.factory.getPairByTokens(tokenA, tokenB);

// Create new pair
const result = await sdk.factory.createPair(tokenA, tokenB);
console.log('Pair address:', result.pairAddress);

// Get factory stats
const stats = await sdk.factory.getStats();
console.log('Total  pairs:', stats.totalPairs);
console.log('24h volume:', stats.totalVolume24h);
```

### Router (Swaps & Liquidity)

```typescript
// Get quote
const quote = await sdk.router.getQuote(amountIn, [tokenA, tokenB]);

// Add liquidity
const result = await sdk.router.addLiquidity({
  tokenA,
  tokenB,
  amountADesired: '1000000000',
  amountBDesired: '500000000',
  amountAMin: '950000000',
  amountBMin: '475000000',
  to: userAddress,
  deadline: sdk.utils.calculateDeadline(20)
});

// Remove liquidity
const result = await sdk.router.removeLiquidity({
  tokenA,
  tokenB,
  liquidity: '707106781',
  amountAMin: '900000000',
  amountBMin: '450000000',
  to: userAddress,
  deadline: sdk.utils.calculateDeadline(20)
});

// Swap exact tokens for tokens
const result = await sdk.router.swapExactTokensForTokens({
  amountIn: '1000000000',
  amountOutMin: '987000000',
  path: [tokenA, tokenB],
  to: userAddress,
  deadline: sdk.utils.calculateDeadline(20)
});
```

### Spot Orderbook (Signed)

```typescript
// Create signed order payload (timestamp is included in the signed message)
const signedOrder = await sdk.orders.prepareSignedOrder({
  pairSymbol: 'LUNES/LUSDT',
  side: 'BUY',
  type: 'LIMIT',
  price: '1.05',
  amount: '100',
  makerAddress: userAddress,
  signMessage: walletSignMessage
});
await sdk.orders.createOrder(signedOrder);

// Signed reads
const orders = await sdk.orders.getUserOrders({
  makerAddress: userAddress,
  limit: 20,
  auth: { signMessage: walletSignMessage }
});
const trades = await sdk.orders.getUserTrades({
  address: userAddress,
  limit: 20,
  auth: { signMessage: walletSignMessage }
});
```

### Staking

```typescript
// Stake tokens
const result = await sdk.staking.stake(
  '10000000000', // 100 LUNES (8 decimals)
  7 * 24 * 60 * 60 // 7 days
);
console.log('Tier:', result.tier);
console.log('APR:', result.apr);

// Get position
const position = await sdk.staking.getPosition(userAddress);
console.log('Staked:', position.amount);
console.log('Pending rewards:', position.pendingRewards);
console.log('Voting power:', position.votingPower);

// Claim rewards
const result = await sdk.staking.claimRewards();
console.log('Claimed:', result.rewards);

// Unstake
const result = await sdk.staking.unstake();
console.log('Received:', result.totalReceived);
```

### Governance

```typescript
// Create proposal
const result = await sdk.staking.createProposal({
  name: 'List TOKEN XYZ',
  description: 'Proposal to list TOKEN XYZ on Lunex DEX',
  tokenAddress: '5Gtoken...',
  fee: '100000000000' // 1000 LUNES
});
console.log('Proposal ID:', result.proposalId);

// Get all proposals
const { proposals } = await sdk.staking.getAllProposals({
  status: 'active'
});

// Vote
await sdk.staking.vote(proposalId, true); // true = in favor

// Execute proposal
const result = await sdk.staking.executeProposal(proposalId);
console.log('Approved:', result.approved);
console.log('Votes for:', result.votesFor);
console.log('Votes against:', result.votesAgainst);
```

### Trading Rewards

```typescript
// Public pool overview
const pool = await sdk.rewards.getPool();
console.log('Reward pool:', pool.rewardPool);
console.log('Staker claim mode:', pool.stakerClaimMode);
console.log('Split valid:', pool.split.splitValid);

// Public reward-engine rankings
const rankings = await sdk.rewards.getRankings({
  limit: 10,
  segment: 'all',
  week: 'current'
});
console.log('Top leader:', rankings.leaders[0]?.name);
console.log('Top trader:', rankings.traders[0]?.address);

// Signed read for DB-backed leader/trader rewards
const pending = await sdk.rewards.getPending({
  address: userAddress,
  nonce,
  timestamp,
  signature
});
console.log('Leader rewards:', pending.leaderRewards);
console.log('Trader rewards:', pending.traderRewards);

// Claim DB-backed leader/trader rewards
const result = await sdk.rewards.claimRewards({
  address: userAddress,
  nonce,
  timestamp,
  signature
});
console.log('Claimed:', result.claimed);

// Distributed weeks with payout observability
const weeks = await sdk.rewards.getWeeks(5);
console.log('Latest trader pool:', weeks[0]?.traderPoolAmount);
console.log('Latest staker mode:', weeks[0]?.observability.staker.claimMode);

// Staker rewards are claimed on-chain via sdk.staking.claimRewards()
```

### Copytrade

```typescript
// Deposit into a leader vault with signed payload
const deposit = await sdk.copytrade.depositToVault(leaderId, signedDepositInput);
console.log('Execution mode:', deposit.executionMode);
console.log('On-chain tx:', deposit.txHash);

// Withdraw follower shares
const withdrawal = await sdk.copytrade.withdrawFromVault(leaderId, signedWithdrawInput);
console.log('Net amount:', withdrawal.netAmount);
console.log('Execution mode:', withdrawal.executionMode);

// Signed reads (positions/activity)
const positions = await sdk.copytrade.getPositions(userAddress, {
  signMessage: walletSignMessage
});
const activity = await sdk.copytrade.getActivity(userAddress, 50, {
  signMessage: walletSignMessage
});
```

### WNative (Wrapping)

```typescript
// Wrap LUNES to WLUNES
const result = await sdk.wnative.wrap('1000000000');
console.log('Wrapped:', result.wlunes);

// Unwrap WLUNES to  LUNES
const result = await sdk.wnative.unwrap('1000000000');
console.log('Unwrapped:', result.lunes);

// Get balances
const balances = await sdk.wnative.getBalance(userAddress);
console.log('WLUNES:', balances.wlunesBalance);
console.log('LUNES:', balances.lunesBalance);

// Check health
const healthy = await sdk.wnative.isHealthy();
console.log('1:1 backing:', healthy);
```

## Real-time Updates (WebSocket)

```typescript
// Connect to WebSocket
sdk.connectWebSocket(authToken);

// Listen to swap events
sdk.on('swap:executed', (data) => {
  console.log('New swap:', data);
  // Update UI
});

// Listen to price updates
sdk.on('price:update', (data) => {
  console.log('Price update:', data.pairAddress, data.price0);
});

// Subscribe to specific pair
sdk.subscribeToPair(pairAddress);

// Listen to proposal events
sdk.on('proposal:created', (data) => {
  console.log('New proposal:', data);
});

sdk.on('vote:cast', (data) => {
  console.log('Vote cast:', data.voter, data.votePower);
});

// Disconnect
sdk.disconnectWebSocket();
```

## Utility Functions

```typescript
// Calculate deadline (20 minutes from now)
const deadline = sdk.utils.calculateDeadline(20);

// Format amount
const formatted = sdk.utils.formatAmount('100000000000', 8);
// '1000.00000000'

// Parse amount
const parsed = sdk.utils.parseAmount('1000', 8);
// '100000000000'

// Format address
const short = sdk.utils.formatAddress('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
// '5Grwva...GKutQY'

// Calculate percentage
const percent = sdk.utils.calculatePercentage('100', '1000');
// '10.00'

// Format large numbers
const formatted = sdk.utils.formatLargeNumber('1500000000');
// '1.50B'
```

## Error Handling

```typescript
try {
  const result = await sdk.router.swapExactTokensForTokens({
    amountIn: '1000000000',
    amountOutMin: '999000000', // Very tight slippage
    path: [tokenA, tokenB],
    to: userAddress,
    deadline: sdk.utils.calculateDeadline(20)
  });
} catch (error: any) {
  console.error('Error code:', error.code);
  console.error('Message:', error.message);
  console.error('Details:', error.details);
  
  switch (error.code) {
    case 'SWAP_001':
      alert('Slippage tolerance exceeded. Try increasing slippage.');
      break;
    case 'SWAP_002':
      alert('Transaction deadline expired. Please try again.');
      break;
    case 'AUTH_002':
      alert('Session expired. Please reconnect wallet.');
      // Re-authenticate
      break;
    default:
      alert(`Error: ${error.message}`);
  }
}
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import LunexSDK, { Pair, Quote, StakePosition, Proposal } from '@lunex/sdk';

const sdk = new LunexSDK({ baseURL: '...' });

// All responses are fully typed
const pairs: { pairs: Pair[]; pagination: Pagination } = 
  await sdk.factory.getAllPairs();

const quote: Quote = await sdk.router.getQuote('100', [tokenA, tokenB]);

const position: StakePosition = await sdk.staking.getPosition(address);
```

## Configuration

```typescript
const sdk = new LunexSDK({
  baseURL: 'https://api.lunex.io/v1',  // Required
  wsURL: 'wss://api.lunex.io',          // Optional (auto-derived from baseURL)
  timeout: 30000,                        // Optional (default: 30000ms)
  apiKey: 'your-api-key'                 // Optional (for premium features)
});
```

## Examples

Check the [examples](./examples) directory for complete working examples:

- [Simple Swap](./examples/simple-swap.ts)
- [Add Liquidity](./examples/add-liquidity.ts)
- [Staking Dashboard](./examples/staking-dashboard.ts)
- [Create Proposal](./examples/create-proposal.ts)
- [Real-time Price Tracker](./examples/price-tracker.ts)

## API Documentation

Full API documentation is available at [https://docs.lunex.io/sdk](https://docs.lunex.io/sdk)

## Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) first.

## License

MIT © [Lunex DEX](https://lunex.io)

## Support

- Documentation: [https://docs.lunex.io](https://docs.lunex.io)
- Discord: [https://discord.gg/lunex](https://discord.gg/lunex)
- Twitter: [@LunexDEX](https://twitter.com/LunexDEX)
- Email: support@lunex.io

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.
