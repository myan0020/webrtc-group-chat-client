import FileCacheManager from "./file-cache-manager";
import {
  ChatMessage,
  CreatingDataChannelOptions,
  DataChannelType,
  FileHashToFile,
  FileHashToMeta,
  LabelToDataChannel,
  MappableLabelToDataChannel,
  NegotiatableDataChannel,
  NegotiatablePeerConnection,
  PeerConnectionMap,
  ReceivingRelatedDataProxy,
  SendingRelatedDataProxy,
  TaskQueueMap,
} from "./common-types";
import { getUniqueFiles } from "./common-util";

class LabelToDataChannelMap implements MappableLabelToDataChannel {
  type: DataChannelType;
  peerMap = new Map<string, LabelToDataChannel>();
  constructor(type: DataChannelType) {
    this.type = type;
  }
  setChannel(peerId: string, label: string, channel: NegotiatableDataChannel) {
    let peerSpecificObject = this.peerMap.get(peerId);
    if (!peerSpecificObject) {
      peerSpecificObject = {};
    }
    peerSpecificObject[label] = channel;

    this.peerMap.set(peerId, peerSpecificObject);

    console.debug(
      `WebRTCGroupChatService: a new channel of`,
      channel,
      `with a label (${label})`,
      `is set to the dataChannelMap`,
      this
    );
  }
  getChannel(peerId: string, label: string) {
    if (!this.peerMap.has(peerId)) {
      return undefined;
    }
    return this.peerMap.get(peerId)![label];
  }
  hasChannel(peerId: string, label: string) {
    let peerSpecificObject = this.peerMap.get(peerId);
    if (!peerSpecificObject) {
      return false;
    }
    if (!peerSpecificObject[label]) {
      return false;
    }
    return true;
  }
  forEach(callback: (labelToDataChannel: LabelToDataChannel, peerId: string) => void) {
    this.peerMap.forEach(callback);
  }
}

/**
 * Chat messaging
 */

const CHAT_MESSAGING_CHANNEL_LABEL = "CHAT_MESSAGING_CHANNEL_LABEL";
const _peerChatMessagingChannelMap = new LabelToDataChannelMap(DataChannelType.TEXT);

let _handleChatMessageReceived: ((chatMessage: ChatMessage) => void) | undefined;

function _sendChatMessageToAllPeer(peerConnectionMap: PeerConnectionMap, message: string) {
  if (message.length === 0) {
    console.debug(`WebRTCGroupChatService: unexpected message during chat messaging`, message);
    return;
  }

  peerConnectionMap.forEach((peerConnection, peerId) => {
    _sendChatMessageToPeer(message, peerId, peerConnection);
  });
}

function _sendChatMessageToPeer(
  message: string,
  peerId: string,
  peerConnection: NegotiatablePeerConnection
) {
  if (message.length === 0) {
    console.debug(`WebRTCGroupChatService: unexpected message during chat messaging`, message);
    return;
  }

  const channel = _peerChatMessagingChannelMap.getChannel(peerId, CHAT_MESSAGING_CHANNEL_LABEL);
  if (channel) {
    _sendChatMessageWithPeerDataChannel(message, channel, peerId);
  } else {
    const options: CreatingDataChannelOptions = {
      bufferedAmountLowThreshold: 0,
      onopen(this, event) {
        _sendChatMessageWithPeerDataChannel(message, this, peerId);
      },
      onmessage(event) {
        _handleChatMessagingChannelMessage(
          event,
          CHAT_MESSAGING_CHANNEL_LABEL,
          peerId,
          peerConnection.peerName
        );
      },
      onclose(event) {
        _handleChannelClose(event, peerId);
      },
    };
    _createAndStoreDataChannel(peerConnection, peerId, CHAT_MESSAGING_CHANNEL_LABEL, options);
  }
}

function _sendChatMessageWithPeerDataChannel(
  message: string,
  channel: NegotiatableDataChannel,
  peerId: string
) {
  if (channel.readyState !== "open") {
    console.debug(
      `WebRTCGroupChatService: unexpected data channel readyState(${channel.readyState}) when sending chat message`
    );
    return;
  }

  channel.send(message);
  console.debug(
    `WebRTCGroupChatService: sent a chat starting message(${message}) to a peer(${peerId})`
  );
}

function _handleChatMessagingChannelMessage(
  event: MessageEvent,
  label: string,
  peerId: string,
  peerName?: string
) {
  const { data: message } = event;

  console.debug(
    `WebRTCGroupChatService: the '${
      label ? label : "unknown"
    }' labeled data channel's 'onmessage' fired with a chat message(${message})`
  );

  if (typeof message !== "string") {
    console.debug(`WebRTCGroupChatService: unexpected 'data' type, it is not type of 'string'`);
    return;
  }
  if (_handleChatMessageReceived) {
    _handleChatMessageReceived({ peerId, peerName, text: message });
  }
}

/**
 * File transceiving
 */

const MAXIMUM_FILE_CHUNK_SIZE_OF_DEFAULT = 16 * 1024;
const FILE_META_DATA_CHANNEL_LABEL = "FILE_META_DATA_CHANNEL_LABEL";
const ACK_FOR_FILE_META_DATA_MESSAGE = "ACK_FOR_FILE_META_DATA_MESSAGE";
const START_OF_FILE_BUFFER_MESSAGE = "START_OF_FILE_BUFFER_MESSAGE";
const END_OF_FILE_BUFFER_MESSAGE = "END_OF_FILE_BUFFER_MESSAGE";
const ACK_FOR_END_OF_FILE_BUFFER_MESSAGE = "ACK_FOR_END_OF_FILE_BUFFER_MESSAGE";
const CANCEL_OF_FILE_BUFFER_MESSAGE = "CANCEL_OF_FILE_BUFFER_MESSAGE";

// ( sender: file meta data, receiver: file meta data )
const _peerFileMetaDataChannelMap = new LabelToDataChannelMap(DataChannelType.FILE_META);

// ( sender: file buffer, receiver: file buffer )
const _peerFileBufferChannelMap = new LabelToDataChannelMap(DataChannelType.FILE_BUFFER);

// ( sender: file buffer )
const _sendFileTaskQueueMap: TaskQueueMap = {
  peerMap: new Map(),
  shiftTask(peerId) {
    let sendFileTaskQueue = this.peerMap.get(peerId);
    if (!sendFileTaskQueue) {
      sendFileTaskQueue = [];
    }
    return sendFileTaskQueue.shift();
  },
  pushTask(peerId, sendFileTask) {
    let sendFileTaskQueue = this.peerMap.get(peerId);
    if (!sendFileTaskQueue) {
      sendFileTaskQueue = [];
    }
    sendFileTaskQueue.push(sendFileTask);
    this.peerMap.set(peerId, sendFileTaskQueue);
  },
};

// ( sender: file meta data && file buffer )
function _sendFileToAllPeer(peerConnectionMap: PeerConnectionMap, files: File[]) {
  if (!peerConnectionMap) {
    console.debug(
      `WebRTCGroupChatService: unexpected peerConnectionMap during file meta data sending`,
      peerConnectionMap
    );
    return;
  }

  if (!files) {
    console.debug(`WebRTCGroupChatService: unexpected files during file meta data sending`, files);
    return;
  }

  // first, guarantee no file sending is cancelled naturally
  FileCacheManager.clearSendingCancelled();

  // then, make file sending tasks for each peer connected
  peerConnectionMap.forEach((peerConnection, peerId) => {
    _sendFileToPeer(files, peerId, peerConnection);
  });
}

// ( sender: file meta data && file buffer )
async function _sendFileToPeer(
  files: File[],
  peerId: string,
  peerConnection: NegotiatablePeerConnection
) {
  if (!files) {
    console.debug(
      `WebRTCGroupChatService: unexpected files ( ${files} ) during file meta data sending`
    );
    return;
  }

  // transform the files into a file hash to file meta data
  const fileHashToFile = await getUniqueFiles(files);
  FileCacheManager.prepareSendingMetaData(fileHashToFile);

  // create and store a data channel to transfer the prepared file hash to file meta data object
  const options: CreatingDataChannelOptions = {
    bufferedAmountLowThreshold: 0,
    onopen(this, event) {
      _handleSenderFileMetaDataChannelOpen(
        peerId,
        this,
        FileCacheManager.preparedSendingHashToMetaData
      );
    },
    onmessage(this, event) {
      _handleSenderFileMetaDataChannelMessage(event, peerId, peerConnection, this, fileHashToFile);
    },
    onclose(event) {
      _handleChannelClose(event, peerId);
    },
  };
  _createAndStoreDataChannel(peerConnection, peerId, FILE_META_DATA_CHANNEL_LABEL, options);
}

// ( sender: file meta data )
function _handleSenderFileMetaDataChannelOpen(
  peerId: string,
  channel: NegotiatableDataChannel,
  preparedFileHashToMetaData: FileHashToMeta
) {
  if (channel.readyState !== "open") {
    console.debug(
      `WebRTCGroupChatService: unexpected data channel readyState(${channel.readyState}) when sending file meta data`
    );
    return;
  }

  channel.send(JSON.stringify(preparedFileHashToMetaData));

  console.debug(
    `WebRTCGroupChatService: sent a file hash to meta data object of`,
    preparedFileHashToMetaData,
    `to a peer(${peerId})`
  );
}

// ( sender: file meta data )
function _handleSenderFileMetaDataChannelMessage(
  event: MessageEvent,
  peerId: string,
  peerConnection: NegotiatablePeerConnection,
  fileMetaDataChannel: NegotiatableDataChannel,
  fileHashToFile: FileHashToFile
) {
  const { data } = event;
  if (data === ACK_FOR_FILE_META_DATA_MESSAGE) {
    console.debug(
      `WebRTCGroupChatService: received ACK_FOR_FILE_META_DATA_MESSAGE from a peer (${peerId}), will perform an active close for this file meta data channel and starting to send file buffers`,
      fileHashToFile
    );

    fileMetaDataChannel.close();
    _sendFileBufferToPeer(fileHashToFile, peerId, peerConnection);
  }
}

// ( sender: file buffer )
async function _sendFileBufferToPeer(
  fileHashToFile: FileHashToFile,
  peerId: string,
  peerConnection: NegotiatablePeerConnection
) {
  if (!fileHashToFile) {
    console.debug(
      `WebRTCGroupChatService: unfound file hash to file object during file buffer sending`
    );
    return;
  }

  const checkingPassed = FileCacheManager.checkIfSendingMetaDataPrepared(fileHashToFile);
  if (!checkingPassed) {
    console.debug(
      `WebRTCGroupChatService: unexpected file hash to file of`,
      fileHashToFile,
      `because it cannot pass file hash to meta data preparation checking during file buffer sending`
    );
    return;
  }

  Object.keys(fileHashToFile).forEach((fileHash) => {
    const sendFileTask = () => {
      if (FileCacheManager.getSendingCancelled(fileHash)) {
        _handleSenderFileBufferChannelClose(peerId);
        return;
      }

      const label = `file-${fileHash}`;
      const file = fileHashToFile[fileHash];
      FileCacheManager.resetSendingProgress(peerId, fileHash);

      const options: CreatingDataChannelOptions = {
        binaryType: "arraybuffer",
        bufferedAmountLowThreshold: 0,
        onopen(this, event) {
          _handleSenderFileBufferChannelOpen(event, peerId, this);
        },
        onbufferedamountlow(this, event) {
          _handleSenderFileBufferChannelBufferedAmountLow(event, peerId, this, fileHash, file);
        },
        onmessage(this, event) {
          _handleSenderFileBufferChannelMessage(event, peerId, this);
        },
        onclose(event) {
          _handleSenderFileBufferChannelClose(peerId);
        },
      };
      _createAndStoreDataChannel(peerConnection, peerId, label, options);
    };

    _sendFileTaskQueueMap.pushTask(peerId, sendFileTask);
  });

  const sendFileTask = _sendFileTaskQueueMap.shiftTask(peerId);
  if (sendFileTask) {
    sendFileTask();
  }
}

// ( sender: file buffer )
function _handleSenderFileBufferChannelMessage(
  event: MessageEvent,
  peerId: string,
  fileBufferChannel: NegotiatableDataChannel
) {
  const { data } = event;
  if (data === ACK_FOR_END_OF_FILE_BUFFER_MESSAGE) {
    console.debug(
      `WebRTCGroupChatService: received ACK_FOR_END_OF_FILE_BUFFER_MESSAGE from a peer (${peerId}), will perform an active close for this file buffer channel`
    );

    fileBufferChannel.close();
  }
}

// ( sender: file meta data && file buffer )
function _createAndStoreDataChannel(
  peerConnection: NegotiatablePeerConnection,
  peerId: string,
  label: string,
  options?: CreatingDataChannelOptions
) {
  if (peerId.length === 0 || label.length === 0) {
    console.debug(
      `WebRTCGroupChatService: unexpected peerId( ${peerId} ) / label( ${label} ) during data channel creating`
    );
    return;
  }

  const channel = peerConnection.createDataChannel(label);

  console.debug(
    `WebRTCGroupChatService: a new data channel of label(${label}) for a peer(${peerId}) has been created`,
    channel
  );

  if (options) {
    channel.bufferedAmountLowThreshold =
      typeof options.bufferedAmountLowThreshold === "number"
        ? options.bufferedAmountLowThreshold
        : 0;
    channel.maxMessageSize = 0;

    if (peerConnection.sctp && peerConnection.sctp.maxMessageSize > 0) {
      channel.maxMessageSize = peerConnection.sctp.maxMessageSize;
      console.debug(
        `WebRTCGroupChatService: a sctp`,
        peerConnection.sctp,
        `with maxMessageSize(${peerConnection.sctp.maxMessageSize}) and state(${peerConnection.sctp.state}) has found and set to a dataChannel(${label})`
      );
    }

    if (options.onopen) {
      channel.onopen = options.onopen;
    }
    if (options.onmessage) {
      channel.onmessage = options.onmessage;
    }
    if (options.onbufferedamountlow) {
      channel.onbufferedamountlow = options.onbufferedamountlow;
    }
    if (options.onclose) {
      channel.onclose = options.onclose;
    }

    if (label === CHAT_MESSAGING_CHANNEL_LABEL) {
      _peerChatMessagingChannelMap.setChannel(peerId, label, channel);
    } else if (label === FILE_META_DATA_CHANNEL_LABEL) {
      _peerFileMetaDataChannelMap.setChannel(peerId, label, channel);
    } else {
      _peerFileBufferChannelMap.setChannel(peerId, label, channel);
    }
  }
}

// ( sender: file buffer )
async function _handleSenderFileBufferChannelBufferedAmountLow(
  event: Event,
  peerId: string,
  channel: NegotiatableDataChannel,
  fileHash: string,
  file: File
) {
  const offset = FileCacheManager.getSendingProgress(peerId, fileHash);
  console.debug(
    `WebRTCGroupChatService: '_handleSenderFileBufferChannelBufferedAmountLow' called, from a channel(${channel.label}), peerId(${peerId}), the current file(${fileHash}) offset is ${offset}`
  );

  if (channel.hasSentEndOfFileBufferMessage) {
    return;
  }

  if (channel.readyState !== "open") {
    return;
  }

  if (offset >= file.size) {
    console.debug(
      `WebRTCGroupChatService: the offset(${offset}) is not less than file size(${file.size}), so notify remote peer that the file buffer sending is completed and wait for ACK_FOR_END_OF_FILE_BUFFER_MESSAGE`
    );

    channel.hasSentEndOfFileBufferMessage = true;
    channel.send(END_OF_FILE_BUFFER_MESSAGE);

    return;
  }

  if (FileCacheManager.getSendingCancelled(fileHash)) {
    return;
  }

  const newOffset = await _sendChunk(fileHash, file, offset, channel);

  if (FileCacheManager.getSendingCancelled(fileHash)) {
    return;
  }

  FileCacheManager.setSendingProgress(peerId, fileHash, newOffset);
}

// ( sender: file buffer )
async function _sendChunk(
  fileHash: string,
  file: File,
  offset: number,
  channel: NegotiatableDataChannel
) {
  const maxMessageSize =
    typeof channel.maxMessageSize === "number" && channel.maxMessageSize > 0
      ? channel.maxMessageSize
      : MAXIMUM_FILE_CHUNK_SIZE_OF_DEFAULT;
  const chunk = file.slice(offset, offset + maxMessageSize);
  const buffer = await chunk.arrayBuffer();

  // avoid sending after sending cancelled
  if (FileCacheManager.getSendingCancelled(fileHash)) {
    return 0;
  }

  if (channel.readyState !== "open") {
    console.debug(
      `WebRTCGroupChatService: unexpected data channel readyState(${channel.readyState}) when sending file buffer`
    );
    return offset;
  }

  channel.send(buffer);

  console.debug(
    `WebRTCGroupChatService: through a data channel(label:${channel.label}) of readyState(${channel.readyState}), a chunk`,
    buffer,
    `of a file(${fileHash}) starting from an offset(${offset}) with a size(${buffer.byteLength}) sent`
  );

  return offset + chunk.size;
}

// ( sender: file buffer )
function _handleSenderFileBufferChannelClose(peerId: string) {
  console.debug(
    `WebRTCGroupChatService: '_handleSenderFileBufferChannelClose' called for a sender peer (${peerId})`
  );

  const sendFileTask = _sendFileTaskQueueMap.shiftTask(peerId);
  if (!sendFileTask) {
    return;
  }
  sendFileTask();
}

// ( sender: file buffer )
function _cancelSenderAllFileSending() {
  Object.keys(FileCacheManager.preparedSendingHashToMetaData).forEach((fileHash) => {
    _cancelSenderFileSendingToAllPeer(fileHash);
  });
}

// ( sender: file buffer )
function _cancelSenderFileSendingToAllPeer(fileHash: string) {
  FileCacheManager.setSendingCancelled(fileHash, true);

  _peerFileBufferChannelMap.forEach((_, peerId) => {
    FileCacheManager.resetSendingProgress(peerId, fileHash);

    const label = `file-${fileHash}`;
    const channel = _peerFileBufferChannelMap.getChannel(peerId, label);
    if (!channel) {
      console.debug(
        `WebRTCGroupChatService: unexpected data channel of 'undefined' when sending canceling message`
      );
      return;
    }
    if (channel.readyState !== "open") {
      console.debug(
        `WebRTCGroupChatService: unexpected data channel readyState(${channel.readyState}) when sending canceling message`
      );
      return;
    }
    channel.send(CANCEL_OF_FILE_BUFFER_MESSAGE);
    channel.close();

    console.debug(
      `WebRTCGroupChatService: sent a sending cancelled signal to a receiver peer (${peerId}), and closed the data channel`
    );
  });
}

// ( sender: file buffer )
function _handleSenderFileBufferChannelOpen(
  event: Event,
  peerId: string,
  channel: NegotiatableDataChannel
) {
  if (channel.readyState !== "open") {
    console.debug(
      `WebRTCGroupChatService: unexpected data channel readyState(${channel.readyState}) when sending START_OF_FILE_BUFFER_MESSAGE message`
    );
    return;
  }

  channel.send(START_OF_FILE_BUFFER_MESSAGE);
  console.debug(
    `WebRTCGroupChatService: sent a starting signal to a receiver peer (${peerId}), so that the receiver can prepare to receive file buffer`
  );
}

// ( sender: file meta data, receiver: file meta data && file buffer )
function _handleChannelClose(event: Event, peerId: string) {
  const { target: channel } = event;
  if (!(channel instanceof RTCDataChannel)) {
    return;
  }
  console.debug(
    `WebRTCGroupChatService: a channel(label:${channel.label}) of a peer(${peerId}) heard close event, its readyState now is ${channel.readyState}`
  );
  channel.close();
}

// ( receiver: file meta data && file buffer && chat messaging )
function _handlePeerConnectionDataChannelEvent(
  event: RTCDataChannelEvent,
  peerId: string,
  peerName?: string
) {
  const channel = event.channel as NegotiatableDataChannel;
  const label = channel.label;

  console.debug(`WebRTCGroupChatService: fired 'ondatachannel' with a channel of label (${label})`);

  if (label === CHAT_MESSAGING_CHANNEL_LABEL) {
    channel.onmessage = (event) => {
      _handleChatMessagingChannelMessage(event, label, peerId, peerName);
      _peerChatMessagingChannelMap.setChannel(peerId, label, channel);
    };
  } else if (label === FILE_META_DATA_CHANNEL_LABEL) {
    channel.onmessage = (event) => {
      _handleReceiverChannelFileMetaDataMessage(event, peerId, label);
    };
    _peerFileMetaDataChannelMap.setChannel(peerId, label, channel);
  } else {
    channel.onmessage = (event) => {
      _handleReceiverChannelFileBufferMessage(event, peerId);
    };
    _peerFileBufferChannelMap.setChannel(peerId, label, channel);
  }
  channel.onclose = (event) => {
    _handleChannelClose(event, peerId);
  };
}

// ( receiver: file meta data )
function _handleReceiverChannelFileMetaDataMessage(
  event: MessageEvent,
  peerId: string,
  label: string
) {
  const { data } = event;

  console.debug(
    `WebRTCGroupChatService: _handleReceiverChannelFileMetaDataMessage called by a peer(${peerId}) from a channel(${label})`,
    data
  );

  if (typeof data !== "string") {
    console.debug(`WebRTCGroupChatService: unexpected 'data' type, it is not type of 'string'`);
    return;
  }

  const fileHashToMetaData = JSON.parse(data);

  FileCacheManager.mergeReceivingHashToMetaData(peerId, fileHashToMetaData);

  // file meta data acknowledge

  const senderChannel = _peerFileMetaDataChannelMap.getChannel(peerId, label);

  if (!senderChannel) {
    console.debug(
      `WebRTCGroupChatService: unfound data channel(${label}) of a peer(${peerId}) when sending ACK_FOR_FILE_META_DATA_MESSAGE message`
    );
    return;
  }

  if (senderChannel.readyState !== "open") {
    console.debug(
      `WebRTCGroupChatService: unexpected data channel(${label}) readyState(${senderChannel.readyState}) of a peer(${peerId}) when sending ACK_FOR_FILE_META_DATA_MESSAGE message`
    );
    return;
  }

  senderChannel.send(ACK_FOR_FILE_META_DATA_MESSAGE);

  console.debug(
    `WebRTCGroupChatService: 'ACK_FOR_FILE_META_DATA_MESSAGE' sent to a peer(${peerId}) from a channel(${label})`,
    data
  );
}

// ( receiver: file buffer )
async function _handleReceiverChannelFileBufferMessage(event: MessageEvent, peerId: string) {
  const data = event.data;

  if (!(event.target instanceof RTCDataChannel)) {
    console.error(`WebRTCGroupChatService: unexpected event target`, event.target);
    return;
  }

  const label = event.target.label;
  const fileHash = label.split("-")?.[1];

  console.debug(
    `WebRTCGroupChatService: _handleReceiverChannelFileBufferMessage called by a peer(${peerId}) and a file(${fileHash}) from a channel(${label})`,
    data
  );

  if (data === START_OF_FILE_BUFFER_MESSAGE) {
    FileCacheManager.deleteReceivingCancelled(peerId, fileHash);
    FileCacheManager.resetReceivingBuffer(peerId, fileHash);
  } else if (data === CANCEL_OF_FILE_BUFFER_MESSAGE) {
    FileCacheManager.setReceivingCancelled(peerId, fileHash, true);
    FileCacheManager.resetReceivingBuffer(peerId, fileHash);
  } else if (data === END_OF_FILE_BUFFER_MESSAGE) {
    const channel = _peerFileBufferChannelMap.getChannel(peerId, label);

    if (!channel) {
      console.debug(
        `WebRTCGroupChatService: unfound data channel(${label}) of a peer(${peerId}) when sending ACK_FOR_END_OF_FILE_BUFFER_MESSAGE message`
      );
      return;
    }
    if (channel.readyState !== "open") {
      console.debug(
        `WebRTCGroupChatService: unexpected data channel(${label}) readyState(${channel.readyState}) of a peer(${peerId}) when sending ACK_FOR_END_OF_FILE_BUFFER_MESSAGE message`
      );
      return;
    }

    channel.send(ACK_FOR_END_OF_FILE_BUFFER_MESSAGE);
  } else {
    if (data instanceof ArrayBuffer) {
      FileCacheManager.addReceivingBuffer(peerId, fileHash, data);
    } else if (data instanceof Blob) {
      FileCacheManager.addReceivingBuffer(peerId, fileHash, await data.arrayBuffer());
    }
  }
}

function _clearAllReceivingFiles() {
  FileCacheManager.resetAllReceivingBufferMergedFiles();
}

function _clearAllFileBuffersReceived() {
  FileCacheManager.resetAllReceivingBuffers();
}

function _clearSendingRelatedData() {
  FileCacheManager.clearSendingRelatedData();
}

function _clearReceivingRelatedData() {
  FileCacheManager.clearReceivingRelatedData();
}

export default {
  sendChatMessageToAllPeer: function (peerConnectionMap: PeerConnectionMap, message: string) {
    _sendChatMessageToAllPeer(peerConnectionMap, message);
  },
  onChatMessageReceived: function (handler: (chatMessage: ChatMessage) => void) {
    _handleChatMessageReceived = handler;
  },

  sendFileToAllPeer: function (peerConnectionMap: PeerConnectionMap, files: File[]) {
    _sendFileToAllPeer(peerConnectionMap, files);
  },
  cancelSenderAllFileSending: function () {
    _cancelSenderAllFileSending();
  },
  cancelSenderFileSendingToAllPeer: function (fileHash: string) {
    _cancelSenderFileSendingToAllPeer(fileHash);
  },
  clearAllReceivingFiles: function () {
    _clearAllReceivingFiles();
  },
  clearAllFileBuffersReceived: function () {
    _clearAllFileBuffersReceived();
  },

  clearSendingRelatedData: function () {
    _clearSendingRelatedData();
  },
  clearReceivingRelatedData: function () {
    _clearReceivingRelatedData();
  },

  // sending view model changing listener
  onFileSendingRelatedDataChanged: function (
    handler: (
      sendingRelatedDataProxy: SendingRelatedDataProxy,
      isSendingStatusSending?: boolean | undefined
    ) => void
  ) {
    FileCacheManager.onSendingRelatedDataChanged(handler);
  },
  // receiving view model changing listener
  onFileReceivingRelatedDataChanged: function (
    handler: (receivingRelatedDataProxy: ReceivingRelatedDataProxy) => void
  ) {
    FileCacheManager.onReceivingRelatedDataChanged(handler);
  },

  handlePeerConnectionDataChannelEvent: function (
    event: RTCDataChannelEvent,
    peerId: string,
    peerName?: string
  ) {
    _handlePeerConnectionDataChannelEvent(event, peerId, peerName);
  },
};
