
/* Media Calling */

export type CallingConstraints = {
  [key in CallingInputType]?: boolean;
};

export enum CallingInputType {
  CALLING_INPUT_TYPE_AUDIO_MICROPHONE = "microphone_audio",
  CALLING_INPUT_TYPE_AUDIO_SCREEN = "screen_audio",
  CALLING_INPUT_TYPE_VIDEO_CAMERA = "camera_video",
  CALLING_INPUT_TYPE_VIDEO_SCREEN = "screen_video",
}

/* Peer Connection */


export interface PeerInfo {
  name: string | undefined;
}

export interface PeersInfo {
  [peerId: string]: PeerInfo;
}

export interface SDPPassThrough {
  sdp: RTCSessionDescription;
  to: string;
  callingConstraints?: CallingConstraints | null;
}

export interface OutgoingSDPPassThrough extends SDPPassThrough {}

export interface ICEPassThrough {
  iceCandidate: RTCIceCandidate;
  to: string;
}

export interface OutgoingICEPassThrough extends ICEPassThrough {}

export interface NegotiatablePeerConnection extends RTCPeerConnection {
  peerName?: string;
  makingOffer?: boolean;
  ignoreRemoteOffer?: boolean;
  isSettingRemoteAnswerPending?: boolean;
  isLocalPoliteDuringOfferCollision?: boolean;
  callingConstraints?: CallingConstraints | null;
}

export interface PeerConnectionMap {
  peerMap: Map<string, NegotiatablePeerConnection>;
  has: (peerId: string) => boolean;
  size: () => number;
  set: (peerId: string, peerConnection: NegotiatablePeerConnection) => void;
  get: (peerId: string) => NegotiatablePeerConnection | undefined;
  findFirstPeerIdByPeerConnection: (peerConnectionToFind: NegotiatablePeerConnection) => string | undefined;
  delete: (peerId: string) => void;
  clear: () => void;
  forEach: (callback: (peerConnection: NegotiatablePeerConnection, peerId: string) => void) => void;
  getPeersInfo: () => PeersInfo;
}

/* Signaling */

export interface NewPeerArivalPayloadAboutNewPeer {
  userId: string;
  userName: string;
  isPolite: boolean;
}

export interface NewPeerArivalPeersInfo {
  [peerId: string]: string;
}

export interface NewPeerArivalPayloadAboutExistingPeers {
  userContainer: NewPeerArivalPeersInfo;
  isPolite: boolean;
}

export type NewPeerArivalPayload =
  | NewPeerArivalPayloadAboutNewPeer
  | NewPeerArivalPayloadAboutExistingPeers;

export interface IncomingSDPPassThrough extends SDPPassThrough {
  from: string;
}

export interface IncomingICEPassThrough extends ICEPassThrough {
  from: string;
}

export type IncomingPassthrough = IncomingSDPPassThrough | IncomingICEPassThrough;

export interface NewPeerLeavePayload {
  userId: string;
}

