/**
 * Build a SYNTHETIC corpus with macOS system voices.
 *
 * WHY THIS EXISTS AND WHAT IT IS NOT: the deciding corpus is meant to be real
 * human speech, because a provider can be good at clean synthetic audio and bad
 * at a real candidate on a real phone. That corpus does not exist and may not
 * get made. This is the honest fallback, and its limits are recorded in the
 * corpus itself so no report can imply otherwise:
 *
 *   MEASURED VALIDLY   post-endpoint residual latency, and end-to-end total_turn.
 *                      These are timings over real audio through the real
 *                      narrowband codec, and they are the figures nobody has.
 *   DIRECTIONAL ONLY   word error rate and entity accuracy. A provider that
 *                      cannot handle Devanagari or code-switching still fails
 *                      visibly; one that aces synthetic speech has proved less.
 *   NOT MEASURED       accent robustness, and disfluency handling — a speech
 *                      synthesiser says exactly the text, so there are no
 *                      genuine fillers, hesitations or self-corrections.
 *
 * Apple's voices are used deliberately: Apple is not a benchmark candidate, so
 * no provider is scored on audio produced by its own sibling. Using Sarvam TTS
 * to make audio for Sarvam STT would be circular.
 *
 * The reference is the INPUT TEXT, exactly. That is the one advantage of a
 * synthetic corpus — the ground truth is known by construction rather than
 * transcribed by anybody.
 *
 *   node scripts/synthetic-corpus.mjs corpus/synthetic
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/synthetic-corpus.mjs <corpus-dir>'); process.exit(1); }

const E = (name, kind, accept, unit, reject) => ({
  name, kind, accept, ...(unit ? { unit } : {}), ...(reject ? { reject } : {}),
});

/**
 * The corpus. Each turn carries the fact categories the specification allocates
 * to that slot, so the category minimums are met.
 *
 * Written as an interview answer would be said, but plainly: a synthesiser
 * cannot deliver a hesitation, so pretending otherwise in the text would only
 * make the reference wrong.
 */
const CONVERSATIONS = [
  { id: 'conv-01', language: 'en-IN', voice: 'Rishi', turns: [
    { text: 'My name is Rajeshwari Krishnamurthy and my notice period is ninety days',
      e: [E('name','name',['rajeshwari']), E('notice','duration',['ninety days'],'days')] },
    { text: 'It is ninety days but I can bring it down to sixty days if needed',
      e: [E('notice2','duration',['ninety days'],'days'), E('reduced','number',['sixty days'],'days')] },
    { text: 'I have nineteen years of experience and my current CTC is twelve lakhs',
      e: [E('exp','number',['nineteen years'],'years'), E('ctc','money',['twelve lakhs'],'lakhs')] },
    { text: 'I am expecting eighteen lakhs and I can start from fourteenth October',
      e: [E('expected','money',['eighteen lakhs'],'lakhs'), E('start','date',['fourteenth october'])] },
    { text: 'The fourteenth suits me and I am currently based in Bengaluru',
      e: [E('date2','date',['the fourteenth']), E('city','location',['bengaluru'])] },
  ]},
  { id: 'conv-02', language: 'en-IN', voice: 'Aman', turns: [
    { text: 'My number is nine eight seven six five four three two one zero and my name is Venkateshwaran',
      e: [E('phone','phone',['9876543210']), E('name','name',['venkateshwaran'])] },
    { text: 'I live in Gurugram and my notice period is thirty days',
      e: [E('city','location',['gurugram']), E('notice','duration',['thirty days'],'days')] },
    { text: 'I cannot relocate right now and my team had fifteen people',
      e: [E('reloc','text',['cannot relocate']), E('team','number',['fifteen people'],'people')] },
    { text: 'My manager was Priyadarshini and my last drawn salary was nine lakhs',
      e: [E('mgr','name',['priyadarshini']), E('salary','money',['nine lakhs'],'lakhs')] },
    { text: 'To confirm the notice period is thirty days and the name is Venkateshwaran',
      e: [E('notice2','duration',['thirty days'],'days'), E('name2','name',['venkateshwaran'])] },
  ]},
  { id: 'conv-03', language: 'en-IN', voice: 'Tara', turns: [
    { text: 'I have nine years in this role and I owe them sixty days notice',
      e: [E('years','number',['nine years'],'years'), E('notice','duration',['sixty days'],'days')] },
    { text: 'My expected range is fifteen to eighteen lakhs and I am considering two offers',
      e: [E('range','money',['fifteen to eighteen lakhs'],'lakhs'), E('offers','number',['two'],'offers')] },
    { text: 'I need to decide by thirty first March and the package should be at least sixteen lakhs',
      e: [E('deadline','date',['thirty first march']),
          E('floor','money',['sixteen lakhs'],'lakhs')] },
    { text: 'My alternate number is nine one two three four five six seven eight nine',
      e: [E('alt','phone',['9123456789'])] },
    { text: 'I stay in Electronic City Phase One in Bengaluru',
      e: [E('area','location',['electronic city'])] },
  ]},
  { id: 'conv-04', language: 'en-IN', voice: 'Rishi', turns: [
    { text: 'No I am not able to relocate', e: [E('reloc','text',['not able to relocate'])] },
    { text: 'Thiruvananthapuram Nair', e: [E('surname','name',['nair'])] },
    { text: 'Ninety days', e: [E('notice','duration',['ninety days'],'days')] },
    { text: 'Fifteen years', e: [E('exp','number',['fifteen years'],'years')] },
    { text: 'Twenty two lakhs', e: [E('ctc','money',['twenty two lakhs'],'lakhs')] },
  ]},
  { id: 'conv-05', language: 'hi-IN', voice: 'Lekha', turns: [
    { text: 'मैं पंद्रह अक्टूबर से जॉइन कर सकती हूँ', alt: 'main pandrah october se join kar sakti hoon',
      e: [E('join','date',['पंद्रह अक्टूबर'])] },
    { text: 'मेरा नंबर नौ आठ सात छह पांच चार तीन दो एक शून्य है', alt: 'mera number nau aath saat chhah paanch chaar teen do ek shunya hai',
      e: [E('phone','phone',['9876543210'])] },
    { text: 'मैं अभी हैदराबाद में रहती हूँ', alt: 'main abhi hyderabad mein rehti hoon',
      e: [E('city','location',['हैदराबाद'])] },
    { text: 'मैं रिलोकेट नहीं कर सकती', alt: 'main relocate nahi kar sakti',
      e: [E('reloc','text',['रिलोकेट नहीं कर सकती'])] },
    { text: 'मेरा नाम सीतालक्ष्मी अय्यर है', alt: 'mera naam seetalakshmi iyer hai',
      e: [E('name','name',['सीतालक्ष्मी'])] },
  ]},
  { id: 'conv-06', language: 'hi-IN', voice: 'Lekha', turns: [
    { text: 'मेरा नोटिस पीरियड नब्बे दिन का है', alt: 'mera notice period nabbe din ka hai',
      e: [E('notice','duration',['नब्बे दिन'],'दिन')] },
    { text: 'मेरे पास बारह साल का अनुभव है', alt: 'mere paas barah saal ka anubhav hai',
      e: [E('exp','number',['बारह साल'],'साल')] },
    { text: 'मेरी सीटीसी दस लाख है', alt: 'meri ctc das lakh hai',
      e: [E('ctc','money',['दस लाख'],'लाख')] },
    { text: 'इंटरव्यू के लिए तीन नवंबर ठीक रहेगा', alt: 'interview ke liye teen november theek rahega',
      e: [E('date','date',['तीन नवंबर'])] },
    { text: 'दूसरा नंबर नौ दो एक तीन चार पांच छह सात आठ नौ है', alt: 'doosra number nau do ek teen chaar paanch chhah saat aath nau hai',
      e: [E('phone2','phone',['9213456789'])] },
  ]},
  { id: 'conv-07', language: 'hi-IN', voice: 'Lekha', turns: [
    { text: 'मैं पुणे से हूँ', alt: 'main pune se hoon', e: [E('city','location',['पुणे'])] },
    { text: 'हाँ मैं शिफ्ट होने के लिए तैयार हूँ', alt: 'haan main shift hone ke liye taiyar hoon',
      e: [E('reloc','text',['तैयार'])] },
    { text: 'मेरा नाम अनुराधा देशपांडे है', alt: 'mera naam anuradha deshpande hai',
      e: [E('name','name',['अनुराधा'])] },
    { text: 'मैं साठ दिन में जॉइन कर सकती हूँ', alt: 'main saath din mein join kar sakti hoon',
      e: [E('notice','duration',['साठ दिन'],'दिन')] },
    { text: 'मेरी टीम में आठ लोग थे', alt: 'meri team mein aath log the',
      e: [E('team','number',['आठ'],'लोग')] },
  ]},
  { id: 'conv-08', language: 'hinglish', voice: 'Lekha', cm: true, turns: [
    { text: 'मेरी करंट सीटीसी बारह लाख है और एक्सपेक्टेड अठारह लाख', alt: 'meri current ctc barah lakh hai aur expected atharah lakh',
      e: [E('ctc','money',['बारह लाख'],'लाख')] },
    { text: 'मैं बीस अक्टूबर तक जॉइन कर सकती हूँ', alt: 'main bees october tak join kar sakti hoon',
      e: [E('join','date',['बीस अक्टूबर'])] },
    { text: 'मेरा नंबर नौ नौ आठ सात छह पांच चार तीन दो एक है', alt: 'mera number nau nau aath saat chhah paanch chaar teen do ek hai',
      e: [E('phone','phone',['9987654321'])] },
    { text: 'अभी मैं मुंबई में बेस्ड हूँ', alt: 'abhi main mumbai mein based hoon',
      e: [E('city','location',['मुंबई'])] },
    { text: 'रिलोकेशन पॉसिबल नहीं है मेरे लिए', alt: 'relocation possible nahi hai mere liye',
      e: [E('reloc','text',['रिलोकेशन पॉसिबल नहीं है'])] },
  ]},
  { id: 'conv-09', language: 'hinglish', voice: 'Lekha', cm: true, turns: [
    { text: 'मेरा फुल नेम कविता सुब्रमण्यम है', alt: 'mera full name kavita subramaniam hai',
      e: [E('name','name',['कविता'])] },
    { text: 'नोटिस पीरियड पैंतालीस दिन का है', alt: 'notice period paintalis din ka hai',
      e: [E('notice','duration',['पैंतालीस दिन'],'दिन')] },
    { text: 'मेरे पास सात साल का एक्सपीरियंस है', alt: 'mere paas saat saal ka experience hai',
      e: [E('exp','number',['सात साल'],'साल')] },
    { text: 'एक्सपेक्टेड पैकेज बीस लाख रखा है', alt: 'expected package bees lakh rakha hai',
      e: [E('pkg','money',['बीस लाख'],'लाख')] },
    { text: 'इंटरव्यू के लिए पच्चीस सितंबर सूट करेगा', alt: 'interview ke liye pachchees september suit karega',
      e: [E('date','date',['पच्चीस सितंबर'])] },
  ]},
  { id: 'conv-10', language: 'hinglish', voice: 'Lekha', cm: true, turns: [
    { text: 'कॉन्टैक्ट नंबर नौ आठ छह पांच चार तीन दो एक शून्य नौ है', alt: 'contact number nau aath chhah paanch chaar teen do ek shunya nau hai',
      e: [E('phone','phone',['9865432109'])] },
    { text: 'मैं चेन्नई में रहती हूँ', alt: 'main chennai mein rehti hoon',
      e: [E('city','location',['चेन्नई'])] },
    { text: 'रिलोकेट कर सकती हूँ अगर पैकेज सही हो', alt: 'relocate kar sakti hoon agar package sahi ho',
      e: [E('reloc','text',['रिलोकेट'])] },
    { text: 'नाम कन्फर्म कर दीजिए मीनाक्षी रामनाथन', alt: 'naam confirm kar dijiye meenakshi ramanathan',
      e: [E('name','name',['मीनाक्षी'])] },
    { text: 'नोटिस सर्व करना पड़ेगा नब्बे दिन का', alt: 'notice serve karna padega nabbe din ka',
      e: [E('notice','duration',['नब्बे दिन'],'दिन')] },
  ]},
  { id: 'conv-11', language: 'hinglish', voice: 'Lekha', cm: true, turns: [
    { text: 'टोटल एक्सपीरियंस नौ साल है', alt: 'total experience nau saal hai',
      e: [E('exp','number',['नौ साल'],'साल')] },
    { text: 'करंट पंद्रह लाख और एक्सपेक्टेड बाईस लाख', alt: 'current pandrah lakh aur expected baais lakh',
      e: [E('ctc','money',['पंद्रह लाख'],'लाख')] },
    { text: 'जॉइनिंग डेट पहली दिसंबर सोच रही हूँ', alt: 'joining date pehli december soch rahi hoon',
      e: [E('join','date',['पहली दिसंबर'])] },
    { text: 'बेस लोकेशन गुड़गांव है', alt: 'base location gurgaon hai',
      e: [E('city','location',['गुड़गांव'])] },
    { text: 'और मेरा नाम लक्ष्मी नारायणन है', alt: 'aur mera naam lakshmi narayanan hai',
      e: [E('name','name',['लक्ष्मी'])] },
  ]},
];

await mkdir(join(out, 'audio'), { recursive: true });
const utterances = [];
const speakers = new Set();

for (const c of CONVERSATIONS) {
  for (const [i, t] of c.turns.entries()) {
    const id = `${c.id}-t${i + 1}`;
    const speakerId = `tts-${c.voice.toLowerCase()}`;
    speakers.add(speakerId);
    await run('say', [
      '-v', c.voice, '--file-format=WAVE', '--data-format=LEI16@16000',
      '-o', join(out, 'audio', `${id}.wav`), t.text,
    ]);
    utterances.push({
      utteranceId: id, file: `audio/${id}.wav`, language: c.language,
      codeMixed: Boolean(c.cm), reference: t.text,
      ...(t.alt ? { referenceAlt: t.alt } : {}),
      entities: t.e ?? [], speakerId, environment: 'quiet',
      conversationId: c.id, turnIndex: i,
    });
    process.stdout.write('.');
  }
}
console.log('');

const PROCESSORS = ['sarvam', 'deepgram', 'elevenlabs', 'cartesia', 'gemini'];
await writeFile(join(out, 'manifest.json'), JSON.stringify({
  corpusVersion: 'synthetic-1',
  description:
    'SYNTHETIC CORPUS — audio generated by macOS system voices, NOT human speech. '
    + 'Latency figures are valid; word error rate and entity accuracy are DIRECTIONAL ONLY; '
    + 'accent robustness and disfluency handling are NOT MEASURED. '
    + 'Apple is not a benchmark candidate, so no provider is scored on audio made by a sibling.',
  audio: { sampleRate: 16000, channels: 1, bitsPerSample: 16, minDurationMs: 500, maxDurationMs: 30000 },
  transliterationAliases: {},
  consent: [...speakers].map((speakerId) => ({
    speakerId, obtainedAt: '2026-08-24', coversCrossBorderTransfer: true,
    disclosedProcessors: PROCESSORS.map((p) =>
      `${p} — synthetic speech only. No human voice is present in this corpus, so no personal data is transferred.`),
    retentionUntil: '2027-08-24',
    deletionContact: 'not-applicable-synthetic-corpus@example.invalid',
  })),
  utterances,
}, null, 2) + '\n', 'utf8');

console.log(`${utterances.length} synthetic utterances -> ${out}`);
console.log('Reference text IS the input text. Nothing was transcribed.');
