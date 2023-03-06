import ReconnectingAliveSocket, { ReconnectingAliveSocketEvent } from "reconnecting-alive-socket";

interface EventListener {
  (event: ReconnectingAliveSocketEvent): void;
}

interface EventListenerContainer {
  open?: EventListener;
  error?: EventListener;
  close?: EventListener;
  message?: [EventListener];
}

const _socketMap: Map<string, ReconnectingAliveSocket> = new Map;
const _eventListenerMap: Map<string, EventListenerContainer> = new Map;

export {_socketMap, _eventListenerMap}

