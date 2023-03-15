/**
 * TODO:
 *
 * Priority Level: Low
 *
 * 1. indexedDB persisting cannot work correctly when receiving buffer(chunk) size is higher than 32 * 1024 bytes;
 * 2. too frequent receiving buffer persisting, not good for performance;
 */

import {
  FileHashToExporter,
  FileHashToFile,
  FileHashToMeta,
  FileHashToMinProgress,
  FileHashToProgress,
  FileHashToTransceivingCancelled,
  IDBBufferPersistingPromiseFulFilledType,
  IDBBufferPersistingPromiseFulfillment,
  IDBDatabasePromise,
  MappableTranceivingProgress,
  ReceivingBufferIDBPersistingSchedulerMap,
  ReceivingCancelledMap,
  ReceivingHashToAllSlices,
  ReceivingHashToExporterMap,
  ReceivingPeerMapOfHashToMeta,
  ReceivingRelatedData,
  ReceivingRelatedDataProxy,
  ReceivingSliceName,
  SendingRelatedData,
  SendingRelatedDataProxy,
  SendingSliceName,
  ReceivingIDBBufferWrapper,
  FileExporter,
} from "./common-types";
import { shadowCopyPlainObject } from "./common-util";

/**
 * Sending && Receiving view model
 */

let _handleSendingRelatedDataChange:
  | undefined
  | ((sendingRelatedDataProxy: SendingRelatedDataProxy, isSendingStatusSending?: boolean) => void);
let _handleReceivingRelatedDataChange:
  | undefined
  | ((receivingRelatedDataProxy: ReceivingRelatedDataProxy) => void);

const _sendingRelatedData: SendingRelatedData = {
  fileHashToAllSlices: {},
  updateSendingStatus(isSendingStatusSending) {
    console.debug(
      `FileDataStore: the sending related data is updated to`,
      this,
      `by sending status of isSending(${isSendingStatusSending})`
    );

    // listener
    if (_handleSendingRelatedDataChange) {
      _handleSendingRelatedDataChange(
        _buildSendingRelatedDataProxy(shadowCopyPlainObject(this)),
        isSendingStatusSending
      );
    }
  },
  updateSlice(fileHashToSingleSlice, sliceName) {
    Object.keys(fileHashToSingleSlice).forEach((fileHash) => {
      let allSlices = this.fileHashToAllSlices[fileHash];
      if (!allSlices) {
        allSlices = {};
      }
      allSlices[sliceName] = fileHashToSingleSlice[fileHash];
      this.fileHashToAllSlices[fileHash] = allSlices;
    });

    // unified log
    console.debug(
      `FileDataStore: the sending related data is updated to`,
      this,
      `with`,
      `a slice key ('${sliceName}') and`,
      `a file hash to slice object of`,
      fileHashToSingleSlice
    );

    // listener
    if (_handleSendingRelatedDataChange) {
      _handleSendingRelatedDataChange(_buildSendingRelatedDataProxy(shadowCopyPlainObject(this)));
    }
  },
  clear() {
    this.fileHashToAllSlices = {};
    // listener
    if (_handleSendingRelatedDataChange) {
      _handleSendingRelatedDataChange(_buildSendingRelatedDataProxy(shadowCopyPlainObject(this)));
    }
  },
};

const _receivingRelatedData: ReceivingRelatedData = {
  peerMapOfHashToAllSlices: new Map<string, ReceivingHashToAllSlices>(),
  updateSlice(peerMapOfHashToSingleSlice, sliceName) {
    peerMapOfHashToSingleSlice.forEach((fileHashToSingleSlice, peerId) => {
      let fileHashToAllSlices = this.peerMapOfHashToAllSlices.get(peerId);
      if (!fileHashToAllSlices) {
        fileHashToAllSlices = {};
      }
      Object.entries(fileHashToSingleSlice).forEach(([fileHash, slice]) => {
        let allSlices = fileHashToAllSlices![fileHash];
        if (!allSlices) {
          allSlices = {};
        }
        allSlices[sliceName] = slice;
        fileHashToAllSlices![fileHash] = allSlices;
      });

      this.peerMapOfHashToAllSlices.set(peerId, fileHashToAllSlices);
    });

    // unified log
    console.debug(
      `FileDataStore: the receiving related data updated to`,
      this,
      `with`,
      `a slice key ('${sliceName}') and`,
      `a slice peer map of`,
      peerMapOfHashToSingleSlice
    );

    // listener
    if (_handleReceivingRelatedDataChange) {
      _handleReceivingRelatedDataChange(
        _buildReceivingRelatedDataProxy(shadowCopyPlainObject(this))
      );
    }
  },
  clear() {
    this.peerMapOfHashToAllSlices.clear();
    // listener
    if (_handleReceivingRelatedDataChange) {
      _handleReceivingRelatedDataChange(
        _buildReceivingRelatedDataProxy(shadowCopyPlainObject(this))
      );
    }
  },
};

/**
 * Sending meta data
 */

let _sendingHashToMetaData: FileHashToMeta = {};

function _prepareSendingMetaData(hashToFile: FileHashToFile) {
  // _sendingHashToMetaData = { ..._sendingHashToMetaData };

  for (const [fileHash, file] of Object.entries(hashToFile)) {
    _sendingHashToMetaData[fileHash] = {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
    };
  }

  console.debug(
    `FileDataStore: new sending file hash to file meta data object of`,
    _sendingHashToMetaData,
    `prepared`
  );

  _sendingRelatedData.updateSlice(_sendingHashToMetaData, SendingSliceName.SENDING_META_DATA);
}

function _checkIfSendingMetaDataPrepared(hashToFile: FileHashToFile) {
  let checkingPassed = true;

  for (const fileHash of Object.keys(hashToFile)) {
    if (!_sendingHashToMetaData[fileHash]) {
      checkingPassed = false;
      break;
    }
  }

  console.debug(
    `FileDataStore: the current sending file hash to file meta data object of`,
    _sendingHashToMetaData,
    `is ${checkingPassed ? "" : "not"} prepared for file buffer sending`
  );

  return checkingPassed;
}

/**
 * Sending && Receiving cancelled
 */

let _sendingHashToCancelled: FileHashToTransceivingCancelled = {};

const _receivingCancelledMap: ReceivingCancelledMap = {
  peerMap: new Map<string, FileHashToTransceivingCancelled>(),
  getCancelled(peerId, fileHash) {
    let hashToCancelled = this.peerMap.get(peerId);
    if (!hashToCancelled) {
      return false;
    }
    return hashToCancelled[fileHash];
  },
  setCancelled(peerId, fileHash, receivingCancelled) {
    let fileHashToTransceivingCancelled = this.peerMap.get(peerId);
    if (!fileHashToTransceivingCancelled) {
      fileHashToTransceivingCancelled = {};
    }

    fileHashToTransceivingCancelled[fileHash] = receivingCancelled;
    this.peerMap.set(peerId, fileHashToTransceivingCancelled);
  },
  deleteCancelled(peerId, fileHash) {
    this.setCancelled(peerId, fileHash, false);
  },
  clear() {
    this.peerMap = new Map<string, FileHashToTransceivingCancelled>();
  },
};

/**
 *  Sending && Receiving progress
 */

class TranceivingProgressMap implements MappableTranceivingProgress {
  // distinguish sending progress and receiving progress
  isSending: boolean;
  // the progress data container
  peerMap = new Map<string, FileHashToMinProgress | FileHashToProgress>();

  constructor(isSending: boolean) {
    this.isSending = isSending;
  }

  // get the transceiving progress of a file for a specific peer
  getProgress(peerId: string, fileHash: string) {
    if (!this.peerMap.has(peerId)) {
      return 0;
    }
    if (!this.peerMap.get(peerId)![fileHash]) {
      return 0;
    }
    return this.peerMap.get(peerId)![fileHash];
  }

  // set the transceiving progress of a file for a specific peer
  setProgress(peerId: string, fileHash: string, progress: number) {
    if (progress < 0) {
      return;
    }

    let fileHashToProgress = this.peerMap.get(peerId);
    if (!fileHashToProgress) {
      fileHashToProgress = {};
    }
    fileHashToProgress[fileHash] = progress;
    this.peerMap.set(peerId, fileHashToProgress);

    console.debug(
      `FileDataStore: setting progress (${progress}) of a file (${fileHash}) for a peer (${peerId}) completed`
    );

    if (this.isSending) {
      const sendingHashToMinProgress = _sendingHashToMinProgress(_sendingHashToMetaData, this);
      _sendingRelatedData.updateSlice(
        sendingHashToMinProgress,
        SendingSliceName.SENDING_MIN_PROGRESS
      );

      // sending status is dependent on sending minimum porgress
      const isSendingStatusSending = _isSendingStatusSending(
        sendingHashToMinProgress,
        _sendingHashToMetaData,
        _sendingHashToCancelled
      );
      _sendingRelatedData.updateSendingStatus(isSendingStatusSending);
    } else {
      _receivingRelatedData.updateSlice(this.peerMap, ReceivingSliceName.RECEIVING_PROGRESS);
    }
  }

  // add the transceiving progress of a file for a specific peer with the additional progress
  addProgress(peerId: string, fileHash: string, additionalProgress: number) {
    const curProgress = this.getProgress(peerId, fileHash) + additionalProgress;
    this.setProgress(peerId, fileHash, curProgress);

    console.debug(
      `FileDataStore: adding the additional progress ( ${additionalProgress} ) for a given file hash ( ${fileHash} ) to a given peer ( ${peerId} ) completed`
    );

    return curProgress;
  }

  // reset the transceiving progress of a file for a specific peer to '0'
  resetProgress(peerId: string, fileHash: string) {
    this.setProgress(peerId, fileHash, 0);
    console.debug(
      `FileDataStore: resetting progress for a given file hash (${fileHash}) to a given peer (${peerId}) completed`
    );
  }

  // calculate the minimum progress(only for sending) of the given file being sent to every peer
  calculateMinProgress(fileHash: string) {
    if (this.peerMap.size === 0) {
      return 0;
    }

    let minProgress = Number.POSITIVE_INFINITY;
    this.peerMap.forEach((fileHashToProgress) => {
      if (fileHashToProgress[fileHash] >= 0) {
        minProgress = Math.min(minProgress, fileHashToProgress[fileHash]);
      }
    });
    if (minProgress === Number.POSITIVE_INFINITY) {
      return 0;
    }

    return minProgress;
  }
}
const _sendingProgressMap = new TranceivingProgressMap(true);
const _receivingProgressMap = new TranceivingProgressMap(false);

/**
 * Sending minimum progress
 */

function _sendingHashToMinProgress(
  sendingHashToMetaData: FileHashToMeta,
  sendingProgressMap: TranceivingProgressMap
) {
  const sendingHashToMinProgress: FileHashToMinProgress = {};
  Object.keys(sendingHashToMetaData).forEach((fileHash) => {
    const minProgress = sendingProgressMap.calculateMinProgress(fileHash);
    sendingHashToMinProgress[fileHash] = minProgress;
  });
  console.debug(
    `FileDataStore: when computing completed, the entire sending hash to sending min progress is`,
    sendingHashToMinProgress
  );

  return sendingHashToMinProgress;
}

/**
 * Sending status
 */

function _isSendingStatusSending(
  sendingHashToMinProgress: FileHashToMinProgress,
  sendingHashToMetaData: FileHashToMeta,
  sendingHashToCancelled: FileHashToTransceivingCancelled
) {
  let isSending = false;

  if (!sendingHashToMinProgress || !sendingHashToMetaData) {
    console.debug(`FileDataStore: unexpected params when getting sending status`);
    return isSending;
  }

  let sumSize = 0;
  let sumMinProgress = 0;

  for (const [fileHash, metaData] of Object.entries(sendingHashToMetaData)) {
    if (sendingHashToCancelled[fileHash]) {
      continue;
    }
    const minProgress = sendingHashToMinProgress[fileHash];
    if (!metaData || typeof metaData.size !== "number" || typeof minProgress !== "number") {
      console.debug(
        `FileDataStore: unexpected sending meta data for a file hash (${fileHash}) in a sending file hash to meta data of`,
        sendingHashToMetaData
      );
      return isSending;
    }

    sumSize += metaData.size;
    sumMinProgress += minProgress;
  }

  if (sumMinProgress > 0 && sumMinProgress < sumSize) {
    isSending = true;
  }
  return isSending;
}

/**
 * Receiving meta data
 */

const _receivingHashToMetaDataMap: ReceivingPeerMapOfHashToMeta = {
  // the receiving and peer-related file hash to meta data container
  peerMap: new Map<string, FileHashToMeta>(),

  // get the file hash to meta data object for a given peer
  getHashToMetaData(peerId) {
    return this.peerMap.get(peerId);
  },

  // get the meta data of a given file hash for a given peer
  getMetaData(peerId, fileHash) {
    const fileHashToMetaData = this.getHashToMetaData(peerId);
    if (!fileHashToMetaData) {
      return undefined;
    }
    return fileHashToMetaData[fileHash];
  },

  // overwrite a file hash to meta data object for a specific peer
  overwriteHashToMetaData(peerId, hashToMetaData) {
    this.peerMap.set(peerId, hashToMetaData);

    console.debug(
      `FileDataStore: overwritting with a receiving file hash to meta data object of`,
      hashToMetaData,
      `for a peer (${peerId}) completed`
    );

    _receivingRelatedData.updateSlice(this.peerMap, ReceivingSliceName.RECEIVING_META_DATA);
  },

  // merge a file hash to meta data object into the current one (if it exsits) for a given peer
  mergeHashToMetaData(peerId, hashToMetaData) {
    const merged = {
      ...this.getHashToMetaData(peerId),
      ...hashToMetaData,
    };
    this.overwriteHashToMetaData(peerId, merged);

    console.debug(
      `FileDataStore: merging a file hash to meta data object`,
      hashToMetaData,
      `into the current one(if exist) for a peer (${peerId}) has been completed`
    );
  },

  // set a meta data of a given file hash for a given peer
  setMetaData(peerId, fileHash, metaData) {
    const hashToMetaData: FileHashToMeta = { [fileHash]: metaData };
    this.mergeHashToMetaData(peerId, hashToMetaData);
  },
};

/**
 * Receiving buffer persistence
 */

function _addReceivingBuffer(peerId: string, fileHash: string, buffer: ArrayBuffer) {
  if (_receivingCancelledMap.getCancelled(peerId, fileHash)) {
    console.debug(
      `FileDataStore: a receiving buffer of a file (${fileHash}) for a peer (${peerId}) cancelled during adding it`
    );
    return;
  }

  if (!_IDBDatabasePromise) {
    console.error(
      `FileDataStore: unfound IDB promise during adding receiving buffer of a file (${fileHash}) for a peer (${peerId})`
    );
    return;
  }

  _IDBDatabasePromise
    .then((IDBDatabase) => {
      if (!IDBDatabase) {
        throw new Error(
          `FileDataStore: unfound IDB during adding receiving buffer of a file (${fileHash}) for a peer (${peerId})`
        );
      }
      _scheduleAddBufferTask(peerId, fileHash, IDBDatabase, buffer);
    })
    .catch((error) => {
      console.error(error);
    });
}

function _scheduleAddBufferTask(
  peerId: string,
  fileHash: string,
  IDBDatabase: IDBDatabase,
  buffer: ArrayBuffer
) {
  const addIDBBufferTask = (fulFillment: IDBBufferPersistingPromiseFulfillment) => {
    console.debug(`FileDataStore: during addIDBBufferTask, use fulFillment`, fulFillment)
    const startOffset = fulFillment.fulFilledAtOffset;
    if (startOffset === undefined) {
      console.error(`FileDataStore: skipped an invalid startOffset of ${startOffset}`);
      return new Promise<IDBBufferPersistingPromiseFulfillment>((resolve, reject) => {
        resolve({
          fulFilledType: IDBBufferPersistingPromiseFulFilledType.FULFILLED_ERROR,
          fulFilledAtOffset: 0,
        });
      });
    }
    return _addIDBReceivingBuffer(peerId, fileHash, IDBDatabase, buffer, startOffset);
  };
  _receivingBufferIDBPersistingSchedulerMap.scheduleNextTask(peerId, fileHash, addIDBBufferTask);
  console.debug(
    `FileDataStore: scheduled adding receiving buffer of a file (${fileHash}) for a peer (${peerId})`
  );
}

function _resetReceivingBuffer(peerId: string, fileHash: string) {
  if (!_IDBDatabasePromise) {
    console.error(
      `FileDataStore: unfound IDB promise during resetting receiving buffer of a file (${fileHash}) for a peer (${peerId})`
    );
    return;
  }

  _IDBDatabasePromise
    .then((IDBDatabase) => {
      if (!IDBDatabase) {
        throw new Error(
          `FileDataStore: unfound IDB during resetting receiving buffer of a file (${fileHash}) for a peer (${peerId})`
        );
      }
      _scheduleResetBufferTask(peerId, fileHash, IDBDatabase);
    })
    .catch((error) => {
      console.error(error);
    });
}

// reset buffer list to an empty list of a file for a specific peer
function _scheduleResetBufferTask(peerId: string, fileHash: string, IDBDatabase: IDBDatabase) {
  const resetIDBBufferTask = (fulFillment: IDBBufferPersistingPromiseFulfillment) => {
    return _resetIDBReceivingBuffer(peerId, fileHash, IDBDatabase);
  };
  _receivingBufferIDBPersistingSchedulerMap.scheduleNextTask(peerId, fileHash, resetIDBBufferTask);
  console.debug(
    `FileDataStore: scheduled resetting receiving buffer of a file (${fileHash}) for a peer (${peerId})`
  );
}

function _resetAllReceivingBuffers() {
  if (!_IDBDatabasePromise) {
    console.error(`FileDataStore: unfound IDB promise during resetting all receiving buffers`);
    return;
  }

  _IDBDatabasePromise
    .then((IDBDatabase) => {
      if (!IDBDatabase) {
        throw new Error(`FileDataStore: unfound IDB during resetting all receiving buffers`);
      }

      _resetIDBAllReceivingBuffers(IDBDatabase);
    })
    .catch((error) => {
      console.error(error);
    });
}

function _resetAllReceivingBufferMergedFiles() {
  const allFileIds = _receivingHashToExporterMap.avaliableFileIds;

  if (!_IDBDatabasePromise) {
    console.error(
      `FileDataStore: unfound IDB promise during resetting all receiving buffer merged files with all file Ids`,
      allFileIds
    );
    return;
  }

  _IDBDatabasePromise
    .then((IDBDatabase) => {
      if (!IDBDatabase) {
        throw new Error(
          `FileDataStore: unfound IDB during resetting all receiving buffer merged files with all file Ids`
        );
      }

      _resetIDBReceivingBufferMergedFiles(allFileIds, IDBDatabase);
    })
    .catch((error) => {
      console.error(error);
    });
}

let _IDBDatabasePromise: IDBDatabasePromise;
const _IDBDatabaseName = "WebRTCFileTransceivingDB";
const _IDBReceivingBufferStoreName = "receivingBufferStore";
const _IDBReceivingFileStoreName = "receivingFileStore";
const _IDBDatabaseVersion = 1;

function _openIDB() {
  _IDBDatabasePromise = new Promise((resolve, reject) => {
    console.debug(`FileDataStore: indexedDB is opening ...`);

    const request = indexedDB.open(_IDBDatabaseName, _IDBDatabaseVersion);

    request.onupgradeneeded = function (event) {
      console.debug(`FileDataStore: indexedDB is upgrading ...`);
      switch (event.oldVersion) {
        case 0:
          // version 0 means that the client had no database, perform initialization
          let database = request.result;
          if (!database.objectStoreNames.contains(_IDBReceivingBufferStoreName)) {
            // store receiving buffer
            const receivingBufferObjectStore = database.createObjectStore(
              _IDBReceivingBufferStoreName,
              {
                keyPath: "bufferId",
              }
            );
            receivingBufferObjectStore.createIndex("fileId_idx", "fileId");
          }
          if (!database.objectStoreNames.contains(_IDBReceivingFileStoreName)) {
            // store files where each file is merged by receiving buffer
            const receivingFileObjectStore = database.createObjectStore(
              _IDBReceivingFileStoreName,
              {
                keyPath: "fileId",
              }
            );
            receivingFileObjectStore.createIndex("fileId_idx", "fileId");
          }
        case 1:
        // client had version 1
        // update
      }
    };
    request.onsuccess = function () {
      // ...the db is ready, use it...
      console.debug(`FileDataStore: indexedDB is now open`);

      const database = request.result;
      database.onversionchange = function () {
        database.close();
        alert("IndexedDB is outdated, please reload the page in order to upgrade it");
      };
      database.onerror = function (event) {
        console.error(`FileDataStore: unexpected and uncatched indexedDB onerror`, event.target);
      };
      resolve(database);
    };
    request.onblocked = function () {
      // this event shouldn't trigger if we handle onversionchange correctly

      // it means that there's another open connection to the same database
      // and it wasn't closed after db.onversionchange triggered for it
      reject();
      alert(
        "Can not open a new version of indexedDB, because an outdated version of it is still open, please try close the outdated one first"
      );
    };
    request.onerror = (event) => {
      console.error(
        `FileDataStore: unexpected indexedDB open database request onerror`,
        (event.target as IDBRequest).error
      );
      reject();
    };
  });
}

const _receivingBufferIDBPersistingSchedulerMap: ReceivingBufferIDBPersistingSchedulerMap = {
  peerMap: new Map(),
  scheduleNextTask(peerId, fileHash, task) {
    let hashToPersistingPromiseChain = this.peerMap.get(peerId);
    if (!hashToPersistingPromiseChain) {
      console.debug(`FileDataStore: unfound file hash to persisting promise chain object`);
      hashToPersistingPromiseChain = {};
    }
    if (!hashToPersistingPromiseChain[fileHash]) {
      console.debug(`FileDataStore: unfound persisting promise chain of a file (${fileHash})`);

      hashToPersistingPromiseChain[fileHash] = new Promise<IDBBufferPersistingPromiseFulfillment>(
        (resolve, _) => {
          const initialStartOffset = 0;
          resolve({
            fulFilledType: IDBBufferPersistingPromiseFulFilledType.FULFILLED_RESETTING,
            fulFilledAtOffset: initialStartOffset,
          });
        }
      );
    }

    hashToPersistingPromiseChain[fileHash] = hashToPersistingPromiseChain[fileHash].then(task);

    this.peerMap.set(peerId, hashToPersistingPromiseChain);
  },
};

const _receivingHashToExporterMap: ReceivingHashToExporterMap = {
  // the receiving and peer-related file hash to file exporter container
  peerMap: new Map<string, FileHashToExporter>(),

  avaliableFileIds: [],

  setExporter(peerId, fileHash, exporter) {
    let hashToExporter = this.peerMap.get(peerId);
    if (!hashToExporter) {
      hashToExporter = {};
    }
    hashToExporter[fileHash] = exporter;
    this.peerMap.set(peerId, hashToExporter);

    if (exporter) {
      this.avaliableFileIds.push(_buildFileId(peerId, fileHash));
    } else {
      const fileId = _buildFileId(peerId, fileHash);
      const deletionIndex = this.avaliableFileIds.indexOf(fileId);
      this.avaliableFileIds.splice(deletionIndex, 1);
    }
    _receivingRelatedData.updateSlice(this.peerMap, ReceivingSliceName.RECEIVING_FILE_EXPORTER);
  },

  clearExporters() {
    this.peerMap.forEach((hashToExporter, peerId) => {
      Object.entries(hashToExporter).forEach(([fileHash, exporter]) => {
        this.setExporter(peerId, fileHash, undefined);
      });
    });
    _receivingRelatedData.updateSlice(this.peerMap, ReceivingSliceName.RECEIVING_FILE_EXPORTER);
  },
};

function _addIDBReceivingBuffer(
  peerId: string,
  fileHash: string,
  IDBDatabase: IDBDatabase,
  buffer: ArrayBuffer,
  startOffset: number
) {
  return new Promise<IDBBufferPersistingPromiseFulfillment>((resolve, reject) => {
    const transaction = IDBDatabase.transaction(_IDBReceivingBufferStoreName, "readwrite");
    const store = transaction.objectStore(_IDBReceivingBufferStoreName);
    const request = store.put({
      bufferId: _buildBufferId(peerId, fileHash, startOffset),
      fileId: _buildFileId(peerId, fileHash),
      buffer: buffer,
      startOffset: startOffset,
    });
    let isOperationSuccessful = true;

    request.onsuccess = function (event) {
      console.debug(`FileDataStore: during addIDBReceivingBuffer, IDB request to add(put) receiving buffer onsuccess`, event);
    };
    request.onerror = function (event) {
      console.error(
        `FileDataStore: during addIDBReceivingBuffer, IDB request to add(put) receiving buffer onerror, start to rollback`,
        event
      );
      isOperationSuccessful = false;
    };
    transaction.onerror = (event) => {
      console.error(`FileDataStore: during addIDBReceivingBuffer, IDB transaction to add(put) receiving buffer onerror`, event);
    };
    transaction.oncomplete = (event) => {
      console.debug(
        `FileDataStore: during addIDBReceivingBuffer, IDB transaction to add(put) receiving buffer of a file (${fileHash}) for a peer (${peerId}) from startOffset (${startOffset}) oncomplete`,
        isOperationSuccessful
      );

      if (!isOperationSuccessful) {
        reject(undefined);
        return;
      }

      if (_receivingCancelledMap.getCancelled(peerId, fileHash)) {
        console.debug(`FileDataStore: during addIDBReceivingBuffer, due to receiving cancelled`);

        // perform IDB rollback because of a receiving file cancelled
        const transaction = IDBDatabase.transaction(_IDBReceivingBufferStoreName, "readwrite");
        const store = transaction.objectStore(_IDBReceivingBufferStoreName);
        const request = store.delete(_buildBufferId(peerId, fileHash, startOffset));
        request.onsuccess = function (event) {
          console.debug(
            `FileDataStore: during addIDBReceivingBuffer, IDB manaully rollbacking request to delete receiving buffer onsuccess`,
            event
          );
        };
        request.onerror = function (event) {
          console.error(
            `FileDataStore: during addIDBReceivingBuffer, IDB manaully rollbacking request to delete receiving buffer onerror`,
            event
          );
        };
        transaction.oncomplete = (event) => {
          console.debug(
            `FileDataStore: during addIDBReceivingBuffer, IDB manaully rollbacking transaction to delete receiving buffer of a file (${fileHash}) for a peer (${peerId}) from startOffset (${startOffset}) oncomplete`
          );
        };

        reject(undefined);
        return;
      }

      // update progress map && perform merging buffer into a file if needed
      const nextStartOffset = _receivingProgressMap.addProgress(
        peerId,
        fileHash,
        buffer.byteLength
      );
      const metaData = _receivingHashToMetaDataMap.getMetaData(peerId, fileHash);
      const isMergingBufferNeeded = metaData && nextStartOffset >= metaData.size;
      if (isMergingBufferNeeded) {
        _mergeIDBReceivingBufferIfNeeded(peerId, fileHash, IDBDatabase).then((fulfillment) => {
          resolve(fulfillment);
        });
        // resolve({ fulFilledType: "ADD", startOffset: 0 });
        return;
      }
      resolve({
        fulFilledType: IDBBufferPersistingPromiseFulFilledType.FULFILLED_ADDING,
        fulFilledAtOffset: nextStartOffset,
      });
    };
  });
}

function _mergeIDBReceivingBufferIfNeeded(
  peerId: string,
  fileHash: string,
  IDBDatabase: IDBDatabase
) {
  const mergingPromise = new Promise<IDBBufferPersistingPromiseFulfillment>((resolve, reject) => {
    const metaData = _receivingHashToMetaDataMap.getMetaData(peerId, fileHash);
    if (!metaData) {
      reject();
      return;
    }

    // get all receiving buffer of a file, from indexedDB, for merging purpose
    const transaction = IDBDatabase.transaction(_IDBReceivingBufferStoreName, "readonly");
    transaction.oncomplete = (event) => {
      console.debug(
        `FileDataStore: during fetching out IDBReceivingBuffer for merging, IDB transaction to merge IDB receiving buffer for a file (${fileHash}) and a peer (${peerId}) oncomplete`,
        event
      );
    };
    transaction.onerror = (event) => {
      console.debug(
        `FileDataStore: during fetching out IDBReceivingBuffer for merging, IDB transaction to merge IDB receiving buffer for a file (${fileHash}) and a peer (${peerId}) onerror`,
        event
      );
      reject();
    };
    const store = transaction.objectStore(_IDBReceivingBufferStoreName);
    const index = store.index("fileId_idx");
    const request = index.openCursor(IDBKeyRange.only(_buildFileId(peerId, fileHash)));
    const bufferWrapperList: ReceivingIDBBufferWrapper[] = [];

    request.onerror = function (event) {
      console.error(`FileDataStore: during fetching out IDBReceivingBuffer for merging, IDB request to open cursor of receiving buffer onerror`, event);
      reject();
    };
    request.onsuccess = function (event) {
      console.debug(
        `FileDataStore: during fetching out IDBReceivingBuffer for merging, IDB request to open cursor of receiving buffer onsuccess`,
        event,
      );

      if (!(event.target instanceof IDBRequest)) {
        console.error(`FileDataStore: during fetching out IDBReceivingBuffer for merging, unexpected event target instance type`, event.target);
        return;
      }

      if (event.target.result instanceof IDBCursorWithValue) {
        const cursor = event.target.result;
        console.debug(
          `FileDataStore: during fetching out IDBReceivingBuffer for merging, it is a valid cursor of receiving buffer including startOffset (${cursor.value.startOffset})`
        );

        const record = cursor.value;
        bufferWrapperList.push({
          buffer: record.buffer,
          startOffset: record.startOffset,
        });

        cursor.continue();
      } else {
        console.debug(
          `FileDataStore: during fetching out IDBReceivingBuffer for merging, ending up with a invalid cursor of receiving buffer, time to creat a file with a buffer wrapper list of`,
          bufferWrapperList
        );

        console.debug(
          `FileDataStore: during merging all IDBReceivingBuffer into one file, merging starts`,
          event
        );

        // merge a list of arraybuffer into a file
        const sortedBufferList = bufferWrapperList
          .sort((a, b) => {
            return a.startOffset - b.startOffset;
          })
          .map((bufferWrapper) => bufferWrapper.buffer);
        const file = new File([new Blob(sortedBufferList)], metaData.name, {
          type: metaData.type,
          lastModified: metaData.lastModified,
        });

        console.debug(
          `FileDataStore: during merging all IDBReceivingBuffer into one file, merging in success`,
          event
        );

        // add the file into IDB
        const transaction = IDBDatabase.transaction(_IDBReceivingFileStoreName, "readwrite");
        const store = transaction.objectStore(_IDBReceivingFileStoreName);
        const request = store.put({
          fileId: _buildFileId(peerId, fileHash),
          file: file,
        });

        request.onsuccess = function (event) {
          console.debug(
            `FileDataStore: during storing the merged file, IDB request to add(put) a merged receiving file onsuccess`,
            event
          );
        };
        request.onerror = function (event) {
          console.error(
            `FileDataStore: during  storing the merged file, IDB request to add(put) a merged receiving file onerror`,
            event
          );
          reject();
        };
        transaction.onerror = (event) => {
          console.debug(
            `FileDataStore: during  storing the merged file, IDB transaction to add(put) a merged receiving file (${fileHash}) for a peer (${peerId}) onerror`,
            event
          );
          reject();
        };
        transaction.oncomplete = (event) => {
          console.debug(
            `FileDataStore: during  storing the merged file, IDB transaction to add(put) a merged receiving file (${fileHash}) for a peer (${peerId}) oncomplete`,
            event
          );

          // after the file added into IDB, make a file exporter to export this file from indexedDB for future usage
          const fileExporter: FileExporter = () => {
            return _getIDBReceivingFile(peerId, fileHash, IDBDatabase);
          };
          _receivingHashToExporterMap.setExporter(peerId, fileHash, fileExporter);

          // after the file added into IDB, delete all receiving buffers which are merged into it
          const transaction = IDBDatabase.transaction(_IDBReceivingBufferStoreName, "readwrite");
          transaction.onerror = (event) => {
            console.debug(
              `FileDataStore: during deleting IDBReceivingBuffer after merging, IDB transaction to delete all receiving buffer for a file (${fileHash}) and a peer (${peerId}) onerror`,
              event
            );
            reject();
          };
          transaction.oncomplete = (event) => {
            console.debug(
              `FileDataStore: during deleting IDBReceivingBuffer after merging, IDB transaction delete all receiving buffer for a file (${fileHash}) and a peer (${peerId}) oncomplete`,
              event
            );
            resolve({
              fulFilledType: IDBBufferPersistingPromiseFulFilledType.FULFILLED_MERGING,
              fulFilledAtOffset: 0,
            });
          };
          const store = transaction.objectStore(_IDBReceivingBufferStoreName);
          const index = store.index("fileId_idx");
          const request = index.openCursor(IDBKeyRange.only(_buildFileId(peerId, fileHash)));
          request.onerror = function (event) {
            console.error(
              `FileDataStore: during deleting IDBReceivingBuffer after merging, IDB request to open cursor of receiving buffer onerror`,
              event
            );
            reject();
          };
          request.onsuccess = function (event) {
            console.debug(
              `FileDataStore: during deleting IDBReceivingBuffer after merging, IDB request to open cursor of receiving buffer onsuccess`,
              event
            );

            if (!(event.target instanceof IDBRequest)) {
              console.error(`FileDataStore: during deleting IDBReceivingBuffer after merging, unexpected event target instance type`, event.target);
              return;
            }
            
            if (event.target.result instanceof IDBCursor) {
              const cursor = event.target.result;
              const request = store.delete(cursor.primaryKey);
              request.onsuccess = function (event) {
                console.debug(`FileDataStore: during deleting IDBReceivingBuffer after merging, requesting to delete a buffer onsuccuess`, event);
              };
              request.onerror = function (event) {
                console.debug(`FileDataStore: during deleting IDBReceivingBuffer after merging, requesting to delete a buffer onerror`, event);
                reject();
              };
              cursor.continue();
            }
          };
        };
      }
    };
  });
  return mergingPromise;
}

function _getIDBReceivingFile(peerId: string, fileHash: string, IDBDatabase: IDBDatabase) {
  return new Promise<File>((resolve, reject) => {
    const transaction = IDBDatabase.transaction(_IDBReceivingFileStoreName, "readwrite");
    const store = transaction.objectStore(_IDBReceivingFileStoreName);
    const request = store.get(_buildFileId(peerId, fileHash));
    let isOperationSuccessful = true;
    let file: File;

    request.onsuccess = (event) => {
      console.debug(`FileDataStore: IDB request to get a receiving file onsuccess`, event);

      if (!(event.target instanceof IDBRequest)) {
        console.error(`FileDataStore: unexpected event target instance type`, event.target);
        return;
      }

      const record = event.target.result;
      if (!record) {
        console.debug(
          `FileDataStore: unexpected empty record of receiving file (${fileHash}) for a peer (${peerId})`
        );
        return;
      }
      if (!(record.file instanceof File)) {
        return;
      }
      file = record.file as File;
    };
    request.onerror = (event) => {
      console.error(`FileDataStore: IDB request to get a receiving file onerror`, event);
      isOperationSuccessful = false;
    };
    transaction.oncomplete = (event) => {
      console.debug(
        `FileDataStore: IDB transaction to get a receiving file (${fileHash}) for a peer (${peerId}) oncomplete`,
        event
      );

      if (!isOperationSuccessful) {
        reject();
        return;
      }

      resolve(file);
    };
  });
}

function _resetIDBAllReceivingBuffers(IDBDatabase: IDBDatabase) {
  return new Promise((resolve, reject) => {
    const transaction = IDBDatabase.transaction(_IDBReceivingBufferStoreName, "readwrite");
    const store = transaction.objectStore(_IDBReceivingBufferStoreName);
    const request = store.clear();
    let isOperationSuccessful = true;

    request.onsuccess = function (event) {
      console.debug(`FileDataStore: IDB request to clear all receiving buffers onsuccess`, event);
    };
    request.onerror = function (event) {
      console.error(`FileDataStore: IDB request to clear all receiving buffers onerror`, event);
      isOperationSuccessful = false;
    };

    transaction.oncomplete = () => {
      console.debug(`FileDataStore: IDB transaction to clear all receiving buffers oncomplete`);

      if (!isOperationSuccessful) {
        reject();
        return;
      }
      resolve(undefined);
    };
  });
}

function _resetIDBReceivingBuffer(peerId: string, fileHash: string, IDBDatabase: IDBDatabase) {
  return new Promise<IDBBufferPersistingPromiseFulfillment>((resolve, reject) => {
    const transaction = IDBDatabase.transaction(_IDBReceivingBufferStoreName, "readwrite");
    const store = transaction.objectStore(_IDBReceivingBufferStoreName);
    const index = store.index("fileId_idx");
    const request = index.openCursor(IDBKeyRange.only(_buildFileId(peerId, fileHash)));
    let isOperationSuccessful = true;

    request.onsuccess = function (event) {
      console.debug(
        `FileDataStore: during resetIDBReceivingBuffer, IDB request to open cursor of receiving buffer onsuccess`,
        event
      );

      if (!(event.target instanceof IDBRequest)) {
        console.error(`FileDataStore: during resetIDBReceivingBuffer, event target instance type is unexpected`, event.target);
        return;
      }
      
      if (event.target.result instanceof IDBCursor) {
        const cursor = event.target.result;
        const request = store.delete(cursor.primaryKey);
        request.onsuccess = function (event) {
          console.debug(`FileDataStore: during resetIDBReceivingBuffer, IDB request to delete a receiving buffer onsuccess`, event);
        };
        request.onerror = function (event) {
          console.error(`FileDataStore: during resetIDBReceivingBuffer, IDB request to delete a receiving buffer onerror`, event);
          isOperationSuccessful = false;
        };
        cursor.continue();
      }
    };
    request.onerror = function (event) {
      console.error(`FileDataStore: during resetIDBReceivingBuffer, IDB request to open cursor of receiving buffer onerror`, event);
      isOperationSuccessful = false;
    };
    transaction.oncomplete = () => {
      console.debug(
        `FileDataStore: during resetIDBReceivingBuffer, IDB transaction to open cursor and delete receiving buffer of a file (${fileHash}) for a peer (${peerId}) oncomplete`
      );

      if (!isOperationSuccessful) {
        reject();
        return;
      }

      _receivingProgressMap.resetProgress(peerId, fileHash);
      const fulFillment: IDBBufferPersistingPromiseFulfillment = {
        fulFilledType: IDBBufferPersistingPromiseFulFilledType.FULFILLED_RESETTING,
        fulFilledAtOffset: 0,
      };
      resolve(fulFillment);
    };
  });
}

function _resetIDBReceivingBufferMergedFiles(fileIds: string[], IDBDatabase: IDBDatabase) {
  const intersectingFileIds = _receivingHashToExporterMap.avaliableFileIds.filter((x) =>
    fileIds.includes(x)
  );
  const isAllResetting =
    intersectingFileIds.length >= _receivingHashToExporterMap.avaliableFileIds.length;

  return new Promise((resolve, reject) => {
    const transaction = IDBDatabase.transaction(_IDBReceivingFileStoreName, "readwrite");
    const store = transaction.objectStore(_IDBReceivingFileStoreName);
    let isOperationSuccessful = true;

    if (isAllResetting) {
      const request = store.clear();
      request.onsuccess = function (event) {
        console.debug(
          `FileDataStore: IDB request to clear all receiving buffer merged files onsuccess`,
          event
        );
        _receivingHashToExporterMap.clearExporters();
      };
      request.onerror = function (event) {
        console.error(
          `FileDataStore: IDB request to clear all receiving buffer merged files onerror`,
          event
        );
        isOperationSuccessful = false;
      };
    } else {
      const request = store.openCursor();
      request.onsuccess = function (event) {
        if (!(event.target instanceof IDBRequest)) {
          console.error(`FileDataStore: unexpected event target instance type`, event.target);
          return;
        }

        if (event.target.result instanceof IDBCursor) {
          const cursor = event.target.result;

          console.debug(
            `FileDataStore: IDB request to open cursor of receiving buffer merged file 'onsuccess' with a primaryKey(${cursor.primaryKey})`,
            event
          );

          const fileId = cursor.primaryKey;
          if (typeof fileId === "string" && intersectingFileIds.includes(fileId)) {
            const request = store.delete(fileId);
            request.onsuccess = function (event) {
              console.debug(
                `FileDataStore: IDB request to delete a receiving buffer merged file with fileId(${cursor.primaryKey}) onsuccess`,
                event
              );

              const { peerId, fileHash } = _parseFileId(fileId);
              _receivingHashToExporterMap.setExporter(peerId, fileHash, undefined);
            };
            request.onerror = function (event) {
              console.error(
                `FileDataStore: IDB request to delete a receiving buffer merged file with fileId(${cursor.primaryKey}) onerror`,
                event
              );
            };
          }
          cursor.continue();
        }
      };
      request.onerror = function (event) {
        isOperationSuccessful = false;
        console.error(
          `FileDataStore: IDB request to open cursor of receiving buffer merged files onerror`,
          event
        );
      };
    }

    transaction.oncomplete = () => {
      console.debug(
        `FileDataStore: IDB transaction to delete receiving buffer merged files oncomplete`
      );

      if (!isOperationSuccessful) {
        reject();
        return;
      }
      resolve(undefined);
    };
  });
}

_openIDB();

/**
 * Utils
 */

function _buildSendingRelatedDataProxy(
  sendingRelatedData: SendingRelatedData
): SendingRelatedDataProxy {
  return {
    fileHashToAllSlices: sendingRelatedData.fileHashToAllSlices,
  };
}

function _buildReceivingRelatedDataProxy(
  receivingRelatedData: ReceivingRelatedData
): ReceivingRelatedDataProxy {
  return {
    peerMapOfHashToAllSlices: receivingRelatedData.peerMapOfHashToAllSlices,
  };
}

function _buildFileId(peerId: string, fileHash: string) {
  return `${peerId}-${fileHash}`;
}

function _buildBufferId(peerId: string, fileHash: string, startOffset: number) {
  return `${peerId}-${fileHash}-${startOffset}`;
}

function _parseFileId(fileId: string) {
  const elements = fileId.split("-");
  return {
    peerId: elements.slice(0, -1).join(""),
    fileHash: elements[elements.length - 1],
  };
}

function _parseBufferId(bufferId: string) {
  const elements = bufferId.split("-");
  const startOffsetString = elements[elements.length - 1];
  return {
    peerId: elements.slice(0, -2).join(""),
    fileHash: elements[elements.length - 2],
    startOffset: !Number.isNaN(startOffsetString) ? Number(startOffsetString) : undefined,
  };
}

export default {
  // sending view model changed listener
  onSendingRelatedDataChanged: function (
    handler: (
      sendingRelatedDataProxy: SendingRelatedDataProxy,
      isSendingStatusSending?: boolean
    ) => void
  ) {
    _handleSendingRelatedDataChange = handler;
  },
  // receiving view model changed listener
  onReceivingRelatedDataChanged: function (
    handler: (receivingRelatedDataProxy: ReceivingRelatedDataProxy) => void
  ) {
    _handleReceivingRelatedDataChange = handler;
  },

  //
  // Sending meta data
  //

  get preparedSendingHashToMetaData() {
    return _sendingHashToMetaData;
  },
  prepareSendingMetaData(hashToFile: FileHashToFile) {
    _prepareSendingMetaData(hashToFile);
  },
  checkIfSendingMetaDataPrepared(hashToFile: FileHashToFile) {
    return _checkIfSendingMetaDataPrepared(hashToFile);
  },

  //
  // Sending && Receiving cancelled
  //

  // sending cancelled
  getSendingCancelled(fileHash: string) {
    return _sendingHashToCancelled[fileHash];
  },
  setSendingCancelled(fileHash: string, cancelled: boolean) {
    _sendingHashToCancelled[fileHash] = cancelled;
  },
  clearSendingCancelled() {
    _sendingHashToCancelled = {};
  },
  // receiving cancelled
  setReceivingCancelled(peerId: string, fileHash: string, cancelled: boolean) {
    _receivingCancelledMap.setCancelled(peerId, fileHash, cancelled);
  },
  deleteReceivingCancelled(peerId: string, fileHash: string) {
    _receivingCancelledMap.deleteCancelled(peerId, fileHash);
  },

  //
  // Sending progress
  //

  getSendingProgress(peerId: string, fileHash: string) {
    return _sendingProgressMap.getProgress(peerId, fileHash);
  },
  setSendingProgress(peerId: string, fileHash: string, progress: number) {
    _sendingProgressMap.setProgress(peerId, fileHash, progress);
  },
  resetSendingProgress(peerId: string, fileHash: string) {
    _sendingProgressMap.resetProgress(peerId, fileHash);
  },

  //
  // Receiving meta data
  //

  mergeReceivingHashToMetaData(peerId: string, hashToMetaData: FileHashToMeta) {
    _receivingHashToMetaDataMap.mergeHashToMetaData(peerId, hashToMetaData);
  },

  //
  // Receiving buffer persistence
  //

  addReceivingBuffer(peerId: string, fileHash: string, buffer: ArrayBuffer) {
    _addReceivingBuffer(peerId, fileHash, buffer);
  },
  resetReceivingBuffer(peerId: string, fileHash: string) {
    _resetReceivingBuffer(peerId, fileHash);
  },
  resetAllReceivingBuffers() {
    _resetAllReceivingBuffers();
  },
  resetAllReceivingBufferMergedFiles() {
    _resetAllReceivingBufferMergedFiles();
  },

  //
  //
  //

  clearSendingRelatedData() {
    _sendingRelatedData.clear();
  },
  clearReceivingRelatedData() {
    _receivingRelatedData.clear();
  },
};
