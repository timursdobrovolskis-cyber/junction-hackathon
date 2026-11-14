// Server-only: never bundle this Node/Python bridge into a browser app.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureBudgetInputs, createBudgetCoachResponse } from './budget-coach.mjs';

const bridgePath = fileURLToPath(new URL('../scripts/coach_budget_bridge.py', import.meta.url));

export function runBudgetEngine(originalForecast, engineInputs, { python = 'python3', timeoutMs = 10000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');
  const payload = JSON.stringify({ originalForecast, engineInputs });
  return new Promise((resolve, reject) => {
    const child = spawn(python, [bridgePath], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = '', bytes = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Budget engine timed out')), timeoutMs);
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => finish(error));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4 * 1024 * 1024) finish(new Error('Budget engine response is too large'));
      else output += chunk;
    });
    // Drain errors without logging customer data or exposing a Python traceback.
    child.stderr.resume();
    child.on('close', (code) => {
      if (settled) return;
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.error || !result.budget) throw new Error(result.error || 'Budget engine failed');
        finish(null, result.budget);
      } catch (error) { finish(error); }
    });
    child.stdin.end(payload);
  });
}

/** Await the real engine; keep the last result available if recalculation fails. */
export async function previewBudgetChange(result, answer, previousInputs, options) {
  const snapshot = structuredClone(result);
  const pending = captureBudgetInputs(snapshot, answer, previousInputs);
  if (!pending.engineRequest.ready) return { ...pending, engineResult: snapshot, coach: createBudgetCoachResponse(snapshot) };
  try {
    const budget = await runBudgetEngine(snapshot.originalForecast, pending.engineRequest.engineInputs, options);
    const engineResult = { budget, originalForecast: snapshot.originalForecast };
    const coach = createBudgetCoachResponse(engineResult);
    return { status: 'recalculated', inputs: pending.inputs, engineResult, coach,
      budgetChanged: true, forecastChanged: false, movesMoney: false };
  } catch (error) {
    return { ...pending, status: 'recalculation_failed', error: error.message,
      message: 'The engine could not produce a new budget. Your choices are saved; the previous preview is still displayed.',
      engineResult: snapshot, coach: createBudgetCoachResponse(snapshot) };
  }
}
