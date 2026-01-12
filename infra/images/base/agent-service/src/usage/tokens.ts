// Simple token estimation based on character count
// Claude and GPT use similar BPE tokenization, roughly 4 chars per token
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Model pricing per 1M tokens (in USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude models
  "claude-opus-4-5-20250929": { input: 15, output: 75 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-3-5-20250929": { input: 0.25, output: 1.25 },

  // OpenAI/Codex models
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 1.1, output: 4.4 },

  // Default fallback
  default: { input: 3, output: 15 },
};

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  // Normalize model name (remove version suffixes for matching)
  const normalizedModel = model.toLowerCase();

  // Find matching pricing
  let pricing = MODEL_PRICING.default;
  for (const [key, value] of Object.entries(MODEL_PRICING)) {
    if (normalizedModel.includes(key.toLowerCase())) {
      pricing = value;
      break;
    }
  }

  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
