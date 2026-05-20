/**
 * Pure audio helpers shared between renderer and (future) backend voice
 * services. Extracted from `src/renderer/App.tsx` as part of QW-1.
 *
 * Why "shared" and not "backend"? These functions are called from the
 * microphone-streaming code in the renderer where the raw `Float32Array`
 * arrives from a Web Audio `ScriptProcessorNode`. In a later PR the encoded
 * PCM payload moves to a backend `VoiceSessionService`, but for now keeping
 * the helpers in `src/shared/` means both halves can import them with zero
 * boundary violation and zero runtime weight.
 *
 * No DOM globals are used here — `btoa` is provided by Node ≥ 16 too, so
 * tests run without jsdom.
 */

/**
 * The Google Assistant voice channel on Google TV expects 16-bit PCM at 8 kHz
 * mono. Anything captured at a higher rate is downsampled in the renderer
 * before being base64-encoded and streamed across IPC.
 */
export const ASSISTANT_VOICE_SAMPLE_RATE = 8_000;

/**
 * Convert a normalised float audio buffer (samples in `[-1, 1]`) to signed
 * 16-bit PCM. Clamps out-of-range samples; treats `undefined`/`NaN` slots as
 * silence (0). Output length equals input length.
 *
 * The asymmetric `*0x8000` vs `*0x7fff` mapping below preserves the
 * historical behaviour of `App.tsx` exactly — negative samples have one more
 * representable code than positive samples in two's-complement int16, so this
 * matches what Google TV's voice decoder expects.
 */
export function convertFloat32ToPcm16(source: Float32Array): Int16Array {
  const output = new Int16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] ?? 0));
    output[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

/**
 * Downsample a float buffer to 8 kHz mono PCM and return raw bytes ready for
 * base64 framing.
 *
 *   - If `inputSampleRate <= 8000`: passthrough (just int16-encode).
 *   - Otherwise: average source samples across each output sample window
 *     (simple decimation-by-averaging — not the highest-quality resampler in
 *     the world, but it matches the original code and Google TV doesn't seem
 *     to mind).
 */
export function downsampleTo8kMono(source: Float32Array, inputSampleRate: number): Uint8Array {
  if (inputSampleRate <= ASSISTANT_VOICE_SAMPLE_RATE) {
    return new Uint8Array(convertFloat32ToPcm16(source).buffer);
  }

  const ratio = inputSampleRate / ASSISTANT_VOICE_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(source.length / ratio));
  const output = new Float32Array(outputLength);
  let outputIndex = 0;
  let sourceIndex = 0;

  while (outputIndex < outputLength) {
    const nextSourceIndex = Math.min(source.length, Math.round((outputIndex + 1) * ratio));
    let total = 0;
    let count = 0;

    for (let index = Math.floor(sourceIndex); index < nextSourceIndex; index += 1) {
      total += source[index] ?? 0;
      count += 1;
    }

    output[outputIndex] = count > 0 ? total / count : 0;
    outputIndex += 1;
    sourceIndex = nextSourceIndex;
  }

  return new Uint8Array(convertFloat32ToPcm16(output).buffer);
}

/**
 * Base64-encode arbitrary bytes. Works in both the renderer (via the global
 * `btoa`) and Node ≥ 16 (which also exposes a global `btoa` since v16.0.0).
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
