const AUDIO_BITRATE = 32000;

export function createPeerConnection(iceServers, onTrack, onIce) {
  const pc = new RTCPeerConnection({ iceServers });

  pc.ontrack = (e) => {
    if (e.streams[0]) onTrack(e.streams[0]);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) onIce(e.candidate);
  };

  return pc;
}

export async function setAudioBitrate(pc) {
  const sender = pc
    .getSenders()
    .find((s) => s.track?.kind === "audio");
  if (!sender) return;

  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = AUDIO_BITRATE;
  try {
    await sender.setParameters(params);
  } catch {
    /* browser may reject before negotiation completes */
  }
}

export async function getLocalStream({
  deviceId,
  noiseSuppression = true,
  echoCancellation = true,
} = {}) {
  const audio = {
    echoCancellation,
    noiseSuppression,
    autoGainControl: !noiseSuppression,
  };
  if (deviceId) {
    audio.deviceId = { exact: deviceId };
  }
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export async function replaceAudioTrack(pcs, stream) {
  const track = stream.getAudioTracks()[0];
  if (!track) return;
  await Promise.all(
    [...pcs.values()].map(async (pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
      if (sender) await sender.replaceTrack(track);
    })
  );
}

/** Web Audio dynamics compressor — giảm tiếng ồn nền */
export function enhanceAudio(stream) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -28;
  compressor.knee.value = 24;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;
  const dest = ctx.createMediaStreamDestination();
  source.connect(compressor);
  compressor.connect(dest);

  return {
    stream: dest.stream,
    stop() {
      ctx.close();
    },
  };
}
