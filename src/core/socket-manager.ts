import ReconnectingAliveSocket, { ReconnectingAliveSocketEvent } from "reconnecting-alive-socket";
import { EventListenerContainer, HandleMessagePayload } from "./common-types";

const _socketMap: Map<string, ReconnectingAliveSocket> = new Map();
const _eventListenerMap: Map<string, EventListenerContainer> = new Map();

function _createSocket(
  socketUrl: string,
  openCallback: EventListener,
  closeCallback: EventListener
) {
  let socket = _socketMap.get(socketUrl);
  if (!socket) {
    socket = new ReconnectingAliveSocket(socketUrl);

    const openEventListener = function (event: Event) {
      console.debug(`SocketService: websocket connected`);
      // external usage
      if (openCallback) {
        openCallback(event);
      }
    };
    const errorEventListener = function (event: Event) {
      console.debug(`SocketService: client side heared websocket onerror event`, event);
    };
    const closeEventListener = function (event: Event) {
      const reconnectingAliveSocketEvent = event as ReconnectingAliveSocketEvent;
      console.debug(
        `SocketService: client side heared websocket onclose event (code: ${reconnectingAliveSocketEvent.code}; reason: ${reconnectingAliveSocketEvent.reason})`
      );
      // external usage
      if (closeCallback) {
        closeCallback(event);
      }
    };
    const removeEventListener = function (event: Event) {
      _removeSocketListeners(socketUrl);
    };

    socket.addEventListener("open", openEventListener);
    socket.addEventListener("error", errorEventListener);
    socket.addEventListener("close", closeEventListener);
    socket.addEventListener("remove", removeEventListener, {
      once: true,
    });

    _eventListenerMap.set(socketUrl, {
      open: openEventListener,
      error: errorEventListener,
      close: closeEventListener,
    });

    _socketMap.set(socketUrl, socket);
  }
}

function _removeSocketListeners(socketUrl: string) {
  if (!_eventListenerMap.has(socketUrl)) {
    return;
  }
  if (!_socketMap.has(socketUrl)) {
    return;
  }

  const eventListenerContainer = _eventListenerMap.get(socketUrl) as EventListenerContainer;
  const socket = _socketMap.get(socketUrl) as ReconnectingAliveSocket;

  const openEventListener = eventListenerContainer.open;
  const errorEventListener = eventListenerContainer.error;
  const closeEventListener = eventListenerContainer.close;
  const messageEventListeners = eventListenerContainer.message;

  if (openEventListener) {
    socket.removeEventListener("open", openEventListener);
  }

  if (errorEventListener) {
    socket.removeEventListener("error", errorEventListener);
  }

  if (closeEventListener) {
    socket.removeEventListener("close", closeEventListener);
  }

  if (messageEventListeners && messageEventListeners.length > 0) {
    messageEventListeners.forEach((messageEventListener) => {
      socket.removeEventListener("message", messageEventListener);
    });
  }

  _socketMap.delete(socketUrl);
  _eventListenerMap.delete(socketUrl);

  console.debug(`SocketService: websocket listeners removed`);
}

function _destroySocket(socketUrl: string) {
  const socket = _socketMap.get(socketUrl);
  if (!socket) {
    return;
  }
  socket.close();
}

function _registerMessageEvent(
  socketUrl: string,
  regisType: number | string,
  regisCallback: HandleMessagePayload
) {
  const socket = _socketMap.get(socketUrl);
  if (!socket) {
    return;
  }

  const messageEventListener = function (event: Event) {
    const messageEvent = event as MessageEvent;

    const parsedData = JSON.parse(messageEvent.data);
    const type = parsedData.type;
    const payload = parsedData.payload;
    if (regisType !== type) {
      return;
    }
    regisCallback(payload);
  };
  socket.addEventListener("message", messageEventListener);

  if (!_eventListenerMap.has(socketUrl)) {
    _eventListenerMap.set(socketUrl, {});
  }
  if (!(_eventListenerMap.get(socketUrl) as EventListenerContainer).message) {
    const eventListenerContainer = _eventListenerMap.get(socketUrl) as EventListenerContainer;
    eventListenerContainer.message = [];
    _eventListenerMap.set(socketUrl, eventListenerContainer);
  }

  const eventListenerContainer = _eventListenerMap.get(socketUrl) as EventListenerContainer;
  (eventListenerContainer.message as EventListener[]).push(messageEventListener);
  _eventListenerMap.set(socketUrl, eventListenerContainer);
}

function _emitMessageEvent(socketUrl: string, emitType: number | string, emitPayload?: unknown) {
  const socket = _socketMap.get(socketUrl);
  if (!socket) {
    return;
  }
  const data = {
    type: emitType,
    payload: emitPayload,
  };
  socket.send(JSON.stringify(data));
}

export default {
  createSocket(socketUrl: string, openCallback: EventListener, closeCallback: EventListener) {
    _createSocket(socketUrl, openCallback, closeCallback);
  },

  destroySocket(socketUrl: string) {
    _destroySocket(socketUrl);
  },

  registerMessageEvent(
    socketUrl: string,
    regisType: number | string,
    regisCallback: HandleMessagePayload
  ) {
    _registerMessageEvent(socketUrl, regisType, regisCallback);
  },

  emitMessageEvent(socketUrl: string, emitType: number | string, emitPayload?: unknown) {
    _emitMessageEvent(socketUrl, emitType, emitPayload);
  },
};
