import { AI_MAX_RECORDING_MS } from '@diary/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/apiClient';

/* Thin MediaRecorder wrapper. `onStop` fires uniformly whether the recording was
   stopped manually or by the max-duration timer, so the caller has one place to
   react; `cancel` skips it entirely (the user discarded the take). */

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function pickMimeType(): string | undefined {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

interface UseVoiceRecorderOptions {
  onStop: (blob: Blob | null) => void;
}

export function useVoiceRecorder({ onStop }: UseVoiceRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | undefined>(undefined);
  const autoStopRef = useRef<number | undefined>(undefined);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  const cleanup = useCallback(() => {
    // Always stop tracks, even on error paths — otherwise Android keeps the mic
    // indicator lit until the page reloads.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (tickRef.current !== undefined) window.clearInterval(tickRef.current);
    if (autoStopRef.current !== undefined) window.clearTimeout(autoStopRef.current);
    tickRef.current = undefined;
    autoStopRef.current = undefined;
    setRecording(false);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied =
        err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      throw new ApiError(0, denied ? 'ai.mic_denied' : 'ai.mic_unavailable');
    }

    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = chunksRef.current.length
        ? new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        : null;
      cleanup();
      onStopRef.current(blob);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start();
    setRecording(true);
    tickRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
    autoStopRef.current = window.setTimeout(() => recorderRef.current?.stop(), AI_MAX_RECORDING_MS);
  }, [cleanup]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    if (recorderRef.current) recorderRef.current.onstop = null;
    cleanup();
  }, [cleanup]);

  return { recording, elapsedMs, start, stop, cancel };
}
