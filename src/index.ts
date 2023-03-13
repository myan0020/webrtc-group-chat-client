/**
 *
 * This service provides a number of group chat features
 * including chat messaging, media calling and file transceiving
 * using W3C WebRTC API and simple mesh architecture
 *
 */

import {
  CallingInputType,
  ChatMessage,
  JoinRoomSuccessPayload,
  LeaveRoomSuccessPayload,
  LocalMediaContext,
  PeerMediaContextMapProxy,
  PeersInfo,
  ReceivingRelatedDataProxy,
  SendingRelatedDataProxy,
  UpdateRoomsPayload,
} from "./core/common-types";
import SignalingManager from "./core/signal-manager";
import PeerConnectionManager from "./core/peer-connection-manager";
import DataChannelManager from "./core/data-channel-manager";
import MediaCallingManager from "./core/media-calling-mananger";
import { formatBytes } from "./core/common-util";

function _resetRTCRelatedState() {
  MediaCallingManager.hangUpCalling(true);
  MediaCallingManager.clearAllPeerTransceivers();
  PeerConnectionManager.closeALLPeerConnections();
  DataChannelManager.cancelSenderAllFileSending();
  DataChannelManager.clearAllFileBuffersReceived();
  DataChannelManager.clearAllReceivingFiles();

  // TODO: need to clear sending&&receiving related data
  DataChannelManager.clearSendingRelatedData();
  DataChannelManager.clearReceivingRelatedData();
}

export type {
  JoinRoomSuccessPayload,
  UpdateRoomsPayload,
  LeaveRoomSuccessPayload,
  PeersInfo,
  ChatMessage,
  SendingRelatedDataProxy,
  ReceivingRelatedDataProxy,
  CallingInputType,
  LocalMediaContext,
  PeerMediaContextMapProxy,
};

export default {
  set peerConnectionConfig(config: RTCConfiguration) {
    PeerConnectionManager.peerConnectionConfig = config;
  },

  /**
   * connect
   *
   * note: please call 'connect' when a user has already signed in
   */

  connect: function (webSocketUrl: string) {
    if (webSocketUrl.length === 0) {
      console.error(`WebRTCGroupChatController: unexpected websocket url(${webSocketUrl})`);
      return;
    }
    SignalingManager.webSocketUrl = webSocketUrl;
    SignalingManager.connect();
  },

  /**
   * disconnect
   *
   * note: please call 'disconnect' when a user has just signed out
   */

  disconnect: function () {
    _resetRTCRelatedState();
    SignalingManager.disconnect();
    SignalingManager.webSocketUrl = undefined;
  },

  /**
   * Chat Room
   */

  // actions
  createNewRoom: function (roomName: string) {
    SignalingManager.createNewRoomSignaling(roomName);
  },
  joinRoom: function (roomId: string) {
    SignalingManager.joinRoomSignaling(roomId);
  },
  leaveRoom: function () {
    _resetRTCRelatedState();
    SignalingManager.leaveRoomSignaling();
  },
  // listeners
  onJoinRoomInSuccess: function (handler: (payload: JoinRoomSuccessPayload) => void) {
    SignalingManager.onJoinRoomInSuccess(handler);
  },
  onRoomsInfoUpdated: function (handler: (payload: UpdateRoomsPayload) => void) {
    SignalingManager.onRoomsInfoUpdated(handler);
  },
  onLeaveRoomInSuccess: function (handler: (payload: LeaveRoomSuccessPayload) => void) {
    SignalingManager.onLeaveRoomInSuccess(handler);
  },

  /**
   * Peer Connection
   */

  getPeerNameById(peerId: string) {
    return PeerConnectionManager.getPeerNameById(peerId);
  },
  onPeersInfoChanged: function (handler: (peersInfo: PeersInfo) => void) {
    PeerConnectionManager.onPeersInfoChanged(handler);
  },

  /**
   * Messaging
   */

  sendChatMessageToAllPeer(message: string) {
    DataChannelManager.sendChatMessageToAllPeer(PeerConnectionManager.peerConnectionMap, message);
  },
  onChatMessageReceived: function (handler: (chatMessage: ChatMessage) => void) {
    DataChannelManager.onChatMessageReceived(handler);
  },

  /**
   * File Transceiving
   */

  //
  // actions
  //
  // sending
  sendFileToAllPeer(files: File[]) {
    DataChannelManager.sendFileToAllPeer(PeerConnectionManager.peerConnectionMap, files);
  },
  // sending cancellation
  cancelAllFileSending() {
    DataChannelManager.cancelSenderAllFileSending();
  },
  cancelFileSendingToAllPeer(fileHash: string) {
    DataChannelManager.cancelSenderFileSendingToAllPeer(fileHash);
  },
  // receiving resetting (all buffers / downloadable files, will be deleted)
  clearAllFileBuffersReceived() {
    DataChannelManager.clearAllFileBuffersReceived();
  },
  clearAllFilesReceived() {
    DataChannelManager.clearAllReceivingFiles();
  },
  //
  // utils
  //
  formatBytes: function (numberOfBytes: number, decimals?: number) {
    return formatBytes(numberOfBytes, decimals);
  },

  // sending view model changing listener
  onFileSendingRelatedDataChanged: function (
    handler: (
      sendingRelatedDataProxy: SendingRelatedDataProxy,
      isSendingStatusSending?: boolean | undefined
    ) => void
  ) {
    DataChannelManager.onFileSendingRelatedDataChanged(handler);
  },
  // receiving view model changing listener
  onFileReceivingRelatedDataChanged: function (
    handler: (receivingRelatedDataProxy: ReceivingRelatedDataProxy) => void
  ) {
    DataChannelManager.onFileReceivingRelatedDataChanged(handler);
  },

  /**
   * Media Calling
   */

  callingInputType: CallingInputType,
  applyCallingInputTypes(callingInputTypes: CallingInputType[]) {
    MediaCallingManager.applyCallingInputTypes(callingInputTypes);
  },
  startCalling() {
    MediaCallingManager.startCalling(PeerConnectionManager.peerConnectionMap);
  },
  hangUpCalling() {
    MediaCallingManager.hangUpCalling(false);
  },
  // media tracks enabling during media calling
  get localMicEnabled() {
    return MediaCallingManager.localMicEnabled;
  },
  set localMicEnabled(enabled) {
    MediaCallingManager.localMicEnabled = enabled;
  },
  get localCameraEnabled() {
    return MediaCallingManager.localCameraEnabled;
  },
  set localCameraEnabled(enabled) {
    MediaCallingManager.localCameraEnabled = enabled;
  },
  // media tracks' transceiver controlling during media calling
  get localMicMuted() {
    return MediaCallingManager.localMicMuted;
  },
  set localMicMuted(muted) {
    MediaCallingManager.localMicMuted = muted;
  },
  get localCameraMuted() {
    return MediaCallingManager.localCameraMuted;
  },
  set localCameraMuted(muted) {
    MediaCallingManager.localCameraMuted = muted;
  },
  // listeners
  onWebRTCCallingStateChanged: function (handler: (isCalling: boolean) => void) {
    MediaCallingManager.onWebRTCCallingStateChanged(handler);
  },
  onLocalMediaContextChanged: function (handler: (localMediaContext: LocalMediaContext) => void) {
    MediaCallingManager.onLocalMediaContextChanged(handler);
  },
  onPeerMediaContextMapChanged: function (
    handler: (peerMediaContextMapProxy: PeerMediaContextMapProxy) => void
  ) {
    MediaCallingManager.onPeerMediaContextMapChanged(handler);
  },
  onLocalAudioEnableAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    MediaCallingManager.onLocalAudioEnableAvaliableChanged(handler);
  },
  onLocalVideoEnableAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    MediaCallingManager.onLocalVideoEnableAvaliableChanged(handler);
  },
  onLocalAudioMuteAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    MediaCallingManager.onLocalAudioMuteAvaliableChanged(handler);
  },
  onLocalVideoMuteAvaliableChanged: function (handler: (isAvaliable: boolean) => void) {
    MediaCallingManager.onLocalVideoMuteAvaliableChanged(handler);
  },
};
