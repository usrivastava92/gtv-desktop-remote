// PR-renderer-6: extract remote command busy/queue state from App.tsx
//
// This hook owns:
//   - the busy state for command dispatch operations
//   - the command queue and dispatch logic
//   - refs for queue processing state
//
// App.tsx uses this as:
//   const { busy, handleCommand } = useRemoteSession(onCommandError);
//
// The hook is designed to be lightweight and have minimal dependencies.
// It accepts an onCommandError callback for error reporting to App's state.

import { useCallback, useRef, useState } from 'react';

import type {
  CommandDispatchRequest,
  RemoteCommand,
  RemoteCommandSource,
} from '../../shared/types';
import { getDesktopApi } from '../api';
import { BURST_SENSITIVE_COMMANDS, MAX_QUEUED_COMMANDS } from '../lib/remoteCommands';

interface QueuedCommandBatch {
  command: RemoteCommand;
  source: RemoteCommandSource;
  requests: CommandDispatchRequest[];
}

/**
 * Manages remote command dispatch and busy state.
 *
 * @param onCommandError - callback when a command fails to send.
 *   Allows the hook to report errors without being tightly coupled to App's state.
 */
export function useRemoteSession(onCommandError?: (error: Error) => void) {
  const [busy, setBusy] = useState(false);

  const commandQueueRef = useRef<QueuedCommandBatch[]>([]);
  const queuedCommandCountRef = useRef(0);
  const isProcessingQueueRef = useRef(false);

  const createCommandRequest = useCallback(
    (command: RemoteCommand, source: RemoteCommandSource): CommandDispatchRequest => {
      return {
        id: crypto.randomUUID(),
        command,
        issuedAt: Date.now(),
        source,
      };
    },
    []
  );

  const recordQueuedCommandDrop = useCallback((request: CommandDispatchRequest) => {
    void getDesktopApi().recordCommandDrop({
      ...request,
      droppedAt: Date.now(),
      dropReason: 'renderer_burst_limit',
      pendingCommandCount: queuedCommandCountRef.current,
    });
  }, []);

  const flushQueuedCommands = useCallback(async () => {
    if (isProcessingQueueRef.current) {
      return;
    }

    isProcessingQueueRef.current = true;

    try {
      while (commandQueueRef.current.length > 0) {
        const currentBatch = commandQueueRef.current[0];
        if (!currentBatch) {
          break;
        }
        const request = currentBatch.requests.shift();

        if (!request) {
          commandQueueRef.current.shift();
          continue;
        }

        try {
          await getDesktopApi().sendCommand(request);
        } catch (error) {
          onCommandError?.(error instanceof Error ? error : new Error(String(error)));
        } finally {
          queuedCommandCountRef.current = Math.max(0, queuedCommandCountRef.current - 1);
          if (currentBatch.requests.length === 0) {
            commandQueueRef.current.shift();
          }
        }
      }
    } finally {
      isProcessingQueueRef.current = false;
      if (commandQueueRef.current.length > 0) {
        void flushQueuedCommands();
      }
    }
  }, [onCommandError]);

  const enqueueCommand = useCallback(
    (request: CommandDispatchRequest) => {
      if (queuedCommandCountRef.current >= MAX_QUEUED_COMMANDS) {
        recordQueuedCommandDrop(request);
        return;
      }

      const lastBatch = commandQueueRef.current[commandQueueRef.current.length - 1];
      if (
        lastBatch &&
        BURST_SENSITIVE_COMMANDS.has(request.command) &&
        lastBatch.command === request.command &&
        lastBatch.source === request.source
      ) {
        lastBatch.requests.push(request);
      } else {
        commandQueueRef.current.push({
          command: request.command,
          source: request.source,
          requests: [request],
        });
      }

      queuedCommandCountRef.current += 1;
      void flushQueuedCommands();
    },
    [flushQueuedCommands, recordQueuedCommandDrop]
  );

  const handleCommand = useCallback(
    (command: RemoteCommand, source: RemoteCommandSource = 'button') => {
      const request = createCommandRequest(command, source);
      enqueueCommand(request);
    },
    [createCommandRequest, enqueueCommand]
  );

  return {
    busy,
    setBusy,
    handleCommand,
  };
}
