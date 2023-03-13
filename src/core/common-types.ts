/**
 * Socket
 */

export interface EventListenerContainer {
  open?: EventListener;
  error?: EventListener;
  close?: EventListener;
  message?: EventListener[];
}

export type HandleMessagePayload = (payload: any) => void;

/**
 * Signaling
 */

export enum _SignalType {
  // WebSocket //
  //
  // heartbeat
  PING = 3,
  PONG = 4,
  //
  // chat room
  GET_ROOMS = 5,
  CREATE_ROOM = 6,
  UPDATE_ROOMS = 7,
  JOIN_ROOM = 8,
  JOIN_ROOM_SUCCESS = 9,
  LEAVE_ROOM = 10,
  LEAVE_ROOM_SUCCESS = 11,
  //
  // WebRTC connection
  WEBRTC_NEW_PEER_ARIVAL = 12,
  WEBRTC_NEW_PEER_LEAVE = 13,
  WEBRTC_NEW_PASSTHROUGH = 14,
}

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

export interface JoinRoomSuccessPayload {
  roomId: string;
  roomName: string;
}

export interface ChatRoom {
  id: string;
  name: string;
}

export interface ChatRooms {
  [roomId: string]: ChatRoom;
}

export interface UpdateRoomsPayload {
  rooms: ChatRooms;
}

export interface LeaveRoomSuccessPayload {
  roomId: string;
  roomName: string;
  userId: string;
}

/**
 * Peer Connection
 */

export type HandlePeersInfoChanged = (peersInfo: PeersInfo) => void;

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

  createDataChannel: (
    label: string,
    dataChannelDict?: RTCDataChannelInit
  ) => NegotiatableDataChannel;
}

export interface PeerConnectionMap {
  peerMap: Map<string, NegotiatablePeerConnection>;
  has: (peerId: string) => boolean;
  size: () => number;
  set: (peerId: string, peerConnection: NegotiatablePeerConnection) => void;
  get: (peerId: string) => NegotiatablePeerConnection | undefined;
  findFirstPeerIdByPeerConnection: (
    peerConnectionToFind: NegotiatablePeerConnection
  ) => string | undefined;
  delete: (peerId: string) => void;
  clear: () => void;
  forEach: (callback: (peerConnection: NegotiatablePeerConnection, peerId: string) => void) => void;
  getPeersInfo: () => PeersInfo;
}

/**
 * Media Calling
 */

export interface AudioProcessor {
  audioContext: AudioContext | null;
  audioGainNode: GainNode | null;
  audioAnalyserNode: AnalyserNode | null;
  volumeMultipler: number;
}

export interface LocalAudioProcessor extends AudioProcessor {
  audioSourceNodeMap: Map<string, MediaStreamAudioSourceNode>;
  audioDestinationNode: MediaStreamAudioDestinationNode | null;
}

export interface PeerAudioProcessor extends AudioProcessor {
  audioSourceNode: MediaStreamAudioSourceNode | null;
  playWithAudioDOMLoaded: (audioDOMLoaded: HTMLMediaElement) => void;
}

export interface MediaContext {
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  audioProcessor: AudioProcessor | null;
}

export interface LocalMediaContext extends MediaContext {
  mediaSourceStreams: MediaStream[];
  audioProcessor: LocalAudioProcessor;
}

export interface PeerMediaContext extends MediaContext {
  audioProcessor: PeerAudioProcessor | null;
}

export interface PeerMediaContextMap {
  map: Map<string, PeerMediaContext>;
  has: (peerId: string) => boolean;
  size: () => number;
  getMediaContext: (peerId: string) => PeerMediaContext | undefined;
  deleteTrack: (peerId: string, kind: string) => void;
  setTrack: (peerId: string, track: MediaStreamTrack) => void;
}

export type ProxyOf<T extends { map: Map<string, PeerMediaContext> }> = Readonly<{ map: T["map"] }>;

export type PeerMediaContextMapProxy = ProxyOf<PeerMediaContextMap>;

export type CallingConstraints = {
  [key in CallingInputType]?: boolean;
};

export enum CallingInputType {
  CALLING_INPUT_TYPE_AUDIO_MICROPHONE = "microphone_audio",
  CALLING_INPUT_TYPE_AUDIO_SCREEN = "screen_audio",
  CALLING_INPUT_TYPE_VIDEO_CAMERA = "camera_video",
  CALLING_INPUT_TYPE_VIDEO_SCREEN = "screen_video",
}

export enum CallingStateChangingType {
  START_UP_CALLING = "Start_Up_Calling",
  HANG_UP_CALLING = "Hang_Up_Calling",
}

/**
 * File Caching
 */

export interface FileMeta {
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

export type FileExporter = () => Promise<File>;

export interface FileHashToMeta {
  [fileHash: string]: FileMeta;
}

export interface FileHashToFile {
  [fileHash: string]: File;
}

export interface FileHashToExporter {
  [fileHash: string]: FileExporter | undefined;
}

export interface FileHashToMinProgress {
  [fileHash: string]: number;
}

export interface FileHashToProgress {
  [fileHash: string]: number;
}

export enum SendingSliceName {
  SENDING_META_DATA = "SENDING_META_DATA",
  SENDING_MIN_PROGRESS = "SENDING_MIN_PROGRESS",
}

export enum ReceivingSliceName {
  RECEIVING_META_DATA = "RECEIVING_META_DATA",
  RECEIVING_FILE_EXPORTER = "RECEIVING_FILE_EXPORTER",
  RECEIVING_PROGRESS = "RECEIVING_PROGRESS",
}

export type Progress = number;

export type MinProgress = number;

export type AdditionalProgress = number;

export type SendingSliceValue = FileMeta | MinProgress;

export type ReceivingSliceValue = FileMeta | FileExporter | Progress;

export type SendingHashToSingleSlice = FileHashToMeta | FileHashToMinProgress;

export type ReceivingPeerMapOfHashToSingleSlice =
  | Map<string, FileHashToMeta>
  | Map<string, FileHashToExporter>
  | Map<string, FileHashToProgress>;

export type SendingAllSlices = {
  [key in SendingSliceName]?: SendingSliceValue;
};

export type SendingHashToAllSlices = {
  [fileHash: string]: SendingAllSlices;
};

export type ReceivingAllSlices = {
  [key in ReceivingSliceName]?: ReceivingSliceValue;
};

export type ReceivingHashToAllSlices = {
  [fileHash: string]: ReceivingAllSlices;
};

export type ReceivingPeerMapOfHashToAllSlices = Map<string, ReceivingHashToAllSlices>;

export interface SendingRelatedData {
  fileHashToAllSlices: SendingHashToAllSlices;
  updateSendingStatus: (isSendingStatusSending: boolean) => void;
  updateSlice: (
    fileHashToSingleSlice: SendingHashToSingleSlice,
    sliceName: SendingSliceName
  ) => void;
  clear: () => void;
}

export interface SendingRelatedDataProxy {
  fileHashToAllSlices: SendingAllSlices;
}

export interface ReceivingRelatedData {
  peerMapOfHashToAllSlices: ReceivingPeerMapOfHashToAllSlices;
  updateSlice: (
    peerMapOfHashToSingleSlice: ReceivingPeerMapOfHashToSingleSlice,
    sliceName: ReceivingSliceName
  ) => void;
  clear: () => void;
}

export interface ReceivingRelatedDataProxy {
  peerMapOfHashToAllSlices: ReceivingPeerMapOfHashToAllSlices;
}

export interface FileHashToTransceivingCancelled {
  [fileHash: string]: boolean;
}

export interface ReceivingCancelledMap {
  peerMap: Map<string, FileHashToTransceivingCancelled>;
  getCancelled: (peerId: string, fileHash: string) => boolean;
  setCancelled: (peerId: string, fileHash: string, receivingCancelled: boolean) => void;
  deleteCancelled: (peerId: string, fileHash: string) => void;
  clear: () => void;
}

export interface MappableTranceivingProgress {
  peerMap: Map<string, FileHashToMinProgress | FileHashToProgress>;
  getProgress: (peerId: string, fileHash: string) => MinProgress | Progress;
  setProgress: (peerId: string, fileHash: string, progress: MinProgress | Progress) => void;
  addProgress: (
    peerId: string,
    fileHash: string,
    additionalProgress: AdditionalProgress
  ) => MinProgress | Progress;
  resetProgress: (peerId: string, fileHash: string) => void;
  calculateMinProgress: (fileHash: string) => MinProgress;
}

export interface ReceivingPeerMapOfHashToMeta {
  peerMap: Map<string, FileHashToMeta>;
  getHashToMetaData: (peerId: string) => FileHashToMeta | undefined;
  getMetaData: (peerId: string, fileHash: string) => FileMeta | undefined;
  overwriteHashToMetaData: (peerId: string, hashToMetaData: FileHashToMeta) => void;
  mergeHashToMetaData: (peerId: string, hashToMetaData: FileHashToMeta) => void;
  setMetaData: (peerId: string, fileHash: string, metaData: FileMeta) => void;
}

export type IDBDatabasePromise = Promise<IDBDatabase>;

export enum IDBBufferPersistingPromiseFulFilledType {
  FULFILLED_RESETTING = "IDBBufferPersistingPromiseFulFilledType_fulfilled_resetting",
  FULFILLED_ADDING = "IDBBufferPersistingPromiseFulFilledType_fulfilled_adding",
  FULFILLED_ERROR = "IDBBufferPersistingPromiseFulFilledType_fulfilled_error",
}

export interface IDBBufferPersistingPromiseFulfillment {
  fulFilledType: IDBBufferPersistingPromiseFulFilledType;
  fulFilledAtOffset: number;
}

export type IDBBufferPersistingPromiseChain = Promise<IDBBufferPersistingPromiseFulfillment>;

export interface FileHashToIDBPersisitingPromiseChain {
  [fileHash: string]: IDBBufferPersistingPromiseChain;
}

export type IDBBufferPersistingTask = (
  lastFulfillment: IDBBufferPersistingPromiseFulfillment
) => Promise<IDBBufferPersistingPromiseFulfillment>;

export interface ReceivingBufferIDBPersistingSchedulerMap {
  peerMap: Map<string, FileHashToIDBPersisitingPromiseChain>;
  scheduleNextTask: (peerId: string, fileHash: string, task: IDBBufferPersistingTask) => void;
}

export interface ReceivingHashToExporterMap {
  peerMap: Map<string, FileHashToExporter>;
  avaliableFileIds: string[];
  setExporter: (peerId: string, fileHash: string, exporter: FileExporter | undefined) => void;
  clearExporters: () => void;
}

export interface ReceivingIDBBufferWrapper {
  buffer: ArrayBuffer;
  startOffset: number;
}

/**
 * Data Channel
 */

export interface LabelToDataChannel {
  [label: string]: NegotiatableDataChannel;
}

export enum DataChannelType {
  FILE_META = "DataChannelType_FILE_META",
  FILE_BUFFER = "DataChannelType_FILE_BUFFER",
  TEXT = "DataChannelType_TEXT",
}

export interface MappableLabelToDataChannel {
  type: DataChannelType;
  peerMap: Map<string, LabelToDataChannel>;
  setChannel: (peerId: string, label: string, channel: NegotiatableDataChannel) => void;
  getChannel: (peerId: string, label: string) => NegotiatableDataChannel | undefined;
  hasChannel: (peerId: string, label: string) => boolean;
  forEach: (callback: (labelToDataChannel: LabelToDataChannel, peerId: string) => void) => void;
}

export type TaskQueue = (() => void)[];

export interface TaskQueueMap {
  peerMap: Map<string, TaskQueue>;
  shiftTask: (peerId: string) => (() => void) | undefined;
  pushTask: (peerId: string, task: () => void) => void;
}

export interface ChatMessage {
  peerId: string;
  peerName: string | undefined;
  text: string;
}

export interface CreatingDataChannelOptions {
  binaryType?: BinaryType;
  bufferedAmountLowThreshold?: number;
  onopen?: ((this: NegotiatableDataChannel, ev: Event) => any) | null;
  onbufferedamountlow?: ((this: NegotiatableDataChannel, ev: Event) => any) | null;
  onmessage?: ((this: NegotiatableDataChannel, ev: MessageEvent) => any) | null;
  onclose?: ((this: NegotiatableDataChannel, ev: Event) => any) | null;
}

export interface NegotiatableDataChannel extends RTCDataChannel {
  maxMessageSize?: number;
  hasSentEndOfFileBufferMessage?: boolean;
}
