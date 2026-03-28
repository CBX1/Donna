/**
 * Simple in-memory metrics for Donna.
 * Exposed via the health endpoint.
 */

const counters = {
  messagesHandled: 0,
  triageNoise: 0,
  triageAttention: 0,
  geminiCalls: 0,
  geminiErrors: 0,
  toolCalls: 0,
};

const latency = {
  gemini: [],  // rolling window of last 100 latencies
};

const MAX_LATENCY_WINDOW = 100;

function increment(name, amount = 1) {
  if (name in counters) counters[name] += amount;
}

function recordGeminiLatency(ms) {
  latency.gemini.push(ms);
  if (latency.gemini.length > MAX_LATENCY_WINDOW) {
    latency.gemini.shift();
  }
}

function getSnapshot() {
  const geminiAvgMs = latency.gemini.length > 0
    ? Math.round(latency.gemini.reduce((a, b) => a + b, 0) / latency.gemini.length)
    : null;

  return {
    ...counters,
    geminiAvgLatencyMs: geminiAvgMs,
    geminiLatencySamples: latency.gemini.length,
  };
}

module.exports = { increment, recordGeminiLatency, getSnapshot };
