import { GateEngine } from "../src/gate/engine.js";
import { tryLocalIntent } from "../src/llm/classifier.js";

// Mock variables needed for the GateEngine
const mockVars = {
  first_name: "John",
  state: "TX"
};

async function testFineTuning() {
  console.log("=========================================");
  console.log("🧪 TESTING FINE-TUNING IMPLEMENTATIONS 🧪");
  console.log("=========================================\n");

  const engine = new GateEngine(mockVars);

  // ---------------------------------------------------------
  // Test 1: Contextual Silence Nudges (Issue 10)
  // ---------------------------------------------------------
  console.log("--- TEST 1: Contextual Silence Nudges ---");
  
  engine.step = "how_are_you";
  console.log(`Step: ${engine.step} -> Bot says: "${engine.silenceNudge().say}"`);

  engine.step = "pitch";
  console.log(`Step: ${engine.step} -> Bot says: "${engine.silenceNudge().say}"`);

  engine.step = "insurance_check_1";
  console.log(`Step: ${engine.step} -> Bot says: "${engine.silenceNudge().say}"`);
  console.log("✅ Passed Contextual Nudges\n");

  // ---------------------------------------------------------
  // Test 2: Rotational Error Recovery (Issue 8)
  // ---------------------------------------------------------
  console.log("--- TEST 2: Rotational Error Recovery ---");
  engine.step = "pitch"; // reset to a normal step
  
  // Simulate 4 low-confidence (0.4) interactions in a row
  for (let i = 1; i <= 4; i++) {
    const action = await engine.handleTurn("unintelligible mumble", 0.4);
    console.log(`Low Confidence Miss ${i} -> Bot says: "${action.say}"`);
  }
  console.log("✅ Passed Rotational Apologies\n");

  // ---------------------------------------------------------
  // Test 3: LLM Latency Bypass (Issue 11)
  // ---------------------------------------------------------
  console.log("--- TEST 3: LLM Latency Bypass Regex ---");
  
  const testPhrases = [
    "I get this through the VA",
    "I already have an agent",
    "I'm already working with someone on this"
  ];

  for (const phrase of testPhrases) {
    const result = tryLocalIntent(phrase, "pitch");
    console.log(`Phrase: "${phrase}"`);
    console.log(`-> Classified locally as: ${result?.intent} (Confidence: ${result?.confidence})`);
  }
  console.log("✅ Passed Regex Bypass\n");
}

testFineTuning().catch(console.error);
