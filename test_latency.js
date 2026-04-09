require('dotenv').config();
const { createClient } = require('@deepgram/sdk');
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const t0 = Date.now();
const dgSpeak = deepgram.speak.live({
    model: 'aura-zeus-en',
    encoding: 'linear16',
    sample_rate: 24000
});

dgSpeak.on('Open', () => {
    console.log(`Opened in ${Date.now() - t0}ms`);
    process.exit(0);
});
