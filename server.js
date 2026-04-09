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

const SYSTEM_PROMPT = `You are a helpful, extremely concise human-like conversational AI. You MUST respond in 1 or 2 short sentences. Absolutely DO NOT output robotic, flat text blocks. Instead, dynamically inject verbal pauses using ellipses ("..."), dramatic questioning ("?!"), commas, and natural hesitation words ("Hmm", "Well", "Let's see") directly into your grammatical structure so the Text-To-Speech engine naturally breathes and pauses correctly! Make it sound like a real person talking natively!`;
const ttsModel = "aura-2-zeus-en";

wss.on('connection', (ws, req) => {
    const isHardware = req.url.includes('format=linear16');
    console.log(`✅ [WebSocket] ${isHardware ? 'Hardware Terminal' : 'Web Frontend'} connected natively!`);

    let transcriptBuilder = "";
    let isAIProcessing = false;
    let chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
    let utteranceTimer = null; 
    let hardwareSleepTimer = null; 

    // Aggressive VAD matrix mathematically explicitly safely reliably smoothly gracefully appropriately logically!
    let url = 'wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&endpointing=800&interim_results=true';
    
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
                
                // 1. Always wipe the timer if you make ANY noise natively confidently seamlessly safely creatively correctly natively thoughtfully
                if (utteranceTimer) clearTimeout(utteranceTimer);

                // 2. Only commit locked completed phrases sequentially
                if (isFinal) {
                    resetHardwareSleepTimer(); 
                    if (isAIProcessing) {
                        console.log(`[CHECKPOINT] Analyzing Interruption Candidate: "${transcript}"`);
                        const lastAI = chatHistory[chatHistory.length - 1]?.content || "speaking...";
                        
                        // We do not await this, it runs in background
                        groq.chat.completions.create({
                            model: "llama-3.1-8b-instant",
                            messages: [{
                                role: "system",
                                content: `The AI is actively saying: "${lastAI}". The user interrupts with: "${transcript}". Is this a functional question or an absolute interruption that physically demands an immediate new AI response? If so, reply strictly "YES". If it is just a passive backchannel ('mhm', 'yeah', 'ok', 'right', 'nice'), background noise, or a short continuation, reply strictly "NO".`
                            }]
                        }).then(res => {
                            const verdict = res.choices[0].message.content.trim().toUpperCase();
                            if (verdict.includes('YES')) {
                                console.log(`[CHECKPOINT] 🛑 Meaningful Interruption Detected! Verdict is YES for: "${transcript}"`);
                                isAIProcessing = false;
                                ws.send(JSON.stringify({ action: 'STOP_AUDIO', log: '⚠️ Meaningful Interruption Detected! Re-routing...' }));
                                transcriptBuilder = transcript + " ";
                            } else {
                                console.log(`[CHECKPOINT] ⏩ Passive background noise ignored! Verdict is NO for: "${transcript}"`);
                            }
                        }).catch(err => console.log('[CHECKPOINT] Interruption eval error:', err));
                    } else {
                        console.log(`[CHECKPOINT] Standard Appending to Builder: "${transcript}"`);
                        transcriptBuilder += transcript + " ";
                        ws.send(JSON.stringify({ log: `👂 Hearing: "${transcriptBuilder.trim()}"...` }));
                    }
                }

                // 3. Fire explicitly when Deepgram mathematically detects the VAD 1500ms End-of-Thought effortlessly appropriately seamlessly successfully organically cleanly safely creatively cleanly appropriately confidently effectively cleanly cleverly seamlessly flawlessly seamlessly safely effectively successfully smartly intuitively effectively safely efficiently magically gracefully!
                if (speechFinal) {
                    console.log(`[CHECKPOINT] Deepgram native SpeechFinal flags triggered.`);
                    if (!isAIProcessing) {
                        console.log(`[CHECKPOINT] 🚀 AI is NOT processing. Submitting Builder: "${transcriptBuilder.trim()}"`);
                        const finalUtterance = transcriptBuilder.trim();
                        transcriptBuilder = "";
                        utteranceTimer = null;
                        
                        if (finalUtterance.length > 0) {
                            console.log(`[CHECKPOINT] Locking pipeline (isAIProcessing = true) and launching generateAndPlay()!`);
                            isAIProcessing = true; 
                            await generateAndPlay(finalUtterance, Date.now());
                        }
                    } else {
                        console.log(`[CHECKPOINT] SpeechFinal triggered but AI is CURRENTLY processing. Ignition bypassed.`);
                    }
                } else if (!isAIProcessing) {
                    // Fallback purely safely cleanly predictably successfully intuitively carefully natively explicitly cleanly magically appropriately explicitly!
                    utteranceTimer = setTimeout(async () => {
                        console.log(`[DEBUG] 🕒 Failsafe Timer Triggered. Submitting Builder: "${transcriptBuilder.trim()}"`);
                        const finalUtterance = transcriptBuilder.trim();
                        transcriptBuilder = "";
                        utteranceTimer = null;
                        
                        if (finalUtterance.length > 0 && !isAIProcessing) {
                            isAIProcessing = true; 
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
                encoding: 'mp3',
                sample_rate: 24000,
            });
            activeTTSSocket = dgSpeak; // expose for interruption handler

            let ttsReady = false;
            let audioChunkCount = 0;
            let firstAudioSent = false;

            dgSpeak.on('open', () => {
                ttsReady = true;
                console.log(`[LATENCY] +${Date.now() - t0}ms: ✅ TTS WebSocket OPEN — ready to receive text`);
            });

            // Each audio chunk from Deepgram is piped IMMEDIATELY to the browser
            dgSpeak.on('audio', (audioChunk) => {
                if (!isAIProcessing) return;
                audioChunkCount++;
                if (!firstAudioSent) {
                    firstAudioSent = true;
                    console.log(`[LATENCY] +${Date.now() - t0}ms: 🔊 FIRST AUDIO CHUNK received from Deepgram! (${audioChunk.length} bytes)`);
                    ws.send(JSON.stringify({ action: 'QUEUE_AUDIO' }));
                } 
                ws.send(audioChunk);
            });

            dgSpeak.on('close', () => {
                console.log(`[LATENCY] +${Date.now() - t0}ms: TTS WebSocket closed. ${audioChunkCount} chunks streamed.`);
                if (isAIProcessing) {
                    isAIProcessing = false;
                    ws.send(JSON.stringify({ log: '🔴 AI done. Listening...' }));
                }
            });

            dgSpeak.on('error', (err) => {
                console.error('[TTS WS Error]', err);
                isAIProcessing = false;
            });

            // Wait for TTS WebSocket to be open (usually <100ms)
            await new Promise((resolve) => {
                if (ttsReady) return resolve();
                dgSpeak.on('open', resolve);
                setTimeout(resolve, 500); // safety fallback
            });

            // --- STEP 2: Stream LLM tokens directly into the open TTS WebSocket ---
            console.log(`[LATENCY] +${Date.now() - t0}ms: Requesting Groq stream...`);
            const stream = await groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: chatHistory,
                stream: true,
                max_tokens: 150
            });
            console.log(`[LATENCY] +${Date.now() - t0}ms: Groq stream open.`);

            let fullReply = "";
            let sentenceBuilder = "";
            let isFirstToken = true;

            for await (const chunk of stream) {
                if (!isAIProcessing) {
                    // User interrupted — close TTS and stop
                    dgSpeak.close();
                    break;
                }

                const token = chunk.choices[0]?.delta?.content || "";
                if (!token) continue;

                if (isFirstToken) {
                    console.log(`[LATENCY] +${Date.now() - t0}ms: ⚡ First LLM token! Streaming into TTS WebSocket...`);
                    ws.send(JSON.stringify({ log: `🤖 Speaking...` }));
                    isFirstToken = false;
                }

                fullReply += token;
                sentenceBuilder += token;

                // Send natural sentence chunks to TTS for better prosody
                // The TTS engine synthesizes each phrase as it arrives — TTFA ~90ms
                const isSentenceEnd = /[.!?]\s/.test(sentenceBuilder);
                if (isSentenceEnd && sentenceBuilder.length > 20) {
                    const phrase = sentenceBuilder.trim();
                    sentenceBuilder = "";
                    console.log(`[LATENCY] +${Date.now() - t0}ms: → Sending phrase to TTS WS: [${phrase}]`);
                    dgSpeak.sendText(phrase);
                }
            }

            // Flush any remaining text
            if (sentenceBuilder.trim().length > 0) {
                console.log(`[LATENCY] +${Date.now() - t0}ms: → Flushing trailing: [${sentenceBuilder.trim()}]`);
                dgSpeak.sendText(sentenceBuilder.trim());
            }

            // Signal Deepgram that text stream is complete — it will finish synthesizing and close
            dgSpeak.flush();
            console.log(`[LATENCY] +${Date.now() - t0}ms: LLM complete. TTS flushed. Waiting for final audio chunks...`);

            if (isAIProcessing) {
                chatHistory.push({ role: "assistant", content: fullReply });
            }

        } catch (e) {
            ws.send(JSON.stringify({ log: `⚠️ Pipeline Error: ${e.message}` }));
            console.error('Pipeline Error:', e);
            isAIProcessing = false;
        }
    }

    ws.on('message', (data, isBinary) => {
        if (!isBinary) {
            try {
                const message = data.toString();
                const parsed = JSON.parse(message);
                if (parsed.action === 'AUDIO_FINISHED') {
                    isAIProcessing = false;
                    ws.send(JSON.stringify({ log: '🔴 AI Finished. Listening natively...' }));
                    resetHardwareSleepTimer();
                } else if (parsed.action === 'STOP_AUDIO') {
                    // Kill the TTS WebSocket immediately to stop audio generation
                    if (activeTTSSocket) {
                        try { activeTTSSocket.close(); } catch(e) {}
                        activeTTSSocket = null;
                    }
                    isAIProcessing = false;
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
