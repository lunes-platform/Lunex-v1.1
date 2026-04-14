import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import pairsRouter from '../../routes/pairs';
import ordersRouter from '../../routes/orders';
import tradesRouter from '../../routes/trades';
import candlesRouter from '../../routes/candles';
import orderbookRouter from '../../routes/orderbook';
import socialRouter from '../../routes/social';
import copytradeRouter from '../../routes/copytrade';
import marginRouter from '../../routes/margin';
import affiliateRouter from '../../routes/affiliate';
import agentsRouter from '../../routes/agents';
import rewardsRouter from '../../routes/rewards';
import asymmetricRouter from '../../routes/asymmetric';
import { marginService } from '../../services/marginService';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api/v1/pairs', pairsRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/trades', tradesRouter);
app.use('/api/v1/candles', candlesRouter);
app.use('/api/v1/orderbook', orderbookRouter);
app.use('/api/v1/social', socialRouter);
app.use('/api/v1/copytrade', copytradeRouter);
app.use('/api/v1/margin', marginRouter);
app.use('/api/v1/affiliate', affiliateRouter);
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/rewards', rewardsRouter);
app.use('/api/v1/asymmetric', asymmetricRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    marginPriceHealth: marginService.getPriceHealthSummary(),
  });
});

app.get('/metrics', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(marginService.getPriceHealthMetrics());
});

export default app;
