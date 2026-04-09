require('dotenv').config();
const { createClient } = require('@deepgram/sdk');
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const dgSpeak = deepgram.speak.live({ model: 'aura-zeus-en', encoding: 'linear16', sample_rate: 24000 });

dgSpeak.on('Open', () => {
    try {
        dgSpeak.flush();
        console.log('flush() worked!');
    } catch(e) {
        console.error('flush() threw:', e);
    }
});
