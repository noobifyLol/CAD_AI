// End-to-end generation check: runs the full AI pipeline against real Groq keys
// and reports the generation mode, validation status, and code produced.
// Run with: npm run test:e2e            (default bracket prompt)
//       or: npm run test:e2e -- "Create a coffee mug ..."
import dotenv from 'dotenv';
dotenv.config();
const { generateFeatureScript, validateFeatureScriptStrict } = await import('../ai.js');

const prompt = process.argv[2]
  || 'Create a mounting bracket 3 inches wide, 2 inches tall, 0.25 inch thick with two 0.25 inch diameter mounting holes and a fillet on the corner';

console.log('=== E2E GENERATION ===');
console.log('prompt:', prompt);
const started = Date.now();
try {
  const result = await generateFeatureScript(prompt, {});
  console.log('\n--- RESULT ---');
  console.log('durationMs:', Date.now() - started);
  console.log('generationMode:', result.generationMode);
  console.log('completionLevel:', result.completionLevel);
  console.log('codeLength:', (result.code || '').length);
  console.log('warnings:', JSON.stringify(result.warnings || [], null, 1));
  const strict = validateFeatureScriptStrict(result.code || '');
  console.log('finalValidation ok:', strict.ok, '| blocking:', strict.blockingIssueCount, '| fatal:', strict.fatalIssueCount);
  if (!strict.ok) {
    for (const i of strict.blockingIssues.slice(0, 10)) console.log('  BLOCKING:', i.message, '|', (i.text || '').slice(0, 90));
    for (const i of strict.fatalIssues.slice(0, 10)) console.log('  FATAL:', i.message);
  }
  console.log('\n--- CODE ---');
  console.log(result.code || '(no code)');
  process.exit(strict.ok ? 0 : 1);
} catch (e) {
  console.error('E2E FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
}
