import readline from 'readline';
import chalk from 'chalk';
import axios from 'axios';
import {
  fetchHistoricalData,
  runBacktest,
  calculateProbability,
  calculateHistoricalVolatility
} from './strategy.js';
import {
  isGeminiConfigured,
  askGemini
} from './gemini.js';

// Default configuration parameters
let config = {
  cycleDuration: 15,    // total duration in minutes
  waitDuration: 12,     // wait period in minutes before entry checks
  entryWindow: 3,       // entry window in minutes
  entryThreshold: 0.95, // contract probability threshold for entry (> 0.95)
  stopLoss: 0.75,       // contract stop loss threshold (< 0.75)
  volDaily: 0.025       // default daily volatility (2.5%) for BTC
};

// Global State
let customVolUsed = false;
let latestBacktestResults = null;
let targetStrikePrice = null; // target strike price override ($S_0)

// Readline interface for CLI interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('SIGINT', () => {
  console.log(chalk.cyan('\n👋 Thank you for using CoinBot! Good luck with your trading!'));
  process.exit(0);
});

// Helper: draw a box around text with a custom title and border color
function boxText(title, text, colorFn = chalk.cyan, width = 76) {
  const borderChar = {
    tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│'
  };
  
  const formattedTitle = title ? ` ${title} ` : '';
  const titleLen = title ? title.length + 2 : 0;
  
  let header = borderChar.tl + colorFn(formattedTitle) + borderChar.h.repeat(Math.max(0, width - titleLen - 2)) + borderChar.tr;
  let footer = borderChar.bl + borderChar.h.repeat(width - 2) + borderChar.br;
  
  console.log(colorFn(header));
  
  const lines = text.split('\n');
  lines.forEach(line => {
    // Strip ANSI escape codes to calculate length accurately
    const cleanLine = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const padding = Math.max(0, width - cleanLine.length - 4);
    console.log(colorFn(borderChar.v) + ' ' + line + ' '.repeat(padding) + ' ' + colorFn(borderChar.v));
  });
  
  console.log(colorFn(footer));
}

// Helper: draw a table
function drawTable(title, headers, rows, colorFn = chalk.yellow) {
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    rows.forEach(r => {
      const valStr = String(r[i]).replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      if (valStr.length > max) max = valStr.length;
    });
    return max + 2;
  });

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + colWidths.length + 1;
  let separator = '+' + colWidths.map(w => '-'.repeat(w)).join('+') + '+';
  
  if (title) {
    console.log(chalk.bold(colorFn(`\n=== ${title} ===`)));
  }
  console.log(colorFn(separator));
  
  const headerStr = '|' + headers.map((h, i) => {
    const pad = colWidths[i] - h.length;
    return ' ' + chalk.bold(h) + ' '.repeat(pad - 1);
  }).join('|') + '|';
  console.log(headerStr);
  console.log(colorFn(separator));
  
  rows.forEach(r => {
    const rowStr = '|' + r.map((val, i) => {
      const valStr = String(val);
      const cleanVal = valStr.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      const pad = colWidths[i] - cleanVal.length;
      return ' ' + valStr + ' '.repeat(pad - 1);
    }).join('|') + '|';
    console.log(rowStr);
  });
  
  console.log(colorFn(separator));
}

// Helper: draw progress bar
function getProgressBar(value, max, size = 20) {
  const percentage = Math.min(1, Math.max(0, value / max));
  const progress = Math.round(size * percentage);
  const emptyProgress = size - progress;
  return `[${chalk.green('█'.repeat(progress))}${chalk.gray('░'.repeat(emptyProgress))}] ${Math.round(percentage * 100)}%`;
}

// Welcome banner
function printWelcomeBanner() {
  console.log(chalk.cyan(`
╔════════════════════════════════════════════════════════════════════╗
║  ██████╗ ██████╗ ██╗███╗   ██╗██████╗  ██████╗ ████████╗           ║
║ ██╔════╝██╔═══██╗██║████╗  ██║██╔══██╗██╔═══██╗╚══██╔══╝           ║
║ ██║     ██║   ██║██║██╔██╗ ██║██████╔╝██║   ██║   ██║              ║
║ ██║     ██║   ██║██║██║╚██╗██║██╔══██╗██║   ██║   ██║              ║
║ ╚██████╗╚██████╔╝██║██║ ╚████║██████╔╝╚██████╔╝   ██║              ║
║  ╚═════╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝    ╚═╝              ║
║                                                                    ║
║    BTC 15-Min Prediction Market Trading Strategy Assistant         ║
╚════════════════════════════════════════════════════════════════════╝`));
  
  console.log(`     ${chalk.green("● BINANCE SPOT API CONNECTED")} | Mode: Live Ticker & Historical Data`);
  
  const geminiConfig = isGeminiConfigured();
  if (geminiConfig) {
    console.log(`     ${chalk.green("● GEMINI AI CHATBOT ACTIVE")}   | Mode: Intelligent NL Agent (gemini-2.5-flash)`);
  } else {
    console.log(`     ${chalk.yellow("○ LOCAL CHATBOT ACTIVE")}       (No GEMINI_API_KEY found. Add to .env for AI brain)`);
  }
  
  if (targetStrikePrice !== null) {
    console.log(`     ${chalk.green("🎯 ACTIVE TARGET STRIKE:")} ${chalk.bold.yellow('$' + targetStrikePrice.toFixed(2))}`);
  } else {
    console.log(`     ${chalk.gray("🎯 NO STRIKE OVERRIDE BOUND (Will align to cycle start spot price)")}`);
  }
  
  console.log(chalk.gray(`     Type ${chalk.yellow('/help')} to see available commands.`));
  console.log('');
}

// Help response
function showHelp() {
  const text = `I can help you explore and execute the 15-Minute BTC Binary Strategy.
Here are the commands you can use directly:

  ${chalk.yellow('/strategy')}         - Explain the strategy rules and math.
  ${chalk.yellow('/backtest [days]')}  - Run a backtest using Binance historical data.
  ${chalk.yellow('/target [price]')}   - Bind a custom target strike price (e.g. 68000) or check target.
  ${chalk.yellow('/clear')}            - Clear custom strike override (defaults to cycle start price).
  ${chalk.yellow('/live')}             - Start real-time paper trading monitor using Binance feed.
  ${chalk.yellow('/config')}           - View or modify parameters (thresholds, timings).
  ${chalk.yellow('/stats')}            - Show results of the last completed backtest.
  ${chalk.yellow('/risks')}            - Learn about risks associated with this strategy.
  ${chalk.yellow('/status')}           - Check Gemini configuration status.
  ${chalk.yellow('/exit')}             - Quit the chatbot session.

Or ask me a question:
  • "Why do we wait 12 minutes?"
  • "How does stop loss protect us at 0.75?"
  • "Explain the Black-Scholes probability model."`;
  
  boxText("COINBOT COMMAND MENU", text, chalk.cyan);
}


// Strategy explanation
function showStrategy() {
  const text = `${chalk.bold.yellow("Core Concept:")}
This is a binary outcome (YES/NO) yield-harvesting strategy designed for
15-minute Bitcoin prediction markets. The market resolves based on whether
BTC price at expiration is higher than the open price ($S_0$) of that cycle.

${chalk.bold.yellow("Rules:")}
1. ${chalk.bold("12-Minute Wait:")} Wait for the first 12 minutes of the 15-min cycle.
   This filters out early noise and let a dominant trend establish.
2. ${chalk.bold("3-Minute Entry Window:")} From minute 12 to 15, evaluate the trade.
3. ${chalk.bold("High Probability Entry (>0.95):")}
   • Calculate probability of YES contract settling at $1.00 ($P_{YES}$).
   • If $P_{YES} > 0.95$, buy YES (we pay $0.95 to $0.98, aiming to collect $1.00).
   • If $P_{NO} = (1 - P_{YES}) > 0.95$, buy NO (we pay $0.95 to $0.98).
   • If neither is >0.95, skip the cycle. No entry is taken.
4. ${chalk.bold("Stop Loss (0.75):")}
   • Once in a trade, monitor the contract price.
   • If the contract price dips to $0.75 or below, exit immediately.
   • This caps our loss at around $0.20 to $0.23 per share.

${chalk.bold.yellow("Contract Pricing Mathematics:")}
We estimate the YES contract price (implied probability) using the Black-Scholes
Geometric Brownian Motion (GBM) model:
   ${chalk.cyan("P_YES = Φ( ln(S_t / S_0) / (σ * √Δt) )")}
Where:
   • ${chalk.cyan("S_0")}   = Open price of the 15-minute cycle (or strike price).
   • ${chalk.cyan("S_t")}   = Current price of BTC at elapsed minute t.
   • ${chalk.cyan("Δt")}    = Remaining time in days (15 - t) / 1440.
   • ${chalk.cyan("σ")}     = Daily historical volatility of BTC.
   • ${chalk.cyan("Φ(z)")}  = Standard Normal Cumulative Distribution Function.`;
  
  boxText("STRATEGY PLAYBOOK & MATHEMATICS", text, chalk.cyan);
}

// Risks explanation
function showRisks() {
  const text = `While high-probability strategies (like entering at >0.95) yield consistent
wins, they carry unique high-impact risks that you must understand:

1. ${chalk.bold.red("Fat-Tail & Expiration Risk (The Gap down):")}
   At minute 14:59, the contract could be trading at 0.98. In the last 2 seconds,
   a sudden spot crash can send the price below $S_0$, resolving the contract
   to 0.00. Because this happens in milliseconds, your 0.75 stop-loss will
   not fill. You lose 100% of the entry ($0.96+), wiping out ~24 successful trades.

2. ${chalk.bold.red("Slippage and Liquidity:")}
   Polymarket uses order books. During fast moves, there may be no bids at
   0.75 to fill your stop loss. You might get filled at 0.50 or not at all.

3. ${chalk.bold.red("Taker Fees:")}
   Polymarket charges variable taker fees (up to 3%) on ultra-short crypto
   markets. If you pay 2% fees on entry and exit, it can completely erase
   your 2% to 4% profit margin.

4. ${chalk.bold.red("Execution Latency:")}
   By the time your bot detects $P > 0.95$ and sends an order, other bots have
   already front-run the trade, driving the contract price above $0.98 or
   exhausting liquidity.`;
  
  boxText("STRATEGY RISK ASSESSMENT", text, chalk.red);
}

// View and change configuration
function viewConfig() {
  const text = `Current strategy parameters:
  
  1. Cycle Duration:    ${chalk.yellow(config.cycleDuration + ' mins')} (Default: 15)
  2. Wait Duration:     ${chalk.yellow(config.waitDuration + ' mins')} (Default: 12)
  3. Entry Window:      ${chalk.yellow(config.entryWindow + ' mins')} (Default: 3)
  4. Entry Threshold:   ${chalk.yellow(config.entryThreshold)} (Default: 0.95)
  5. Stop Loss Limit:   ${chalk.yellow(config.stopLoss)} (Default: 0.75)
  6. Daily Volatility:  ${chalk.yellow(customVolUsed ? config.volDaily + ' (Custom)' : config.volDaily + ' (Auto-Calculated)')}

To modify any parameter, type: ${chalk.yellow('set <number> <value>')}
Example: ${chalk.yellow('set 5 0.80')} (changes Stop Loss to 0.80)
Example: ${chalk.yellow('set 6 0.03')} (forces Daily Volatility to 3.0%)`;
  
  boxText("STRATEGY PARAMETERS", text, chalk.magenta);
}

// Set parameter
function handleSetConfig(args) {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    console.log(chalk.red("❌ Invalid command format. Use: set <param_num> <value>"));
    return;
  }
  
  const num = parseInt(parts[0]);
  const val = parseFloat(parts[1]);
  
  if (isNaN(num) || isNaN(val)) {
    console.log(chalk.red("❌ Parameter index and value must be numbers."));
    return;
  }
  
  switch(num) {
    case 1:
      config.cycleDuration = val;
      console.log(chalk.green(`✓ Cycle Duration set to ${val} minutes.`));
      break;
    case 2:
      config.waitDuration = val;
      console.log(chalk.green(`✓ Wait Duration set to ${val} minutes.`));
      config.entryWindow = config.cycleDuration - val;
      break;
    case 3:
      config.entryWindow = val;
      console.log(chalk.green(`✓ Entry Window set to ${val} minutes.`));
      config.waitDuration = config.cycleDuration - val;
      break;
    case 4:
      if (val <= 0.5 || val >= 1.0) {
        console.log(chalk.red("❌ Entry threshold must be between 0.50 and 1.00 (e.g. 0.95)"));
        return;
      }
      config.entryThreshold = val;
      console.log(chalk.green(`✓ Entry Threshold set to ${val}.`));
      break;
    case 5:
      if (val <= 0.0 || val >= config.entryThreshold) {
        console.log(chalk.red(`❌ Stop loss must be between 0.00 and ${config.entryThreshold} (Entry Threshold)`));
        return;
      }
      config.stopLoss = val;
      console.log(chalk.green(`✓ Stop Loss set to ${val}.`));
      break;
    case 6:
      config.volDaily = val;
      customVolUsed = true;
      console.log(chalk.green(`✓ Daily Volatility overridden to ${val} (${(val * 100).toFixed(2)}%).`));
      break;
    default:
      console.log(chalk.red("❌ Parameter index not found (choose 1-6)."));
  }
}

// API status
function showStatus() {
  const text = `Binance Connection Status:
  • API Endpoint:   https://api.binance.com (CONNECTED)
  • Target Feed:    BTCUSDT Real-time Tick
  
  Google Gemini Chatbot AI Status:
  • Gemini API Configured:   ${isGeminiConfigured() ? chalk.green("YES") : chalk.red("NO")}
  • API Key Hooked:          ${process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('change_me') ? chalk.green("Loaded") : chalk.red("Missing")}
  
  Active Strategy Config:
  • Target Strike Override:  ${targetStrikePrice !== null ? chalk.green('$' + targetStrikePrice.toFixed(2)) : chalk.yellow("None (defaults to cycle start price)")}
  • Cycle Duration:          ${chalk.cyan(config.cycleDuration + ' minutes')}
  • Entry Window Open Time:  ${chalk.cyan(config.waitDuration + ' minutes')}
  • Entry Threshold:         ${chalk.cyan(config.entryThreshold)}`;
  
  boxText("SYSTEM & CONNECTION STATUS", text, chalk.cyan);
}

// Target a custom strike price
function handleTarget(priceArg) {
  if (!priceArg) {
    if (targetStrikePrice !== null) {
      console.log(chalk.green(`🎯 Current target strike price override: $${targetStrikePrice.toFixed(2)}`));
    } else {
      console.log(chalk.yellow(`🎯 No strike override bound. It will default to the price at the beginning of each 15-minute cycle (S0).`));
    }
    return;
  }
  
  const val = parseFloat(priceArg);
  if (isNaN(val) || val <= 0) {
    console.log(chalk.red("❌ Invalid strike price. Please provide a valid positive number."));
    return;
  }
  
  targetStrikePrice = val;
  console.log(chalk.green(`🎯 Target strike price override bound successfully to $${targetStrikePrice.toFixed(2)}!`));
  console.log(chalk.gray("This price will be used as S0 in the probability calculations instead of the cycle start price."));
}

// Clear custom strike target
function handleClearTarget() {
  targetStrikePrice = null;
  console.log(chalk.green("✓ Custom strike price override cleared. Aligning to cycle start price."));
}


// Run backtest flow
async function handleBacktest(daysArg) {
  let days = 3;
  if (daysArg) {
    const val = parseInt(daysArg);
    if (!isNaN(val) && val > 0 && val <= 30) {
      days = val;
    } else {
      console.log(chalk.yellow(`⚠️ Invalid days: "${daysArg}". Using default of 3 days.`));
    }
  }
  
  console.log(chalk.cyan(`\n⚡ Initializing historical backtest for last ${days} days of BTCUSDT...`));
  console.log(chalk.gray(`   (Checking cache or downloading 1-minute klines from Binance...)`));
  
  let i = 0;
  const chars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const spinnerInterval = setInterval(() => {
    process.stdout.write(`\r${chalk.yellow(chars[i++ % chars.length])} Fetching data...`);
  }, 80);
  
  try {
    const rawKlines = await fetchHistoricalData('BTCUSDT', days);
    clearInterval(spinnerInterval);
    process.stdout.write(`\r`); // clear spinner line
    
    console.log(chalk.green(`✓ Successfully loaded ${rawKlines.length} 1-minute candles.`));
    
    // Apply automatic volatility if not customized
    if (!customVolUsed) {
      config.volDaily = calculateHistoricalVolatility(rawKlines);
    }
    
    const results = runBacktest(rawKlines, config);
    latestBacktestResults = results;
    
    displayBacktestResults(days, results);
  } catch (error) {
    clearInterval(spinnerInterval);
    process.stdout.write(`\r`);
    console.log(chalk.red(`❌ Backtest failed: ${error.message}`));
  }
}

// Draw beautiful ASCII chart of virtual account capital over time
function drawEquityChart(capitalCurve, width = 55, height = 8) {
  if (!capitalCurve || capitalCurve.length < 2) return;
  
  // Downsample capitalCurve to fit the chart width
  const data = [];
  const step = (capitalCurve.length - 1) / (width - 1 || 1);
  for (let i = 0; i < width; i++) {
    const idx = Math.min(Math.round(i * step), capitalCurve.length - 1);
    data.push(capitalCurve[idx]);
  }
  
  let maxVal = Math.max(...data);
  let minVal = Math.min(...data);
  
  let range = maxVal - minVal;
  if (range === 0) {
    maxVal += 10;
    minVal -= 10;
    range = 20;
  } else {
    // Add small buffer to top and bottom
    maxVal += range * 0.05;
    minVal -= range * 0.05;
    range = maxVal - minVal;
  }
  
  // Initialize grid
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));
  
  // Plot points on the grid
  for (let c = 0; c < width; c++) {
    const val = data[c];
    const r = Math.round(((maxVal - val) / range) * (height - 1));
    const safeR = Math.max(0, Math.min(height - 1, r));
    grid[safeR][c] = '●';
  }
  
  console.log(chalk.bold.cyan("\n📈 VIRTUAL ACCOUNT BALANCE CURVE (EQUITY CURVE)"));
  console.log(chalk.cyan("  " + "─".repeat(width + 13)));
  
  const initialCap = capitalCurve[0];
  const finalCap = capitalCurve[capitalCurve.length - 1];
  const colorFn = finalCap >= initialCap ? chalk.green : chalk.red;
  
  for (let r = 0; r < height; r++) {
    const rowVal = maxVal - (r / (height - 1)) * range;
    const label = `$${rowVal.toFixed(2)}`;
    const paddedLabel = label.padStart(10);
    
    let line = chalk.gray(paddedLabel + " ┤ ");
    for (let c = 0; c < width; c++) {
      const char = grid[r][c];
      if (char === '●') {
        line += colorFn(char);
      } else {
        line += chalk.gray('·'); // subtle grid background dots
      }
    }
    console.log(line);
  }
  console.log(chalk.cyan("  " + "─".repeat(width + 13)));
  console.log(chalk.gray(`  Start: Trade 0 (Initial: $${initialCap.toFixed(0)})`.padEnd(Math.floor((width + 13)/2)) + `End: Trade ${capitalCurve.length - 1} (Final: $${finalCap.toFixed(2)})`.padStart(Math.ceil((width + 13)/2))));
}

// Print backtest results
function displayBacktestResults(days, res) {
  const text = `Simulation over the last ${chalk.bold(days + ' days')} using BTC 1-minute candles.
Daily Volatility calculated: ${chalk.yellow((res.volDaily * 100).toFixed(3) + '%')}
Total 15-Minute clock cycles: ${chalk.bold(res.totalCycles)}`;
  
  boxText("HISTORICAL BACKTEST SETTINGS", text, chalk.green);

  const statsRows = [
    ["Total Trades Executed", chalk.bold(res.totalTrades), "Trades triggered based on entry rules"],
    ["Wins (Expired Profit)", chalk.green(res.wins), `Settled at 1.00`],
    ["Losses (Expired/Stopped)", chalk.red(res.losses), `Trades that ended in loss`],
    ["• Stop Loss Exits", chalk.red(res.stopLossHits), `Triggered when contract price hit <= ${config.stopLoss}`],
    ["• Expiration Losses", chalk.red(res.losses - res.stopLossHits), `Failed at expiration (0.00) without hitting SL`],
    ["Win Rate", chalk.bold.green(res.winRate.toFixed(2) + '%'), "Percentage of winning trades"],
    ["Average PnL per Trade", res.avgReturn >= 0 ? chalk.green('+' + res.avgReturn.toFixed(2) + '%') : chalk.red(res.avgReturn.toFixed(2) + '%'), "Average percentage profit/loss per trade"],
    ["Final Virtual Account Value", chalk.bold.green('$' + res.finalCapital.toFixed(2)), `Starting Capital: $1,000 (Sizing: 10% of balance/trade)`],
    ["Maximum Balance Drawdown", chalk.red(res.maxDrawdown.toFixed(2) + '%'), "Peak-to-trough account drawdown percentage"]
  ];
  
  drawTable("STRATEGY PERFORMANCE METRICS", ["Metric", "Value", "Description"], statsRows, chalk.green);
  
  if (res.trades.length > 0) {
    drawEquityChart(res.capitalCurve);
  
    const sampleSize = Math.min(5, res.trades.length);
    console.log(chalk.bold.yellow(`\nLast ${sampleSize} Trades executed:`));
    const tradeRows = res.trades.slice(-sampleSize).map(t => {
      const typeStr = t.tradeType === 'YES' ? chalk.green('YES') : chalk.red('NO');
      const timeStr = t.cycleStart.toISOString().replace('T', ' ').substring(0, 19);
      const resStr = t.profitLoss > 0 
        ? chalk.green('WIN (+' + (t.profitLoss * 100).toFixed(1) + '%)') 
        : chalk.red('LOSS (' + (t.profitLoss * 100).toFixed(1) + '%)');
      const reasonStr = t.exitReason === 'STOP_LOSS' ? chalk.red(`STOP LOSS @ min ${t.stopLossMinute}`) : chalk.cyan('EXPIRATION');
      
      return [
        timeStr,
        typeStr,
        `$${t.S0.toFixed(1)}`,
        `$${t.Swait.toFixed(1)}`,
        `$${t.Sfinal.toFixed(1)}`,
        t.entryPrice.toFixed(3),
        t.exitPrice.toFixed(3),
        resStr,
        reasonStr
      ];
    });
    
    drawTable(
      null, 
      ["Time", "Type", "S0 (Start)", "S12 (Entry)", "S15 (End)", "Entry Px", "Exit Px", "Outcome", "Exit Reason"], 
      tradeRows, 
      chalk.gray
    );
  } else {
    console.log(chalk.yellow("\n⚠️ No trades were executed in the test period. The threshold (> 0.95) was never met."));
    console.log(chalk.gray("Try lowering the entry threshold (e.g. set 4 0.90) or increasing volatility."));
  }
}

// Live Paper Trading Simulation Monitor
function startLiveMonitor() {
  rl.pause();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  
  console.clear();
  console.log(chalk.bold.cyan("===================================================================="));
  console.log(chalk.bold.cyan("              LIVE PREDICTION MARKET STRATEGY MONITOR               "));
  console.log(chalk.bold.cyan("===================================================================="));
  console.log(`  Target Feed:    BTCUSDT Real-time Tick (Binance Public API)`);
  if (targetStrikePrice !== null) {
    console.log(chalk.green(`  🎯 Bound Custom Strike: $${targetStrikePrice.toFixed(2)}`));
  } else {
    console.log(chalk.gray("  🎯 Bound Custom Strike: None (Simulating cycle start price)"));
  }
  console.log(chalk.yellow("  Press 'C' at any time to quit the live feed and return to chat."));
  console.log(chalk.bold.cyan("====================================================================\n"));
  
  let currentCycleStart = null;
  let S0 = null;
  let activePosition = null; // { type, entryPrice, stopLossHit, resolved }
  let logMessage = "Connecting to feed...";
  
  // Set up stdin key handler
  const keyHandler = (key) => {
    const char = key.toString();
    if (char === 'c' || char === 'C') {
      clearInterval(intervalId);
      process.stdin.removeListener('data', keyHandler);
      process.stdin.setRawMode(false);
      rl.resume();
      console.clear();
      printWelcomeBanner();
      promptUser();
    } else if (char === '\u0003') { // Ctrl+C
      clearInterval(intervalId);
      process.stdin.removeListener('data', keyHandler);
      process.stdin.setRawMode(false);
      console.log(chalk.cyan('\n👋 Thank you for using CoinBot! Good luck with your trading!'));
      process.exit(0);
    }
  };
  
  process.stdin.on('data', keyHandler);
  
  // Main monitor loop function (runs every 4 seconds)
  async function tick() {
    try {
      // 1. Fetch live BTC spot price from Binance
      const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
        params: { symbol: 'BTCUSDT' }
      });
      const btcPrice = parseFloat(response.data.price);
      
      const now = new Date();
      
      // Calculate clock cycle timings (aligned to config.cycleDuration)
      const currentCycleMinuteFloor = Math.floor(now.getMinutes() / config.cycleDuration) * config.cycleDuration;
      const elapsedSeconds = (now.getMinutes() - currentCycleMinuteFloor) * 60 + now.getSeconds();
      const elapsedMinutes = elapsedSeconds / 60;
      const remainingSeconds = (config.cycleDuration * 60) - elapsedSeconds;
      
      // Check for cycle boundary / reset S0
      const cycleId = `${now.getHours()}:${currentCycleMinuteFloor}`;
      if (currentCycleStart !== cycleId) {
        currentCycleStart = cycleId;
        
        // S0 is either the targeted custom strike price or cycle start spot price
        if (targetStrikePrice !== null) {
          S0 = targetStrikePrice;
          logMessage = `Active cycle reset. Using targeted custom strike $${S0.toFixed(2)} as baseline.`;
        } else {
          S0 = btcPrice;
          logMessage = `Active cycle reset. Using current BTC spot $${S0.toFixed(2)} as baseline.`;
        }
        
        activePosition = null; // reset position
        console.clear();
      }
      
      // 2. Fetch contract prices (Model)
      const modelYes = calculateProbability(S0, btcPrice, elapsedMinutes, config.cycleDuration, config.volDaily);
      const modelNo = 1.0 - modelYes;
      
      // Use model prices for simulated paper execution
      const currentYesVal = modelYes;
      const currentNoVal = modelNo;
      
      // 3. Evaluate Strategy
      if (elapsedMinutes >= config.waitDuration) {
        // Inside the entry window
        if (!activePosition) {
          // Check for entry
          let entered = false;
          let entryType = null;
          let entryPriceVal = 0;
          
          if (currentYesVal >= config.entryThreshold) {
            entered = true;
            entryType = 'YES';
            entryPriceVal = currentYesVal;
          } else if (currentNoVal >= config.entryThreshold) {
            entered = true;
            entryType = 'NO';
            entryPriceVal = currentNoVal;
          }
          
          if (entered) {
            logMessage = `Evaluating entry conditions. Found model probability > ${config.entryThreshold}...`;
            
            activePosition = {
              type: entryType,
              entryPrice: entryPriceVal,
              stopLossHit: false,
              placed: true
            };
            
            logMessage = chalk.green(`🚀 PAPER TRADE: Entered ${entryType} position at $${entryPriceVal.toFixed(3)}`);
          } else {
            logMessage = chalk.yellow(`⚡ Monitoring entry window. Model Prices: YES: ${currentYesVal.toFixed(3)} | NO: ${currentNoVal.toFixed(3)}`);
          }
        } else {
          // Monitor Stop Loss on active position
          if (!activePosition.stopLossHit && !activePosition.resolved) {
            const currentPositionVal = activePosition.type === 'YES' ? currentYesVal : currentNoVal;
            if (currentPositionVal <= config.stopLoss) {
              activePosition.stopLossHit = true;
              activePosition.exitPrice = config.stopLoss;
              activePosition.exitTime = now.toLocaleTimeString();
              logMessage = chalk.red(`🚨 PAPER STOP LOSS TRIGGERED: Position exited at $${config.stopLoss}`);
            } else {
              logMessage = chalk.green(`📈 HOLDING ${activePosition.type} (Entry: $${activePosition.entryPrice.toFixed(3)} | Current: $${currentPositionVal.toFixed(3)})`);
            }
          }
        }
      } else {
        logMessage = chalk.gray(`Status: Waiting for entry window (Elapsed: ${Math.floor(elapsedMinutes)}m, Entry starts at: ${config.waitDuration}m)`);
      }
      
      // Expiration check (last few seconds of cycle)
      if (remainingSeconds < 5 && activePosition && !activePosition.stopLossHit && !activePosition.resolved) {
        activePosition.resolved = true;
        const won = activePosition.type === 'YES' ? (btcPrice > S0) : (btcPrice <= S0);
        activePosition.exitPrice = won ? 1.0 : 0.0;
        
        if (won) {
          logMessage = chalk.bold.green(`🏆 WIN! Simulated contract settled at 1.00. Profit: +$${(1.0 - activePosition.entryPrice).toFixed(3)} per share.`);
        } else {
          logMessage = chalk.bold.red(`💥 LOSS! Simulated contract settled at 0.00. Loss: -$${activePosition.entryPrice.toFixed(3)} per share.`);
        }
      }
      
      // Draw dashboard in-place
      process.stdout.write('\x1b[H');
      console.log(chalk.bold.cyan("===================================================================="));
      console.log(chalk.bold.cyan("              LIVE PREDICTION MARKET STRATEGY MONITOR               "));
      console.log(chalk.bold.cyan("===================================================================="));
      console.log(`  Local Time:      ${chalk.bold(now.toLocaleTimeString())}      |  Target Asset: ${chalk.bold.yellow("BTCUSDT")}`);
      console.log(`  Cycle Range:     ${chalk.bold(cycleId)} - ${now.getHours()}:${currentCycleMinuteFloor + config.cycleDuration} |  Time Remaining: ${chalk.bold(Math.floor(remainingSeconds / 60) + 'm ' + (remainingSeconds % 60) + 's')}`);
      console.log(`  Cycle Progress:  ${getProgressBar(elapsedSeconds, config.cycleDuration * 60, 30)}`);
      console.log(chalk.bold.cyan("--------------------------------------------------------------------"));
      console.log(`  Cycle Baseline (S0):   ${chalk.yellow('$' + S0.toFixed(2))}`);
      console.log(`  Current Price (St):    ${chalk.bold.yellow('$' + btcPrice.toFixed(2))} (${btcPrice >= S0 ? chalk.green('+' + (Math.log(btcPrice/S0)*100).toFixed(3) + '%') : chalk.red((Math.log(btcPrice/S0)*100).toFixed(3) + '%')})`);
      console.log(`  Volatility (Daily σ):  ${chalk.cyan((config.volDaily * 100).toFixed(3) + '%')}`);
      console.log(chalk.bold.cyan("--------------------------------------------------------------------"));
      
      console.log(`  Simulated Contract Values (Geometric Brownian Motion Model):`);
      console.log(`   • YES Price (S_t > S_0):  ${chalk.bold.green('$' + modelYes.toFixed(4))}`);
      console.log(`   • NO  Price (S_t <= S_0): ${chalk.bold.red('$' + modelNo.toFixed(4))}`);
      console.log(chalk.bold.cyan("--------------------------------------------------------------------"));
      
      // Display position status
      if (activePosition) {
        const curPx = activePosition.type === 'YES' ? currentYesVal : currentNoVal;
        const pnl = activePosition.stopLossHit 
          ? (0.75 - activePosition.entryPrice) 
          : (activePosition.resolved ? (activePosition.exitPrice - activePosition.entryPrice) : (curPx - activePosition.entryPrice));
        const pnlText = pnl >= 0 ? chalk.green('+$' + pnl.toFixed(3)) : chalk.red('-$' + Math.abs(pnl).toFixed(3));
        
        console.log(chalk.bold("  [ACTIVE SIMULATED POSITION]"));
        console.log(`  Position Type:     ${activePosition.type === 'YES' ? chalk.bold.green('YES') : chalk.bold.red('NO')}`);
        console.log(`  Entry Price:       $${activePosition.entryPrice.toFixed(3)}`);
        console.log(`  Current Value:     $${(activePosition.stopLossHit ? 0.75 : (activePosition.resolved ? activePosition.exitPrice : curPx)).toFixed(3)}`);
        console.log(`  Stop Loss Level:   $${config.stopLoss.toFixed(2)}`);
        console.log(`  Net Trade PnL:     ${pnlText} per share`);
        console.log(`  Position Status:   ${activePosition.stopLossHit ? chalk.bold.red('STOPPED OUT') : (activePosition.resolved ? chalk.bold.green('RESOLVED') : chalk.bold.yellow('OPEN'))}`);
      } else {
        console.log(chalk.gray("  [NO ACTIVE POSITION] Scanning for simulated entry signal..."));
      }
      
      console.log(chalk.bold.cyan("--------------------------------------------------------------------"));
      console.log("  " + logMessage);
      console.log(chalk.bold.cyan("===================================================================="));
      console.log(chalk.gray("  Press 'C' to quit live simulation and return to chatbot chat mode."));
      
    } catch (e) {
      console.log(chalk.red(`Error in live monitor tick: ${e.message}`));
    }
  }
  
  tick();
  const intervalId = setInterval(tick, 4000);
}

// Conversation Natural Language Interface Parser
async function getBotResponse(input) {
  const query = input.toLowerCase().trim();
  
  // 1. Strict Slash Command Checks
  if (query === '/help' || query === '/h') {
    showHelp();
    return null;
  }
  if (query === '/strategy') {
    showStrategy();
    return null;
  }
  if (query === '/risks') {
    showRisks();
    return null;
  }
  if (query === '/config') {
    viewConfig();
    return null;
  }
  if (query === '/stats') {
    if (latestBacktestResults) {
      displayBacktestResults(3, latestBacktestResults);
    } else {
      return `No backtest has been run in this session yet. Type ${chalk.yellow('/backtest')} to run one.`;
    }
    return null;
  }
  if (query === '/status') {
    showStatus();
    return null;
  }

  // 2. Google Gemini AI dynamic response (if configured)
  if (isGeminiConfigured()) {
    try {
      process.stdout.write(chalk.gray('🤖 Thinking...'));
      const response = await askGemini(input);
      // Clear the "Thinking..." indicator line
      process.stdout.write('\r\x1b[K');
      return response;
    } catch (e) {
      process.stdout.write('\r\x1b[K');
      console.log(chalk.red(`⚠️ Gemini AI Error: ${e.message}. Falling back to offline local engine.`));
    }
  }

  // 3. Offline Keyword Fallbacks (only processed if Gemini is not configured/failed)
  if (/\b(strategy|rules|work|logic|explain|playbook|formula|minutes|windows)\b/.test(query)) {
    showStrategy();
    return null;
  }
  
  if (/\b(risk|risks|danger|dangers|lose|liquid|slippage|fee|fees|drawdown)\b/.test(query)) {
    showRisks();
    return null;
  }
  
  if (/\b(config|settings|parameters|threshold|thresholds)\b/.test(query)) {
    viewConfig();
    return null;
  }
  
  if (/\b(status|connection|credentials|keys|api)\b/.test(query)) {
    showStatus();
    return null;
  }

  if (/\b(hello|hi|hey|greetings|yo|sup)\b/.test(query)) {
    return `Hello! I am CoinBot, your BTC 15-Minute prediction market trading strategy assistant. How can I help you today? Try typing ${chalk.yellow('/help')} to see what I can do!`;
  }
  
  if (/\b(why|reason|waiting|wait)\b/.test(query) && /\b(12|twelve|wait)\b/.test(query)) {
    return `${chalk.bold.yellow("Why wait 12 minutes?")}
In ultra-short 15-minute prediction markets, the first 8 to 12 minutes are dominated by high volatility and market noise. 
By waiting until the 12th minute, we allow the market to establish a strong, directional momentum. We then buy contracts in the direction of this momentum in the final 3 minutes when the probability of reversal is mathematically lower.`;
  }
  
  if (/\b(stop loss|sl|protect|0.75)\b/.test(query)) {
    return `${chalk.bold.yellow("Stop Loss Protection (0.75):")}
When we buy a high-probability contract (e.g. at a price above $0.95), we are risking up to $0.95+ to make a small $0.05 yield. This is an asymmetric risk profile.
By adding a stop loss at ${chalk.yellow("0.75")}, we automatically sell the contract if the price drops to 0.75 (meaning BTC moves against us and the probability drops to 75%).
This limits our loss to a maximum of ~0.20-0.23, preventing a single bad trade from wiping out dozens of winning trades.`;
  }
  
  if (/\b(probability|math|model|formulas|black-scholes|calculating|distribution|gbm)\b/.test(query)) {
    return `${chalk.bold.yellow("Contract Pricing Math:")}
The contract price represents the market's expectation of the outcome.
Using a ${chalk.bold("Geometric Brownian Motion (GBM)")} model, we assume BTC price follows a log-normal distribution.
The probability that BTC closes above the baseline price $S_0$ at expiration ($T=15$ mins) given the price $S_t$ at elapsed minute $t$ is calculated using the Standard Normal CDF ($\Phi$):

  ${chalk.cyan("P(S_T > S_0) = Φ( ln(S_t / S_0) / (σ_daily * √( (15-t)/1440 )) )")}

Where ${chalk.cyan("σ_daily")} is BTC's daily volatility. When the price $S_t$ moves far away from $S_0$, the probability goes to >0.95 (YES is highly likely) or <0.05 (NO is highly likely).`;
  }

  if (/\b(win rate|winrate|success rate|profitability|expectancy)\b/.test(query)) {
    return `Because we only enter trades when the probability is already ${chalk.bold(">95%")}, this strategy naturally has a very high success rate (often 85% to 93% in backtests).
However, due to extreme volatility spikes (gap risk) and slippage, the actual realized win rate may be lower, and losses can be larger than expected. You should run a ${chalk.yellow('/backtest')} to see how it performs on historical data.`;
  }

  return `I'm not sure how to answer that. 
Try asking about:
  • "Why do we wait 12 minutes?"
  • "What is the stop loss at 0.75?"
  • "How is the probability calculated?"
Or run one of the system commands:
  • ${chalk.yellow('/target [price]')} - Bind a custom target strike price
  • ${chalk.yellow('/clear')}          - Clear custom strike override
  • ${chalk.yellow('/live')}           - Start live paper trading monitor
  • ${chalk.yellow('/config')}         - Customize parameters`;
}

// Conversation input loop
function promptUser() {
  rl.question(chalk.bold.green('\nCoinBot> '), async (input) => {
    const rawInput = input.trim();
    if (!rawInput) {
      promptUser();
      return;
    }
    
    const lowerInput = rawInput.toLowerCase();
    
    // Command Router
    if (lowerInput.startsWith('set ')) {
      handleSetConfig(rawInput.substring(4));
      promptUser();
    } else if (lowerInput === '/exit' || lowerInput === 'exit' || lowerInput === 'quit') {
      console.log(chalk.cyan('\n👋 Thank you for using CoinBot! Good luck with your trading!'));
      rl.close();
      process.exit(0);
    } else if (lowerInput.startsWith('/backtest') || lowerInput === 'backtest') {
      const args = rawInput.split(/\s+/).slice(1);
      await handleBacktest(args[0]);
      promptUser();
    } else if (lowerInput.startsWith('/target') || lowerInput === 'target') {
      const args = rawInput.split(/\s+/).slice(1);
      handleTarget(args[0]);
      promptUser();
    } else if (lowerInput === '/clear' || lowerInput === 'clear') {
      handleClearTarget();
      promptUser();
    } else if (lowerInput === '/status' || lowerInput === 'status') {
      showStatus();
      promptUser();
    } else if (lowerInput === '/live' || lowerInput === 'live') {
      startLiveMonitor();
    } else {
      const response = await getBotResponse(rawInput);
      if (response) {
        console.log('\n' + response);
      }
      promptUser();
    }
  });
}

// Main function
function main() {
  console.clear();
  printWelcomeBanner();
  showHelp();
  promptUser();
}

main();
