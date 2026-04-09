const { DeepgramClient } = require('@deepgram/sdk');
const dg = new DeepgramClient({ apiKey: '123' });
console.log('listen keys:', Object.keys(dg.listen));
console.log('listen v1 keys?:', dg.listen.live);
