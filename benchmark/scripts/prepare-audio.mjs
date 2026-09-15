/**
 * Turn whatever a phone recorded into what the harness needs.
 *
 * The founder should not be running a take-by-take approval loop with a level
 * meter. Record however is practical, then run this once over the folder: it
 * trims the lead-in, normalises the level, and converts to 16 kHz mono 16-bit
 * WAV — which is exactly the three things that were being flagged by hand.
 *
 * WHAT IT DOES NOT DO: change what was said. It is level and format only. No
 * noise reduction, no de-essing, no gating that could swallow a quiet word — a
 * benchmark that cleans up its own audio measures a pipeline that will not
 * exist on a real call.
 *
 *   node scripts/prepare-audio.mjs <input-dir> <output-dir>
 *
 * Input may be .m4a, .mp3, .wav, .aac, .ogg, .webm, .flac. Output is named
 * after the input, so name your takes as the worksheet says and they land
 * ready to use.
 */
import { readdir, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const AUDIO = new Set(['.m4a', '.mp3', '.wav', '.aac', '.ogg', '.webm', '.flac']);

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error('usage: node scripts/prepare-audio.mjs <input-dir> <output-dir>');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const files = (await readdir(inDir)).filter((f) => AUDIO.has(extname(f).toLowerCase()));
if (files.length === 0) {
  console.error(`No audio files in ${inDir}`);
  process.exit(1);
}

console.log(`Preparing ${files.length} file(s)\n`);
let failed = 0;

for (const file of files.sort()) {
  const out = join(outDir, `${basename(file, extname(file))}.wav`);
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', join(inDir, file),
      // Trim leading silence only. `stop_periods` is deliberately NOT set:
      // trailing silence is harmless, and a gate that cuts mid-utterance
      // silence would remove the mid-answer pause the corpus wants.
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,'
        + 'loudnorm=I=-23:TP=-2:LRA=11',
      '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-c:a', 'pcm_s16le',
      out,
    ]);
    console.log(`  ok   ${file}  ->  ${basename(out)}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${file}: ${(error.stderr || error.message).split('\n')[0]}`);
  }
}

console.log(`\n${files.length - failed} prepared, ${failed} failed -> ${outDir}`);
console.log('Level and format only. Nothing about what was said has been altered.');
