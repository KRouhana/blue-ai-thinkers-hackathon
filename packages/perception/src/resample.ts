/**
 * Recall's mixed raw stream is 16 kHz signed 16-bit mono PCM. OpenAI's live
 * transcription examples use 24 kHz PCM, so this deterministic 3:2 upsampler
 * produces [a, midpoint(a,b), b] for every input pair. It holds one odd sample
 * between messages to avoid a discontinuity at packet boundaries.
 */
export class Pcm16To24kResampler {
  private pending: number | null = null;

  convert(chunk: Int16Array): Int16Array {
    if (chunk.length === 0) return new Int16Array(0);

    const input = this.pending === null
      ? chunk
      : Int16Array.from([this.pending, ...chunk]);
    const usableLength = input.length - (input.length % 2);
    this.pending = usableLength === input.length ? null : input[input.length - 1] ?? null;

    const output = new Int16Array((usableLength / 2) * 3);
    let outputIndex = 0;
    for (let inputIndex = 0; inputIndex < usableLength; inputIndex += 2) {
      const first = input[inputIndex] ?? 0;
      const second = input[inputIndex + 1] ?? 0;
      output[outputIndex++] = first;
      output[outputIndex++] = Math.round((first + second) / 2);
      output[outputIndex++] = second;
    }
    return output;
  }

  reset(): void {
    this.pending = null;
  }
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const result = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    result[index] = Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff));
  }
  return result;
}
