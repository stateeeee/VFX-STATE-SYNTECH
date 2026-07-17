import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Bot,
  RefreshCw,
  Cpu,
  Lightbulb,
  ChevronRight,
  Video,
  Settings
} from 'lucide-react';
import Markdown from 'react-markdown';

const GeminiIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.9969 24C12.3396 17.5134 17.4851 12.3663 23.9701 12.0221C17.4851 11.6778 12.3396 6.53075 11.9969 0.0441895C11.6543 6.53075 6.50877 11.6778 0.0236816 12.0221C6.50877 12.3663 11.6543 17.5134 11.9969 24Z" fill="currentColor"/>
  </svg>
);


interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  presetSuggested?: any;
}

interface AiDirectorProps {
  isDayMode?: boolean;
  activeGeminiMode: 'art_director' | 'agent' | 'optimizer' | null;
  compEffects: { id: string; enabled: boolean }[];
  compSource: { name: string; url: string } | null;
  currentConfig: {
    activeModule: string;
    signalSource: string;
    bufferSize: number;
    parameters: any;
  };
  onApplyPreset: (preset: any) => void;
  onUpdateCompEffects: (enableIds: string[], disableIds: string[]) => void;
}

const DEFAULT_SUGGESTIONS: Record<string, string[]> = {
  blob_tracker: ['Increase Blob Tracker sensitivity', 'Add fluid dynamics turbulence', 'Boost cellular density glow'],
  analog: ['Add Analog sync jitter', 'Warm the CRT phosphor bloom', 'Increase chromatic aberration'],
  blob_reveal: ['Soften the reveal mask edges', 'Pulse the mask with the audio', 'Raise reveal threshold'],
  bokeh: ['Enhance Bokeh depth falloff', 'Widen the aperture disks', 'Add anamorphic squeeze'],
  anamorphic_lab: ['Stretch the horizontal flares', 'Add film halation glow', 'Increase diffraction streaks'],
};

export default function AiDirector({ currentConfig, onApplyPreset, isDayMode, activeGeminiMode, compEffects, compSource, onUpdateCompEffects }: AiDirectorProps) {
  const mode = activeGeminiMode;
  const panelInk = isDayMode ? 'bg-[#fbfaf7]' : 'bg-ink-900';
  
  return (
    <div className={`flex-1 flex flex-col h-full w-full overflow-hidden ${panelInk}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between shrink-0 ${isDayMode ? 'border-[#7b51b7]/30 bg-white' : 'border-[#7b51b7]/40 bg-ink-900'}`}>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center shrink-0">
            {mode === 'art_director' ? <Lightbulb className={`w-4 h-4 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`} /> : 
             mode === 'agent' ? <Bot className={`w-4 h-4 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`} /> :
             mode === 'optimizer' ? <Settings className={`w-4 h-4 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`} /> :
             <Sparkles className={`w-4 h-4 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`} />}
          </div>
          <h2 className={`text-[11px] tracking-[0.22em] font-mono uppercase font-bold ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}>
            {mode === 'art_director' ? 'Art Director' : mode === 'agent' ? 'Agent' : mode === 'optimizer' ? 'Optimizer' : 'Gemini Pro'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {mode ? (
            <span className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
            </span>
          ) : (
            <span className={`flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded ${isDayMode ? 'bg-[#7b51b7]/10 text-[#7b51b7] border border-[#7b51b7]/30' : 'bg-[#7b51b7]/10 text-violet-300 border border-[#7b51b7]/40'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isDayMode ? 'bg-[#7b51b7]/70' : 'bg-violet-400/70'}`} /> Standby
            </span>
          )}
        </div>
      </div>

      {!mode && <AiHomeTab isDayMode={isDayMode} />}
      {mode === 'art_director' && (
        <ArtDirectorTab isDayMode={isDayMode} currentConfig={currentConfig} onApplyPreset={onApplyPreset} />
      )}
      {mode === 'agent' && (
        <AgentTab isDayMode={isDayMode} compEffects={compEffects} onUpdateCompEffects={onUpdateCompEffects} />
      )}
      {mode === 'optimizer' && (
        <OptimizerTab isDayMode={isDayMode} compSource={compSource} />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// PREMIUM HOME TAB
// -------------------------------------------------------------
function AiHomeTab({ isDayMode }: { isDayMode?: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <div className={`p-5 rounded-xl border ${isDayMode ? 'bg-white border-[#7b51b7]/20' : 'bg-[#7b51b7]/10 border-[#7b51b7]/40'} flex flex-col h-full gap-4`}>
        <div>
          <h3 className={`${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'} font-mono text-[10px] uppercase tracking-widest mb-3`}>
            System Capabilities
          </h3>
          <p className={`${isDayMode ? 'text-neutral-600' : 'text-neutral-400'} text-xs leading-relaxed`}>
            I can comprehensively analyze your visual composition, intelligently optimize node routing for peak frame rates, and algorithmically suggest aesthetic parameters to elevate your creative output.
          </p>
        </div>

        <div className="mt-auto pt-2">
          <button className={`w-full py-2.5 rounded text-[10px] font-mono uppercase tracking-widest transition-colors ${isDayMode ? 'bg-[#7b51b7]/10 text-[#7b51b7] hover:bg-[#7b51b7]/20 border border-[#7b51b7]/40' : 'bg-[#7b51b7]/10 text-[#7b51b7] hover:bg-[#7b51b7]/20 border border-[#7b51b7]/30'}`}>
            Select A Module
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// ART DIRECTOR (Aesthetic Parameters) - The original functionality
// -------------------------------------------------------------
function ArtDirectorTab({ isDayMode, currentConfig, onApplyPreset }: any) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'model',
      text: `I've analyzed your composition. The audio shows strong low-mid frequencies that would benefit from enhanced depth mapping and organic distortion. Select a suggestion or write a custom directive to begin.`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Consulting core index...');
  const [showThread, setShowThread] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (showThread) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, showThread]);

  useEffect(() => {
    if (!isLoading) return;
    const phrases = [
      'Accessing vault index...',
      'Decompressing node vectors...',
      'Synthesizing parameters...',
      'Consulting Gemini models...',
    ];
    let i = 0;
    const interval = setInterval(() => { i = (i + 1) % phrases.length; setLoadingText(phrases[i]); }, 1500);
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;
    const userMsg: Message = { id: `msg_${Date.now()}`, role: 'user', text: textToSend, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const historyPayload = messages.map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          history: historyPayload,
          currentConfig: {
            activeModule: currentConfig.activeModule,
            signalSource: currentConfig.signalSource,
            bufferSize: currentConfig.bufferSize,
            parameters: currentConfig.parameters,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          { id: `msg_${Date.now() + 1}`, role: 'model', text: data.reply, timestamp: new Date(), presetSuggested: data.preset },
        ]);
      } else {
        throw new Error(data.error || 'Server rejected request');
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'model',
          text: `⚠️ **Neural Link Interruption**: Failed to complete server-side prompt proxy.`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const latestModel = [...messages].reverse().find((m) => m.role === 'model');
  const latestPreset = latestModel?.presetSuggested;
  const analysisText = (latestModel?.text || '').split('PRESET:')[0].trim();
  const presetSuggestions: string[] = latestPreset
    ? Object.entries(latestPreset).map(([k, v]) => `Set ${k.replace(/([A-Z])/g, ' $1').trim()} → ${v}`)
    : [];
  const moduleSuggestions = DEFAULT_SUGGESTIONS[currentConfig.activeModule] || DEFAULT_SUGGESTIONS.blob_tracker;

  const handleApplyAll = () => {
    if (latestPreset) {
      onApplyPreset(latestPreset);
      return;
    }
    handleSendMessage(`Optimize the settings of the active module "${currentConfig.activeModule}" to maximize its visual density and output intensity. Generate preset.`);
  };

  const subInk = isDayMode ? 'text-neutral-500' : 'text-neutral-400';

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className={`p-4 rounded-xl border ${isDayMode ? 'bg-white border-[#7b51b7]/20' : 'bg-[#7b51b7]/10 border-[#7b51b7]/40'} flex flex-col gap-4`}>
          {/* Scene Analysis */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkles className={`w-3 h-3 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`} />
              <span className={`font-mono text-[10px] font-bold tracking-widest uppercase ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}>Scene Analysis</span>
            </div>
            <div className={`markdown-body font-mono text-[11px] leading-relaxed ${isDayMode ? 'text-neutral-700' : 'text-neutral-300'}`}>
              {isLoading ? (
                <span className={`flex items-center gap-2 ${isDayMode ? 'text-[#7b51b7]/80' : 'text-violet-400/80'}`}>
                  <RefreshCw className="w-3 h-3 animate-spin" /> {loadingText}
                </span>
              ) : (
                <Markdown>{analysisText || 'Awaiting signal analysis…'}</Markdown>
              )}
            </div>
          </div>

          {/* Suggestions */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Lightbulb className="w-3 h-3 text-violet-400" />
              <span className={`font-mono text-[10px] font-bold tracking-widest uppercase ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}>Suggestions</span>
            </div>
            <ul className="space-y-1.5">
              {(presetSuggestions.length ? presetSuggestions : moduleSuggestions).map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => (presetSuggestions.length ? handleApplyAll() : handleSendMessage(`${s} for the "${currentConfig.activeModule}" module. Generate preset.`))}
                    className={`w-full flex items-start gap-2 text-left font-mono text-[10px] leading-snug px-2 py-1.5 rounded-md border transition-colors cursor-pointer disabled:opacity-40 ${
                      isDayMode ? 'border-[#7b51b7]/30 hover:border-[#7b51b7]/40 hover:bg-[#7b51b7]/5 text-neutral-700' : 'border-[#7b51b7]/40 hover:border-[#7b51b7]/40 hover:bg-[#7b51b7]/10 text-neutral-300'
                    }`}
                  >
                    <ChevronRight className={`w-3 h-3 shrink-0 mt-[1px] ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`} />
                    <span>{s}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {messages.length > 1 && (
            <div>
              <button
                type="button"
                onClick={() => setShowThread((v) => !v)}
                className={`font-mono text-[9px] uppercase tracking-widest ${subInk} ${isDayMode ? 'hover:text-[#7b51b7]' : 'hover:text-violet-400'} cursor-pointer`}
              >
                {showThread ? '▾ Hide' : '▸ Show'} full transcript ({messages.length})
              </button>
              {showThread && (
                <div className="mt-2 space-y-2.5">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex gap-2 ${msg.role === 'model' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[88%] p-2.5 rounded-lg border font-mono text-[10px] leading-relaxed ${
                        msg.role === 'model'
                          ? (isDayMode ? 'bg-white border-[#7b51b7]/30 text-neutral-700' : 'bg-ink-900 border-[#7b51b7]/40 text-neutral-300')
                          : (isDayMode ? 'bg-[#7b51b7]/10 border-[#7b51b7]/60 text-[#7b51b7]' : 'bg-[#7b51b7]/10 border-[#7b51b7]/30 text-[#7b51b7]')
                      }`}>
                        <div className="markdown-body"><Markdown>{msg.text.split('PRESET:')[0]}</Markdown></div>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={handleApplyAll}
              disabled={isLoading}
              className={`w-full px-3 py-2 ${isDayMode ? 'bg-[#7b51b7]/10 text-[#7b51b7] border border-[#7b51b7]/40 hover:bg-[#7b51b7]/20' : 'bg-[#7b51b7]/10 text-[#7b51b7] border border-[#7b51b7]/30 hover:bg-[#7b51b7]/20'} font-extrabold text-[10px] tracking-wider uppercase rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40`}
            >
              <Cpu className="w-3.5 h-3.5" /> Apply All Suggestions
            </button>
          </div>
        </div>
      </div>
      <div className={`p-3 border-t shrink-0 ${isDayMode ? 'border-[#7b51b7]/30 bg-white' : 'border-[#7b51b7]/40 bg-ink-900'}`}>
        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Gemini to optimize active nodes..."
            disabled={isLoading}
            className={`flex-1 min-w-0 px-3 py-2 rounded-md font-mono text-[11px] transition-colors ${
              isDayMode ? 'bg-white border border-[#7b51b7]/40 text-neutral-900 focus:outline-none focus:border-[#7b51b7]/60 placeholder-neutral-400' : 'bg-ink-900 border border-[#7b51b7]/60 text-white focus:outline-none focus:border-violet-500/60 placeholder-neutral-600'
            } disabled:opacity-40`}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={`px-3 ${isDayMode ? 'bg-[#7b51b7]' : 'bg-violet-500'} text-white font-extrabold rounded-md flex items-center justify-center transition-colors ${isDayMode ? 'hover:bg-[#7b51b7]/90' : 'hover:bg-violet-400'} cursor-pointer disabled:opacity-30`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </>
  );
}

// -------------------------------------------------------------
// AGENT (Automatic Nodes) - The autonomous graph assistant
// -------------------------------------------------------------
function AgentTab({ isDayMode, compEffects, onUpdateCompEffects }: any) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'agent_welcome',
      role: 'model',
      text: `I am the Gemini 3.1 Pro autonomous agent. I can build or modify the node graph for you. Tell me what visual effect you want to achieve.`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;
    const userMsg: Message = { id: `msg_${Date.now()}`, role: 'user', text: textToSend, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const historyPayload = messages.map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch('/api/gemini/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textToSend,
          history: historyPayload,
          compEffects: compEffects.filter((e: any) => e.enabled).map((e: any) => e.id)
        }),
      });
      const data = await res.json();
      
      if (res.ok) {
        if (data.result) {
          const enableList = data.result.enable || [];
          const disableList = data.result.disable || [];
          if (enableList.length > 0 || disableList.length > 0) {
            onUpdateCompEffects(enableList, disableList);
          }
        }
        setMessages((prev) => [
          ...prev,
          { id: `msg_${Date.now() + 1}`, role: 'model', text: data.message || "Done.", timestamp: new Date() },
        ]);
      } else {
        throw new Error(data.error || 'Server rejected request');
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'model',
          text: `⚠️ **Agent Error**: Failed to modify node graph.`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className={`p-4 rounded-xl border ${isDayMode ? 'bg-white border-[#7b51b7]/20' : 'bg-[#7b51b7]/10 border-[#7b51b7]/40'} flex flex-col gap-4`}>
          <div className="space-y-2.5">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === 'model' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[88%] p-2.5 rounded-lg border font-mono text-[10px] leading-relaxed ${
                msg.role === 'model'
                  ? (isDayMode ? 'bg-white border-[#7b51b7]/30 text-neutral-700' : 'bg-ink-900 border-[#7b51b7]/40 text-neutral-300')
                  : (isDayMode ? 'bg-[#7b51b7]/10 border-[#7b51b7]/60 text-[#7b51b7]' : 'bg-[#7b51b7]/10 border-[#7b51b7]/30 text-[#7b51b7]')
              }`}>
                <div className="markdown-body"><Markdown>{msg.text}</Markdown></div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className={`flex gap-2 justify-start`}>
              <div className={`max-w-[88%] p-2.5 rounded-lg border font-mono text-[10px] leading-relaxed ${isDayMode ? 'bg-white border-[#7b51b7]/30 text-neutral-700' : 'bg-ink-900 border-[#7b51b7]/40 text-neutral-300'}`}>
                <span className={`flex items-center gap-2 ${isDayMode ? 'text-[#7b51b7]/80' : 'text-violet-400/80'}`}>
                  <RefreshCw className="w-3 h-3 animate-spin" /> Thinking (High)...
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>
    </div>
      <div className={`p-3 border-t shrink-0 ${isDayMode ? 'border-[#7b51b7]/30 bg-white' : 'border-[#7b51b7]/40 bg-ink-900'}`}>
        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="E.g. Add analog glitch and disable tracking..."
            disabled={isLoading}
            className={`flex-1 min-w-0 px-3 py-2 rounded-md font-mono text-[11px] transition-colors ${
              isDayMode ? 'bg-white border border-[#7b51b7]/40 text-neutral-900 focus:outline-none focus:border-[#7b51b7]/60 placeholder-neutral-400' : 'bg-ink-900 border border-[#7b51b7]/60 text-white focus:outline-none focus:border-violet-500/60 placeholder-neutral-600'
            } disabled:opacity-40`}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className={`px-3 ${isDayMode ? 'bg-[#7b51b7]' : 'bg-violet-500'} text-white font-extrabold rounded-md flex items-center justify-center transition-colors ${isDayMode ? 'hover:bg-[#7b51b7]/90' : 'hover:bg-violet-400'} cursor-pointer disabled:opacity-30`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </>
  );
}

// -------------------------------------------------------------
// OPTIMIZER (Better Performance) - Video Content Analysis
// -------------------------------------------------------------
function OptimizerTab({ isDayMode, compSource }: any) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const analyzeVideo = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/gemini/analyze-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoName: compSource?.name || 'Live Camera Feed',
        }),
      });
      const data = await res.json();
      setAnalysis(data.analysis || 'Analysis complete.');
    } catch (err) {
      setAnalysis('⚠️ Neural Link Interruption: Could not analyze video.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <div className={`p-4 rounded-xl border ${isDayMode ? 'bg-white border-[#7b51b7]/20' : 'bg-[#7b51b7]/10 border-[#7b51b7]/40'} flex flex-col gap-4`}>
        <h3 className={`font-mono text-[11px] font-bold uppercase tracking-widest flex items-center gap-2 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}>
          <Video className="w-4 h-4" /> Video Context Analyzer
        </h3>
        <p className={`font-mono text-[10px] leading-relaxed ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>
          Uses Gemini 3.1 Pro Preview to deeply analyze the active video content and recommend optimal buffer sizes and scaling approaches for performance.
        </p>
        
        <div className={`p-3 rounded border ${isDayMode ? 'bg-black/5 border-[#7b51b7]/20 text-neutral-800' : 'bg-[#7b51b7]/10 border-[#7b51b7]/30 text-neutral-300'} font-mono text-[10px]`}>
          <span className="opacity-60 uppercase tracking-wider block mb-1">Active Input Source</span>
          <span className="font-bold">{compSource?.name || 'No video selected'}</span>
        </div>

        <button
          onClick={analyzeVideo}
          disabled={isLoading}
          className={`w-full px-3 py-2 ${isDayMode ? 'bg-[#7b51b7]/10 text-[#7b51b7] border border-[#7b51b7]/40 hover:bg-[#7b51b7]/20' : 'bg-[#7b51b7]/10 text-[#7b51b7] border border-[#7b51b7]/30 hover:bg-[#7b51b7]/20'} font-extrabold text-[10px] tracking-wider uppercase rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40`}
        >
          {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Cpu className="w-3.5 h-3.5" />}
          {isLoading ? 'Analyzing Content...' : 'Run Video Analysis'}
        </button>

        {analysis && (
          <div className="mt-4 pt-4 border-t border-dashed border-neutral-500/30">
            <h4 className={`font-mono text-[9px] uppercase tracking-widest mb-2 ${isDayMode ? 'text-neutral-500' : 'text-neutral-400'}`}>Analysis Results</h4>
            <div className={`markdown-body font-mono text-[10px] leading-relaxed ${isDayMode ? 'text-neutral-700' : 'text-neutral-300'}`}>
              <Markdown>{analysis}</Markdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
