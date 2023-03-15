import {
  NegotiatablePeerConnection,
  CallingConstraints,
  PeersInfo,
  PeerConnectionMap,
  NewPeerArivalPayload,
  IncomingPassthrough,
  NewPeerLeavePayload,
  OutgoingICEPassThrough,
  OutgoingSDPPassThrough,
  NegotiatableDataChannel,
  HandlePeersInfoChanged,
} from "./common-types";
import SignalingManager from "./signal-manager";
import MediaCallingManager from "./media-calling-mananger";
import DataChannelManager from "./data-channel-manager";

class PeerConnection extends RTCPeerConnection implements NegotiatablePeerConnection {
  peerName?: string;
  makingOffer?: boolean;
  ignoreRemoteOffer?: boolean;
  isSettingRemoteAnswerPending?: boolean;
  isLocalPoliteDuringOfferCollision?: boolean;
  callingConstraints?: CallingConstraints | null;
  createDataChannel(label: string, dataChannelDict?: RTCDataChannelInit) {
    return super.createDataChannel(label, dataChannelDict) as NegotiatableDataChannel;
  }
}
let _peerConnectionConfig: RTCConfiguration | undefined;
let _handlePeersInfoChanged: HandlePeersInfoChanged | undefined;

const _peerConnectionMap: PeerConnectionMap = {
  peerMap: new Map(),
  has(key) {
    return this.peerMap.has(key);
  },
  size() {
    return this.peerMap.size;
  },
  set(key, value) {
    const prevSize = this.peerMap.size;
    this.peerMap.set(key, value);
    const curSize = this.peerMap.size;

    console.debug(
      `WebRTCGroupChatService: _peerConnectionMap set executed, and its size changed from ${prevSize} to ${curSize}`
    );

    if (_handlePeersInfoChanged) {
      _handlePeersInfoChanged(this.getPeersInfo());
    }
  },
  get(key) {
    return this.peerMap.get(key);
  },
  findFirstPeerIdByPeerConnection: function (peerConnectionToFind: NegotiatablePeerConnection) {
    for (let [peerId, peerConnection] of this.peerMap.entries()) {
      if (peerConnection === peerConnectionToFind) return peerId;
    }
  },
  delete(key) {
    const prevSize = this.peerMap.size;
    this.peerMap.delete(key);
    const curSize = this.peerMap.size;

    console.debug(
      `WebRTCGroupChatService: _peerConnectionMap delete executed, and its size changed from ${prevSize} to ${curSize}`
    );

    if (_handlePeersInfoChanged) {
      _handlePeersInfoChanged(this.getPeersInfo());
    }
  },
  clear() {
    const prevSize = this.peerMap.size;
    this.peerMap.clear();
    const curSize = this.peerMap.size;
    console.debug(
      `WebRTCGroupChatService: _peerConnectionMap clear executed, and its size changed from ${prevSize} to ${curSize}`
    );

    if (_handlePeersInfoChanged) {
      _handlePeersInfoChanged(this.getPeersInfo());
    }
  },
  forEach(func) {
    this.peerMap.forEach(func);
  },
  getPeersInfo() {
    const peersInfo: PeersInfo = {};
    this.peerMap.forEach((peerConnection, peerId) => {
      peersInfo[peerId] = { name: peerConnection.peerName };
    });
    return peersInfo;
  },
};

function _handleNewPeerArivalInternally(newPeerArivalPayload: NewPeerArivalPayload) {
  const peerConnectionOfferCollisionSetup = (
    peerConnection: NegotiatablePeerConnection,
    isNewPeerPolite: boolean
  ) => {
    peerConnection.makingOffer = false;
    peerConnection.ignoreRemoteOffer = false;
    peerConnection.isSettingRemoteAnswerPending = false;
    peerConnection.isLocalPoliteDuringOfferCollision = !isNewPeerPolite;
  };

  if ("userId" in newPeerArivalPayload) {
    const { userId: peerId, userName: peerName, isPolite: isNewPeerPolite } = newPeerArivalPayload;
    const peerConnection = _locatePeerConnection(peerId, peerName);
    if (!peerConnection) {
      return;
    }
    peerConnectionOfferCollisionSetup(peerConnection, isNewPeerPolite);
    return;
  }

  const { userContainer: newPeerArivalPeersInfo, isPolite: isNewPeerPolite } = newPeerArivalPayload;
  Object.entries(newPeerArivalPeersInfo).forEach(([peerId, peerName]) => {
    if (peerId && peerId.length > 0) {
      const peerConnection = _locatePeerConnection(peerId, peerName);
      if (!peerConnection) {
        return;
      }
      peerConnectionOfferCollisionSetup(peerConnection, isNewPeerPolite);
    }
  });
}

function _handleNewPassthroughArival(incomingPassthrough: IncomingPassthrough) {
  const peerId = incomingPassthrough.from;
  const peerConnection = _locatePeerConnection(peerId);
  if (!peerConnection) {
    console.debug(
      `WebRTCGroupChatService: unexpected non-existent peer connection ( ${peerConnection} ) with peerId of ${peerId} after '_locatePeerConnection' method`
    );
    return;
  }

  console.debug(
    `WebRTCGroupChatService: before consuming this sdp, the current peerConnection signalingState is ${
      peerConnection.signalingState
    }, the localDescription type is ${
      peerConnection.localDescription ? peerConnection.localDescription.type : "unknown"
    }, the remoteDescription type is ${
      peerConnection.remoteDescription ? peerConnection.remoteDescription.type : "unknown"
    }`
  );

  if ("iceCandidate" in incomingPassthrough) {
    const { iceCandidate } = incomingPassthrough;
    console.debug(`WebRTCGroupChatService: this passthrough carries IceCandidate`, iceCandidate);

    peerConnection
      .addIceCandidate(iceCandidate)
      .then(() => {
        console.debug(
          `WebRTCGroupChatService: peerId (${peerId})'s 'addIceCandidate' done with no issue`
        );
      })
      .catch((error) => {
        // Suppress ignored offer's candidates
        if (!peerConnection.ignoreRemoteOffer) {
          console.error(`WebRTCGroupChatService: Found error with message of ${error}`);
        }
      });
    return;
  }

  const { sdp, callingConstraints } = incomingPassthrough;

  console.debug(`WebRTCGroupChatService: this passthrough carries sdp (${sdp.type})`);

  const isPeerConnectionStable =
    peerConnection.signalingState == "stable" ||
    (peerConnection.signalingState == "have-local-offer" &&
      peerConnection.isSettingRemoteAnswerPending);
  const isPeerConnectionReadyForOffer = !peerConnection.makingOffer && isPeerConnectionStable;
  const isOfferCollision = sdp.type == "offer" && !isPeerConnectionReadyForOffer;

  if (isOfferCollision) {
    console.debug(
      `WebRTCGroupChatService: an offer collision has happened ( signalingState: ${peerConnection.signalingState}, isSettingRemoteAnswerPending: ${peerConnection.isSettingRemoteAnswerPending}, makingOffer: ${peerConnection.makingOffer}, isPeerConnectionStable: ${isPeerConnectionStable}, sdp type: ${sdp.type} )`
    );
  }

  peerConnection.ignoreRemoteOffer =
    isOfferCollision && !peerConnection.isLocalPoliteDuringOfferCollision;

  if (peerConnection.ignoreRemoteOffer) {
    console.debug(
      `WebRTCGroupChatService: the local peer ignore the ${sdp.type} typed SDP for peer connection of peerId ( ${peerId} ), during this offer collision`
    );
    return;
  }

  if (sdp.type == "answer") {
    peerConnection.isSettingRemoteAnswerPending = true;
  }

  peerConnection.callingConstraints = callingConstraints;
  console.debug(`callingConstraints:`, callingConstraints);

  console.debug(
    `WebRTCGroupChatService: before setting 'setRemoteDescription', the remoteDescription is ${
      peerConnection.remoteDescription ? peerConnection.remoteDescription.type : "unknown"
    }`
  );

  peerConnection
    .setRemoteDescription(sdp) // SRD rolls back as needed
    .then(() => {
      console.debug(
        `WebRTCGroupChatService: the local peer accept the ( ${sdp.type} ) typed SDP as a param of 'setRemoteDescription' for peer connection of peerId ( ${peerId} )`
      );
      console.debug(
        `WebRTCGroupChatService: after setting 'setRemoteDescription', the remoteDescription is ${
          peerConnection.remoteDescription ? peerConnection.remoteDescription.type : "unknown"
        }`
      );

      // remote description is answer
      if (sdp.type == "answer") {
        peerConnection.isSettingRemoteAnswerPending = false;
        return;
      }

      // remote description is offer
      return peerConnection.setLocalDescription();
    })
    .then(() => {
      if (sdp.type == "answer") {
        return;
      }
      const outgoingSDPPassThrough: OutgoingSDPPassThrough = {
        sdp: peerConnection.localDescription!,
        to: peerId,
      };
      SignalingManager.passThroughSignaling(outgoingSDPPassThrough);
    })
    .catch((error) => {
      console.error(
        `WebRTCGroupChatService: Found an error with message of ${error} during 'setRemoteDescription' or 'setLocalDescription'`
      );
    });
}

function _handleNewPeerLeave(newPeerLeavePayload: NewPeerLeavePayload) {
  const { userId: peerId } = newPeerLeavePayload;
  MediaCallingManager.deletePeerTransceiver(peerId);
  _closePeerConnection(peerId);
}

function _locatePeerConnection(peerId: string, peerName?: string) {
  if (peerId.length === 0) {
    console.error(
      `WebRTCGroupChatService: unexpected peerId ( ${peerId} ) during '_locatePeerConnection'`
    );
    return;
  }
  if (!_peerConnectionMap.has(peerId)) {
    const prevPeerIdsSize = _peerConnectionMap.size();
    _addPeerConnection(peerId, peerName);
    console.debug(
      `WebRTCGroupChatService: after '_addPeerConnection' method, peer connection count changed from ${prevPeerIdsSize} to ${_peerConnectionMap.size()}`
    );
  }
  return _peerConnectionMap.get(peerId)!;
}

function _addPeerConnection(peerId: string, peerName?: string) {
  if (peerId.length === 0) {
    console.debug(
      `WebRTCGroupChatService: unexpected peerId of ${peerId} during creating and adding a new peer connection`
    );
    return;
  }
  const peerConnection = new PeerConnection(_peerConnectionConfig);
  console.debug(`WebRTCGroupChatService: a new 'RTCPeerConnection' is created`);

  peerConnection.peerName = peerName;

  _peerConnectionMap.set(peerId, peerConnection);

  peerConnection.onicecandidate = (event) => {
    _handlePeerConnectionICECandidateEvent(event, peerId);
  };
  peerConnection.oniceconnectionstatechange = _handlePeerConnectionICEConnectionStateChangeEvent;
  peerConnection.onnegotiationneeded = _handlePeerConnectionNegotiationEvent;
  peerConnection.ondatachannel = (event) => {
    DataChannelManager.handlePeerConnectionDataChannelEvent(event, peerId, peerName);
  };

  peerConnection.ontrack = (event) => {
    MediaCallingManager.handlePeerConnectionTrackEvent(event, peerId);
  };
  MediaCallingManager.addLocalTracksIfPossible(peerId, peerConnection);
}

function _handlePeerConnectionICECandidateEvent(event: RTCPeerConnectionIceEvent, peerId: string) {
  if (event.candidate) {
    const outgoingICEPassThrough: OutgoingICEPassThrough = {
      iceCandidate: event.candidate,
      to: peerId,
    };
    SignalingManager.passThroughSignaling(outgoingICEPassThrough);
    console.debug(
      `WebRTCGroupChatService: a peer connection's 'onicecandidate' fired with a new ICE candidate, then it's sent to ${peerId}`
    );
  }
}

function _handlePeerConnectionICEConnectionStateChangeEvent(event: Event) {
  if (!(event.target instanceof RTCPeerConnection)) {
    return;
  }
  const peerConnection = event.target;
  console.debug(
    `WebRTCGroupChatService: a peer connection's 'oniceconnectionstatechange' fired with a state of '${peerConnection.iceConnectionState}'`,
    `localDescription:`,
    peerConnection.currentLocalDescription,
    `remoteDescription:`,
    peerConnection.currentRemoteDescription
  );

  // TODO: add ice connection status to 'peersInfo' object, and make 'peersInfo' object hear this ice connection state change event
}

function _handlePeerConnectionNegotiationEvent(event: Event) {
  if (!(event.target instanceof PeerConnection)) {
    console.error(
      `WebRTCGroupChatService: unexpected peer connection negotiation event target type`,
      event.target
    );
    return;
  }

  const peerConnection = event.target;
  const peerId = _peerConnectionMap.findFirstPeerIdByPeerConnection(peerConnection);

  if (!peerId) {
    return;
  }

  console.debug(
    `WebRTCGroupChatService: a peer connection's 'onnegotiationneeded' fired, maybe it's time to create a new SDP offer ? the current remoteDescription is ${
      peerConnection.remoteDescription ? peerConnection.remoteDescription.type : "unknown"
    }`
  );

  peerConnection.makingOffer = true;
  peerConnection
    .setLocalDescription()
    .then(() => {
      const offer = peerConnection.localDescription!;
      if (offer.type !== "offer") {
        throw new Error(
          `unexpected localDescription of type '${offer.type}' created to \
          peerId of ${peerId} during 'onnegotiationneeded'`
        );
      }

      console.debug(
        `WebRTCGroupChatService: a new localDescription of type '${offer.type}' created to peerId of ${peerId} during 'onnegotiationneeded'`
      );
      console.debug(
        `WebRTCGroupChatService: the current localDescription is ${
          peerConnection.localDescription!.type
        }, the current remoteDescription is ${
          peerConnection.remoteDescription ? peerConnection.remoteDescription.type : "unknown"
        },  during 'onnegotiationneeded'`
      );

      const outgoingSDPPassThrough: OutgoingSDPPassThrough = {
        sdp: offer,
        to: peerId,
        callingConstraints: MediaCallingManager.callingConstraints,
      };
      SignalingManager.passThroughSignaling(outgoingSDPPassThrough);
    })
    .catch((error) => {
      console.error(`WebRTCGroupChatService: Found error with message of ${error}`);
    })
    .finally(() => {
      peerConnection.makingOffer = false;
    });
}

function _closePeerConnection(peerId: string) {
  if (peerId.length === 0) {
    console.debug(`WebRTCGroupChatService: unexpected peerId when stopping peer side connection`);
    return;
  }

  const peerConnection = _peerConnectionMap.get(peerId);
  if (!peerConnection) return;

  peerConnection.close();
  _peerConnectionMap.delete(peerId);
}

function _closeALLPeerConnections() {
  _peerConnectionMap.forEach((peerConnection, peerId) => {
    if (peerConnection) {
      peerConnection.close();
      console.debug(`WebRTCGroupChatService: the peerConnection with peerId of ${peerId} closed`);
    }
  });
  _peerConnectionMap.clear();
  console.debug(`WebRTCGroupChatService: all peer connections cleared`);
}

/**
 * Binding to signaling manager
 */

SignalingManager.onWebRTCNewPeerLeaved(_handleNewPeerLeave);
SignalingManager.onWebRTCNewPassthroughArival(_handleNewPassthroughArival);
SignalingManager.onWebRTCNewPeerArivalInternally(_handleNewPeerArivalInternally);

export default {
  set peerConnectionConfig(config: RTCConfiguration) {
    _peerConnectionConfig = config;
  },

  get peerConnectionMap() {
    return _peerConnectionMap;
  },

  getPeerNameById(peerId: string) {
    const peerConnection = _peerConnectionMap.get(peerId);
    if (!peerConnection || typeof peerConnection.peerName !== "string") {
      return undefined;
    }
    return peerConnection.peerName;
  },

  handleNewPeerArivalInternally: function (newPeerArivalPayload: NewPeerArivalPayload) {
    _handleNewPeerArivalInternally(newPeerArivalPayload);
  },
  handleNewPassthroughArival: function (incomingPassthrough: IncomingPassthrough) {
    _handleNewPassthroughArival(incomingPassthrough);
  },
  handleNewPeerLeave: function (newPeerLeavePayload: NewPeerLeavePayload) {
    _handleNewPeerLeave(newPeerLeavePayload);
  },

  closeALLPeerConnections: function () {
    _closeALLPeerConnections();
  },

  //listener
  onPeersInfoChanged: function (handler: (peersInfo: PeersInfo) => void) {
    _handlePeersInfoChanged = handler;
  },
};
