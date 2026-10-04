import type { VoiceCandidate } from '@domino/protocol';

export type PeerStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';
export interface PeerSnapshot {
  status: PeerStatus;
  stream: MediaStream | null;
}
export interface PeerOptions {
  initiator: boolean;
  stream: MediaStream;
  iceServers: RTCIceServer[];
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
  createStream: (tracks: MediaStreamTrack[]) => MediaStream;
  description: (type: 'offer' | 'answer', sdp: string) => Promise<boolean>;
  ice: (candidate: VoiceCandidate) => Promise<boolean>;
  changed: () => void;
}

/** Exactly one fixed audio transceiver per pair; mute never renegotiates. */
export class VoicePeer {
  private readonly pc: RTCPeerConnection;
  private closed = false;
  private queue = Promise.resolve();
  private incoming: VoiceCandidate[] = [];
  private outgoing: VoiceCandidate[] = [];
  private descriptionSent = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: PeerSnapshot = { status: 'connecting', stream: null };
  constructor(private readonly options: PeerOptions) {
    this.pc = options.createPeer({
      iceServers: options.iceServers,
      bundlePolicy: 'max-bundle',
    });
    try {
      const track = options.stream.getAudioTracks()[0];
      if (!track) throw new Error('No audio track');
      this.pc.addTrack(track, options.stream);
      this.pc.onicecandidate = (event) => {
        if (this.closed) return;
        const candidate: VoiceCandidate = event.candidate
          ? {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: 0,
              usernameFragment: event.candidate.usernameFragment,
            }
          : null;
        if (!this.descriptionSent) {
          if (this.outgoing.length >= 64) return this.fail();
          this.outgoing.push(candidate);
        } else void this.sendIce(candidate);
      };
      this.pc.ontrack = (event) => {
        if (this.closed || event.track.kind !== 'audio') {
          event.track.stop();
          return;
        }
        if (this.snapshot.stream?.getTracks().includes(event.track)) return;
        this.stopRemote();
        event.track.onended = () => this.fail();
        this.snapshot = {
          ...this.snapshot,
          stream: options.createStream([event.track]),
        };
        options.changed();
      };
      this.pc.onconnectionstatechange = () => {
        if (this.closed) return;
        const state = this.pc.connectionState;
        if (state === 'failed' || state === 'closed') return this.fail();
        if (state === 'connected') {
          clearTimeout(this.timer);
          this.snapshot = { ...this.snapshot, status: 'connected' };
        } else if (state === 'disconnected') {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.fail(), 10_000);
          this.snapshot = { ...this.snapshot, status: 'disconnected' };
        }
        options.changed();
      };
      this.timer = setTimeout(() => this.fail(), 20_000);
    } catch {
      this.close();
      throw new Error('Voice unavailable');
    }
  }
  getSnapshot = (): PeerSnapshot => this.snapshot;
  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue
      .then(async () => {
        if (!this.closed) await operation();
      })
      .catch(() => this.fail());
  }
  start(): void {
    if (!this.options.initiator) return;
    this.enqueue(async () => {
      const description = await this.pc.createOffer();
      if (!this.closed) await this.localDescription(description, 'offer');
    });
  }
  receiveDescription(type: 'offer' | 'answer', sdp: string): void {
    this.enqueue(async () => {
      if (
        (type === 'offer') === this.options.initiator ||
        this.pc.remoteDescription
      )
        return;
      await this.pc.setRemoteDescription({ type, sdp });
      if (this.closed) return;
      for (const candidate of this.incoming.splice(0)) {
        await this.pc.addIceCandidate(
          candidate && {
            ...candidate,
            usernameFragment: candidate.usernameFragment ?? null,
          },
        );
        if (this.closed) return;
      }
      if (type === 'offer') {
        const answer = await this.pc.createAnswer();
        if (!this.closed) await this.localDescription(answer, 'answer');
      }
    });
  }
  receiveIce(candidate: VoiceCandidate): void {
    this.enqueue(async () => {
      if (this.pc.remoteDescription)
        await this.pc.addIceCandidate(
          candidate && {
            ...candidate,
            usernameFragment: candidate.usernameFragment ?? null,
          },
        );
      else {
        if (this.incoming.length >= 64) throw new Error('ICE limit');
        this.incoming.push(candidate);
      }
    });
  }
  private async localDescription(
    description: RTCSessionDescriptionInit,
    type: 'offer' | 'answer',
  ): Promise<void> {
    await this.pc.setLocalDescription(description);
    if (this.closed) return;
    const sdp = this.pc.localDescription?.sdp;
    if (!sdp || !(await this.options.description(type, sdp)))
      throw new Error('Signaling unavailable');
    if (this.closed) return;
    this.descriptionSent = true;
    for (const candidate of this.outgoing.splice(0))
      await this.sendIce(candidate);
  }
  private async sendIce(candidate: VoiceCandidate): Promise<void> {
    if (this.closed) return;
    try {
      if (!(await this.options.ice(candidate))) this.fail();
    } catch {
      this.fail();
    }
  }
  private stopRemote(): void {
    for (const track of this.snapshot.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
  }
  private fail(): void {
    if (this.closed) return;
    this.close();
    this.snapshot = { status: 'failed', stream: null };
    this.options.changed();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.incoming = [];
    this.outgoing = [];
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.stopRemote();
    this.pc.close();
    this.snapshot = { ...this.snapshot, stream: null };
  }
}
