import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

interface EffectHostProps {
  module: any;
  iframeSrc: string;
  isDayMode: boolean;
  onBack: () => void;
  onTelemetry?: (telemetry: any) => void;
  onParams?: (params: any) => void;
  onSendReady?: (send: any) => void;
  onOpenAi?: () => void;
}

export interface EffectHostHandle {
  /** Ask the effect for its settings via the bridge and persist them.
   *  Resolves true when the effect replied and the snapshot was stored. */
  requestSave: () => Promise<boolean>;
}

const settingsKey = (id: string) => `syntech.effectSettings.${id}`;

const EffectHost = forwardRef<EffectHostHandle, EffectHostProps>(function EffectHost(
  { module, iframeSrc, isDayMode, onBack },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const moduleIdRef = useRef<string>(module?.id);
  moduleIdRef.current = module?.id;
  const pendingSaveRef = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || ev.source !== win) return;
      const msg = ev.data;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      if (msg.type === 'syn:ready') {
        // Effect booted: replay its saved settings, if any (03-SPEC-SHELL §5).
        const id = msg.payload?.id || moduleIdRef.current;
        try {
          const raw = localStorage.getItem(settingsKey(id));
          if (raw) win.postMessage({ type: 'syn:apply-settings', payload: JSON.parse(raw) }, '*');
        } catch { /* corrupt snapshot or private mode — effect keeps its defaults */ }
      } else if (msg.type === 'syn:settings') {
        let ok = false;
        try {
          localStorage.setItem(settingsKey(moduleIdRef.current), JSON.stringify(msg.payload ?? {}));
          ok = true;
        } catch { /* private mode */ }
        pendingSaveRef.current?.(ok);
        pendingSaveRef.current = null;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useImperativeHandle(ref, () => ({
    requestSave: () =>
      new Promise<boolean>((resolve) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return resolve(false);
        pendingSaveRef.current = resolve;
        win.postMessage({ type: 'syn:get-settings' }, '*');
        setTimeout(() => {
          if (pendingSaveRef.current === resolve) {
            pendingSaveRef.current = null;
            resolve(false);
          }
        }, 1500);
      }),
  }));

  return (
    <div className={`w-full h-full flex flex-col ${isDayMode ? 'bg-white' : 'bg-black'}`}>
      <div className={`flex items-center justify-between p-3 border-b ${isDayMode ? 'border-neutral-200' : 'border-ink-700/50'}`}>
        <button onClick={onBack} className="text-sm font-mono text-violet-500 hover:text-violet-400">
          ← BACK TO GRAPH
        </button>
        <div className="font-mono text-xs font-bold text-violet-500 uppercase tracking-widest">
          {module?.name || 'EFFECT'}
        </div>
        <div className="w-16"></div>
      </div>
      <div className="flex-1 relative">
        <iframe
          ref={iframeRef}
          src={iframeSrc + '/index.html'}
          className="w-full h-full border-none"
          title={module?.name || 'Effect'}
          allow="camera; microphone"
        />
      </div>
    </div>
  );
});

export default EffectHost;
