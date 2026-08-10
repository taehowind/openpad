import { EventEmitter } from "node:events";

// Process-local pub/sub for board changes. Single-instance only (matches the SQLite runtime).
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function notifyBoard(boardId: string) {
  emitter.emit(boardId);
}

export function subscribeBoard(boardId: string, listener: () => void) {
  emitter.on(boardId, listener);
  return () => emitter.off(boardId, listener);
}
