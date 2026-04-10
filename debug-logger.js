/**
 * Pod Pipeline Debug Logger
 * Mode 2: Audio Buffer Audit + State Machine Trace (core-debugger skill)
 *
 * Captures every decision point in the turn-detection pipeline as a structured
 * event, writes to ./logs/session-<timestamp>.ndjson for offline analysis.
 * Zero-latency: all writes are fire-and-forget async, no await in hot path.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const SESSION_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `session-${SESSION_ID}.ndjson`);
const SUMMARY_FILE = path.join(LOG_DIR, `session-${SESSION_ID}-summary.txt`);

let eventSeq = 0;
let sessionStart = Date.now();
const writeStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function ts() { return Date.now() - sessionStart; }

function log(type, payload) {
    const event = { seq: ++eventSeq, t: ts(), type, ...payload };
    writeStream.write(JSON.stringify(event) + '\n');
    return event;
}

// ─── Public API ────────────────────────────────────────────────────────────

const Debug = {

    // Called when a Deepgram transcript arrives (interim or final)
    transcript(transcript, isFinal, currentState) {
        log('TRANSCRIPT', {
            isFinal,
            state: currentState,
            text: transcript,
            wordCount: transcript.trim().split(/\s+/).length,
        });
    },

    // Called on every Gate 1 fire
    gate1(hangoverMs, currentText, currentState) {
        log('GATE1_FIRED', {
            hangoverMs,
            state: currentState,
            textSnapshot: currentText,
            wordCount: currentText.trim().split(/\s+/).length,
        });
    },

    // Called when Gate 2 evaluates a candidate
    gate2Eval(utterance, passed, reason, wordCount, hasStrongPunct) {
        log('GATE2_EVAL', {
            passed,
            reason,      // e.g. 'yield_phrase', 'punctuation', 'continuation_word', 'setup_phrase', 'conservative_return_false'
            wordCount,
            hasStrongPunct,
            utterance: utterance.substring(0, 200),  // cap at 200 chars
        });
    },

    // Called when Gate 2 fires the LLM
    gate2Fire(utterance, triggeredBy) {
        log('GATE2_FIRED', {
            triggeredBy,  // 'fast_heuristic' | 'adaptive_failsafe'
            wordCount: utterance.trim().split(/\s+/).length,
            utterance: utterance.substring(0, 200),
        });
    },

    // Called when the adaptive failsafe timer fires
    failsafeFired(fallbackMs, wordsSoFar, utterance) {
        log('FAILSAFE_FIRED', {
            fallbackMs,
            wordsSoFar,
            utterance: utterance.substring(0, 200),
        });
    },

    // Called when an interruption verdict comes back
    interruption(transcript, verdict, state) {
        log('INTERRUPTION', {
            verdict,
            state,
            transcript: transcript.substring(0, 200),
        });
    },

    // Called when transcriptBuilder changes
    builderState(action, added, fullBuilder) {
        log('BUILDER', {
            action,  // 'append_final' | 'merge_interim' | 'skip_dedup' | 'cleared'
            added,
            builderLength: fullBuilder.length,
            wordCount: fullBuilder.trim().split(/\s+/).length,
            snapshot: fullBuilder.substring(0, 300),
        });
    },

    // Called when the utteranceTimer is cleared by incoming speech
    timerCancelled(which, reason) {
        log('TIMER_CANCELLED', { which, reason });
    },

    // Called when state transitions
    stateChange(from, to, reason) {
        log('STATE_CHANGE', { from, to, reason });
    },

    // Called when a barge-in guard triggers
    bargeInGuard(msSinceStart) {
        log('BARGE_IN_GUARD', { msSinceStart });
    },

    // Called on pipeline start (LLM + TTS fire)
    pipelineStart(utterance) {
        log('PIPELINE_START', { utterance: utterance.substring(0, 200) });
    },

    // Called on session end — writes human-readable summary
    summarize() {
        writeStream.end();
        const raw = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
        const events = raw.map(l => JSON.parse(l));

        const lines = [
            `Pod Debug Session: ${SESSION_ID}`,
            `Total events: ${events.length}`,
            `Session duration: ${ts()}ms`,
            '',
            '─── GATE2 DECISIONS ─────────────────────────────────',
        ];

        events.filter(e => e.type === 'GATE2_EVAL').forEach(e => {
            lines.push(`  [+${e.t}ms] ${e.passed ? '✅ PASS' : '⛔ EXTEND'} (${e.reason}) | ${e.wordCount}w | punct:${e.hasStrongPunct} | "${e.utterance.substring(0, 80)}..."`);
        });

        lines.push('', '─── PIPELINE FIRES ───────────────────────────────────');
        events.filter(e => e.type === 'GATE2_FIRED' || e.type === 'FAILSAFE_FIRED').forEach(e => {
            lines.push(`  [+${e.t}ms] ${e.type} via ${e.triggeredBy || 'failsafe'} | ${(e.wordCount || e.wordsSoFar)}w`);
        });

        lines.push('', '─── INTERRUPTIONS ────────────────────────────────────');
        events.filter(e => e.type === 'INTERRUPTION').forEach(e => {
            lines.push(`  [+${e.t}ms] ${e.verdict} | "${(e.transcript || '').substring(0, 80)}"`);
        });

        lines.push('', '─── BUILDER MUTATIONS ────────────────────────────────');
        events.filter(e => e.type === 'BUILDER').forEach(e => {
            lines.push(`  [+${e.t}ms] ${e.action} | +${e.added?.substring(0, 60)} | total:${e.wordCount}w`);
        });

        fs.writeFileSync(SUMMARY_FILE, lines.join('\n'));
        console.log(`\n📋 [DEBUG] Session log: ${LOG_FILE}`);
        console.log(`📋 [DEBUG] Summary:     ${SUMMARY_FILE}`);
    }
};

process.on('SIGINT', () => {
    Debug.summarize();
    process.exit(0);
});
process.on('SIGTERM', () => Debug.summarize());

module.exports = { Debug, SESSION_ID, LOG_FILE };
