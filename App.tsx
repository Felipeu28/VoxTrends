import React, { useState, useEffect, useRef } from 'react';
import { voxService, decodeBase64, decodeAudioData } from './services/gemini';
import { voxDB } from './services/db';
import { auth } from './services/auth';
import { db } from './services/database';
import { storage } from './services/storage';
import { ICONS, COLORS } from './constants';
import { EditionType, User, SavedClip, GroundingLink, ChatMessage } from './types';
import AudioVisualizer from './components/AudioVisualizer';
import { translations } from './translations';
import LoginScreen from './components/auth/LoginScreen';
import SignupScreen from './components/auth/SignupScreen';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface DailyData {
  text: string;
  script: string;
  audio: string | null;
  links: GroundingLink[];
  imageUrl: string | null;
  flashSummary?: string;
  chatHistory?: ChatMessage[];
}

// Convert base64 audio to blob URL for playback
const createAudioBlobUrl = (base64Audio: string): string => {
  try {
    // Decode base64
    const binaryString = atob(base64Audio.replace(/[\n\r\t\s]/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Create WAV file with headers
    const dataSize = bytes.length;
    const fileSize = 44 + dataSize;
    const wavBuffer = new ArrayBuffer(fileSize);
    const view = new DataView(wavBuffer);
    
    // WAV header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, fileSize - 8, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, 24000, true); // sample rate
    view.setUint32(28, 48000, true); // byte rate
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);
    
    const pcmData = new Uint8Array(wavBuffer, 44);
    pcmData.set(bytes);
    
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('Failed to create audio blob:', error);
    return '';
  }
};

const VOX_EDITIONS_KEY = 'vox_daily_editions_v2';

// ==================== HELPER COMPONENTS ====================

const RichText: React.FC<{ text: string; language: string }> = ({ text, language }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-4 md:space-y-6">
      {lines.map((line, i) => {
        if (!line.trim()) return null;
        const isHeader = line.startsWith('#') || (line.toUpperCase() === line && line.length > 5 && !line.includes(':'));
        if (isHeader) {
          return (
            <h4 key={i} className="text-xl md:text-3xl font-serif font-bold text-white tracking-tight border-l-4 border-violet-600 pl-4 md:pl-6 my-6 md:my-10 animate-in slide-in-from-left">
              {line.replace(/#/g, '').trim()}
            </h4>
          );
        }
        return <p key={i} className="text-base md:text-xl font-light leading-relaxed text-zinc-300 opacity-90">{line}</p>;
      })}
    </div>
  );
};

const Toast: React.FC<{ message: string; visible: boolean; onHide: () => void }> = ({ message, visible, onHide }) => {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(onHide, 3500);
      return () => clearTimeout(timer);
    }
  }, [visible, onHide]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 bg-violet-600 text-white px-8 py-4 rounded-2xl shadow-2xl z-[100] font-bold text-sm animate-in slide-in-from-bottom duration-300 flex items-center gap-3">
      {message}
    </div>
  );
};

// Enhanced Audio Player Component
// Enhanced Audio Player Component - Handles both URLs and base64
const AudioPlayer: React.FC<{ 
  audioData: string | null;  // Changed from audioUrl
  clipId: string;
  isPlaying: boolean;
  onPlayPause: () => void;
}> = ({ audioData, clipId, isPlaying, onPlayPause }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!audioData) return;
    
    // Check if it's a URL or base64
    if (audioData.startsWith('http')) {
      // It's already a URL from Supabase
      setAudioSrc(audioData);
    } else {
      // It's base64, convert to blob URL
      const blobUrl = createAudioBlobUrl(audioData);
      setAudioSrc(blobUrl);
      
      // Cleanup blob URL when component unmounts
      return () => URL.revokeObjectURL(blobUrl);
    }
  }, [audioData]);

  useEffect(() => {
    if (audioRef.current && audioSrc) {
      if (isPlaying) {
        audioRef.current.play().catch(err => console.error('Playback error:', err));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, audioSrc]);

  if (!audioSrc) return null;

  return (
    <>
      <audio ref={audioRef} src={audioSrc} preload="metadata" />
      <button 
        onClick={onPlayPause}
        className="w-16 h-16 md:w-20 md:h-20 bg-white rounded-3xl flex items-center justify-center shadow-2xl hover:scale-105 transition-all text-black"
      >
        {isPlaying ? <ICONS.Pause className="w-8 h-8 md:w-10 md:h-10" /> : <ICONS.Play className="w-8 h-8 md:w-10 md:h-10 ml-1" />}
      </button>
    </>
  );
};

// Progress Bar Component
const ProgressBar: React.FC<{ 
  loading: boolean; 
  status: string;
  estimatedDuration?: number;
}> = ({ loading, status, estimatedDuration = 25000 }) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!loading) {
      setProgress(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min(95, (elapsed / estimatedDuration) * 100);
      setProgress(newProgress);
    }, 100);

    return () => clearInterval(interval);
  }, [loading, estimatedDuration]);

  if (!loading) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-zinc-950/95 backdrop-blur-xl border-b border-violet-600/30">
      <div className="h-1 bg-zinc-900 overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-violet-600 to-purple-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border-3 border-violet-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-mono text-violet-400">{status}</p>
        </div>
        <p className="text-xs text-zinc-600">{Math.round(progress)}%</p>
      </div>
    </div>
  );
};

// Expandable Research Display
const ResearchDisplay: React.FC<{ 
  result: { text: string; grounding: GroundingLink[] };
  language: string;
}> = ({ result, language }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-6">
      <h4 className="text-2xl font-serif font-bold">Research Dossier</h4>
      
      <div className={`text-sm text-zinc-400 border-l border-zinc-800 pl-4 italic ${expanded ? '' : 'line-clamp-10'}`}>
        <RichText text={result.text} language={language} />
      </div>

      {result.text.split('\n').length > 10 && (
        <button 
          onClick={() => setExpanded(!expanded)}
          className="text-violet-400 hover:text-violet-300 text-sm font-bold"
        >
          {expanded ? '↑ Show Less' : '↓ Show More'}
        </button>
      )}

      {result.grounding && result.grounding.length > 0 && (
        <div className="space-y-3">
          <h5 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Verified Sources</h5>
          <div className="space-y-2">
            {result.grounding.map((link, i) => (
              <a 
                key={i}
                href={link.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-violet-600/50 transition-all group"
              >
                <p className="text-xs font-bold text-white group-hover:text-violet-400 truncate">{link.title}</p>
                <p className="text-[10px] text-zinc-600 truncate">{link.uri}</p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Auto-Scrolling Chat Component
const InterrogationHub: React.FC<{ 
  context: string;
  language: string;
  history: ChatMessage[];
  setHistory: (h: ChatMessage[]) => void;
}> = ({ context, language, history, setHistory }) => {
  const t = translations[language as keyof typeof translations] || translations.English;
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, collapsed]);

  const handleAsk = async () => {
    if (!question.trim()) return;
    
    setThinking(true);
    const q = question;
    setQuestion('');
    setHistory([...history, { role: 'user', text: q }]);

    try {
      const res = await voxService.interrogate(context, q, history, language);
      setHistory([...history, { role: 'user', text: q }, { role: 'model', text: res }]);
    } catch (error) {
      console.error('Interrogation error:', error);
      setHistory([...history, { role: 'user', text: q }, { role: 'model', text: 'Unable to process inquiry. Please try again.' }]);
    } finally {
      setThinking(false);
    }
  };

  if (history.length === 0) return null;

  return (
    <div className="mt-12 border-t border-zinc-900 pt-12 space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ICONS.Podcast className="w-6 h-6 text-violet-600 animate-pulse" />
          <h4 className="text-xl font-serif font-bold">{t.interrogateIntel}</h4>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-zinc-500 hover:text-white text-sm font-bold"
        >
          {collapsed ? '↓ Expand' : '↑ Collapse'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {history.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-6 rounded-3xl ${m.role === 'user' ? 'bg-zinc-900 border border-zinc-800' : 'bg-violet-600/10 border border-violet-600/20'}`}>
                  <RichText text={m.text} language={language} />
                </div>
              </div>
            ))}
            {thinking && (
              <div className="text-[10px] text-violet-500 font-mono animate-pulse">{t.aiThinking}</div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder={t.askSomething}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-[2.5rem] py-6 px-8 focus:outline-none focus:border-violet-600"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAsk()}
            />
            <button
              onClick={handleAsk}
              disabled={thinking}
              className="absolute right-3 top-3 bottom-3 px-6 bg-white text-black rounded-3xl font-black disabled:opacity-50"
            >
              ASK
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// Share Modal Component
// Enhanced Share Modal with Beautiful PDF Export
const ShareModal: React.FC<{ 
  clip: { title: string; imageUrl: string | null; audio: string | null; text: string };
  language: string;
  onClose: () => void;
}> = ({ clip, language, onClose }) => {
  const t = translations[language as keyof typeof translations] || translations.English;

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to export PDF');
      return;
    }
    
    // Create beautiful HTML for PDF
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${clip.title} - VoxTrends Intelligence Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Playfair+Display:wght@700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      line-height: 1.8;
      color: #1a1a1a;
      background: #ffffff;
      padding: 60px 80px;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      border-bottom: 4px solid #8B5CF6;
      padding-bottom: 30px;
      margin-bottom: 50px;
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    
    .logo-icon {
      width: 40px;
      height: 40px;
      background: #8B5CF6;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 20px;
    }
    
    .logo-text {
      font-family: 'Playfair Display', serif;
      font-size: 28px;
      font-weight: 700;
      color: #8B5CF6;
    }
    
    .report-type {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #6B7280;
      margin-bottom: 10px;
    }
    
    h1 {
      font-family: 'Playfair Display', serif;
      font-size: 42px;
      font-weight: 700;
      color: #111827;
      line-height: 1.2;
      margin-bottom: 20px;
    }
    
    .meta {
      display: flex;
      gap: 30px;
      font-size: 13px;
      color: #6B7280;
      margin-top: 20px;
    }
    
    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .meta-label {
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .cover-image {
      width: 100%;
      max-height: 500px;
      object-fit: cover;
      border-radius: 20px;
      margin: 40px 0;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.1);
    }
    
    .content {
      font-size: 16px;
      line-height: 1.9;
      color: #374151;
    }
    
    .content p {
      margin-bottom: 24px;
    }
    
    .content h2,
    .content h3,
    .content h4 {
      font-family: 'Playfair Display', serif;
      color: #111827;
      margin: 40px 0 20px 0;
      padding-left: 20px;
      border-left: 4px solid #8B5CF6;
    }
    
    .content h2 {
      font-size: 32px;
      margin-top: 60px;
    }
    
    .content h3 {
      font-size: 26px;
    }
    
    .content h4 {
      font-size: 20px;
    }
    
    .footer {
      margin-top: 80px;
      padding-top: 40px;
      border-top: 2px solid #E5E7EB;
      text-align: center;
      color: #9CA3AF;
      font-size: 12px;
    }
    
    .footer-logo {
      font-family: 'Playfair Display', serif;
      font-weight: 700;
      color: #8B5CF6;
      font-size: 16px;
      margin-bottom: 10px;
    }
    
    @media print {
      body {
        padding: 40px;
      }
      
      .cover-image {
        page-break-before: always;
        page-break-after: always;
      }
      
      .content h2 {
        page-break-after: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-icon">V</div>
      <div class="logo-text">VoxTrends</div>
    </div>
    
    <div class="report-type">Intelligence Report</div>
    <h1>${clip.title}</h1>
    
    <div class="meta">
      <div class="meta-item">
        <span class="meta-label">Generated:</span>
        <span>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Type:</span>
        <span>VoxTrends AI Analysis</span>
      </div>
    </div>
  </div>
  
  ${clip.imageUrl ? `<img src="${clip.imageUrl}" alt="Cover Image" class="cover-image" />` : ''}
  
  <div class="content">
    ${clip.text.split('\n\n').map(para => {
      if (para.startsWith('#')) {
        const level = para.match(/^#+/)?.[0].length || 2;
        const text = para.replace(/^#+\s*/, '');
        return `<h${level}>${text}</h${level}>`;
      }
      return `<p>${para}</p>`;
    }).join('')}
  </div>
  
  <div class="footer">
    <div class="footer-logo">VoxTrends</div>
    <p>This report was generated by VoxTrends AI Intelligence Platform</p>
    <p>© ${new Date().getFullYear()} VoxTrends. All rights reserved.</p>
  </div>
</body>
</html>
    `;
    
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    
    // Wait for content to load, then trigger print
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl animate-in fade-in">
      <div className="w-full max-w-5xl bg-zinc-950 border border-zinc-900 rounded-[3rem] overflow-hidden flex flex-col md:flex-row shadow-[0_0_100px_rgba(139,92,246,0.1)] relative max-h-[90vh]">
        <button
          onClick={onClose}
          className="absolute top-8 right-8 text-zinc-500 hover:text-white z-20"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="w-full md:w-1/2 p-12 bg-zinc-900/20 flex flex-col gap-8 justify-center items-center text-center">
          <div className="w-full aspect-video rounded-3xl overflow-hidden shadow-2xl border border-zinc-800 relative">
            {clip.imageUrl && <img src={clip.imageUrl} className="w-full h-full object-cover" alt={clip.title} />}
          </div>
          <h4 className="text-3xl font-serif font-bold text-white">{clip.title}</h4>
        </div>

        <div className="w-full md:w-1/2 p-12 flex flex-col justify-center gap-6">
          <button
            onClick={handleExportPDF}
            className="w-full p-8 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-violet-600 transition-all text-left flex items-center gap-6 group"
          >
            <div className="w-16 h-16 bg-zinc-950 rounded-2xl flex items-center justify-center text-violet-500 group-hover:bg-violet-600 group-hover:text-white transition-all">
              <ICONS.FileText className="w-8 h-8" />
            </div>
            <div>
              <p className="text-xl font-bold text-white group-hover:text-violet-400 transition-colors">{t.exportPDF}</p>
              <p className="text-sm text-zinc-600">Professional intelligence report with branding</p>
            </div>
          </button>
          
          <button
            onClick={() => {
              navigator.clipboard.writeText(clip.text);
              alert('Content copied to clipboard!');
            }}
            className="w-full p-8 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-emerald-600 transition-all text-left flex items-center gap-6 group"
          >
            <div className="w-16 h-16 bg-zinc-950 rounded-2xl flex items-center justify-center text-emerald-500 group-hover:bg-emerald-600 group-hover:text-white transition-all">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-white group-hover:text-emerald-400 transition-colors">Copy Text</p>
              <p className="text-sm text-zinc-600">Copy all content to clipboard</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
// ==================== MAIN APP COMPONENT ====================

const App: React.FC = () => {
  // Authentication state
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');
  const [authLoading, setAuthLoading] = useState(true);
  
  // Application state
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'landing' | 'dashboard' | 'profile'>('landing');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [region, setRegion] = useState('Global');
  const [language, setLanguage] = useState('English');
  const [activeTab, setActiveTab] = useState<EditionType>(EditionType.MORNING);
  const [dailyEditions, setDailyEditions] = useState<Record<EditionType, DailyData | null>>({
    [EditionType.MORNING]: null,
    [EditionType.MIDDAY]: null,
    [EditionType.EVENING]: null
  });
  const [savedClips, setSavedClips] = useState<SavedClip[]>([]);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shareClip, setShareClip] = useState<{ 
    title: string;
    imageUrl: string | null;
    audio: string | null;
    text: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [researchResult, setResearchResult] = useState<{ text: string; grounding: GroundingLink[] } | null>(null);
  const [step, setStep] = useState(0);
  const [showMobileSettings, setShowMobileSettings] = useState(false);

  const t = translations[language as keyof typeof translations] || translations.English;

  // ==================== AUTHENTICATION LOGIC ====================

  useEffect(() => {
    const initAuth = async () => {
      try {
        const currentUser = await auth.getCurrentUser();
        setAuthUser(currentUser);
        
        if (currentUser) {
          const profile = await db.getUser(currentUser.id);
          if (profile) {
            setUserProfile(profile);
            setUser({
              name: profile.name || 'User',
              email: profile.email,
              avatar: profile.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Vox',
              plan: profile.plan as 'Pro' | 'Free',
              memberSince: new Date(profile.created_at).getFullYear().toString(),
              region: profile.region,
              language: profile.language,
            });
            setRegion(profile.region);
            setLanguage(profile.language);
            setView('dashboard');
            
            // Load user's saved clips
            const clips = await db.getUserClips(currentUser.id);
            setSavedClips(clips.map(clip => ({
              id: clip.id,
              title: clip.title,
              date: new Date(clip.created_at).toLocaleDateString(),
              type: clip.clip_type,
              text: clip.content,
              imageUrl: clip.image_url,
              audioData: clip.audio_url,
              flashSummary: clip.flash_summary || '',
              chatHistory: clip.chat_history || [],
            })));

            // Update last login
            await db.updateLastLogin(currentUser.id);
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setAuthLoading(false);
      }
    };
    
    initAuth();
    
    const { data: { subscription } } = auth.onAuthStateChange(async (user) => {
      setAuthUser(user);
      if (user) {
        const profile = await db.getUser(user.id);
        if (profile) {
          setUserProfile(profile);
          setUser({
            name: profile.name || 'User',
            email: profile.email,
            avatar: profile.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Vox',
            plan: profile.plan as 'Pro' | 'Free',
            memberSince: new Date(profile.created_at).getFullYear().toString(),
            region: profile.region,
            language: profile.language,
          });
          setView('dashboard');
        }
      } else {
        setUserProfile(null);
        setUser(null);
        setView('landing');
      }
    });
    
    return () => subscription.unsubscribe();
  }, []);

  // Load cached editions on mount
  useEffect(() => {
    const init = async () => {
      const dbEditions = await voxDB.get(VOX_EDITIONS_KEY);
      if (dbEditions) setDailyEditions(dbEditions);

      const h = new Date().getHours();
      if (h < 12) setActiveTab(EditionType.MORNING);
      else if (h < 18) setActiveTab(EditionType.MIDDAY);
      else setActiveTab(EditionType.EVENING);
    };
    init();
  }, []);

  // ==================== MAIN FUNCTIONS ====================

  const handleGenerateDaily = async (ed: EditionType) => {
    if (!authUser) {
      setToastMessage('Please log in to generate editions');
      return;
    }

    setLoading(true);
    setStatus('Checking for cached edition...');
    
    try {
      // Check for cached edition
      const cached = await db.getCachedEdition(ed, region, language);
      
      if (cached && cached.expires_at && new Date(cached.expires_at) > new Date()) {
        setStatus('Loading cached edition...');
        
        const cachedData: DailyData = {
          text: cached.content,
          script: cached.script,
          audio: cached.audio_url,
          links: cached.grounding_links || [],
          imageUrl: cached.image_url,
          flashSummary: cached.flash_summary || undefined,
          chatHistory: [],
        };
        
        const updatedEditions = { ...dailyEditions, [ed]: cachedData };
        setDailyEditions(updatedEditions);
        await voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
        
        setToastMessage(`✨ Using cached ${ed} edition for ${region} (${language})`);
        setStatus('');
        setLoading(false);
        
        await db.logUsage(authUser.id, 'cache_hit', { edition: ed, region, language });
        return;
      }
      
      // Generate fresh edition
      setStatus('Searching trending news...');
      const { text, grounding } = await voxService.fetchTrendingNews(region, language);
      
      setStatus('Writing broadcast script...');
      const script = await voxService.generatePodcastScript(text, language);
      
      setStatus('Generating audio & cover art...');
      const [rawAudio, imageUrl, flash] = await Promise.all([
        voxService.generateAudio(script),
        voxService.generateCoverArt(`News ${region} ${ed}`),
        voxService.generateFlashSummary(text, language)
      ]);

      let audioUrl: string | undefined;

      // Upload audio to Supabase Storage
      if (rawAudio) {
        setStatus('Uploading audio to cloud...');
        try {
          audioUrl = await storage.uploadAudio(
            authUser.id,
            rawAudio,
            `${ed}-${region}-${language}-${Date.now()}`
          );
        } catch (error) {
          console.error('Audio upload error:', error);
        }
      }

      let uploadedImageUrl: string | undefined;

      // Upload image to Supabase Storage
      if (imageUrl) {
        setStatus('Uploading cover art to cloud...');
        try {
          uploadedImageUrl = await storage.uploadImage(
            authUser.id,
            imageUrl,
            `${ed}-${region}-${language}-${Date.now()}`
          );
        } catch (error) {
          console.error('Image upload error:', error);
          uploadedImageUrl = imageUrl; // Fallback to base64
        }
      }
      
      // Cache the generated edition
      setStatus('Caching for other users...');
      await db.cacheEdition(ed, region, language, text, script, {
        audioUrl: audioUrl,
        imageUrl: uploadedImageUrl,
        groundingLinks: grounding,
        flashSummary: flash,
      });
      
      const newData: DailyData = {
        text,
        script,
        audio: audioUrl || null,
        links: grounding,
        imageUrl: uploadedImageUrl || null,
        flashSummary: flash,
        chatHistory: []
      };
      
      const updatedEditions = { ...dailyEditions, [ed]: newData };
      setDailyEditions(updatedEditions);
      await voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
      
      setToastMessage(`🎉 ${ed} edition generated for ${region} (${language})!`);
      setStatus('');
      
      await db.logUsage(authUser.id, 'generate_edition', {
        edition: ed,
        region,
        language,
        cost_estimate: 0.10
      }, 0.10);
      
    } catch (e: any) {
      console.error('Generate edition error:', e);
      setStatus('');
      setToastMessage(e.message || 'Failed to generate edition. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConductResearch = async () => {
    if (!searchQuery.trim() || !authUser) return;
    
    setLoading(true);
    setStatus('Deploying research agent...');
    setStep(1);
    
    try {
      const result = await voxService.conductResearch(searchQuery, 'High', 'Professional', region, language);
      if (result) {
        setResearchResult(result);
        setStep(2);
        await db.logUsage(authUser.id, 'research_query', { query: searchQuery });
      }
    } catch (e: any) {
      console.error('Research error:', e);
      setStep(0);
      setToastMessage('Research failed. Please try refining your query.');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  const saveToVault = async (
    title: string,
    data: DailyData | { text: string; grounding: GroundingLink[] },
    type: 'Daily' | 'Research'
  ) => {
    if (!authUser) {
      setToastMessage('Please log in to save clips');
      return;
    }
    
    try {
      setLoading(true);
      setStatus('Saving to vault...');
      
      let audioUrl: string | undefined;
      let imageUrl: string | undefined;
      
      if ((data as DailyData).audio) {
        setStatus('Uploading audio to cloud...');
        try {
          // If it's already a URL, use it directly
          if ((data as DailyData).audio!.startsWith('http')) {
            audioUrl = (data as DailyData).audio!;
          } else {
            audioUrl = await storage.uploadAudio(
              authUser.id,
              (data as DailyData).audio!,
              `${type}-${Date.now()}`
            );
          }
        } catch (error) {
          console.error('Audio upload error:', error);
        }
      }
      
      if ((data as DailyData).imageUrl) {
        setStatus('Uploading image to cloud...');
        try {
          imageUrl = await storage.uploadImage(
            authUser.id,
            (data as DailyData).imageUrl!,
            `${type}-${Date.now()}`
          );
        } catch (error) {
          console.error('Image upload error:', error);
        }
      }
      
      setStatus('Saving metadata...');
      const clip = await db.saveClip(
        authUser.id,
        title,
        type,
        data.text,
        {
          flashSummary: (data as DailyData).flashSummary,
          audioUrl: audioUrl,
          imageUrl: imageUrl,
          chatHistory: (data as DailyData).chatHistory,
        }
      );
      
      const newClip: SavedClip = {
        id: clip.id,
        title: clip.title,
        date: new Date(clip.created_at).toLocaleDateString(),
        type: clip.clip_type,
        text: clip.content,
        imageUrl: clip.image_url,
        audioData: clip.audio_url,
        flashSummary: clip.flash_summary || '',
        chatHistory: clip.chat_history || [],
      };
      
      setSavedClips(prev => [newClip, ...prev]);
      setToastMessage('✅ Saved to cloud vault!');
      setStatus('');
      
      await db.logUsage(authUser.id, 'save_clip', { type, title });
      
    } catch (error) {
      console.error('Save to vault error:', error);
      setToastMessage('Failed to save. Please try again.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const removeFromVault = async (id: string) => {
    try {
      await db.deleteClip(id);
      setSavedClips(prev => prev.filter(c => c.id !== id));
      setToastMessage(t.deletedSuccess);
    } catch (error) {
      console.error('Delete clip error:', error);
      setToastMessage('Failed to delete. Please try again.');
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setUser(null);
      setUserProfile(null);
      setView('landing');
      setToastMessage('Logged out successfully');
    } catch (error) {
      console.error('Logout error:', error);
      setToastMessage('Failed to log out');
    }
  };

  // ==================== RENDER ====================

  if (authLoading) {
    return (
      <div className="h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 bg-violet-600 rounded-[2rem] flex items-center justify-center mb-6 mx-auto shadow-2xl shadow-violet-600/30 animate-pulse">
            <ICONS.Podcast className="w-12 h-12 text-white" />
          </div>
          <p className="text-zinc-500 font-mono text-sm">Loading VoxTrends...</p>
        </div>
      </div>
    );
  }
  
  if (!authUser) {
    if (authView === 'login') {
      return <LoginScreen onSwitchToSignup={() => setAuthView('signup')} />;
    } else {
      return <SignupScreen onSwitchToLogin={() => setAuthView('login')} />;
    }
  }

  const currentDaily = dailyEditions[activeTab];

  return (
    <div className="h-screen bg-[#050505] text-zinc-100 flex flex-col md:flex-row overflow-hidden font-sans">
      <Toast message={toastMessage || ''} visible={!!toastMessage} onHide={() => setToastMessage(null)} />
      <ProgressBar loading={loading} status={status} />
      
      {shareClip && (
        <ShareModal 
          clip={shareClip}
          language={language}
          onClose={() => setShareClip(null)}
        />
      )}

      {/* Mobile Settings Modal */}
      {showMobileSettings && (
        <div className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-xl flex items-end animate-in fade-in md:hidden">
          <div className="w-full bg-zinc-950 rounded-t-[3rem] p-10 border-t border-zinc-800 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-2xl font-serif font-bold">{t.preferences}</h3>
              <button onClick={() => setShowMobileSettings(false)} className="p-3 bg-zinc-900 rounded-full">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-xs font-black text-zinc-600 uppercase tracking-widest">{t.region}</label>
                <select
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value);
                    if (authUser && userProfile) {
                      db.updateUser(authUser.id, { region: e.target.value });
                    }
                    setShowMobileSettings(false);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-6 text-sm font-bold focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="Global">Global</option>
                  <option value="USA">United States</option>
                  <option value="Colombia">Colombia</option>
                  <option value="Mexico">Mexico</option>
                  <option value="Spain">Spain</option>
                  <option value="Venezuela">Venezuela</option>
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-xs font-black text-zinc-600 uppercase tracking-widest">{t.language}</label>
                <select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    if (authUser && userProfile) {
                      db.updateUser(authUser.id, { language: e.target.value });
                    }
                    setShowMobileSettings(false);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-6 text-sm font-bold focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="English">English</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="hidden md:flex w-72 border-r border-zinc-900 flex-col p-8 gap-10 bg-zinc-950/20 shrink-0">
        <div className="flex items-center gap-3">
          <ICONS.Podcast className="w-8 h-8 text-violet-600" />
          <span className="text-2xl font-serif font-bold">VoxTrends</span>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => setView('dashboard')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${view === 'dashboard' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            <ICONS.Trend className="w-5 h-5" />
            <span className="font-bold">Dashboard</span>
          </button>

          <button
            onClick={() => setView('profile')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${view === 'profile' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            <ICONS.FileText className="w-5 h-5" />
            <span className="font-bold">Profile & Vault</span>
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-4 p-4 rounded-2xl text-zinc-500 hover:text-red-400 transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="font-bold">Logout</span>
          </button>
        </nav>

        <div className="p-6 bg-zinc-900/50 rounded-3xl border border-zinc-800 space-y-4">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{t.region}</label>
            <select
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                if (authUser && userProfile) {
                  db.updateUser(authUser.id, { region: e.target.value });
                }
              }}
              className="w-full bg-transparent text-xs font-bold focus:outline-none appearance-none cursor-pointer"
            >
              <option value="Global">Global</option>
              <option value="USA">United States</option>
              <option value="Colombia">Colombia</option>
              <option value="Mexico">Mexico</option>
              <option value="Spain">Spain</option>
              <option value="Venezuela">Venezuela</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{t.language}</label>
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                if (authUser && userProfile) {
                  db.updateUser(authUser.id, { language: e.target.value });
                }
              }}
              className="w-full bg-transparent text-xs font-bold focus:outline-none appearance-none cursor-pointer"
            >
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
            </select>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="px-6 md:px-10 py-6 border-b border-zinc-900 flex justify-between items-center backdrop-blur-3xl bg-[#050505]/80 sticky top-0 z-50">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-xl md:text-2xl font-serif font-bold uppercase tracking-widest">
                {view === 'dashboard' ? t.broadcastCenter : 'Intelligence Vault'}
              </h2>
              <button
                onClick={() => setShowMobileSettings(true)}
                className="md:hidden p-2 bg-zinc-900 rounded-lg text-zinc-400"
              >
                <ICONS.Settings className="w-5 h-5" />
              </button>
            </div>

            {view === 'dashboard' && (
              <div className="flex gap-2">
                {[EditionType.MORNING, EditionType.MIDDAY, EditionType.EVENING].map(ed => (
                  <button
                    key={ed}
                    onClick={() => setActiveTab(ed)}
                    className={`px-3 md:px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                      activeTab === ed
                        ? 'bg-violet-600 border-violet-600 text-white'
                        : 'bg-transparent border-zinc-800 text-zinc-500'
                    }`}
                  >
                    {ed}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setView(view === 'profile' ? 'dashboard' : 'profile')}
              className="md:hidden p-3 bg-zinc-900 rounded-xl text-white"
            >
              {view === 'profile' ? <ICONS.Trend className="w-5 h-5" /> : <ICONS.FileText className="w-5 h-5" />}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-64 md:pb-32">
          {/* Dashboard View */}
          {view === 'dashboard' && (
            <div className="flex flex-col lg:grid lg:grid-cols-12 gap-10">
              {/* Main Broadcast Section */}
              <div className="lg:col-span-8 space-y-8">
                <section className="bg-zinc-900/10 border border-zinc-900 rounded-[3rem] p-8 md:p-12 relative overflow-hidden">
                  <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-12 relative z-10">
                    <div className="animate-in slide-in-from-top duration-700">
                      <span className="text-violet-500 text-[10px] font-black uppercase tracking-widest mb-2 block">
                        {activeTab} Pulse // {region}
                      </span>
                      <h3 className="text-4xl md:text-5xl font-serif font-bold tracking-tighter">{t.thePulse}</h3>
                    </div>

                    <div className="flex gap-4 items-center">
                      {currentDaily ? (
                        <>
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => saveToVault(`${activeTab} ${region} Broadcast`, currentDaily, 'Daily')}
                              className="px-6 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[9px] font-black tracking-widest text-emerald-400 hover:border-emerald-600 transition-all"
                            >
                              SAVE TO VAULT
                            </button>
                          </div>

                          <AudioPlayer
                            audioData={currentDaily.audio}
                            clipId={`edition-${activeTab}`}
                            isPlaying={playingClipId === `edition-${activeTab}`}
                            onPlayPause={() => {
                              if (playingClipId === `edition-${activeTab}`) {
                                setPlayingClipId(null);
                              } else {
                                setPlayingClipId(`edition-${activeTab}`);
                              }
                            }}
                          />
                        </>
                      ) : (
                        <button
                          onClick={() => handleGenerateDaily(activeTab)}
                          disabled={loading}
                          className="px-8 md:px-10 py-4 md:py-5 bg-white text-black font-black rounded-3xl hover:bg-violet-600 hover:text-white transition-all shadow-xl disabled:opacity-50"
                        >
                          {loading ? 'SYNCING...' : `${t.sync} ${activeTab.toUpperCase()}`}
                        </button>
                      )}
                    </div>
                  </div>

                  {currentDaily && (
                    <div className="space-y-10 animate-in fade-in duration-1000">
                      <div className="w-full aspect-video rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl relative group">
                        {currentDaily.imageUrl && (
                          <img
                            src={currentDaily.imageUrl}
                            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                            alt={`${activeTab} Edition`}
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-8">
                          <p className="text-xs font-mono text-violet-400 tracking-widest uppercase">
                            VOX HOSTS: JOE & JANE
                          </p>
                        </div>
                      </div>

                      <RichText text={currentDaily.text} language={language} />

                      {/* Grounding Links */}
                      {currentDaily.links && currentDaily.links.length > 0 && (
                        <div className="space-y-4 border-t border-zinc-900 pt-8">
                          <h5 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Verified Sources</h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {currentDaily.links.map((link, i) => (
                              <a
                                key={i}
                                href={link.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-violet-600/50 transition-all group"
                              >
                                <p className="text-xs font-bold text-white group-hover:text-violet-400 truncate">
                                  {link.title}
                                </p>
                                <p className="text-[10px] text-zinc-600 truncate">{link.uri}</p>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      <InterrogationHub
                        context={currentDaily.text}
                        language={language}
                        history={currentDaily.chatHistory || []}
                        setHistory={async (h) => {
                          const updatedDaily = { ...currentDaily, chatHistory: h };
                          const updatedEditions = { ...dailyEditions, [activeTab]: updatedDaily };
                          setDailyEditions(updatedEditions);
                          await voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
                        }}
                      />
                    </div>
                  )}

                  {!currentDaily && !loading && (
                    <div className="py-24 flex flex-col items-center justify-center text-zinc-800 opacity-20">
                      <ICONS.Podcast className="w-20 h-20 mb-4" />
                      <p className="font-serif italic text-lg">Broadcast offline. Sync to begin.</p>
                    </div>
                  )}
                </section>
              </div>

              {/* Research Panel */}
              <div className="lg:col-span-4 space-y-8">
                <section className="bg-zinc-950 border border-zinc-900 rounded-[3rem] p-8 md:p-10">
                  <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                    <div className="w-2 h-2 bg-violet-600 rounded-full animate-ping" />
                    {t.guidedResearcher}
                  </h3>

                  {step === 0 && (
                    <div className="space-y-6 animate-in slide-in-from-right">
                      <h4 className="text-2xl font-serif font-bold">{t.targetTopic}</h4>
                      <input
                        type="text"
                        placeholder="e.g. AI Trends 2025"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-6 px-8 text-lg focus:outline-none focus:border-violet-600"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleConductResearch()}
                      />
                      <button
                        onClick={handleConductResearch}
                        disabled={loading}
                        className="w-full py-5 bg-white text-black font-black rounded-3xl hover:bg-violet-600 hover:text-white transition-all disabled:opacity-50"
                      >
                        RESEARCH
                      </button>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="py-20 text-center space-y-6">
                      <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="text-violet-500 font-mono text-sm uppercase tracking-widest animate-pulse">
                        Scanning social vectors...
                      </p>
                    </div>
                  )}

                  {step === 2 && researchResult && (
                    <div className="space-y-8 animate-in fade-in">
                      <ResearchDisplay result={researchResult} language={language} />
                      
                      <div className="flex flex-col gap-3">
                        <button
                          onClick={() => saveToVault(`Research: ${searchQuery}`, researchResult, 'Research')}
                          className="w-full py-4 bg-violet-600 text-white font-black rounded-2xl hover:bg-violet-700 transition-all"
                        >
                          SAVE DOSSIER
                        </button>
                        <button
                          onClick={() => {
                            setStep(0);
                            setResearchResult(null);
                            setSearchQuery('');
                          }}
                          className="w-full py-4 bg-zinc-900 text-zinc-500 font-bold rounded-2xl hover:text-white transition-all"
                        >
                          NEW INVESTIGATION
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {/* Profile/Vault View */}
          {view === 'profile' && user && (
            <div className="max-w-4xl mx-auto space-y-12 pb-20 animate-in fade-in">
              <section className="flex flex-col md:flex-row items-center gap-10 p-12 bg-zinc-900/20 border border-zinc-900 rounded-[3rem]">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-violet-600 shadow-2xl">
                  <img src={user.avatar} className="w-full h-full object-cover" alt={user.name} />
                </div>
                <div className="space-y-2 text-center md:text-left">
                  <h3 className="text-4xl font-serif font-bold text-white">{user.name}</h3>
                  <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">
                    Vox Investigator // Since {user.memberSince}
                  </p>
                  <div className="flex justify-center md:justify-start gap-4 pt-4">
                    <div className="px-4 py-2 bg-violet-600/10 border border-violet-600/20 rounded-xl">
                      <p className="text-[10px] text-violet-500 font-black uppercase">Plan</p>
                      <p className="text-sm font-bold">{user.plan}</p>
                    </div>
                    <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] text-zinc-500 font-black uppercase">Vault Storage</p>
                      <p className="text-sm font-bold">{savedClips.length} items</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-8">
                <h4 className="text-2xl font-serif font-bold flex items-center gap-4">
                  Intelligence Vault
                  <div className="h-[1px] flex-1 bg-zinc-900" />
                </h4>

                {savedClips.length === 0 ? (
                  <div className="py-20 text-center bg-zinc-950 border border-dashed border-zinc-800 rounded-[3rem] text-zinc-600 font-serif italic">
                    Your vault is currently empty. Start investigating to store intel here.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {savedClips.map(clip => (
                      <div
                        key={clip.id}
                        className="p-8 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] hover:border-violet-600/50 transition-all group relative overflow-hidden"
                      >
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button
                            onClick={() => removeFromVault(clip.id)}
                            className="p-2 bg-zinc-950 rounded-lg text-zinc-600 hover:text-red-500 transition-colors"
                          >
                            <ICONS.Trash className="w-4 h-4" />
                          </button>
                        </div>

                        <span className="text-[9px] font-black text-violet-500 uppercase tracking-widest mb-2 block">
                          {clip.type} // {clip.date}
                        </span>
                        <h5 className="text-xl font-bold text-white mb-4">{clip.title}</h5>

                        <div className="flex gap-4">
                          {clip.audioData && (
                            <button
                              onClick={() => {
                                if (playingClipId === clip.id) {
                                  setPlayingClipId(null);
                                } else {
                                  setPlayingClipId(clip.id);
                                }
                              }}
                              className="flex-1 py-3 bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-violet-600 hover:text-white transition-all"
                            >
                              {playingClipId === clip.id ? 'PAUSE' : 'PLAY'}
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setShareClip({
                                title: clip.title,
                                audio: clip.audioData || null,
                                imageUrl: clip.imageUrl || null,
                                text: clip.text,
                              })
                            }
                            className="px-6 py-3 bg-zinc-950 text-zinc-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:text-white transition-all"
                          >
                            OPEN
                          </button>
                        </div>

                        {/* Hidden Audio Element for Playback */}
                        {clip.audioData && (
                          <AudioPlayer
                          audioData={currentDaily.audio}
                            clipId={clip.id}
                            isPlaying={playingClipId === clip.id}
                            onPlayPause={() => {
                              if (playingClipId === clip.id) {
                                setPlayingClipId(null);
                              } else {
                                setPlayingClipId(clip.id);
                              }
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>

      {/* Floating Audio Player */}
      {playingClipId && (
        <div className="fixed bottom-8 right-4 left-4 md:left-auto md:right-8 z-[150] md:w-80 bg-zinc-950 border border-violet-600/30 p-4 rounded-3xl shadow-2xl animate-in slide-in-from-right">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center animate-pulse">
              <ICONS.Podcast className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-[10px] font-black text-violet-500 uppercase">On Air</p>
              <p className="text-xs font-bold truncate">Broadcast Intelligence</p>
            </div>
            <button
              onClick={() => setPlayingClipId(null)}
              className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white"
            >
              <ICONS.Pause className="w-4 h-4" />
            </button>
          </div>
          <AudioVisualizer isPlaying={true} />
        </div>
      )}
    </div>
  );
};

export default App;
