import {
  CallingConstraints,
  CallingInputType,
  CallingStateChangingType,
  LocalMediaContext,
  NegotiatablePeerConnection,
  PeerConnectionMap,
  PeerMediaContext,
  PeerMediaContextMap,
  PeerMediaContextMapProxy,
} from "./common-types";
import { shadowCopyPlainObject } from "./common-util";
/**
 * reusable media transceivers
 */

class ReusableTransceiversMap {
  kind: string;
  private peerMap = new Map<string, RTCRtpTransceiver[]>();

  constructor(transceiversKind: string) {
    this.kind = transceiversKind;
  }

  set(peerId: string, transceivers: RTCRtpTransceiver[]) {
    this.peerMap.set(peerId, transceivers);
  }
  get(peerId: string) {
    return this.peerMap.get(peerId);
  }
  has(peerId: string) {
    return this.peerMap.has(peerId);
  }
  delete(peerId: string) {
    this.peerMap.delete(peerId);
  }
  clear() {
    this.peerMap.clear();
  }
  forEach(callback: (value: RTCRtpTransceiver[]) => void) {
    this.peerMap.forEach(callback);
  }
  entries() {
    return this.peerMap.entries();
  }
  replaceAllSenders(withTrack: MediaStreamTrack | null) {
    this.peerMap.forEach((transceivers, _) => {
      if (transceivers.length > 0 && transceivers[0].sender) {
        const transceiver = transceivers[0];
        transceiver.sender.replaceTrack(withTrack).then(() => {
          if (transceiver.currentDirection === "stopped") {
            return;
          }
          if (!withTrack) {
            transceiver.direction = "recvonly";
          }
        });
      }
    });
  }
}

const _reusableAudioTransceiversMap = new ReusableTransceiversMap("audio");
const _reusableVideoTransceiversMap = new ReusableTransceiversMap("video");

function _deletePeerTransceiver(peerId: string) {
  _reusableAudioTransceiversMap.delete(peerId);
  _reusableVideoTransceiversMap.delete(peerId);
  console.debug(
    `WebRTCGroupChatController: both reusable audio && video transceivers for a peer( ${peerId} ) deleted`
  );
}

function _clearAllPeerTransceivers() {
  _reusableAudioTransceiversMap.clear();
  _reusableVideoTransceiversMap.clear();
  console.debug(`WebRTCGroupChatController: all reusable audio && video transceivers cleared`);
}

function _pauseAllTransceiverSending() {
  _reusableAudioTransceiversMap.replaceAllSenders(null);
  _reusableVideoTransceiversMap.replaceAllSenders(null);
}

/**
 * peer track receiving
 */

let _handlePeerMediaContextMapChanged:
  | ((peerMediaContextMapProxy: PeerMediaContextMapProxy) => void)
  | undefined;

function buildPeerMediaContextMapProxy(
  peerMediaContextMap: PeerMediaContextMap
): PeerMediaContextMapProxy {
  return {
    map: peerMediaContextMap.map,
  };
}

const _peerMediaContextMap: PeerMediaContextMap = {
  map: new Map<string, PeerMediaContext>(),
  has(peerId) {
    return this.map.has(peerId);
  },
  size() {
    return this.map.size;
  },
  getMediaContext(key) {
    if (!this.map.get(key)) {
      return undefined;
    }
    return this.map.get(key);
  },
  deleteTrack(peerId, kind) {
    if (!this.getMediaContext(peerId)) {
      return;
    }

    const mediaContext = this.getMediaContext(peerId);
    if (!mediaContext) {
      return;
    }

    if (kind === "video") {
      mediaContext.videoTrack = null;
    } else if (kind === "audio") {
      mediaContext.audioTrack = null;

      const audioProcessor = mediaContext.audioProcessor;
      if (!audioProcessor) {
        return;
      }

      if (audioProcessor.audioSourceNode) {
        audioProcessor.audioSourceNode.disconnect();
        audioProcessor.audioSourceNode = null;
      }
      if (audioProcessor.audioAnalyserNode) {
        audioProcessor.audioAnalyserNode = null;
      }
      if (audioProcessor.audioGainNode) {
        audioProcessor.audioGainNode.disconnect();
        audioProcessor.audioGainNode = null;
      }
      if (audioProcessor.audioContext) {
        audioProcessor.audioContext.close();
        audioProcessor.audioContext = null;
      }
    }

    if (!mediaContext.videoTrack && !mediaContext.audioTrack) {
      this.map.delete(peerId);
    } else {
      this.map.set(peerId, mediaContext);
    }

    if (_handlePeerMediaContextMapChanged) {
      _handlePeerMediaContextMapChanged(
        buildPeerMediaContextMapProxy(shadowCopyPlainObject(this))
      );
    }
  },

  setTrack(peerId, track) {
    const prevSize = this.map.size;

    if (!this.getMediaContext(peerId)) {
      const thatPeerMediaContextMap = this;

      const newMediaContext: PeerMediaContext = {
        videoTrack: null,
        audioTrack: null,
        audioProcessor: {
          audioContext: null,
          audioGainNode: null,
          audioSourceNode: null,
          audioAnalyserNode: null,

          // Chromium Issue: MediaStream from RTC is silent for Web Audio API
          // https://bugs.chromium.org/p/chromium/issues/detail?id=933677#c4
          playWithAudioDOMLoaded(audioDOMLoaded: HTMLMediaElement) {
            if (!(audioDOMLoaded instanceof HTMLMediaElement)) {
              return;
            }
            if (this.audioSourceNode) {
              return;
            }
            if (
              !(newMediaContext.audioTrack instanceof MediaStreamTrack) ||
              newMediaContext.audioTrack.kind !== "audio"
            ) {
              return;
            }

            const audioStream = new MediaStream([newMediaContext.audioTrack]);

            // It is a required step to output audio stream before using audio context
            audioDOMLoaded.srcObject = audioStream;
            // Make sure that only audio context instead of audio DOM element can output this audio stream
            audioDOMLoaded.volume = 0;

            this.audioContext = new AudioContext();
            this.audioGainNode = this.audioContext.createGain();

            const audioSourceNode = this.audioContext.createMediaStreamSource(audioStream);
            const audioAnalyserNode = this.audioContext.createAnalyser();
            audioSourceNode.connect(this.audioGainNode);
            audioSourceNode.connect(audioAnalyserNode);
            this.audioGainNode.connect(this.audioContext.destination);
            this.audioSourceNode = audioSourceNode;
            this.audioAnalyserNode = audioAnalyserNode;

            if (_handlePeerMediaContextMapChanged) {
              _handlePeerMediaContextMapChanged(
                buildPeerMediaContextMapProxy(shadowCopyPlainObject(thatPeerMediaContextMap))
              );
            }
          },

          set volumeMultipler(newMultipler: number) {
            if (!this.audioGainNode) {
              return;
            }
            this.audioGainNode.gain.value = newMultipler;
          },
          get volumeMultipler() {
            if (!this.audioGainNode) {
              return 0;
            }
            return this.audioGainNode.gain.value;
          },
        },
      };
      this.map.set(peerId, newMediaContext);
    }

    const mediaContext = this.getMediaContext(peerId)!;

    if (track.kind === "video") {
      mediaContext.videoTrack = track;
    } else if (track.kind === "audio") {
      mediaContext.audioTrack = track;
    }

    this.map.set(peerId, mediaContext);

    console.debug(
      `WebRTCGroupChatController: _peerMediaContextMap size changed from ${prevSize} to ${this.map.size}`
    );

    if (_handlePeerMediaContextMapChanged) {
      _handlePeerMediaContextMapChanged(
        buildPeerMediaContextMapProxy(shadowCopyPlainObject(this))
      );
    }
  },
};

function _handlePeerConnectionTrackEvent(event: RTCTrackEvent, peerId: string) {
  if (!(event.target instanceof RTCPeerConnection) || !event.track) {
    console.error(`WebRTCGroupChatController: unexpected event target / track during 'ontrack'`);
    return;
  }
  if (!peerId) {
    console.error(`WebRTCGroupChatController: unexpected peerId ( ${peerId} ) during 'ontrack'`);
    return;
  }

  const peerConnection = event.target as NegotiatablePeerConnection;
  const track = event.track;
  _setupTrackEventHandlers(track, peerId, peerConnection);
}

function _setupTrackEventHandlers(
  track: MediaStreamTrack,
  peerId: string,
  peerConnection: NegotiatablePeerConnection
) {
  // Chromium Issue: Video Track repeatedly firing muted and unmuted when using Tab Sharing
  // https://bugs.chromium.org/p/chromium/issues/detail?id=931033
  if (
    peerConnection.callingConstraints &&
    peerConnection.callingConstraints[CallingInputType.CALLING_INPUT_TYPE_VIDEO_SCREEN]
  ) {
    _peerMediaContextMap.setTrack(peerId, track);
    return;
  }

  track.onunmute = (event: Event) => {
    _handleIncomingTrackUnmute(event, peerId);
  };
  track.onmute = (event: Event) => {
    _handleIncomingTrackMute(event, peerId);
  };
  track.onended = (event: Event) => {
    _handleIncomingTrackEnded(event, peerId);
  };
}

function _handleIncomingTrackUnmute(event: Event, peerId: string) {
  if (!(event.target instanceof MediaStreamTrack)) {
    return;
  }

  const track = event.target;
  _peerMediaContextMap.setTrack(peerId, track);
  console.debug(`WebRTCGroupChatController: unmute a track for a peer( ${peerId} )`, track);
}

function _handleIncomingTrackMute(event: Event, peerId: string) {
  if (!(event.target instanceof MediaStreamTrack)) {
    return;
  }

  const track = event.target;
  _peerMediaContextMap.deleteTrack(peerId, track.kind);
  console.debug(
    `WebRTCGroupChatController: muted a track for a peer( ${peerId}, kind(${track.kind}) )`,
    track
  );
}

function _handleIncomingTrackEnded(event: Event, peerId: string) {
  if (!(event.target instanceof MediaStreamTrack)) {
    return;
  }

  const track = event.target;
  _peerMediaContextMap.deleteTrack(peerId, track.kind);
  console.debug(`WebRTCGroupChatController: ended a track for a peer( ${peerId} )`, track);
}

/**
 * local track sending
 */

let _localMediaContext: LocalMediaContext = {
  mediaSourceStreams: [],
  videoTrack: null,
  audioTrack: null,
  audioProcessor: {
    audioContext: null,
    audioGainNode: null,
    audioAnalyserNode: null,
    audioDestinationNode: null,
    audioSourceNodeMap: new Map<string, MediaStreamAudioSourceNode>(),

    set volumeMultipler(newMultipler: number) {
      if (!this.audioGainNode) {
        return;
      }
      this.audioGainNode.gain.value = newMultipler;
    },
    get volumeMultipler() {
      if (!this.audioGainNode) {
        return 0;
      }
      return this.audioGainNode.gain.value;
    },
  },
};

let _localMediaContextCreatingPromise: Promise<undefined> | null | undefined;

let _handleLocalMediaContextChanged: ((localMediaContext: LocalMediaContext) => void) | undefined;
let _handleLocalAudioEnableAvaliableChanged: ((isAvaliable: boolean) => void) | undefined;
let _handleLocalVideoEnableAvaliableChanged: ((isAvaliable: boolean) => void) | undefined;
let _handleLocalAudioMuteAvaliableChanged: ((isAvaliable: boolean) => void) | undefined;
let _handleLocalVideoMuteAvaliableChanged: ((isAvaliable: boolean) => void) | undefined;

let _callingConstraints: CallingConstraints | null;

function _applyCallingInputTypes(callingInputTypes: CallingInputType[]) {
  _callingConstraints = {};
  callingInputTypes.forEach((callingInputType) => {
    _callingConstraints![callingInputType] = true;
  });

  _localMediaContextCreatingPromise = _createLocalMediaContext();
}

async function _createLocalMediaContext(): Promise<undefined> {
  const promise = new Promise(
    (resolve: (value: undefined) => void, rejected: (reason?: string) => void) => {
      if (!_callingConstraints) {
        rejected("unexpected empty calling contraints");
        return;
      }

      const enableCameraVideoTrack =
        _callingConstraints[CallingInputType.CALLING_INPUT_TYPE_VIDEO_CAMERA];
      const enableMicrophoneAudioTrack =
        _callingConstraints[CallingInputType.CALLING_INPUT_TYPE_AUDIO_MICROPHONE];
      const enableScreenVideoTrack =
        _callingConstraints[CallingInputType.CALLING_INPUT_TYPE_VIDEO_SCREEN];
      const enableScreenAudioTrack =
        _callingConstraints[CallingInputType.CALLING_INPUT_TYPE_AUDIO_SCREEN];

      const mediaDevices = navigator.mediaDevices;

      if (
        enableMicrophoneAudioTrack &&
        !enableCameraVideoTrack &&
        !enableScreenAudioTrack &&
        !enableScreenVideoTrack
      ) {
        mediaDevices.getUserMedia({ audio: true, video: false }).then((mediaStream) => {
          _localMediaContext.mediaSourceStreams.push(mediaStream);
          _buildLocalMediaDestinationTracks();
          resolve(undefined);
        });
      } else if (
        enableMicrophoneAudioTrack &&
        enableCameraVideoTrack &&
        !enableScreenAudioTrack &&
        !enableScreenVideoTrack
      ) {
        mediaDevices.getUserMedia({ audio: true, video: true }).then((mediaStream) => {
          _localMediaContext.mediaSourceStreams.push(mediaStream);
          _buildLocalMediaDestinationTracks();
          resolve(undefined);
        });
      } else if (
        enableScreenAudioTrack &&
        enableScreenVideoTrack &&
        !enableMicrophoneAudioTrack &&
        !enableCameraVideoTrack
      ) {
        mediaDevices.getDisplayMedia({ audio: true, video: false }).then((mediaStream) => {
          _localMediaContext.mediaSourceStreams.push(mediaStream);
          _buildLocalMediaDestinationTracks();
          resolve(undefined);
        });
      } else if (
        enableScreenAudioTrack &&
        enableScreenVideoTrack &&
        enableMicrophoneAudioTrack &&
        !enableCameraVideoTrack
      ) {
        Promise.all([
          mediaDevices.getDisplayMedia({ audio: true, video: true }),
          mediaDevices.getUserMedia({ audio: true, video: false }),
        ]).then((mediaStreams) => {
          if (!(mediaStreams instanceof Array)) {
            return;
          }

          mediaStreams.forEach((mediaStream) => {
            _localMediaContext.mediaSourceStreams.push(mediaStream);
          });
          _buildLocalMediaDestinationTracks();
          resolve(undefined);
        });
      } else {
        // use no video, only microphone
        mediaDevices.getUserMedia({ audio: true, video: false }).then((mediaStream) => {
          _localMediaContext.mediaSourceStreams.push(mediaStream);
          _buildLocalMediaDestinationTracks();
          resolve(undefined);
        });
      }
    }
  );

  return promise;
}

function _buildLocalMediaDestinationTracks() {
  if (_localMediaContext.mediaSourceStreams.length === 0) {
    return;
  }

  let audioDestinationTrack;
  let videoDestinationTrack;

  const audioCtx = new AudioContext();
  const audioGainNode = audioCtx.createGain();
  const audioAnalyserNode = audioCtx.createAnalyser();
  const audioDestinationNode = audioCtx.createMediaStreamDestination();
  audioGainNode.connect(audioAnalyserNode);

  _localMediaContext.audioProcessor.audioContext = audioCtx;
  _localMediaContext.audioProcessor.audioGainNode = audioGainNode;
  _localMediaContext.audioProcessor.audioAnalyserNode = audioAnalyserNode;
  _localMediaContext.audioProcessor.audioDestinationNode = audioDestinationNode;

  const audioSourceTracks: MediaStreamTrack[] = [];
  const videoSourceTracks: MediaStreamTrack[] = [];

  _localMediaContext.mediaSourceStreams.forEach((mediaStream) => {
    mediaStream.getAudioTracks().forEach((audioTrack) => {
      audioSourceTracks.push(audioTrack);
    });

    mediaStream.getVideoTracks().forEach((videoTrack) => {
      videoSourceTracks.push(videoTrack);
    });
  });

  if (audioSourceTracks.length > 0) {
    audioSourceTracks.forEach((audioSourceTrack) => {
      const audioSourceStream = new MediaStream([audioSourceTrack]);
      const audioSourceNode = audioCtx.createMediaStreamSource(audioSourceStream);
      audioSourceNode.connect(audioGainNode);
      audioSourceNode.connect(audioDestinationNode);
      _localMediaContext.audioProcessor.audioSourceNodeMap.set(
        audioSourceTrack.id,
        audioSourceNode
      );
    });

    if (audioDestinationNode.stream.getAudioTracks().length > 0) {
      audioDestinationTrack = audioDestinationNode.stream.getAudioTracks()[0];
    }
  }

  if (videoSourceTracks.length > 0) {
    videoDestinationTrack = videoSourceTracks[0];
  }

  if (audioDestinationTrack) {
    _localMediaContext.audioTrack = audioDestinationTrack;
    if (_handleLocalAudioEnableAvaliableChanged) {
      _handleLocalAudioEnableAvaliableChanged(true);
    }
  }

  if (videoDestinationTrack) {
    _localMediaContext.videoTrack = videoDestinationTrack;
    if (_handleLocalVideoEnableAvaliableChanged) {
      _handleLocalVideoEnableAvaliableChanged(true);
    }
  }

  if (audioDestinationTrack || videoDestinationTrack) {
    if (_handleLocalMediaContextChanged) {
      _handleLocalMediaContextChanged(shadowCopyPlainObject(_localMediaContext));
    }
  }
}

function _addLocalMediaStream(peerConnectionMap: PeerConnectionMap) {
  if (!_localMediaContext.audioTrack && !_localMediaContext.videoTrack) {
    console.debug(
      `WebRTCGroupChatController: unexpected _localMediaContext when adding local media stream to all peer connections`,
      _localMediaContext
    );
    return;
  }

  const tracks = [];
  if (_localMediaContext.audioTrack) {
    tracks.push(_localMediaContext.audioTrack);
  }
  if (_localMediaContext.videoTrack) {
    tracks.push(_localMediaContext.videoTrack);
  }

  tracks.forEach((track, _) => {
    let reusableTransceiversMap: ReusableTransceiversMap | undefined;
    let handleLocalMuteAvaliableChanged: ((isAvaliable: boolean) => void) | undefined;
    if (track.kind === "audio") {
      reusableTransceiversMap = _reusableAudioTransceiversMap;
      handleLocalMuteAvaliableChanged = _handleLocalAudioMuteAvaliableChanged;
    } else if (track.kind === "video") {
      reusableTransceiversMap = _reusableVideoTransceiversMap;
      handleLocalMuteAvaliableChanged = _handleLocalVideoMuteAvaliableChanged;
    }

    if (!reusableTransceiversMap) {
      return;
    }

    peerConnectionMap.forEach((peerConnection, peerId) => {
      const transceivers = reusableTransceiversMap!.get(peerId);
      if (transceivers && transceivers.length > 0 && transceivers[0].sender) {
        const transceiver = transceivers[0];
        transceiver.sender.replaceTrack(track).then(() => {
          transceiver.direction = "sendrecv";
        });
      } else if (!transceivers || transceivers.length === 0) {
        peerConnection.addTrack(track);
        reusableTransceiversMap!.set(
          peerId,
          _getTransceiversOfPureKind(peerConnection, track.kind)
        );
      }
    });

    // local mute avaliable
    if (handleLocalMuteAvaliableChanged) {
      handleLocalMuteAvaliableChanged(true);
    }
  });
}

function _addLocalTracksIfPossible(peerId: string, peerConnection: NegotiatablePeerConnection) {
  const tracks = [];
  if (_localMediaContext.audioTrack) {
    tracks.push(_localMediaContext.audioTrack);
  }
  if (_localMediaContext.videoTrack) {
    tracks.push(_localMediaContext.videoTrack);
  }

  if (tracks.length > 0) {
    tracks.forEach((track, index) => {
      let reusableTransceiversMap: ReusableTransceiversMap | undefined;
      if (track.kind === "audio") {
        reusableTransceiversMap = _reusableAudioTransceiversMap;
      } else if (track.kind === "video") {
        reusableTransceiversMap = _reusableVideoTransceiversMap;
      }

      if (!reusableTransceiversMap) {
        return;
      }

      const transceivers = reusableTransceiversMap.get(peerId);
      if (transceivers && transceivers.length > 0 && transceivers[0].sender) {
        const transceiver = transceivers[0];
        transceiver.sender.replaceTrack(track).then(() => {
          transceiver.direction = "sendrecv";
        });
      } else if (!transceivers || transceivers.length === 0) {
        //
        // TODO:
        //
        // Priority Level: Middle
        //
        // ”前面的人进入房间后，打开媒体流，然后点击enable或mute按钮，接着当前房间进来了新人，但无法给新人同步前面的加入者所点击过的enable或mute状态“
        //
        const muted = _getLocalMediaTrackMuted(track.kind);
        peerConnection.addTrack(track);
        reusableTransceiversMap!.set(
          peerId,
          _getTransceiversOfPureKind(peerConnection, track.kind)
        );
      }
    });
  }
}

function _releaseLocalMediaContext() {
  // release source streams
  if (_localMediaContext.mediaSourceStreams.length > 0) {
    _localMediaContext.mediaSourceStreams.forEach((localMediaSourceStream) => {
      localMediaSourceStream.getTracks().forEach((localMediaSourceTrack) => {
        localMediaSourceTrack.stop();
      });
    });
    _localMediaContext.mediaSourceStreams.length = 0;
  }

  // release destination tracks
  const tracks = [];
  if (_localMediaContext.audioTrack) {
    tracks.push(_localMediaContext.audioTrack);
  }
  if (_localMediaContext.videoTrack) {
    tracks.push(_localMediaContext.videoTrack);
  }
  if (tracks.length > 0) {
    let handleLocalEnableAvaliableChanged: ((isAvaliable: boolean) => void) | undefined;
    let handleLocalMuteAvaliableChanged: ((isAvaliable: boolean) => void) | undefined;

    tracks.forEach(function (track) {
      if (track.kind === "audio") {
        handleLocalEnableAvaliableChanged = _handleLocalAudioEnableAvaliableChanged;
        handleLocalMuteAvaliableChanged = _handleLocalAudioMuteAvaliableChanged;
      } else if (track.kind === "video") {
        handleLocalEnableAvaliableChanged = _handleLocalVideoEnableAvaliableChanged;
        handleLocalMuteAvaliableChanged = _handleLocalVideoMuteAvaliableChanged;
      }

      track.stop();

      if (handleLocalEnableAvaliableChanged) {
        handleLocalEnableAvaliableChanged(false);
      }
      if (handleLocalMuteAvaliableChanged) {
        handleLocalMuteAvaliableChanged(false);
      }
    });

    _localMediaContext.audioTrack = null;
    _localMediaContext.videoTrack = null;
  }

  // release audio processor
  const audioProcessor = _localMediaContext.audioProcessor;
  if (audioProcessor.audioAnalyserNode) {
    audioProcessor.audioAnalyserNode = null;
  }
  if (audioProcessor.audioGainNode) {
    audioProcessor.audioGainNode.disconnect();
    audioProcessor.audioGainNode = null;
  }
  if (audioProcessor.audioSourceNodeMap.size > 0) {
    audioProcessor.audioSourceNodeMap.forEach(function (audioSourceNode) {
      audioSourceNode.disconnect();
    });
    audioProcessor.audioSourceNodeMap.clear();
  }
  if (audioProcessor.audioDestinationNode) {
    audioProcessor.audioDestinationNode.disconnect();
    audioProcessor.audioDestinationNode = null;
  }
  if (audioProcessor.audioContext) {
    audioProcessor.audioContext.close();
    audioProcessor.audioContext = null;
  }

  // call listener
  if (_handleLocalMediaContextChanged) {
    _handleLocalMediaContextChanged(shadowCopyPlainObject(_localMediaContext));
  }
}

function _getLocalMediaTrackEnabled(trackKind: string): boolean {
  let trackEnabled = false;

  if (!_localMediaContext.audioTrack && !_localMediaContext.videoTrack) {
    return trackEnabled;
  }

  let track;
  if (trackKind === "audio") {
    track = _localMediaContext.audioTrack;
  } else if (trackKind === "video") {
    track = _localMediaContext.videoTrack;
  }

  if (!track) {
    console.error(
      `WebRTCGroupChatController: unexpected empty track when 'get' enabling ( ${trackKind} ) kind of local media device`
    );
    return trackEnabled;
  }

  trackEnabled = track.enabled;
  return trackEnabled;
}

function _setLocalMediaTrackEnabled(trackKind: string, enabled: boolean) {
  if (!_localMediaContext.audioTrack && !_localMediaContext.videoTrack) {
    console.error(
      `WebRTCGroupChatController: unexpected empty _localMediaContext.mediaStream when 'set' enabling ( ${trackKind} ) kind of local media device`
    );
    return;
  }

  let track;
  if (trackKind === "audio") {
    track = _localMediaContext.audioTrack;
  } else if (trackKind === "video") {
    track = _localMediaContext.videoTrack;
  }

  if (!track) {
    console.error(
      `WebRTCGroupChatController: unexpected empty track when enabling ( ${trackKind} ) kind of local media device`
    );
    return;
  }
  track.enabled = enabled;
}

function _getLocalMediaTrackMuted(trackKind: string): boolean {
  if (!_localMediaContext.audioTrack && !_localMediaContext.videoTrack) {
    return true;
  }

  let reusableTransceiversMap;
  if (trackKind === "audio") {
    reusableTransceiversMap = _reusableAudioTransceiversMap;
  } else if (trackKind === "video") {
    reusableTransceiversMap = _reusableVideoTransceiversMap;
  }

  let transceiverMuted = false;

  if (!reusableTransceiversMap) {
    return transceiverMuted;
  }

  for (let [_, transceivers] of reusableTransceiversMap.entries()) {
    const transceiver = transceivers[0];
    // warning: some potential issues about transceiving direction may exist
    if (
      transceiver.currentDirection === "inactive" ||
      (transceiver.currentDirection === "recvonly" && transceiver.direction === "recvonly") ||
      transceiver.currentDirection === "stopped"
    ) {
      transceiverMuted = true;
      break;
    }
  }
  if (transceiverMuted) {
    return true;
  }

  let track;
  if (trackKind === "audio") {
    track = _localMediaContext.audioTrack;
  } else if (trackKind === "video") {
    track = _localMediaContext.videoTrack;
  }
  if (!track) {
    console.error(
      `WebRTCGroupChatController: unexpected empty track when 'get' muting ( ${trackKind} ) kind of local media device`
    );
    return true;
  }

  return track.muted;
}

function _setLocalMediaTrackMuted(trackKind: string, muted: boolean) {
  let reusableTransceiversMap;
  if (trackKind === "audio") {
    reusableTransceiversMap = _reusableAudioTransceiversMap;
  } else if (trackKind === "video") {
    reusableTransceiversMap = _reusableVideoTransceiversMap;
  }
  if (!reusableTransceiversMap) {
    return;
  }
  reusableTransceiversMap.forEach((transceivers) => {
    if (transceivers.length > 0) {
      const transceiver = transceivers[0];
      // transceiver.sender.replaceTrack(null).then(() => {
      // });
      transceiver.direction = muted ? "recvonly" : "sendrecv";
    }
  });
}

/**
 * calling
 */

let _isCalling = false;
let _handleCallingStateChanged: ((isCalling: boolean) => void) | undefined;

function _startCalling(peerConnectionMap: PeerConnectionMap) {
  if (!_localMediaContextCreatingPromise) {
    console.debug(`unexpected empty '_localMediaContextCreatingPromise' during starting calling`);
    return;
  }

  _changeCallingState(CallingStateChangingType.START_UP_CALLING);
  _localMediaContextCreatingPromise.then(
    () => {
      _addLocalMediaStream(peerConnectionMap);
    },
    (error) => {
      console.debug(
        `WebRTCGroupChatController: met error of ${error} when creating local media stream`
      );
      _changeCallingState(CallingStateChangingType.HANG_UP_CALLING);
    }
  );
}

function _hangUpCalling(isLeavingRoom: boolean) {
  if (!_isCalling) {
    return;
  }

  _changeCallingState(CallingStateChangingType.HANG_UP_CALLING);
  _releaseLocalMediaContext();

  if (!isLeavingRoom) {
    _pauseAllTransceiverSending();
  }
}

function _changeCallingState(callingStateChangingType: CallingStateChangingType) {
  console.debug(
    `WebRTCGroupChatController: change calling state with a changing type of ${callingStateChangingType}`
  );

  switch (callingStateChangingType) {
    case CallingStateChangingType.START_UP_CALLING:
      {
        if (_isCalling) return;
        if (_handleCallingStateChanged) {
          _handleCallingStateChanged(_isCalling);
        }
      }
      break;
    case CallingStateChangingType.HANG_UP_CALLING:
      {
        if (!_isCalling) return;
        _isCalling = false;
        if (_handleCallingStateChanged) {
          _handleCallingStateChanged(_isCalling);
        }
      }
      break;
    default:
      break;
  }
}

/**
 * utils
 */

function _pureKindOfTransceiver(transceiver: RTCRtpTransceiver) {
  let senderKind = "";
  let receiverKind = "";
  if (transceiver.sender && transceiver.sender.track) {
    senderKind = transceiver.sender.track.kind;
  }
  if (transceiver.receiver && transceiver.receiver.track) {
    receiverKind = transceiver.receiver.track.kind;
  }
  if (senderKind !== receiverKind) {
    return undefined;
  }
  return senderKind;
}

function _getTransceiversOfPureKind(peerConnection: NegotiatablePeerConnection, pureKind: string) {
  const transceivers = peerConnection.getTransceivers();
  if (!transceivers || transceivers.length === 0) {
    return [];
  }
  return transceivers.filter((transceiver) => {
    return _pureKindOfTransceiver(transceiver) === pureKind;
  });
}

export default {
  get CallingInputType() {
    return CallingInputType;
  },
  get callingConstraints() {
    return _callingConstraints;
  },
  applyCallingInputTypes: function (callingInputTypes: CallingInputType[]) {
    _applyCallingInputTypes(callingInputTypes);
  },

  startCalling: function (peerConnectionMap: PeerConnectionMap) {
    _startCalling(peerConnectionMap);
  },
  hangUpCalling: function (isLeavingRoom: boolean) {
    _hangUpCalling(isLeavingRoom);
  },

  addLocalTracksIfPossible: function (peerId: string, peerConnection: NegotiatablePeerConnection) {
    _addLocalTracksIfPossible(peerId, peerConnection);
  },

  deletePeerTransceiver: function (peerId: string) {
    _deletePeerTransceiver(peerId);
  },
  clearAllPeerTransceivers: function () {
    _clearAllPeerTransceivers();
  },

  // media tracks enabling during media calling
  get localMicEnabled() {
    return _getLocalMediaTrackEnabled("audio");
  },
  set localMicEnabled(enabled) {
    _setLocalMediaTrackEnabled("audio", enabled);
  },
  get localCameraEnabled() {
    return _getLocalMediaTrackEnabled("video");
  },
  set localCameraEnabled(enabled) {
    _setLocalMediaTrackEnabled("video", enabled);
  },

  // media tracks' transceiver controlling during media calling
  get localMicMuted() {
    return _getLocalMediaTrackMuted("audio");
  },
  set localMicMuted(muted) {
    _setLocalMediaTrackMuted("audio", muted);
  },
  get localCameraMuted() {
    return _getLocalMediaTrackMuted("video");
  },
  set localCameraMuted(muted) {
    _setLocalMediaTrackMuted("video", muted);
  },

  // listeners
  onWebRTCCallingStateChanged: function (handler: (isCalling: boolean) => void) {
    _handleCallingStateChanged = handler;
  },
  onLocalMediaContextChanged: function (handler: (localMediaContext: LocalMediaContext) => void) {
    _handleLocalMediaContextChanged = handler;
  },
  onPeerMediaContextMapChanged: function (
    handler: (peerMediaContextMapProxy: PeerMediaContextMapProxy) => void
  ) {
    _handlePeerMediaContextMapChanged = handler;
  },
  onLocalAudioEnableAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    _handleLocalAudioEnableAvaliableChanged = handler;
  },
  onLocalVideoEnableAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    _handleLocalVideoEnableAvaliableChanged = handler;
  },
  onLocalAudioMuteAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    _handleLocalAudioMuteAvaliableChanged = handler;
  },
  onLocalVideoMuteAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    _handleLocalVideoMuteAvaliableChanged = handler;
  },

  handlePeerConnectionTrackEvent: function (event: RTCTrackEvent, peerId: string) {
    _handlePeerConnectionTrackEvent(event, peerId);
  },
};
