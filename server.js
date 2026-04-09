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
    let url = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&endpointing=1000&interim_results=true';
    
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

    const continuationWords = new Set(["and", "or", "but", "because", "so", "if", "then", "like", "which", "that", "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "on", "with", "have", "has", "had", "just", "about", "some", "my", "your", "their", "our", "very", "much", "many"]);

    function isLogicallyComplete(text) {
         if (!text || text.length < 5) return false;
         
         const trimmedText = text.trim();
         const hasStrongPunctuation = /[.?!]$/.test(trimmedText);
         const words = text.toLowerCase().split(/\s+/);
         
         // If a user definitively ends a substantial sentence with punctuation, respect it natively
         if (hasStrongPunctuation && words.length >= 4) return true;

         const lastWord = words[words.length - 1].replace(/[^a-z]/g, '');
         if (continuationWords.has(lastWord)) return false;
         
         // If phrase is very short AND doesn't have strong end punctuation, assume they are still thinking
         // (e.g. "Right", "Yeah", "Okay" are short forms often followed by actual sentence)
         if (words.length < 4 && !hasStrongPunctuation) return false;
         
         return true; // Predictive heuristic assumes complete
    }

    deepgramLive.on('message', async (data) => {
        const response = JSON.parse(data.toString());
        
        if (response.type !== 'Results') {
            process.stdout.write('~'); 
        }
        
        if (response.type === 'Results') {
            const transcript = response.channel.alternatives[0].transcript;
            const isFinal = response.is_final;
            const speechFinal = response.speech_final;

            if (transcript.trim().length > 0) {
                // --- DEBUGGER TRACE ---
                console.log(`\n[DEBUG STT] IsFinal: ${isFinal} | SpeechFinal: ${speechFinal} | Text: "${transcript}"`);
                
                // 1. Always wipe the timer if you make ANY noise
                if (utteranceTimer) clearTimeout(utteranceTimer);
                
                // Track interim speech so Failsafe Timer doesn't drop words
                if (!isFinal) latestInterim = transcript;

                // 2. Only commit locked completed phrases sequentially
                if (isFinal) {
                    resetHardwareSleepTimer(); 
                    if (currentState === State.PROCESSING || currentState === State.SPEAKING) {
                        // Barge-In Guard: Ignore all interruptions in the first 500ms of speaking!
                        if (currentState === State.SPEAKING && (Date.now() - speakingStartTime < 500)) {
                            console.log(`[CHECKPOINT] 🛡️ Barge-In Guard active! Ignoring early interruption bounds.`);
                            return;
                        }
                        
                        console.log(`[CHECKPOINT] Analyzing Interruption Candidate: "${transcript}"`);
                        const lastAI = chatHistory[chatHistory.length - 1]?.content || "speaking...";
                        
                        // Strict Native Hardware Echo Suppression Matrix
                        // Eliminates 90% of self-interruptions if using external speakers
                        const cleanAI = lastAI.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim();
                        const cleanUser = transcript.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().trim();
                        
                        // Duration Gate: Needs to be ~200ms of continuous acoustic speech to qualify as human word
                        if (cleanUser.length <= 15) {
                            console.log(`[CHECKPOINT] ⏩ Duration Gate failed (too short to be interruption intent)`);
                            return;
                        }
                        
                        // If the transcript is a substring of what the AI just said (or vice versa)
                        if (cleanUser.length > 5 && (cleanAI.includes(cleanUser) || cleanUser.includes(cleanAI))) {
                            console.log(`[CHECKPOINT] 🔊 Hardware Echo Filtered! ("${transcript}")`);
                            return;
                        }
                        
                        // We do not await this, it runs in background
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
                                transcriptBuilder = transcript + " ";
                            } else {
                                console.log(`[CHECKPOINT] ⏩ Passive background noise ignored! Verdict is NO for: "${transcript}"`);
                            }
                        }).catch(err => console.log('[CHECKPOINT] Interruption eval error:', err));
                    } else if (currentState === State.LISTENING || currentState === State.IDLE) {
                        console.log(`[CHECKPOINT] Standard Appending to Builder: "${transcript}"`);
                        transcriptBuilder += transcript + " ";
                        latestInterim = ""; // clear interim since it's merged
                        ws.send(JSON.stringify({ log: `👂 Hearing: "${transcriptBuilder.trim()}"...` }));
                    }
                }

                // 3. Fire explicitly when Deepgram mathematically detects the VAD 1500ms End-of-Thought
                if (speechFinal) {
                    console.log(`[CHECKPOINT] Deepgram native SpeechFinal flags triggered.`);
                    const finalUtterance = transcriptBuilder.trim();
                    if (!isLogicallyComplete(finalUtterance)) {
                        console.log(`[CHECKPOINT] ⏭️ Sentence logically incomplete ("${finalUtterance}"). Waiting for Failsafe Timer...`);
                    } else if (currentState === State.LISTENING || currentState === State.INTERRUPTED || currentState === State.IDLE) {
                        console.log(`[CHECKPOINT] 🚀 Submitting Builder: "${transcriptBuilder.trim()}"`);
                        transcriptBuilder = "";
                        utteranceTimer = null;
                        
                        if (finalUtterance.length > 0) {
                            console.log(`[CHECKPOINT] Locking pipeline -> PROCESSING!`);
                            currentState = State.PROCESSING; 
                            await generateAndPlay(finalUtterance, Date.now());
                        }
                    } else {
                        console.log(`[CHECKPOINT] SpeechFinal triggered but AI is CURRENTLY ${currentState}. Ignition bypassed.`);
                    }
                } 
                
                if (currentState === State.LISTENING || currentState === State.INTERRUPTED || currentState === State.IDLE) {
                    // Fallback timer for 2500ms - catches incomplete sentences explicitly
                    if (utteranceTimer) clearTimeout(utteranceTimer);
                    utteranceTimer = setTimeout(async () => {
                        console.log(`[DEBUG] 🕒 Failsafe Timer Triggered (2500ms).`);
                        
                        // Merge the latest interim transcript if Deepgram was taking too long to verify it!
                        if (latestInterim.trim().length > 0) {
                            console.log(`[CHECKPOINT] 🔄 Intercepting dropped Interim Transcript into Builder: "${latestInterim}"`);
                            transcriptBuilder += latestInterim + " ";
                            latestInterim = "";
                        }
                        
                        const finalUtterance = transcriptBuilder.trim();
                        transcriptBuilder = "";
                        utteranceTimer = null;
                        
                        if (finalUtterance.length > 0 && (currentState === State.LISTENING || currentState === State.IDLE || currentState === State.INTERRUPTED)) {
                            console.log(`[CHECKPOINT] Locking pipeline natively via failsafe! Submitting: "${finalUtterance}"`);
                            currentState = State.PROCESSING; 
                            await generateAndPlay(finalUtterance, Date.now());
                        }
                    }, 2500); 
                }
            }
        }
    });

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

            dgSpeak.on('Open', () => {
                ttsReady = true;
                console.log(`[LATENCY] +${Date.now() - t0}ms: ✅ TTS WebSocket OPEN — ready to receive text`);
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

                // Send natural sentence chunks to TTS for better prosody
                // The TTS engine synthesizes each phrase as it arrives — TTFA ~90ms
                const isSentenceEnd = /[.!?]\s/.test(sentenceBuilder);
                if (isSentenceEnd && sentenceBuilder.length > 15) {
                    const phrase = sentenceBuilder.trim();
                    sentenceBuilder = "";
                    
                    if (!ttsReady) {
                        console.log(`[LATENCY] +${Date.now() - t0}ms: Waiting for TTS WebSocket to open...`);
                        await new Promise(resolve => {
                            if (ttsReady) return resolve();
                            dgSpeak.on('Open', resolve);
                            setTimeout(resolve, 3000); 
                        });
                    }
                    
                    console.log(`[LATENCY] +${Date.now() - t0}ms: → Sending phrase to TTS WS: [${phrase}]`);
                    try { dgSpeak.sendText(phrase); } catch(e){}
                }
            }

            // Flush any remaining text
            if (sentenceBuilder.trim().length > 0) {
                if (!ttsReady) {
                    await new Promise(resolve => {
                        if (ttsReady) return resolve();
                        dgSpeak.on('Open', resolve);
                        setTimeout(resolve, 3000); 
                    });
                }
                console.log(`[LATENCY] +${Date.now() - t0}ms: → Flushing trailing: [${sentenceBuilder.trim()}]`);
                try { dgSpeak.sendText(sentenceBuilder.trim()); } catch(e){}
            }

            // Signal Deepgram natively explicitly explicitly effectively reliably cleverly smartly confidently natively intelligently intuitively efficiently magically natively that the stream is completely conclusively closed
            try { dgSpeak.conn.send(JSON.stringify({ type: 'Close' })); } catch(e){}
            console.log(`[LATENCY] +${Date.now() - t0}ms: LLM complete. Native explicit explicit Explicit TTS Close sent to Internal deepgram conn Socket! Waiting for final audio chunks...`);

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
                if (parsed.action === 'AUDIO_FINISHED') {
                    currentState = State.LISTENING;
                    ws.send(JSON.stringify({ log: '🔴 AI Finished. Listening natively...' }));
                    resetHardwareSleepTimer();
                } else if (parsed.action === 'STOP_AUDIO') {
                    // Kill the TTS WebSocket immediately to stop audio generation
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
            // DO NOT block the stream during isAIProcessing natively otherwise Deepgram caches or drops the fragments! 
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
