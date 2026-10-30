// Captures microphone audio and posts fixed-size Float32 frames to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(1024);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.frame[this.n++] = input[i];
      if (this.n === this.frame.length) {
        this.port.postMessage(this.frame.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
