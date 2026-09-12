/**
 * Recall's mixed raw stream is 16 kHz signed 16-bit mono PCM. OpenAI's live
 * transcription examples use 24 kHz PCM, so this deterministic 3:2 upsampler
 * produces samples at the exact 3:2 time positions using linear interpolation.
 * It preserves the two unconsumed samples between messages, so no boundary
 * discontinuity or time compression is introduced.
 */
export class Pcm16To24kResampler {
  private pending: number[] = [];

  convert(chunk: Int16Array): Int16Array {
    if (chunk.length === 0) return new Int16Array(0);

    const input = [...this.pending, ...chunk];
    const output: number[] = [];
    let inputIndex = 0;
    // Output positions are 0, 2/3, 4/3 source samples for each two inputs.
    // The final source sample is retained as look-ahead for the next packet.
    while (inputIndex + 2 < input.length) {
      const first = input[inputIndex] ?? 0;
      const second = input[inputIndex + 1] ?? 0;
      const third = input[inputIndex + 2] ?? 0;
      output.push(
        first,
        Math.round((first + 2 * second) / 3),
        Math.round((2 * second + third) / 3),
      );
      inputIndex += 2;
    }
    this.pending = input.slice(inputIndex);
    return Int16Array.from(output);
  }

  reset(): void {
    this.pending = [];
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
