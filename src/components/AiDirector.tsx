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
  const mode = activeGeminiMode || 'art_director';
  const panelInk = isDayMode ? 'bg-[#fbfaf7]' : 'bg-ink-900';
  
  return (
    <div className={`flex-1 flex flex-col h-full w-full overflow-hidden ${panelInk}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between shrink-0 ${isDayMode ? 'border-neutral-200 bg-white' : 'border-ink-700/50 bg-ink-950'}`}>
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 border border-gold-500/60 rotate-45 flex items-center justify-center shrink-0 rounded-[6px] bg-gold-500/5">
            {mode === 'art_director' ? <Lightbulb className="w-3 h-3 text-gold-500 -rotate-45" /> : 
             mode === 'agent' ? <Bot className="w-3 h-3 text-gold-500 -rotate-45" /> :
             <Settings className="w-3 h-3 text-gold-500 -rotate-45" />}
          </div>
          <h2 className="text-[11px] tracking-[0.22em] font-mono text-gold-500 uppercase font-bold">
            {mode === 'art_director' ? 'Aesthetic Params' : mode === 'agent' ? 'Automatic Nodes' : 'Performance Optimizer'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-mono ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}>Gemini AI</span>
          <span className="flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
          </span>
        </div>
      </div>

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
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4 custom-scrollbar">
        {/* Scene Analysis */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="w-3 h-3 text-gold-500" />
            <span className="font-mono text-[10px] font-bold tracking-widest uppercase text-gold-500">Scene Analysis</span>
          </div>
          <div className={`markdown-body font-mono text-[11px] leading-relaxed ${isDayMode ? 'text-neutral-700' : 'text-neutral-300'}`}>
            {isLoading ? (
              <span className="flex items-center gap-2 text-gold-500/80">
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
                    isDayMode ? 'border-neutral-200 hover:border-gold-500/40 hover:bg-gold-500/5 text-neutral-700' : 'border-ink-700/60 hover:border-gold-500/40 hover:bg-gold-500/[0.06] text-neutral-300'
                  }`}
                >
                  <ChevronRight className="w-3 h-3 text-gold-500 shrink-0 mt-[1px]" />
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
              className={`font-mono text-[9px] uppercase tracking-widest ${subInk} hover:text-gold-500 cursor-pointer`}
            >
              {showThread ? '▾ Hide' : '▸ Show'} full transcript ({messages.length})
            </button>
            {showThread && (
              <div className="mt-2 space-y-2.5">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex gap-2 ${msg.role === 'model' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[88%] p-2.5 rounded-lg border font-mono text-[10px] leading-relaxed ${
                      msg.role === 'model'
                        ? (isDayMode ? 'bg-white border-neutral-200 text-neutral-700' : 'bg-black/40 border-ink-700/60 text-neutral-300')
                        : (isDayMode ? 'bg-gold-500/10 border-gold-500/30 text-gold-800' : 'bg-gold-500/10 border-gold-500/30 text-gold-200')
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
      </div>

      <div className={`px-4 py-2.5 border-t shrink-0 ${isDayMode ? 'border-neutral-200 bg-[#f5f4f0]' : 'border-ink-700/50 bg-ink-950'}`}>
        <button
          type="button"
          onClick={handleApplyAll}
          disabled={isLoading}
          className="w-full px-3 py-2 bg-gold-500 text-black font-extrabold text-[10px] tracking-wider uppercase rounded-md hover:bg-gold-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
        >
          <Cpu className="w-3.5 h-3.5" /> Apply All Suggestions
        </button>
      </div>

      <div className={`p-3 border-t shrink-0 ${isDayMode ? 'border-neutral-200 bg-white' : 'border-ink-700/50 bg-ink-950'}`}>
        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Gemini to optimize active nodes..."
            disabled={isLoading}
            className={`flex-1 min-w-0 px-3 py-2 rounded-md font-mono text-[11px] transition-colors ${
              isDayMode ? 'bg-white border border-neutral-300 text-neutral-900 focus:outline-none focus:border-gold-500/60 placeholder-neutral-400' : 'bg-black/40 border border-ink-700/70 text-white focus:outline-none focus:border-gold-500/60 placeholder-neutral-600'
            } disabled:opacity-40`}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-3 bg-gold-500 text-black font-extrabold rounded-md flex items-center justify-center transition-colors hover:bg-gold-400 cursor-pointer disabled:opacity-30"
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
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4 custom-scrollbar">
        <div className="space-y-2.5">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 ${msg.role === 'model' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[88%] p-2.5 rounded-lg border font-mono text-[10px] leading-relaxed ${
                msg.role === 'model'
                  ? (isDayMode ? 'bg-white border-neutral-200 text-neutral-700' : 'bg-black/40 border-ink-700/60 text-neutral-300')
                  : (isDayMode ? 'bg-gold-500/10 border-gold-500/30 text-gold-800' : 'bg-gold-500/10 border-gold-500/30 text-gold-200')
              }`}>
                <div className="markdown-body"><Markdown>{msg.text}</Markdown></div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className={`flex gap-2 justify-start`}>
              <div className={`max-w-[88%] p-2.5 rounded-lg border font-mono text-[10px] leading-relaxed ${isDayMode ? 'bg-white border-neutral-200 text-neutral-700' : 'bg-black/40 border-ink-700/60 text-neutral-300'}`}>
                <span className="flex items-center gap-2 text-gold-500/80">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Thinking (High)...
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>
      <div className={`p-3 border-t shrink-0 ${isDayMode ? 'border-neutral-200 bg-white' : 'border-ink-700/50 bg-ink-950'}`}>
        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(input); }} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="E.g. Add analog glitch and disable tracking..."
            disabled={isLoading}
            className={`flex-1 min-w-0 px-3 py-2 rounded-md font-mono text-[11px] transition-colors ${
              isDayMode ? 'bg-white border border-neutral-300 text-neutral-900 focus:outline-none focus:border-gold-500/60 placeholder-neutral-400' : 'bg-black/40 border border-ink-700/70 text-white focus:outline-none focus:border-gold-500/60 placeholder-neutral-600'
            } disabled:opacity-40`}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-3 bg-gold-500 text-black font-extrabold rounded-md flex items-center justify-center transition-colors hover:bg-gold-400 cursor-pointer disabled:opacity-30"
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
    <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4 custom-scrollbar">
      <div className={`p-4 border rounded-xl ${isDayMode ? 'bg-white border-neutral-200' : 'bg-black/40 border-ink-700/60'}`}>
        <h3 className="font-mono text-[11px] font-bold text-gold-500 uppercase tracking-widest mb-2 flex items-center gap-2">
          <Video className="w-4 h-4" /> Video Context Analyzer
        </h3>
        <p className={`font-mono text-[10px] leading-relaxed mb-4 ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>
          Uses Gemini 3.1 Pro Preview to deeply analyze the active video content and recommend optimal buffer sizes and scaling approaches for performance.
        </p>
        
        <div className={`p-3 rounded border mb-4 ${isDayMode ? 'bg-black/5 border-neutral-200 text-neutral-800' : 'bg-ink-950 border-ink-700 text-neutral-300'} font-mono text-[10px]`}>
          <span className="opacity-60 uppercase tracking-wider block mb-1">Active Input Source</span>
          <span className="font-bold">{compSource?.name || 'No video selected'}</span>
        </div>

        <button
          onClick={analyzeVideo}
          disabled={isLoading}
          className="w-full px-3 py-2 bg-neutral-800 text-white dark:bg-white dark:text-black font-extrabold text-[10px] tracking-wider uppercase rounded-md transition-opacity hover:opacity-80 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
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
