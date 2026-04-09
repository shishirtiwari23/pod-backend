require('dotenv').config();
const { createClient } = require('@deepgram/sdk');
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const dgSpeak = deepgram.speak.live({ model: 'aura-zeus-en', encoding: 'linear16', sample_rate: 24000 });

dgSpeak.on('Open', () => {
    dgSpeak.sendText("Hello world!");
    dgSpeak.flush();
    dgSpeak.conn.send(JSON.stringify({ type: 'Close' }));
});

let bytes = 0;
dgSpeak.on('Audio', (data) => {
    bytes += data.byteLength || data.length || 0;
});

dgSpeak.on('Close', () => {
    console.log("Graceful close received! Audio bytes:", bytes);
});
