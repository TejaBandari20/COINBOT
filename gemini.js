import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

let ai = null;
let chatHistory = [];

// Check if Gemini API key is configured
export function isGeminiConfigured() {
  const key = process.env.GEMINI_API_KEY;
  return !!key && key !== 'change_me' && key.trim().length > 0;
}

// Initialize Gemini Client
export function initGemini() {
  if (isGeminiConfigured()) {
    try {
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim() });
      return true;
    } catch (e) {
      console.error("Failed to initialize Gemini AI:", e.message);
    }
  }
  return false;
}

const SYSTEM_INSTRUCTION = `You are CoinBot, a professional quantitative trading assistant chatbot for short-term prediction markets.
Your primary domain is a 15-minute clock-aligned Bitcoin (BTC) strategy.

Playbook Rules:
1. Cycle duration: 15 minutes, clock-aligned (e.g. 00:00, 00:15, 00:30).
2. Wait duration: 12 minutes (minutes 0 to 12 of the cycle). No entries allowed.
3. Entry window: 3 minutes (minutes 12 to 15).
4. Entry rule: Calculate implied YES contract probability (P_YES) using a Geometric Brownian Motion (GBM) model.
   - If P_YES > 0.95, enter YES.
   - If P_YES < 0.05, enter NO (since P_NO > 0.95).
    - Otherwise, skip (no entry).
5. Stop Loss: 0.75. If contract price falls to or below 0.75, close immediately.
6. Target Strike Price: S0 is either a custom target strike price override set by the user, or defaults to the BTC price at the beginning of each 15-minute cycle.

You are running inside a Node.js CLI terminal. The user can interact with you in natural language or run slash-commands:
- /strategy         - Explain the strategy rules and math.
- /backtest [days]  - Run a backtest using Binance historical data.
- /target [price]   - Bind a custom target strike price (e.g. 68000).
- /clear            - Clear custom strike override (defaults to cycle start price).
- /live             - Start real-time paper trading monitor using Binance feed.
- /config           - View or modify parameters.
- /stats            - Show results of the last completed backtest.
- /risks            - Learn about risks associated with this strategy.
- /status           - Check Gemini configuration status.
- /exit             - Quit the chatbot session.

Strict Scope Limitation:
- You MUST only answer questions directly related to this project statement: the 15-minute BTC prediction market strategy, the Geometric Brownian Motion (GBM) probability model, strategy parameters, risks, backtesting, or cryptocurrency trading systems.
- If the user asks off-topic questions (e.g., recipes, pop culture, history, geography, non-trading coding questions, or general chatbot queries), you MUST politely refuse to answer. You should reply: "I can only assist with questions regarding the BTC 15-Minute Prediction Market Strategy and related quantitative parameters. Please ask a strategy-related question or run one of the system commands."

Tone & Behavior:
- Be highly professional, quantitative, and concise.
- Keep responses short and direct to fit well in a terminal.
- Use clean Markdown formatting (bolding, bullet points, code blocks).
- If the user asks you to perform a task like running a backtest or starting the live feed, politely guide them to type the command (e.g., "/backtest 7" or "/live").`;

export async function askGemini(userInput) {
  if (!ai) {
    if (!initGemini()) {
      throw new Error("Gemini API not configured.");
    }
  }

  // Record user query
  chatHistory.push({
    role: 'user',
    parts: [{ text: userInput }]
  });

  // Limit conversation history to the last 15 messages to manage token limits
  if (chatHistory.length > 15) {
    chatHistory = chatHistory.slice(-15);
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: chatHistory,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION
      }
    });

    const reply = response.text || "I was unable to generate a response.";
    
    // Record AI reply
    chatHistory.push({
      role: 'model',
      parts: [{ text: reply }]
    });

    return reply;
  } catch (error) {
    // Clean history from failed query
    chatHistory.pop();
    throw error;
  }
}
