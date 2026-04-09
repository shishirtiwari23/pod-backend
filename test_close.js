require('dotenv').config();
const { createClient } = require('@deepgram/sdk');
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const dgSpeak = deepgram.speak.live({ model: 'aura-zeus-en', encoding: 'linear16', sample_rate: 24000 });

dgSpeak.on('Open', () => {
    dgSpeak.sendText("Hello world!");
    dgSpeak.flush();
    try {
        dgSpeak.conn.close(); // let's see if conn exists
        console.log("conn.close() worked!");
    } catch(e) { console.error('conn error', e.message); }
});
