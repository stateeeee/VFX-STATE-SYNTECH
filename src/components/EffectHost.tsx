import React, { useEffect, useRef } from 'react';
import { ModuleId } from '../types';

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

export default function EffectHost({ module, iframeSrc, isDayMode, onBack }: EffectHostProps) {
  return (
    <div className={`w-full h-full flex flex-col ${isDayMode ? 'bg-white' : 'bg-black'}`}>
      <div className={`flex items-center justify-between p-3 border-b ${isDayMode ? 'border-neutral-200' : 'border-ink-700'}`}>
        <button onClick={onBack} className="text-sm font-mono text-gold-500 hover:text-gold-400">
          ← BACK TO GRAPH
        </button>
        <div className="font-mono text-xs font-bold text-gold-500 uppercase tracking-widest">
          {module?.name || 'EFFECT'}
        </div>
        <div className="w-16"></div>
      </div>
      <div className="flex-1 relative">
        <iframe
          src={iframeSrc + '/index.html'}
          className="w-full h-full border-none"
          title={module?.name || 'Effect'}
          allow="camera; microphone"
        />
      </div>
    </div>
  );
}
