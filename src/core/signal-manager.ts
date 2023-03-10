import { NewPeerLeavePayload, IncomingPassthrough, NewPeerArivalPayload } from "./common-types";
import SocketManager from "./socket-manager";

// declare global {
//   interface NewPeerArivalPayloadAboutNewPeer {
//     userId: string;
//     userName: string;
//     isPolite: boolean;
//   }

//   interface NewPeerArivalPeersInfo {
//     [peerId: string]: string;
//   }

//   interface NewPeerArivalPayloadAboutExistingPeers {
//     userContainer: NewPeerArivalPeersInfo;
//     isPolite: boolean;
//   }

//   type NewPeerArivalPayload =
//     | NewPeerArivalPayloadAboutNewPeer
//     | NewPeerArivalPayloadAboutExistingPeers;

//   interface IncomingSDPPassThrough extends SDPPassThrough {
//     from: string;
//   }

//   interface IncomingICEPassThrough extends ICEPassThrough {
//     from: string;
//   }
//   type IncomingPassthrough = IncomingSDPPassThrough | IncomingICEPassThrough;

//   interface NewPeerLeavePayload {
//     userId: string;
//   }
// }

enum _SignalType {
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

type HandleSignalPayload = (payload: unknown) => void;

let _webSocketUrl: string | undefined;

let _handleWebSocketOpened: EventListener | undefined;
let _handleWebSocketClosed: EventListener | undefined;

let _handleJoinRoomSuccess: HandleSignalPayload | undefined;
let _handleRoomsUpdated: HandleSignalPayload | undefined;
let _handleLeaveRoomSuccess: HandleSignalPayload | undefined;

let _handleNewPeerArivalExternally: HandleSignalPayload | undefined;
let _handleNewPeerLeaved: ((payload: NewPeerLeavePayload) => void) | undefined;
let _handleNewPassthroughArival: ((payload: IncomingPassthrough) => void) | undefined;
let _handleNewPeerArivalInternally: ((payload: NewPeerArivalPayload) => void) | undefined;

function _handleSocketOpen(event: Event) {
  console.debug("WebRTCGroupChatController: websocket connected");
  // external usage
  if (_handleWebSocketOpened) {
    _handleWebSocketOpened(event);
  }
}

function _handleSocketClose(event: Event) {
  console.debug("WebRTCGroupChatController: client side heared websocket onclose event");
  // external usage
  if (_handleWebSocketClosed) {
    _handleWebSocketClosed(event);
  }
}

function _handleSocketPing() {
  console.debug("WebRTCGroupChatController: PING signal received, will respond with PONG signal");
  if (!_webSocketUrl) {
    return;
  }
  SocketManager.emitMessageEvent(_webSocketUrl, _SignalType.PONG);
}

function _handleSocketUpdateRooms(payload: unknown) {
  console.debug("WebRTCGroupChatController: UPDATE_ROOMS signal received");

  // external usage
  if (_handleRoomsUpdated) {
    _handleRoomsUpdated(payload);
  }
}

function _handleSocketJoinRoomSuccess(payload: unknown) {
  console.debug("WebRTCGroupChatController: JOIN_ROOM_SUCCESS signal received");
  // external usage
  if (_handleJoinRoomSuccess) {
    _handleJoinRoomSuccess(payload);
  }
}

function _handleSocketLeaveRoomSuccess(payload: unknown) {
  console.debug("WebRTCGroupChatController: LEAVE_ROOM_SUCCESS signal received");
  // external usage
  if (_handleLeaveRoomSuccess) {
    _handleLeaveRoomSuccess(payload);
  }
}

function _handleSocketNewWebRTCPeerArival(payload: unknown) {
  console.debug("WebRTCGroupChatController: WEBRTC_NEW_PEER signal received");
  const newPeerArivalPayload = payload as NewPeerArivalPayload;
  // internal usage
  if (_handleNewPeerArivalInternally) {
    _handleNewPeerArivalInternally(newPeerArivalPayload);
  }
  // external usage
  if (_handleNewPeerArivalExternally) {
    _handleNewPeerArivalExternally(newPeerArivalPayload);
  }
}

function _handleSocketNewWebRTCPassthroughArival(payload: unknown) {
  console.debug("WebRTCGroupChatController: WEBRTC_NEW_PASSTHROUGH signal received");
  const incomingPassthroughPayload = payload as IncomingPassthrough;
  // internal usage
  if (_handleNewPassthroughArival) {
    _handleNewPassthroughArival(incomingPassthroughPayload);
  }
}

function _handleSocketNewWebRTCPeerLeave(payload: unknown) {
  console.debug("WebRTCGroupChatController: WEBRTC_NEW_PEER_LEAVE signal received");
  const newPeerLeavePayload = payload as NewPeerLeavePayload;
  // internal usage
  if (_handleNewPeerLeaved) {
    _handleNewPeerLeaved(newPeerLeavePayload);
  }
}

function _connect() {
  if (!_webSocketUrl || _webSocketUrl.length === 0) {
    console.debug(
      `WebRTCSignalingManager: connecting failed because of WebSocket url`,
      _webSocketUrl
    );
    return;
  }

  SocketManager.createSocket(_webSocketUrl, _handleSocketOpen, _handleSocketClose);
  SocketManager.registerMessageEvent(_webSocketUrl, _SignalType.PING, _handleSocketPing);
  SocketManager.registerMessageEvent(
    _webSocketUrl,
    _SignalType.UPDATE_ROOMS,
    _handleSocketUpdateRooms
  );
  SocketManager.registerMessageEvent(
    _webSocketUrl,
    _SignalType.JOIN_ROOM_SUCCESS,
    _handleSocketJoinRoomSuccess
  );
  SocketManager.registerMessageEvent(
    _webSocketUrl,
    _SignalType.LEAVE_ROOM_SUCCESS,
    _handleSocketLeaveRoomSuccess
  );
  SocketManager.registerMessageEvent(
    _webSocketUrl,
    _SignalType.WEBRTC_NEW_PEER_ARIVAL,
    _handleSocketNewWebRTCPeerArival
  );
  SocketManager.registerMessageEvent(
    _webSocketUrl,
    _SignalType.WEBRTC_NEW_PASSTHROUGH,
    _handleSocketNewWebRTCPassthroughArival
  );
  SocketManager.registerMessageEvent(
    _webSocketUrl,
    _SignalType.WEBRTC_NEW_PEER_LEAVE,
    _handleSocketNewWebRTCPeerLeave
  );
}

function _disconnect() {
  if (!_webSocketUrl || _webSocketUrl.length === 0) {
    return;
  }
  SocketManager.destroySocket(_webSocketUrl);
}

/**
 * Chat room
 */

function _createNewRoomSignaling(roomName: string) {
  if (!_webSocketUrl || _webSocketUrl.length === 0 || roomName.length === 0) {
    return;
  }
  SocketManager.emitMessageEvent(_webSocketUrl, _SignalType.CREATE_ROOM, {
    roomName: roomName,
  });
}

function _joinRoomSignaling(roomId: string) {
  if (!_webSocketUrl || _webSocketUrl.length === 0 || roomId.length === 0) {
    return;
  }
  SocketManager.emitMessageEvent(_webSocketUrl, _SignalType.JOIN_ROOM, {
    roomId: roomId,
  });
}

function _leaveRoomSignaling() {
  if (!_webSocketUrl || _webSocketUrl.length === 0) {
    return;
  }
  SocketManager.emitMessageEvent(_webSocketUrl, _SignalType.LEAVE_ROOM, {});
}

/**
 * WebRTC peer connection
 */

function _passThroughSignaling(payload: unknown) {
  if (!_webSocketUrl || _webSocketUrl.length === 0) {
    return;
  }
  SocketManager.emitMessageEvent(_webSocketUrl, _SignalType.WEBRTC_NEW_PASSTHROUGH, payload);
}

/**
 * Utils
 */

function _checkUserName(username: string) {
  if (username.length === 0) {
    return false;
  }
  return true;
}

function _checkSocketUrl(url: string) {
  // use regular expression to check it literally
  return true;
}

function _checkUserId(id: string) {
  // use regular expression to check it literally
  return true;
}

export default {
  set webSocketUrl(url: string) {
    _webSocketUrl = url;
  },

  connect: function () {
    _connect();
  },

  disconnect: function () {
    _disconnect();
  },

  createNewRoomSignaling: function (roomName: string) {
    _createNewRoomSignaling(roomName);
  },
  joinRoomSignaling: function (roomId: string) {
    _joinRoomSignaling(roomId);
  },
  leaveRoomSignaling: function () {
    _leaveRoomSignaling();
  },

  passThroughSignaling: function (payload: unknown) {
    _passThroughSignaling(payload);
  },

  onWebSocketOpen: function (handler: EventListener) {
    _handleWebSocketOpened = handler;
  },
  onWebSocketClose: function (handler: EventListener) {
    _handleWebSocketClosed = handler;
  },

  onJoinRoomInSuccess: function (handler: HandleSignalPayload) {
    _handleJoinRoomSuccess = handler;
  },
  onRoomsInfoUpdated: function (handler: HandleSignalPayload) {
    _handleRoomsUpdated = handler;
  },
  onLeaveRoomInSuccess: function (handler: HandleSignalPayload) {
    _handleLeaveRoomSuccess = handler;
  },

  onWebRTCNewPeerArivalExternally: function (handler: HandleSignalPayload) {
    _handleNewPeerArivalExternally = handler;
  },
  onWebRTCNewPeerLeaved: function (handler: HandleSignalPayload) {
    _handleNewPeerLeaved = handler;
  },
  onWebRTCNewPassthroughArival: function (handler: HandleSignalPayload) {
    _handleNewPassthroughArival = handler;
  },
  onWebRTCNewPeerArivalInternally: function (handler: HandleSignalPayload) {
    _handleNewPeerArivalInternally = handler;
  },
};
