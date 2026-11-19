import { useCallback, useEffect, useRef, useState } from 'react';

export function browserMonitorSupport(browserWindow = window) {
  if (!browserWindow.isSecureContext) {
    return { supported: false, message: 'Browser monitor detection requires a secure context (HTTPS or localhost).' };
  }
  if (typeof browserWindow.getScreenDetails !== 'function') {
    return { supported: false, message: 'The Window Management API is not supported by this browser.' };
  }
  return { supported: true, message: 'Window Management API available. Permission will be requested when you check.' };
}

export function monitorResultFromScreens(screens) {
  const count = Array.isArray(screens) ? screens.length : 0;
  if (count < 1) return { status: 'UNKNOWN', screenCount: null, screens: [], message: 'The browser returned no available screen details.' };
  return {
    status: count === 1 ? 'PASS' : 'FAIL',
    screenCount: count,
    screens: screens.map((screen, index) => ({
      label: typeof screen.label === 'string' && screen.label ? screen.label : `Screen ${index + 1}`,
      width: screen.width,
      height: screen.height,
      isPrimary: Boolean(screen.isPrimary),
    })),
    message: count === 1 ? 'One browser-visible screen was reported.' : `${count} browser-visible screens were reported.`,
  };
}

export function browserMonitorError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Permission was denied. Allow display access in the browser and try again.';
  }
  return error?.message ? `Browser monitor detection failed: ${error.message}` : 'Browser monitor detection failed.';
}

export function useBrowserMonitorCheck() {
  const [support, setSupport] = useState(() => browserMonitorSupport());
  const [result, setResult] = useState(null);
  const detailsRef = useRef(null);
  const listenerRef = useRef(null);

  const cleanup = useCallback(() => {
    if (detailsRef.current && listenerRef.current) detailsRef.current.removeEventListener('screenschange', listenerRef.current);
    detailsRef.current = null;
    listenerRef.current = null;
  }, []);

  const check = useCallback(async () => {
    cleanup();
    const currentSupport = browserMonitorSupport();
    setSupport(currentSupport);
    if (!currentSupport.supported) {
      setResult({ status: 'UNKNOWN', screenCount: null, screens: [], message: currentSupport.message });
      return;
    }
    try {
      const details = await window.getScreenDetails();
      const refresh = () => setResult(monitorResultFromScreens(Array.from(details.screens)));
      detailsRef.current = details;
      listenerRef.current = refresh;
      details.addEventListener('screenschange', refresh);
      refresh();
    } catch (error) {
      setResult({ status: 'UNKNOWN', screenCount: null, screens: [], message: browserMonitorError(error) });
    }
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);
  return { support, result, check };
}
