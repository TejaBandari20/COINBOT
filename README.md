# 🪙 COINBOT — BTC Prediction Market Trading Strategy Assistant

COINBOT is an interactive CLI trading assistant designed to analyze, backtest, and live-monitor a **15-minute clock-aligned Bitcoin (BTC) prediction market strategy**. It leverages real-time and historical data from the Binance Spot API and integrates Google Gemini (`gemini-2.5-flash`) to answer natural language questions about quantitative trading, mathematical modeling, and risk factors.

---

## 📈 The 15-Minute prediction Strategy

This strategy is designed for binary yield-harvesting prediction markets (e.g., Polymarket) resolving every 15 minutes (clock-aligned: `XX:00`, `XX:15`, `XX:30`, `XX:45`).

### 🛠️ Execution Rules
1. **12-Minute Wait Period**: No trades are entered during the first 12 minutes of the 15-minute cycle to let initial market volatility settle and establish a direction.
2. **3-Minute Entry Window**: Between minutes 12 and 15, the bot calculates contract probabilities.
3. **High Probability Entry (>0.95)**:
   - Implied probability of a **YES** contract resolving is calculated using a **Geometric Brownian Motion (GBM)** model.
   - If $P_{\text{YES}} > 0.95$, enter a **YES** contract (aiming to purchase between $0.95 and $0.98 for a $1.00 payout).
   - If $P_{\text{NO}} = (1 - P_{\text{YES}}) > 0.95$, enter a **NO** contract.
   - If neither threshold is met, the cycle is skipped.
4. **Stop Loss (0.75)**: Once in a trade, if the implied contract price dips to $0.75 or lower, exit immediately to cap losses at around $0.20 per share.

---

## 🧮 Mathematical Modeling

The bot estimates the probability of contract completion using the Black-Scholes/Geometric Brownian Motion (GBM) pricing model:

$$P_{\text{YES}} = \Phi\left( \frac{\ln(S_t / S_0)}{\sigma \sqrt{\Delta t}} \right)$$

Where:
- $S_0$: Open price of the 15-minute cycle (or custom targeted strike price).
- $S_t$: Current spot price of BTC at elapsed minute $t$.
- $\Delta t$: Remaining time to expiry in days: $\frac{\text{CycleDuration} - t}{1440}$.
- $\sigma$: Daily historical volatility of BTC log returns.
- $\Phi(z)$: Standard Normal Cumulative Distribution Function (CDF).

The CDF is approximated using a high-precision numerical algorithm (error margin $< 7.5 \times 10^{-8}$).

---

## 🚀 Getting Started

### 📋 Prerequisites
- **Node.js**: Version 18.0.0 or higher is required.
- **Gemini API Key**: (Optional but recommended) Get an API key from [Google AI Studio](https://aistudio.google.com/) for natural language support.

### ⚙️ Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/TejaBandari20/COINBOT.git
   cd COINBOT
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup environment variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` and configure your API key:
     ```env
     GEMINI_API_KEY=your_actual_gemini_api_key
     ```

### 💻 Running the Bot
Start the interactive CLI session:
```bash
npm start
```

---

## 🕹️ CLI Commands

Inside the CLI, you can chat in natural language or run the following slash-commands:

| Command | Description |
| :--- | :--- |
| `/strategy` | Explains the strategy rules, parameters, and contract pricing mathematics. |
| `/backtest [days]` | Runs a simulation over the past $N$ days (up to 30 days) using historical 1-minute klines from Binance. |
| `/target [price]` | Binds a custom target strike price override ($S_0$) rather than using the cycle's open spot price. |
| `/clear` | Clears custom strike override, reverting back to using the cycle's open spot price. |
| `/live` | Starts a real-time terminal dashboard simulating paper trading with the live Binance spot price feed. |
| `/config` | Views or overrides current strategy config parameters (thresholds, timings, custom volatility). |
| `/stats` | Shows aggregate performance metrics of the last completed backtest session. |
| `/risks` | Explains the structural risks (e.g. gap downs, tail-events, taker fees, execution latency). |
| `/status` | Displays Binance Spot API connection status and Gemini AI configuration status. |
| `/exit` | Gracefully closes the terminal session. |

---

## 📂 Project Structure

- `index.js` - Main entry point, interactive terminal prompt loop, command parser, and Live dashboard UI.
- `gemini.js` - Configuration, initialization, and request handling for the Google Gemini API client.
- `strategy.js` - Quantitative calculations: Standard Normal CDF approximation, GBM probability modeling, volatility calculation, historical data fetch/cache from Binance API, and backtest runner.
- `package.json` - Node project metadata, entry script, and package dependencies.
- `requirements.txt` - Dependency reference file listing the packages for external compatibility.
- `.gitignore` - Prevents caching files, node modules, and private credentials from being pushed to git.

---

## ⚠️ Strategy Risks
- **Fat-Tail/Gap Down Risk**: Rapid price changes in the last seconds of the cycle can drop the price below $S_0$, resolving the contract to $0.00 instantly. A stop-loss of 0.75 will fail to trigger in time.
- **Slippage & Liquidity**: Heavy market movements can result in poor execution fills on stop-loss triggers.
- **Exchange/Taker Fees**: High taker fees on prediction exchanges can severely erode the small yield generated by high-probability entries.
