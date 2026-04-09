require('dotenv').config();
const { createClient } = require('@deepgram/sdk');
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const dgSpeak = deepgram.speak.live({ model: 'aura-zeus-en', encoding: 'linear16', sample_rate: 24000 });

dgSpeak.on('Open', () => {
    dgSpeak.sendText('Hello world');
    console.log('Available methods:', Object.keys(dgSpeak.__proto__), Object.keys(dgSpeak));
    try {
        dgSpeak.finish();
        console.log('finish() worked!');
    } catch(e) {
        console.error('finish() threw:', e);
    }
    
    try {
        dgSpeak.close();
        console.log('close() worked!');
    } catch(e) {
         console.error('close() threw:', e);
    }
});
