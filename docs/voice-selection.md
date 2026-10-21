# Voice selection: Google Chirp 3 HD

Chosen from our own clarity test (2026-10-18/19), not from memory. Full data is in
`apps/web/public/voice-samples/multilingual/results.json`.

**Decision (2026-10-19): two voices, Kore (female) and Iapetus (male), for every language.**

## Picks for Indian callers

| | Voice | Indian-language rank (of 30) | Average error, 11 Indian languages | Worst Indian language | Overall rank, 52 languages |
|---|---|---|---|---|---|
| Female | **Kore** | #1 | 3.2% | Malayalam 4.0% | #22 |
| Male | **Iapetus** | #2 | 3.2% | Hindi 3.3% | #2 |

Error = how much the speech recogniser got wrong compared with what it heard from the other
29 voices (lower is clearer), averaged over clean audio and an 8 kHz phone-line copy.

Why these two:
- **Kore**: clearest female voice on the 11 Indian languages, with no language where it falls
  behind the other voices. Deepgram (a second recogniser) also found it almost perfect on
  English and Hindi (0.2%). Its only slip in any of the 52 languages is Romanian.
- **Iapetus**: #2 on Indian languages and #2 overall, with no slips in any of the 52 languages,
  and among the fewest wrong digits on the phone line (3.8% in Indian languages).
  It is the safest single voice if we add more languages.
- Backups: Gacrux (female, #3 overall, no slips, but #14 on Indian languages) and
  Fenrir (male, #1 overall, #6 on Indian languages).
- Avoid: Vindemiatrix, Achird, Pulcherrima (clear slips in Kannada, Marathi, Gujarati, Telugu, Tamil).

Caveat: most voices score very close to each other, and repeating the test on a different half of
the data gives a different order. Treat the ranking as "these are safe, these to avoid", not as an
exact order. Confirm by ear before launch.

## India launch: which languages

Source: Census of India 2011, Table C-16 (speakers by mother tongue, 22 scheduled languages);
this is the latest published language census. Languages above 1% of the population:

| # | Language | Mother-tongue speakers (millions) | Share of India | Google Chirp 3 HD voice? | Female voice ID | Male voice ID | Note |
|---|---|---|---|---|---|---|---|
| 1 | Hindi | 528.3 | 43.63% | Yes | `hi-IN-Chirp3-HD-Kore` | `hi-IN-Chirp3-HD-Iapetus` | clear in our test |
| 2 | Bengali | 97.2 | 8.03% | Yes | `bn-IN-Chirp3-HD-Kore` | `bn-IN-Chirp3-HD-Iapetus` | clear in our test |
| 3 | Marathi | 83.0 | 6.86% | Yes | `mr-IN-Chirp3-HD-Kore` | `mr-IN-Chirp3-HD-Iapetus` | slightly weaker for every voice; test with real calls |
| 4 | Telugu | 81.1 | 6.70% | Yes | `te-IN-Chirp3-HD-Kore` | `te-IN-Chirp3-HD-Iapetus` | clear in our test |
| 5 | Tamil | 69.0 | 5.70% | Yes | `ta-IN-Chirp3-HD-Kore` | `ta-IN-Chirp3-HD-Iapetus` | clear in our test |
| 6 | Gujarati | 55.5 | 4.58% | Yes | `gu-IN-Chirp3-HD-Kore` | `gu-IN-Chirp3-HD-Iapetus` | clear in our test |
| 7 | Urdu | 50.8 | 4.19% | Yes | `ur-IN-Chirp3-HD-Kore` | `ur-IN-Chirp3-HD-Iapetus` | weaker for every voice (digits); test with real calls |
| 8 | Kannada | 43.7 | 3.61% | Yes | `kn-IN-Chirp3-HD-Kore` | `kn-IN-Chirp3-HD-Iapetus` | clear in our test |
| 9 | Odia | 37.5 | 3.10% | **No** | – | – | not offered by Google; needs another provider |
| 10 | Malayalam | 34.8 | 2.88% | Yes | `ml-IN-Chirp3-HD-Kore` | `ml-IN-Chirp3-HD-Iapetus` | clear in our test |
| 11 | Punjabi | 33.1 | 2.74% | Yes | `pa-IN-Chirp3-HD-Kore` | `pa-IN-Chirp3-HD-Iapetus` | clear in our test |
| 12 | Assamese | 15.3 | 1.26% | **No** | – | – | not offered by Google; needs another provider |
| 13 | Maithili | 13.6 | 1.12% | **No** | – | – | not offered by Google; needs another provider |

**Launch set for India (11 languages):** English (India) `en-IN` plus the 10 Indian languages
above that Google offers: Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Urdu, Kannada,
Malayalam, Punjabi. Together they are the mother tongue of **88.9%** of India, and all 11
were in our clarity test with these exact voice IDs. English (India) is included because it is the
common language of hiring and support calls (Census counts it mainly as a second language).

**Not covered by Google (about 5.5% of India):** Odia (3.10%), Assamese (1.26%) and Maithili
(1.12%; many Maithili speakers also use Hindi, not verified). Google has no voice of any kind for these,
so adding them means using another speech provider and testing that separately.

**Then global:** use the per-language table below; the same two personas exist in every
language Google offers (exceptions noted there).

## Voice ID per language (all languages, for global launch)

Format: `<language code>-Chirp3-HD-<Persona>`. The same persona sounds like the same person in
every language, so we keep one female and one male persona everywhere.

| Language | Code | Female voice ID | Male voice ID | Female error | Male error | Typical voice error / note |
|---|---|---|---|---|---|---|
| English (India) | en-IN | `en-IN-Chirp3-HD-Kore` | `en-IN-Chirp3-HD-Iapetus` | 0.4% | 0.0% | 0.0% |
| Hindi | hi-IN | `hi-IN-Chirp3-HD-Kore` | `hi-IN-Chirp3-HD-Iapetus` | 2.0% | 3.3% | 1.8% |
| Bengali | bn-IN | `bn-IN-Chirp3-HD-Kore` | `bn-IN-Chirp3-HD-Iapetus` | 0.9% | 2.4% | 1.6% |
| Gujarati | gu-IN | `gu-IN-Chirp3-HD-Kore` | `gu-IN-Chirp3-HD-Iapetus` | 3.6% | 3.0% | 3.0% |
| Kannada | kn-IN | `kn-IN-Chirp3-HD-Kore` | `kn-IN-Chirp3-HD-Iapetus` | 0.4% | 1.9% | 1.8% |
| Malayalam | ml-IN | `ml-IN-Chirp3-HD-Kore` | `ml-IN-Chirp3-HD-Iapetus` | 4.0% | 2.0% | 3.6% |
| Marathi | mr-IN | `mr-IN-Chirp3-HD-Kore` | `mr-IN-Chirp3-HD-Iapetus` | 5.9% | 4.3% | 5.5% — weak for every voice |
| Punjabi | pa-IN | `pa-IN-Chirp3-HD-Kore` | `pa-IN-Chirp3-HD-Iapetus` | 1.7% | 3.8% | 2.3% |
| Tamil | ta-IN | `ta-IN-Chirp3-HD-Kore` | `ta-IN-Chirp3-HD-Iapetus` | 4.3% | 3.3% | 3.6% |
| Telugu | te-IN | `te-IN-Chirp3-HD-Kore` | `te-IN-Chirp3-HD-Iapetus` | 1.0% | 2.4% | 2.2% |
| Urdu | ur-IN | `ur-IN-Chirp3-HD-Kore` | `ur-IN-Chirp3-HD-Iapetus` | 10.8% | 9.0% | 11.7% — weak for every voice |
| English (US) | en-US | `en-US-Chirp3-HD-Kore` | `en-US-Chirp3-HD-Iapetus` | 0.4% | 0.0% | 0.0% |
| English (UK) | en-GB | `en-GB-Chirp3-HD-Kore` | `en-GB-Chirp3-HD-Iapetus` | 0.4% | 0.6% | 0.2% |
| English (Australia) | en-AU | `en-AU-Chirp3-HD-Kore` | `en-AU-Chirp3-HD-Iapetus` | 0.6% | 0.6% | 0.6% |
| German | de-DE | `de-DE-Chirp3-HD-Kore` | `de-DE-Chirp3-HD-Iapetus` | 0.3% | 0.0% | 0.2% |
| French (France) | fr-FR | `fr-FR-Chirp3-HD-Kore` | `fr-FR-Chirp3-HD-Iapetus` | 0.3% | 0.8% | 0.6% |
| French (Canada) | fr-CA | `fr-CA-Chirp3-HD-Kore` | `fr-CA-Chirp3-HD-Iapetus` | 1.1% | 1.5% | 1.2% |
| Spanish (Spain) | es-ES | `es-ES-Chirp3-HD-Kore` | `es-ES-Chirp3-HD-Iapetus` | 0.4% | 0.4% | 0.3% |
| Spanish (US) | es-US | `es-US-Chirp3-HD-Kore` | `es-US-Chirp3-HD-Iapetus` | 1.0% | 0.0% | 0.3% |
| Italian | it-IT | `it-IT-Chirp3-HD-Kore` | `it-IT-Chirp3-HD-Iapetus` | 0.0% | 0.0% | 0.0% |
| Portuguese (Brazil) | pt-BR | `pt-BR-Chirp3-HD-Kore` | `pt-BR-Chirp3-HD-Iapetus` | 0.7% | 0.3% | 0.3% |
| Dutch (Netherlands) | nl-NL | `nl-NL-Chirp3-HD-Kore` | `nl-NL-Chirp3-HD-Iapetus` | 1.8% | 0.0% | 0.0% |
| Dutch (Belgium) | nl-BE | `nl-BE-Chirp3-HD-Kore` | `nl-BE-Chirp3-HD-Iapetus` | 0.2% | 0.4% | 0.4% |
| Swedish | sv-SE | `sv-SE-Chirp3-HD-Kore` | `sv-SE-Chirp3-HD-Iapetus` | 3.3% | 2.0% | 1.0% |
| Danish | da-DK | `da-DK-Chirp3-HD-Kore` | `da-DK-Chirp3-HD-Iapetus` | 1.6% | 0.5% | 0.5% |
| Norwegian | nb-NO | `nb-NO-Chirp3-HD-Kore` | `nb-NO-Chirp3-HD-Iapetus` | 3.2% | 1.9% | 1.9% |
| Finnish | fi-FI | `fi-FI-Chirp3-HD-Kore` | `fi-FI-Chirp3-HD-Iapetus` | 1.7% | 3.8% | 1.6% |
| Polish | pl-PL | `pl-PL-Chirp3-HD-Kore` | `pl-PL-Chirp3-HD-Iapetus` | 0.2% | 0.2% | 0.2% |
| Czech | cs-CZ | `cs-CZ-Chirp3-HD-Kore` | `cs-CZ-Chirp3-HD-Iapetus` | 0.0% | 0.0% | 0.1% |
| Slovak | sk-SK | `sk-SK-Chirp3-HD-Kore` | `sk-SK-Chirp3-HD-Iapetus` | 0.2% | 0.0% | 0.4% |
| Slovenian | sl-SI | `sl-SI-Chirp3-HD-Kore` | `sl-SI-Chirp3-HD-Iapetus` | 0.8% | 2.0% | 1.7% |
| Croatian | hr-HR | `hr-HR-Chirp3-HD-Kore` | `hr-HR-Chirp3-HD-Iapetus` | 0.0% | 0.0% | 0.0% |
| Serbian | sr-RS | `sr-RS-Chirp3-HD-Kore` | `sr-RS-Chirp3-HD-Iapetus` | 0.9% | 1.1% | 1.2% |
| Bulgarian | bg-BG | `bg-BG-Chirp3-HD-Kore` | `bg-BG-Chirp3-HD-Iapetus` | 1.3% | 0.3% | 1.3% |
| Romanian | ro-RO | `ro-RO-Chirp3-HD-Gacrux` | `ro-RO-Chirp3-HD-Iapetus` | 0.2% | 0.5% | 0.1% — Kore slipped here; use Gacrux |
| Hungarian | hu-HU | `hu-HU-Chirp3-HD-Kore` | `hu-HU-Chirp3-HD-Iapetus` | 0.0% | 0.8% | 0.4% |
| Greek | el-GR | `el-GR-Chirp3-HD-Kore` | `el-GR-Chirp3-HD-Iapetus` | 0.8% | 1.1% | 1.9% |
| Estonian | et-EE | `et-EE-Chirp3-HD-Kore` | `et-EE-Chirp3-HD-Iapetus` | 1.2% | 0.8% | 2.7% |
| Latvian | lv-LV | `lv-LV-Chirp3-HD-Kore` | `lv-LV-Chirp3-HD-Iapetus` | 0.9% | 1.8% | 1.7% |
| Lithuanian | lt-LT | `lt-LT-Chirp3-HD-Kore` | `lt-LT-Chirp3-HD-Iapetus` | 0.6% | 0.4% | 0.4% |
| Ukrainian | uk-UA | `uk-UA-Chirp3-HD-Kore` | `uk-UA-Chirp3-HD-Iapetus` | 0.4% | 0.7% | 0.8% |
| Turkish | tr-TR | `tr-TR-Chirp3-HD-Kore` | `tr-TR-Chirp3-HD-Iapetus` | 4.1% | 2.4% | 1.7% |
| Arabic | ar-XA | `ar-XA-Chirp3-HD-Kore` | `ar-XA-Chirp3-HD-Iapetus` | 2.7% | 3.9% | 2.7% |
| Hebrew | he-IL | `he-IL-Chirp3-HD-Kore` | `he-IL-Chirp3-HD-Iapetus` | 5.5% | 3.9% | 4.3% |
| Indonesian | id-ID | `id-ID-Chirp3-HD-Kore` | `id-ID-Chirp3-HD-Iapetus` | 0.6% | 0.6% | 0.0% |
| Vietnamese | vi-VN | `vi-VN-Chirp3-HD-Kore` | `vi-VN-Chirp3-HD-Iapetus` | 0.0% | 0.0% | 0.0% |
| Thai | th-TH | `th-TH-Chirp3-HD-Kore` | `th-TH-Chirp3-HD-Iapetus` | 0.3% | 1.8% | 0.4% |
| Japanese | ja-JP | `ja-JP-Chirp3-HD-Kore` | `ja-JP-Chirp3-HD-Iapetus` | 1.6% | 2.9% | 1.7% |
| Korean | ko-KR | `ko-KR-Chirp3-HD-Kore` | `ko-KR-Chirp3-HD-Iapetus` | 1.3% | 2.0% | 2.5% |
| Mandarin Chinese | cmn-CN | `cmn-CN-Chirp3-HD-Kore` | `cmn-CN-Chirp3-HD-Iapetus` | 1.8% | 2.2% | 1.8% |
| Cantonese | yue-HK | `yue-HK-Chirp3-HD-Kore` | `yue-HK-Chirp3-HD-Iapetus` | 9.5% | 12.5% | 13.8% — weak for every voice |
| Swahili | sw-KE | `sw-KE-Chirp3-HD-Kore` | `sw-KE-Chirp3-HD-Iapetus` | 2.1% | 1.3% | 2.1% |
| Russian | ru-RU | `ru-RU-Chirp3-HD-Kore` | `ru-RU-Chirp3-HD-Fenrir` (Iapetus not offered in Russian) | not tested | not tested | only 8 voices; test before use |

"Weak for every voice" means the problem is the language support, not the voice: Cantonese
misreads numbers for every voice, and Urdu and Hebrew get many digits wrong. Test these with
real calls before offering them.

## Rules for adding a language

1. Use the voice IDs above. No new voice selection is needed.
2. Keep person and company names in English letters inside the sentence (for example
   `నేను Nexstopp నుంచి Asha`). Do not convert names into the local script; the voice reads
   the script literally (for example ఆశ is read as the word "hope", not the name Asha).
   Not yet confirmed by ear that English-letter names sound right in every language; check
   this in the native-speaker test call.
3. Before going live in a new language, a native speaker listens to one test call.
4. To re-run the clarity test, the scripts are in
   `/private/tmp/claude-501/-Users-valletivarish-Documents-new-startup/f1aa8ae0-b2ee-46a2-b303-fc8bc2ea440e/scratchpad/vt/`
   (scratch folder; copy it into the repo if we want to keep it).
