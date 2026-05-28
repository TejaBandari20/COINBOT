import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Standard normal cumulative distribution function (CDF)
// Extremely precise approximation (error < 7.5e-8)
export function stdNormalCDF(x) {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228; // 1 / sqrt(2*pi)

  if (x >= 0.0) {
    const t = 1.0 / (1.0 + p * x);
    return (1.0 - c * Math.exp(-x * x / 2.0) * t *
      (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1));
  } else {
    const t = 1.0 / (1.0 - p * x);
    return (c * Math.exp(-x * x / 2.0) * t *
      (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1));
  }
}

// Calculate the implied probability that price at expiration will be greater than S0
export function calculateProbability(S0, St, elapsedMinutes, cycleDuration, volDaily) {
  const remMinutes = cycleDuration - elapsedMinutes;
  if (remMinutes <= 0) {
    return St > S0 ? 1.0 : 0.0;
  }
  // Volatility over the remaining minutes
  // volDaily is standard deviation of daily log returns (e.g., 0.02 = 2%)
  // Daily volatility scaling to remMinutes (1440 minutes in a day)
  const volRem = volDaily * Math.sqrt(remMinutes / 1440);
  if (volRem <= 0) return St > S0 ? 1.0 : 0.0;
  
  const z = Math.log(St / S0) / volRem;
  return stdNormalCDF(z);
}

// Calculate historical daily volatility from klines
export function calculateHistoricalVolatility(klines) {
  if (klines.length < 2) return 0.025; // default 2.5%
  
  const logReturns = [];
  for (let i = 1; i < klines.length; i++) {
    const prevClose = parseFloat(klines[i - 1][4]);
    const currClose = parseFloat(klines[i][4]);
    if (prevClose > 0 && currClose > 0) {
      logReturns.push(Math.log(currClose / prevClose));
    }
  }
  
  if (logReturns.length === 0) return 0.025;
  
  // Calculate standard deviation of 1-minute log returns
  const mean = logReturns.reduce((sum, val) => sum + val, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (logReturns.length - 1);
  const vol1m = Math.sqrt(variance);
  
  // Scale to daily volatility (1440 minutes in a day)
  const volDaily = vol1m * Math.sqrt(1440);
  return volDaily;
}

// Fetch historical klines from Binance with caching and pagination
export async function fetchHistoricalData(symbol = 'BTCUSDT', days = 3) {
  const cachePath = `./btc_cache_${days}d.json`;
  
  // Check if cache exists and is less than 1 hour old
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageInHours < 1.0) {
      try {
        const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (cachedData && cachedData.length > 0) {
          return cachedData;
        }
      } catch (e) {
        // Cache read error, will refetch
      }
    }
  }
  
  // Fetch from Binance
  // 1 day = 1440 minutes
  const totalMinutes = days * 1440;
  let allKlines = [];
  let endTime = Date.now();
  
  // We fetch in chunks of 1000 klines
  const limit = 1000;
  const chunks = Math.ceil(totalMinutes / limit);
  
  for (let i = 0; i < chunks; i++) {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/klines', {
        params: {
          symbol,
          interval: '1m',
          limit,
          endTime
        }
      });
      
      const klines = response.data;
      if (!klines || klines.length === 0) break;
      
      allKlines = klines.concat(allKlines);
      // Set endTime to the open time of the oldest fetched candle minus 1 millisecond
      endTime = klines[0][0] - 1;
      
      // Sleep briefly to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      throw new Error(`Failed fetching historical data chunk ${i + 1}: ${error.message}`);
    }
  }
  
  // Sort klines by open time just in case
  allKlines.sort((a, b) => a[0] - b[0]);
  
  // Write to cache
  try {
    fs.writeFileSync(cachePath, JSON.stringify(allKlines), 'utf8');
  } catch (e) {
    // Ignore cache write error
  }
  
  return allKlines;
}

// Run backtest simulation
export function runBacktest(rawKlines, config = {}) {
  const cycleDuration = config.cycleDuration || 15;
  const waitDuration = config.waitDuration || 12;
  const entryWindow = config.entryWindow || 3;
  const entryThreshold = config.entryThreshold || 0.95;
  const stopLoss = config.stopLoss || 0.75;
  const customVolDaily = config.volDaily;
  
  // Format klines into easy objects
  const klines = rawKlines.map(k => ({
    timestamp: parseInt(k[0]),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    datetime: new Date(parseInt(k[0]))
  }));
  
  // Calculate historical volatility if not customized
  const volDaily = customVolDaily || calculateHistoricalVolatility(rawKlines);
  
  // Group klines by clock-aligned cycles
  // A cycle starts at minute 00, 15, 30, 45, etc.
  const cycles = {};
  
  klines.forEach(k => {
    const minSinceEpoch = Math.floor(k.timestamp / 60000);
    const cycleIndex = Math.floor(minSinceEpoch / cycleDuration);
    const cycleStartTimestamp = cycleIndex * cycleDuration * 60000;
    
    if (!cycles[cycleStartTimestamp]) {
      cycles[cycleStartTimestamp] = [];
    }
    cycles[cycleStartTimestamp].push(k);
  });
  
  const sortedCycleStarts = Object.keys(cycles).map(Number).sort((a, b) => a - b);
  const trades = [];
  let totalCycles = 0;
  
  sortedCycleStarts.forEach(startTime => {
    const cycleKlines = cycles[startTime];
    // We need the cycle to have enough klines (at least waitDuration + 1 klines to enter, and close to cycleDuration klines to resolve)
    // Sometimes the first or last cycle is partial; we skip it
    if (cycleKlines.length < cycleDuration - 1) {
      return;
    }
    
    // Sort cycle klines by timestamp
    cycleKlines.sort((a, b) => a.timestamp - b.timestamp);
    
    totalCycles++;
    
    // S0 is the open price of the first minute of the cycle
    const S0 = cycleKlines[0].open;
    
    // Swait is the price at the entry check minute (e.g. index waitDuration)
    // In a 15-minute cycle, index 12 corresponds to the 13th minute (minute 12 of the cycle)
    const waitCandle = cycleKlines[waitDuration];
    if (!waitCandle) return;
    
    const Swait = waitCandle.open;
    
    // Calculate YES contract probability at minute waitDuration
    const pYes = calculateProbability(S0, Swait, waitDuration, cycleDuration, volDaily);
    const pNo = 1.0 - pYes;
    
    let tradeType = null;
    let entryPrice = 0;
    
    if (pYes >= entryThreshold) {
      tradeType = 'YES';
      entryPrice = pYes;
    } else if (pNo >= entryThreshold) {
      tradeType = 'NO';
      entryPrice = pNo;
    }
    
    if (tradeType) {
      // We entered a trade!
      let hitStopLoss = false;
      let stopLossMinute = -1;
      let exitPrice = 0;
      let exitReason = '';
      
      // Monitor the entry window (minutes 12, 13, 14)
      for (let m = waitDuration; m < cycleDuration; m++) {
        const candle = cycleKlines[m];
        if (!candle) continue;
        
        if (tradeType === 'YES') {
          // Low price gives the lowest probability for YES
          const minProb = calculateProbability(S0, candle.low, m, cycleDuration, volDaily);
          if (minProb <= stopLoss) {
            hitStopLoss = true;
            stopLossMinute = m;
            exitPrice = stopLoss;
            exitReason = 'STOP_LOSS';
            break;
          }
        } else {
          // High price gives the highest probability for YES, which is the lowest for NO (1 - pYes)
          const maxProbYes = calculateProbability(S0, candle.high, m, cycleDuration, volDaily);
          const minProbNo = 1.0 - maxProbYes;
          if (minProbNo <= stopLoss) {
            hitStopLoss = true;
            stopLossMinute = m;
            exitPrice = stopLoss;
            exitReason = 'STOP_LOSS';
            break;
          }
        }
      }
      
      const lastCandle = cycleKlines[cycleKlines.length - 1];
      const Sfinal = lastCandle.close;
      
      if (!hitStopLoss) {
        // Trade reached expiration (minute 15)
        exitReason = 'EXPIRATION';
        if (tradeType === 'YES') {
          exitPrice = Sfinal > S0 ? 1.0 : 0.0;
        } else {
          exitPrice = Sfinal <= S0 ? 1.0 : 0.0;
        }
      }
      
      const profitLoss = exitPrice - entryPrice;
      const pctReturn = (profitLoss / entryPrice) * 100;
      
      trades.push({
        cycleStart: new Date(startTime),
        tradeType,
        S0,
        Swait,
        Sfinal,
        entryPrice,
        exitPrice,
        profitLoss,
        pctReturn,
        exitReason,
        stopLossMinute: hitStopLoss ? stopLossMinute : null
      });
    }
  });
  
  // Calculate aggregate performance
  let wins = 0;
  let losses = 0;
  let totalProfitLoss = 0;
  let totalPctReturn = 0;
  let stopLossHits = 0;
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  let peakCapital = 1000; // Assume starting capital of 1000 units
  let capital = 1000;
  const capitalCurve = [1000];
  
  trades.forEach(t => {
    // Simulate trade sizing (risk 100 units per trade, or reinvest capital)
    // Let's assume a simple fixed sizing: risk 10% of current capital on each trade
    const positionSize = capital * 0.10;
    const units = positionSize / t.entryPrice;
    const tradeResult = (t.exitPrice - t.entryPrice) * units;
    capital += tradeResult;
    capitalCurve.push(capital);
    
    if (capital > peakCapital) {
      peakCapital = capital;
    }
    const dd = ((peakCapital - capital) / peakCapital) * 100;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
    
    if (t.profitLoss > 0) {
      wins++;
    } else {
      losses++;
      if (t.exitReason === 'STOP_LOSS') {
        stopLossHits++;
      }
    }
    totalProfitLoss += t.profitLoss;
    totalPctReturn += t.pctReturn;
  });
  
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgReturn = totalTrades > 0 ? totalPctReturn / totalTrades : 0;
  
  return {
    volDaily,
    totalCycles,
    totalTrades,
    wins,
    losses,
    stopLossHits,
    winRate,
    avgReturn,
    totalProfitLoss,
    maxDrawdown,
    finalCapital: capital,
    initialCapital: 1000,
    capitalCurve,
    trades
  };
}
