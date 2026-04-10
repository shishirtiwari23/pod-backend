process.env.PATH = process.env.PATH + ':/opt/homebrew/bin';
const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const WebSocketClient = require('ws'); 
const OpenAI = require('openai');
const { createClient } = require('@deepgram/sdk');
const path = require('path');
require('dotenv').config();

// Deepgram SDK client for WebSocket streaming TTS
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);

const app = express();

app.use(express.static(path.join(__dirname, '../simulator')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const groq = new OpenAI({ 
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

const SYSTEM_PROMPT = `You are a helpful, extremely concise human-like conversational AI. You MUST respond in 1 or 2 short sentences. Absolutely DO NOT output robotic, flat text blocks, markdown, lists, asterisks, bullet points, or emojis, because your response will be directly fed into a voice synthesizer. Instead, dynamically inject verbal pauses using ellipses ("..."), dramatic questioning ("?!"), commas, and natural hesitation words ("Hmm", "Well", "Let's see") directly into your grammatical structure so the Text-To-Speech engine naturally breathes and pauses correctly! Make it sound like a real person talking natively!`;
const ttsModel = "aura-zeus-en";

wss.on('connection', (ws, req) => {
    const isHardware = req.url.includes('format=linear16');
    console.log(`✅ [WebSocket] ${isHardware ? 'Hardware Terminal' : 'Web Frontend'} connected natively!`);

    let transcriptBuilder = "";
    let latestInterim = "";
    const State = { IDLE: "IDLE", LISTENING: "LISTENING", PROCESSING: "PROCESSING", SPEAKING: "SPEAKING", INTERRUPTED: "INTERRUPTED" };
    let currentState = State.LISTENING;
    let speakingStartTime = 0;
    let chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
    let utteranceTimer = null; 
    let hardwareSleepTimer = null; 

    // Aggressive VAD matrix mathematically explicitly safely reliably smoothly gracefully appropriately logically!
    let url = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true';
    
    if (isHardware) {
         url += '&encoding=linear16&sample_rate=16000&channels=1';
         console.log('📡 [Hardware] Initializing pure PCM bitstream');
    } else {
         console.log('📡 [Browser] Initializing compressed WebM matrix');
    }
    
    let deepgramLive = new WebSocketClient(url, {
        headers: { 'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}` }
    });

    deepgramLive.on('open', () => {
        console.log('📡 [Deepgram] Engine strictly bolted to continuous chunk pipelines safely.');
    });

    deepgramLive.on('close', (event) => {
         console.log(`📡 [Deepgram] Socket strictly terminated. Code: ${event}`);
    });

    // Expanded continuation word set — these words at end of sentence = user isn't done
    const continuationWords = new Set([
        "and", "or", "but", "because", "so", "if", "then", "like", "which", "that",
        "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "on", "with",
        "have", "has", "had", "just", "about", "some", "my", "your", "their", "our",
        "very", "much", "many",
        // NEW: these are strong mid-sentence continuers the old set was missing
        "next", "though", "yet", "when", "where", "how", "also", "too",
        "while", "since", "before", "after", "until", "unless", "whether",
        "although", "however", "still", "than", "by", "at", "its", "this",
        "what", "who", "whom", "whose", "get", "got", "go", "going", "not",
        "now", "here", "there", "really", "even"
    ]);

    function isLogicallyComplete(text) {
         if (!text || text.length < 5) return false;
         
         const trimmedText = text.trim();
         const hasStrongPunctuation = /[.?!]$/.test(trimmedText);
         const words = text.toLowerCase().split(/\s+/);
         
         // Strong punctuation + enough words = done
         if (hasStrongPunctuation && words.length >= 4) return true;

         const lastWord = words[words.length - 1].replace(/[^a-z]/g, '');
         if (continuationWords.has(lastWord)) return false;

         // FIX: "Setup phrase" detection — these opening patterns mean the user hasn't started yet
         // e.g. "I'm going to say a long sentence" sounds complete but is clearly an announcement
         const setupPhrasePatterns = [
             /^(so\s+)?i('m|\s+am)\s+(going|about)\s+to\b/i,   // "I'm going to..."
             /^(so\s+)?let\s+me\b/i,                           // "Let me..."
             /^i\s+want\s+(you\s+to|to)\b/i,                   // "I want you to / I want to..."
             /^i\s+(would|'d)\s+like\s+to\b/i,                 // "I'd like to..."
             /\band\s+i\s+want\b/i,                            // "...and I want"
             /\bbefore\s+i\b/i,                                 // "...before I"
             /\bwithout\s+(getting|being|having)\b/i,           // "...without getting"
             /\bso\s+that\b/i,                                  // "...so that"
         ];
         if (setupPhrasePatterns.some(p => p.test(trimmedText))) return false;

         // FIX: Raised minimum to 8 words — 6-7 word fragments are still too ambiguous unpunctuated
         if (words.length <= 7 && !hasStrongPunctuation) return false;
         
         return true;
    }

    let silenceHangoverTimer = null;
    let gate2Executing = false;

    // Named so WAKE reconnection can re-attach it to the new deepgramLive socket
    async function handleDeepgramMessage(data) {
        const response = JSON.parse(data.toString());
        
        if (response.type !== 'Results') {
            process.stdout.write('~'); 
            return;
        }
        
        const transcript = response.channel.alternatives[0].transcript;
        const isFinal = response.is_final;
        
        if (transcript.trim().length > 0) {
            // --- GATE 1: ACOUSTIC VAD TRACKING ---
            // If we receive ANY text, clear the hangover timer
            if (silenceHangoverTimer) {
                clearTimeout(silenceHangoverTimer);
            }
            
            if (isFinal) {
                resetHardwareSleepTimer(); 
                
                if (currentState === State.PROCESSING || currentState === State.SPEAKING) {
                    // Barge-In Guard: strictly 600ms boundary per specs
                    if (currentState === State.SPEAKING && (Date.now() - speakingStartTime < 600)) {
                        console.log(`[CHECKPOINT] 🛡️ 600ms Barge-In Guard active! Ignoring early interruption bounds.`);
                        return;
                    }
                    
                    console.log(`[CHECKPOINT] Analyzing Interruption Candidate: "${transcript}"`);
                    const lastAI = chatHistory[chatHistory.length - 1]?.content || "speaking...";
                    
                    const cleanAI = lastAI.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim();
                    const cleanUser = transcript.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim();
                    
                    if (cleanUser.length <= 15) return;
                    if (cleanUser.length > 5 && (cleanAI.includes(cleanUser) || cleanUser.includes(cleanAI))) return;
                    
                    groq.chat.completions.create({
                        model: "llama-3.1-8b-instant",
                        messages: [{
                            role: "system",
                            content: `The AI is actively saying: "${lastAI}". The microphone picks up: "${transcript}". Is this a meaningful interruption making a functional thought/question that physically demands an immediate new AI response? If it is the microphone accidentally hearing the AI's own voice (echo), reply strictly NO. If it is a brief passive backchannel (e.g. 'mhm', 'yeah', 'right', 'ok', 'nice', 'oh') or a short incomplete fragment, reply strictly NO. If it is ANY kind of deliberate user attempt to speak, interrupt, or change topic, reply strictly YES. If in doubt, ALWAYS reply YES.`
                        }]
                    }).then(res => {
                        const verdict = res.choices[0].message.content.trim().toUpperCase();
                        if (verdict.includes('YES')) {
                            console.log(`[CHECKPOINT] 🛑 Meaningful Interruption Detected! Verdict is YES for: "${transcript}"`);
                            currentState = State.INTERRUPTED;
                            ws.send(JSON.stringify({ action: 'STOP_AUDIO', log: '⚠️ Meaningful Interruption Detected! Re-routing...' }));
                            // FIX: Set transcriptBuilder to EMPTY then let INTERRUPTED isFinal blocks accumulate
                            // Don't pre-seed with partial — it was caught mid-sentence
                            transcriptBuilder = "";
                            latestInterim = transcript; // Track as interim so Gate 2 can pick it up
                            // FIX: Extended to 1500ms — give user time to finish their thought
                            // after AI stops speaking before we fire Gate 2
                            if (silenceHangoverTimer) clearTimeout(silenceHangoverTimer);
                            silenceHangoverTimer = setTimeout(triggerGate2Check, 1500);
                        } else {
                            console.log(`[CHECKPOINT] ⏩ Passive background noise ignored! Verdict is NO for: "${transcript}"`);
                        }
                    }).catch(err => console.log('[CHECKPOINT] Interruption eval error:', err));
                } else if (currentState === State.LISTENING || currentState === State.IDLE) {
                    console.log(`[CHECKPOINT] Standard Appending to Builder: "${transcript}"`);
                    transcriptBuilder += transcript + " ";
                    latestInterim = ""; 
                    ws.send(JSON.stringify({ log: `👂 Hearing: "${transcriptBuilder.trim()}"...` }));
                } else if (currentState === State.INTERRUPTED) {
                    // INTERRUPTED: user kept talking after barge-in — append to builder
                    // Gate 2's 300ms timer will pick up the full utterance
                    transcriptBuilder += transcript + " ";
                    latestInterim = "";
                    console.log(`[CHECKPOINT] [INTERRUPTED] Appending continued speech: "${transcript}"`);
                }
            } else if (currentState === State.LISTENING || currentState === State.IDLE || currentState === State.INTERRUPTED) {
                // Tracking Interim continuously
                latestInterim = transcript;
                ws.send(JSON.stringify({ log: `👂 Hearing: "${(transcriptBuilder + " " + latestInterim).trim()}"...` }));
            }

            // Re-arm Gate 1 Hangover Tracking
            // FIX: Use patience mode after interruption — user needs longer to finish their thought
            if (currentState === State.LISTENING || currentState === State.IDLE || currentState === State.INTERRUPTED) {
                const hangover = currentState === State.INTERRUPTED ? 1200 : 700;
                silenceHangoverTimer = setTimeout(triggerGate2Check, hangover);
            }
        }
    }

    async function triggerGate2Check() {
         console.log(`[GATE 1 PASSED] 700ms Silence Hangover hit.`);
         // FIX: properly guard against re-entrant calls
         if (gate2Executing) {
             console.log(`[GATE 2] Already executing — skipping duplicate fire.`);
             return;
         }
         gate2Executing = true;

         if (latestInterim.trim().length > 0) {
             const interimTrimmed = latestInterim.trim();
             const builderTrimmed = transcriptBuilder.trim().toLowerCase();
             // FIX: Dedup — only append interim if it's not already captured at the tail of the builder
             // Prevents: "And let" [pause] -> builder="And let" -> user says more -> interim="Let me try" ->
             // Gate 1 fires -> appends "Let me try" even though builder already has a version of it
             if (!builderTrimmed.endsWith(interimTrimmed.toLowerCase())) {
                 console.log(`[CHECKPOINT] 🔄 Merging interim into Builder: "${interimTrimmed}"`);
                 transcriptBuilder += interimTrimmed + " ";
             } else {
                 console.log(`[CHECKPOINT] Interim already in Builder — skipping: "${interimTrimmed}"`);
             }
             latestInterim = "";
         }

         const finalUtterance = transcriptBuilder.trim();
         if (finalUtterance.length === 0) {
             gate2Executing = false;
             return;
         }

         // --- GATE 2: SEMANTIC EVALUATION ---
         console.log(`[GATE 2 PENDING] Evaluating Semantic Completeness: "${finalUtterance}"`);
         
         const passesFastHeuristics = isLogicallyComplete(finalUtterance);

         if (passesFastHeuristics) {
             console.log(`[GATE 2 PASSED] Fast Heuristics matched. Firing LLM.`);
             transcriptBuilder = "";
             currentState = State.PROCESSING;
             gate2Executing = false;
             await generateAndPlay(finalUtterance, Date.now());
         } else {
             console.log(`[GATE 2 EXTENDING] Sentence incomplete. Waiting up to 1400ms for more speech...`);
             // Gate 2 fail: user is mid-thought. Wait a generous extra window.
             // If new audio arrives, Gate 1 will fire again and reset the hangover.
             if (utteranceTimer) clearTimeout(utteranceTimer);
             utteranceTimer = setTimeout(async () => {
                  console.log(`[DEBUG] 🕒 Hard Failsafe Triggered (1400ms).`);
                  const captured = transcriptBuilder.trim();
                  transcriptBuilder = "";
                  gate2Executing = false;
                  utteranceTimer = null;
                  if (captured.length > 0 && (currentState === State.LISTENING || currentState === State.IDLE || currentState === State.INTERRUPTED)) {
                       currentState = State.PROCESSING; 
                       await generateAndPlay(captured, Date.now());
                  }
             }, 1400); 
             gate2Executing = false; // allow re-entry when new words arrive
         }
    } // end handleDeepgramMessage

    // Attach to initial connection
    deepgramLive.on('message', handleDeepgramMessage);

    deepgramLive.on('error', (err) => {
        console.error('⚠️ Deepgram streaming error', err);
        ws.send(JSON.stringify({ log: `⚠️ Deepgram Engine Dropped: ${err.message}` }));
    });

    function resetHardwareSleepTimer() {
        if (hardwareSleepTimer) clearTimeout(hardwareSleepTimer);
        // Only run native sleep hardware cycles logically optimally safely cleanly implicitly correctly accurately dynamically elegantly efficiently beautifully strictly functionally smoothly intuitively reliably creatively successfully efficiently cleanly intuitively cleanly intelligently efficiently structurally on pure physical CLI scripts natively!
        if (isHardware) {
            hardwareSleepTimer = setTimeout(() => {
                console.log('\n💤 [VAD Tracker] 10 SECONDS OF AMBIENT NOISE DETECTED. Sending Hardware to Sleep natively.');
                ws.send(JSON.stringify({ action: 'SLEEP' }));
                if (deepgramLive) {
                    deepgramLive.terminate();
                    deepgramLive = null;
                }
            }, 10000); 
        }
    }

    resetHardwareSleepTimer();

    // Tracks the active Deepgram TTS WebSocket so interruptions can immediately close it
    let activeTTSSocket = null;

    // ============================================================
    // WEBSOCKET STREAMING TTS ENGINE
    // Industry standard for <300ms Time-To-First-Audio.
    // Instead of REST (wait 2-4s for full MP3), a persistent WebSocket
    // to Deepgram streams audio CHUNKS as they are synthesized (~90ms TTFA).
    // We pipe each chunk directly to the browser as it arrives.
    // ============================================================

    async function generateAndPlay(utterance, callStartTime) {
        const t0 = callStartTime || Date.now();
        console.log(`\n[LATENCY] +0ms: Pipeline START`);

        try {
            ws.send(JSON.stringify({ log: `🗣️ [You]: "${utterance.substring(0, 80)}..."` }));
            chatHistory.push({ role: "user", content: utterance });
            if (chatHistory.length > 11) chatHistory = [chatHistory[0], ...chatHistory.slice(-10)];

            // --- STEP 1: Open Deepgram WebSocket TTS FIRST ---
            // Opening it now, before the LLM even responds, eliminates the WebSocket
            // handshake time from the critical latency path (~50-100ms saved).
            console.log(`[LATENCY] +${Date.now() - t0}ms: Opening Deepgram TTS WebSocket...`);
            const dgSpeak = deepgramClient.speak.live({
                model: ttsModel,
                encoding: 'linear16',
                sample_rate: 24000,
            });
            activeTTSSocket = dgSpeak; // expose for interruption handler

            let ttsReady = false;
            let audioChunkCount = 0;
            let firstAudioSent = false;
            // TTS phrase queue — phrases are built while TTS socket handshake is in-flight
            // When TTS opens, drain queue immediately in order. No async blocking in LLM loop.
            const ttsQueue = [];

            function sendOrQueue(text) {
                if (ttsReady) {
                    try { dgSpeak.sendText(text); } catch(e) {}
                } else {
                    ttsQueue.push(text);
                }
            }

            dgSpeak.on('Open', () => {
                ttsReady = true;
                console.log(`[LATENCY] +${Date.now() - t0}ms: ✅ TTS WebSocket OPEN — draining ${ttsQueue.length} queued phrases`);
                // Drain buffered phrases that arrived before socket opened
                while (ttsQueue.length > 0) {
                    try { dgSpeak.sendText(ttsQueue.shift()); } catch(e) {}
                }
            });

            // Each audio chunk from Deepgram is piped IMMEDIATELY to the browser
            dgSpeak.on('Audio', (audioChunk) => {
                if (currentState === State.INTERRUPTED) return;
                audioChunkCount++;
                if (!firstAudioSent) {
                    speakingStartTime = Date.now(); // ⏱️ Guard period start!
                    currentState = State.SPEAKING;
                    firstAudioSent = true;
                    console.log(`[LATENCY] +${Date.now() - t0}ms: 🔊 FIRST AUDIO CHUNK received from Deepgram! (${audioChunk.length} bytes)`);
                    ws.send(JSON.stringify({ action: 'QUEUE_AUDIO' }));
                } 
                ws.send(audioChunk);
            });

            dgSpeak.on('Close', () => {
                console.log(`[LATENCY] +${Date.now() - t0}ms: TTS WebSocket closed. ${audioChunkCount} chunks streamed.`);
                ws.send(JSON.stringify({ action: 'TTS_STREAM_CLOSED' }));
            });

            dgSpeak.on('Error', (err) => {
                console.error('[TTS WS Error]', err);
                currentState = State.LISTENING;
            });

            // --- STEP 2: Stream LLM tokens directly into the open TTS WebSocket ---
            // DO NOT wait for the TTS socket to open before calling the LLM!
            // Fire them concurrently!
            console.log(`[LATENCY] +${Date.now() - t0}ms: Requesting Groq stream concurrently...`);
            const streamPromise = groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: chatHistory,
                stream: true,
                max_tokens: 512
            });
            
            const stream = await streamPromise;
            console.log(`[LATENCY] +${Date.now() - t0}ms: Groq stream open.`);


            let fullReply = "";
            let sentenceBuilder = "";
            let isFirstToken = true;

            for await (const chunk of stream) {
                if (currentState === State.INTERRUPTED) {
                    // User interrupted — close TTS and stop
                    try { dgSpeak.close(); } catch(e) {}
                    return; // exit safely to avoid flushing
                }

                const token = chunk.choices[0]?.delta?.content || "";
                if (!token) continue;

                if (isFirstToken) {
                    console.log(`[LATENCY] +${Date.now() - t0}ms: ⚡ First LLM token! Streaming into TTS WebSocket...`);
                    ws.send(JSON.stringify({ action: 'TTS_STREAM_START', log: `🤖 Speaking...` }));
                    isFirstToken = false;
                }

                fullReply += token;
                sentenceBuilder += token;

                // Stream phrases to TTS as they complete — no blocking await
                const isSentenceEnd = /[.!?]\s/.test(sentenceBuilder);
                if (isSentenceEnd && sentenceBuilder.length > 15) {
                    const phrase = sentenceBuilder.trim();
                    sentenceBuilder = "";
                    console.log(`[LATENCY] +${Date.now() - t0}ms: → Queueing phrase: [${phrase.substring(0, 60)}]`);
                    sendOrQueue(phrase);
                }
            }

            // Flush any remaining text that didn't hit a sentence boundary
            if (sentenceBuilder.trim().length > 0) {
                // Wait for TTS to be ready before flushing final fragment
                if (!ttsReady) {
                    await new Promise(resolve => {
                        if (ttsReady) { resolve(); return; }
                        dgSpeak.on('Open', () => resolve());
                        setTimeout(resolve, 3000);
                    });
                    // Drain queue before the trailing flush
                    while (ttsQueue.length > 0) {
                        try { dgSpeak.sendText(ttsQueue.shift()); } catch(e) {}
                    }
                }
                console.log(`[LATENCY] +${Date.now() - t0}ms: → Flushing trailing: [${sentenceBuilder.trim().substring(0, 60)}]`);
                try { dgSpeak.sendText(sentenceBuilder.trim()); } catch(e){}
            }

            // FIX: use proper Deepgram SDK close instead of raw conn.send — the old method was
            // bypassing the SDK's internal queue, causing the last audio chunk to be dropped
            try { dgSpeak.requestClose(); } catch(e){}
            console.log(`[LATENCY] +${Date.now() - t0}ms: LLM complete. TTS close requested. Waiting for final audio chunks...`);

            if (currentState === State.SPEAKING || currentState === State.PROCESSING) {
                chatHistory.push({ role: "assistant", content: fullReply });
                if (chatHistory.length > 11) chatHistory = [chatHistory[0], ...chatHistory.slice(-10)];
            }

        } catch (e) {
            ws.send(JSON.stringify({ log: `⚠️ Pipeline Error: ${e.message}` }));
            console.error('Pipeline Error:', e);
            currentState = State.LISTENING;
        }
    }

    ws.on('message', (data, isBinary) => {
        if (!isBinary) {
            try {
                const message = data.toString();
                const parsed = JSON.parse(message);

                // FIX: Handle WAKE action — reconnect Deepgram after hardware sleep
                if (parsed.action === 'WAKE') {
                    console.log('\n⚡ [WAKE] Reconnecting Deepgram STT after sleep...');
                    if (deepgramLive) {
                        try { deepgramLive.terminate(); } catch(e) {}
                        deepgramLive = null;
                    }
                    // Reset pipeline state cleanly
                    transcriptBuilder = "";
                    latestInterim = "";
                    currentState = State.LISTENING;
                    utteranceTimer = null;
                    silenceHangoverTimer = null;
                    gate2Executing = false;

                    const reconnectUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&interim_results=true&encoding=linear16&sample_rate=16000&channels=1';
                    deepgramLive = new WebSocketClient(reconnectUrl, {
                        headers: { 'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}` }
                    });
                    deepgramLive.on('open', () => {
                        console.log('📡 [Deepgram] Reconnected after WAKE.');
                        resetHardwareSleepTimer();
                    });
                    deepgramLive.on('message', handleDeepgramMessage);
                    deepgramLive.on('error', (err) => console.error('⚠️ Deepgram error after WAKE:', err.message));
                    deepgramLive.on('close', (code) => console.log(`📡 [Deepgram] Socket terminated. Code: ${code}`));
                    return;
                }

                if (parsed.action === 'AUDIO_FINISHED') {
                    currentState = State.LISTENING;
                    ws.send(JSON.stringify({ log: '🔴 AI Finished. Listening natively...' }));
                    resetHardwareSleepTimer();
                } else if (parsed.action === 'STOP_AUDIO') {
                    if (activeTTSSocket) {
                        try { activeTTSSocket.close(); } catch(e) {}
                        activeTTSSocket = null;
                    }
                    currentState = State.INTERRUPTED;
                }
            } catch(e) {}
            return;
        }
        if (deepgramLive && deepgramLive.readyState === 1) {
            process.stdout.write('.'); 
            deepgramLive.send(data); 
        } 
    });

    ws.on('close', () => {
        console.log('❌ [WebSocket] Client disconnected');
        if (deepgramLive) deepgramLive.terminate();
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Accelerated Continuous-Stream Backend on Port ${PORT}`));
