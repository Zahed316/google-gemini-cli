const { sendPrompt, ensureChrome } = require('../src/gemini-driver');

async function run() {
  console.log('[test-driver] Ensuring Chrome is running...');
  await ensureChrome();
  console.log('[test-driver] Chrome ready.');

  // Test 1: Exercising model ('flash') and thinking ('low') with prompt streaming
  console.log('\n[test-driver] Test 1: Exercising model="flash" and thinking="low"...');
  const t0 = Date.now();
  let streamedText1 = '';

  const result1 = await sendPrompt({
    prompt: 'Echo the single word: OK',
    model: 'flash',
    thinking: 'low',
    isNewChat: true,
    onChunk: (chunk) => {
      process.stdout.write(chunk);
      streamedText1 += chunk;
    }
  });

  const duration1 = Date.now() - t0;
  console.log(`\n[test-driver] Test 1 completed in ${duration1}ms with result: "${result1.trim()}"`);

  if (!result1 || result1.trim().length === 0) {
    throw new Error('Test 1 failed: empty response received from Gemini');
  }
  if (duration1 > 25000) {
    throw new Error(`Test 1 exceeded duration limit (${duration1}ms > 25000ms) - possible 30s timeout issue`);
  }

  // Test 2: Switching model to 'argon' to verify dynamic model transition
  console.log('\n[test-driver] Test 2: Exercising model="argon"...');
  const t1 = Date.now();
  let streamedText2 = '';

  const result2 = await sendPrompt({
    prompt: 'Echo the single word: OK',
    model: 'argon',
    isNewChat: false,
    onChunk: (chunk) => {
      process.stdout.write(chunk);
      streamedText2 += chunk;
    }
  });

  const duration2 = Date.now() - t1;
  console.log(`\n[test-driver] Test 2 completed in ${duration2}ms with result: "${result2.trim()}"`);

  if (!result2 || result2.trim().length === 0) {
    throw new Error('Test 2 failed: empty response received from Gemini');
  }

  console.log('\n[test-driver] All tests passed cleanly!');
}

run().catch((err) => {
  console.error('[test-driver] Test failed with error:', err);
  process.exit(1);
});
