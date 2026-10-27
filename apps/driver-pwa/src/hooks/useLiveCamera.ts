import { useCallback, useEffect, useRef, useState } from 'react';

import { captureSquareFrame } from '../services/imageEnhancementService';

export type CameraFacing = 'user' | 'environment';
export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';
export type CameraErrorKind = 'unsupported' | 'insecure' | 'denied' | 'not_found' | 'in_use' | 'interrupted' | 'unknown';

interface UseLiveCameraResult {
  /** Ref for the <video> that shows the live feed */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  errorKind: CameraErrorKind | null;
  facing: CameraFacing;
  /** True once the video is playing real frames (a capture before this would be blank) */
  frameReady: boolean;
  /** More than one camera is available, so switching makes sense */
  canSwitch: boolean;
  start: (facing?: CameraFacing) => Promise<void>;
  stop: () => void;
  switchFacing: () => void;
  /** The centre square of the current frame as a JPEG, mirrored for the front camera like the preview. Rejects if no frame is showing. */
  capturePhoto: () => Promise<Blob>;
}

function classifyError(err: unknown): CameraErrorKind {
  const name = err instanceof DOMException ? err.name : (err as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'not_found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in_use';
    default:
      return 'unknown';
  }
}

/**
 * A live camera feed and nothing else: the only way a picture comes out of this hook's video element is the camera itself.
 * Owns the whole stream lifecycle: it stops every track when stopped, when restarted, and when the screen unmounts, and it ignores a
 * permission answer that arrives after the screen has already moved on (the late stream is stopped at once).
 */
export function useLiveCamera(initialFacing: CameraFacing = 'user'): UseLiveCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorKind, setErrorKind] = useState<CameraErrorKind | null>(null);
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);
  const [frameReady, setFrameReady] = useState(false);
  const [canSwitch, setCanSwitch] = useState(false);

  const releaseStream = useCallback(() => {
    const current = streamRef.current;
    streamRef.current = null;
    current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    if (videoRef.current) videoRef.current.srcObject = null;
    setFrameReady(false);
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current += 1; // any permission answer still on its way is now stale
    releaseStream();
    setStatus('idle');
    setErrorKind(null);
  }, [releaseStream]);

  const start = useCallback(
    async (targetFacing: CameraFacing = 'user') => {
      const requestId = ++requestIdRef.current;
      releaseStream();
      setFacing(targetFacing);
      setErrorKind(null);

      const fail = (kind: CameraErrorKind) => {
        setStatus('error');
        setErrorKind(kind);
      };

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        fail(typeof window !== 'undefined' && window.isSecureContext === false ? 'insecure' : 'unsupported');
        return;
      }

      setStatus('starting');

      let mediaStream: MediaStream;
      try {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: targetFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
        } catch (err) {
          // a camera that cannot meet the preferred constraints still works with plain ones
          if ((err as { name?: string } | null)?.name !== 'OverconstrainedError') throw err;
          mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      } catch (err) {
        if (requestId === requestIdRef.current) fail(classifyError(err));
        return;
      }

      if (requestId !== requestIdRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      mediaStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (streamRef.current !== mediaStream) return;
          releaseStream();
          fail('interrupted');
        };
      });

      streamRef.current = mediaStream;
      setStatus('live');

      // device labels and the full device list only become available after permission is granted
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (requestId === requestIdRef.current) {
          setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
        }
      } catch {
        // switching just stays hidden
      }
    },
    [releaseStream]
  );

  const switchFacing = useCallback(() => {
    void start(facing === 'user' ? 'environment' : 'user');
  }, [facing, start]);

  // Show the stream in the video element once the camera is live, and note when real frames are flowing
  useEffect(() => {
    const el = videoRef.current;
    if (status !== 'live' || !el) return;

    const markFrameReady = () => setFrameReady(el.videoWidth > 0 && el.videoHeight > 0);
    el.addEventListener('loadeddata', markFrameReady);
    el.addEventListener('playing', markFrameReady);
    el.srcObject = streamRef.current;
    el.play().catch(() => {
      // autoplay can be refused until the next user gesture; the capture button stays disabled until frames flow
    });

    return () => {
      el.removeEventListener('loadeddata', markFrameReady);
      el.removeEventListener('playing', markFrameReady);
    };
  }, [status]);

  const capturePhoto = useCallback(async (): Promise<Blob> => {
    const el = videoRef.current;
    if (!el || !streamRef.current || el.videoWidth === 0) throw new Error('Camera frame is not ready');
    return captureSquareFrame(el, { mirror: facing === 'user' });
  }, [facing]);

  // Leaving the screen always lets go of the camera
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      const current = streamRef.current;
      streamRef.current = null;
      current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
    };
  }, []);

  return { videoRef, status, errorKind, facing, frameReady, canSwitch, start, stop, switchFacing, capturePhoto };
}
