export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private sampleRate: number = 24000;
  private isInterrupted: boolean = false;
  private activeSources: AudioBufferSourceNode[] = [];
  public onFinished: (() => void) | null = null;
  private finishedTimer: any = null;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
  }

  public init() {
    this.isInterrupted = false;
    this.onFinished = null;
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.sampleRate,
      });
    }
    // Only reset time if it's lagging behind current time
    if (this.audioContext.currentTime > this.nextPlayTime) {
        this.nextPlayTime = this.audioContext.currentTime;
    }
  }

  public stop() {
    if (!this.audioContext) return; // FIX WEAK-08: guard against null context
    this.activeSources.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    this.activeSources = [];
    this.nextPlayTime = this.audioContext.currentTime;
  }

  // Instantly kills current playback and drops the queue
  public interrupt() {
    this.isInterrupted = true;
    this.stop(); 
  }

  public async playChunk(base64Data: string) {
    if (this.isInterrupted) return; // Drop chunks arriving after an interrupt

    if (!this.audioContext) {
      this.init();
    }

    if (!this.audioContext) return;

    try {
      // Decode base64 to binary
      const binaryString = window.atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Cartesia sends PCM 16-bit little-endian. Convert to Float32.
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, this.sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      // Schedule playback seamlessly
      const currentTime = this.audioContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }

      source.start(this.nextPlayTime);
      this.activeSources.push(source);
      
      // Garbage collect sources once they finish playing
      source.onended = () => {
        this.activeSources = this.activeSources.filter(s => s !== source);
        if (this.finishedTimer) clearTimeout(this.finishedTimer);
        this.finishedTimer = setTimeout(() => {
           if (this.activeSources.length === 0 && this.onFinished) {
               this.onFinished();
               this.onFinished = null;
           }
        }, 300);
      };

      this.nextPlayTime += audioBuffer.duration;
    } catch (e) {
      console.error("Audio decoding error:", e);
    }
  }
}
