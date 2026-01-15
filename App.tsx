import React, { useState, useEffect, useRef } from 'react';
import { voxService, decodeBase64, decodeAudioData } from './services/gemini';
import { voxDB } from './services/db';
import { auth } from './services/auth';
import { db } from './services/database';
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

const VOX_USER_KEY = 'vox_user_identity';
const VOX_EDITIONS_KEY = 'vox_daily_editions_v2'; 
const VOX_VAULT_KEY = 'vox_vault_archive_v2';

const RichText: React.FC<{ text: string; language: string }> = ({ text, language }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-4 md:space-y-6">
      {lines.map((line, i) => {
        if (!line.trim()) return null;
        const isHeader = line.startsWith('#') || (line.toUpperCase() === line && line.length > 5 && !line.includes(':'));
        if (isHeader) return <h4 key={i} className="text-xl md:text-3xl font-serif font-bold text-white tracking-tight border-l-4 border-violet-600 pl-4 md:pl-6 my-6 md:my-10 animate-in slide-in-from-left">{line.replace(/#/g, '').trim()}</h4>;
        return <p key={i} className="text-base md:text-xl font-light leading-relaxed text-zinc-300 opacity-90">{line}</p>;
      })}
    </div>
  );
};

const Toast: React.FC<{ message: string; visible: boolean; onHide: () => void }> = ({ message, visible, onHide }) => {
  useEffect(() => { if (visible) { const timer = setTimeout(onHide, 3000); return () => clearTimeout(timer); } }, [visible, onHide]);
  if (!visible) return null;
  return <div className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 bg-violet-600 text-white px-8 py-4 rounded-2xl shadow-2xl z-[100] font-bold text-sm animate-in slide-in-from-bottom duration-300 flex items-center gap-3">{message}</div>;
};

const ShareModal: React.FC<{ 
  clip: { title: string, imageUrl: string | null, audio: string | null, text: string }, 
  language: string, onClose: () => void, autoGenerateVideo?: boolean 
}> = ({ clip, language, onClose, autoGenerateVideo }) => {
  const t = translations[language as keyof typeof translations] || translations.English;
  const [videoStatus, setVideoStatus] = useState<'idle' | 'generating' | 'ready'>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { if (autoGenerateVideo && clip.audio && clip.imageUrl) handleGenerateVideo(); }, [autoGenerateVideo]);

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>${clip.title}</title><style>body{font-family:serif;padding:40px;line-height:1.6;} h1{color:#8B5CF6;border-bottom:2px solid #eee;padding-bottom:10px;} img{max-width:100%;border-radius:12px;margin-bottom:20px;} p{white-space:pre-wrap;}</style></head><body>${clip.imageUrl ? `<img src="${clip.imageUrl}" />` : ''}<h1>${clip.title}</h1><p>${clip.text}</p></body></html>`);
    printWindow.document.close();
  };

  const handleGenerateVideo = async () => {
    if (!clip.audio || !clip.imageUrl) return;
    setVideoStatus('generating');
    const canvas = canvasRef.current!; const ctx = canvas.getContext('2d')!;
    canvas.width = 1280; canvas.height = 720;
    const img = new Image(); img.src = clip.imageUrl; await new Promise(r => img.onload = r);
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    const buffer = await decodeAudioData(decodeBase64(clip.audio), audioCtx);
    const source = audioCtx.createBufferSource(); source.buffer = buffer;
    const dest = audioCtx.createMediaStreamDestination(); source.connect(dest);
    const recorder = new MediaRecorder(new MediaStream([...(canvas as any).captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]), { mimeType: 'video/webm' });
    const chunks: Blob[] = []; recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => { setVideoUrl(URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }))); setVideoStatus('ready'); };
    recorder.start(); source.start();
    const start = Date.now(); const dur = buffer.duration * 1000;
    const render = () => {
      const elapsed = Date.now() - start; const prog = Math.min(1, elapsed / dur);
      ctx.drawImage(img, 0, 0, 1280, 720); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,1280,720);
      ctx.fillStyle='white'; ctx.font='bold 50px serif'; ctx.fillText(clip.title, 60, 150);
      ctx.fillStyle='#8B5CF6'; ctx.fillRect(60, 650, 1160 * prog, 15);
      if (elapsed < dur) requestAnimationFrame(render); else { recorder.stop(); audioCtx.close(); }
    }; render();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl animate-in fade-in">
      <div className="w-full max-w-5xl bg-zinc-950 border border-zinc-900 rounded-[3rem] overflow-hidden flex flex-col md:flex-row shadow-[0_0_100px_rgba(139,92,246,0.1)] relative max-h-[90vh]">
        <button onClick={onClose} className="absolute top-8 right-8 text-zinc-500 hover:text-white z-20"><svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        <div className="w-full md:w-1/2 p-12 bg-zinc-900/20 flex flex-col gap-8 justify-center items-center text-center">
          <div className="w-full aspect-video rounded-3xl overflow-hidden shadow-2xl border border-zinc-800 relative">
            {clip.imageUrl && <img src={clip.imageUrl} className="w-full h-full object-cover" />}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <h4 className="text-3xl font-serif font-bold text-white">{clip.title}</h4>
        </div>
        <div className="w-full md:w-1/2 p-12 flex flex-col justify-center gap-6">
          <button onClick={handleExportPDF} className="w-full p-8 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-violet-600 transition-all text-left flex items-center gap-6">
            <div className="w-16 h-16 bg-zinc-950 rounded-2xl flex items-center justify-center text-violet-500"><ICONS.FileText className="w-8 h-8" /></div>
            <div><p className="text-xl font-bold text-white">{t.exportPDF}</p><p className="text-sm text-zinc-600">Standard intelligence report.</p></div>
          </button>
          <button onClick={handleGenerateVideo} disabled={videoStatus === 'generating'} className="w-full p-8 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-violet-600 transition-all text-left flex items-center gap-6">
            <div className="w-16 h-16 bg-zinc-950 rounded-2xl flex items-center justify-center text-violet-500"><ICONS.Video className="w-8 h-8" /></div>
            <div><p className="text-xl font-bold text-white">{videoStatus === 'generating' ? 'SINTETIZANDO...' : t.generateVideo}</p><p className="text-sm text-zinc-600">Dynamic audiogram.</p></div>
          </button>
          {videoStatus === 'ready' && videoUrl && <a href={videoUrl} download="vox-intel.mp4" className="w-full py-6 bg-violet-600 text-white rounded-3xl font-black tracking-widest text-center">DOWNLOAD MP4</a>}
        </div>
      </div>
    </div>
  );
};

const InterrogationHub: React.FC<{ context: string, language: string, history: ChatMessage[], setHistory: (h: ChatMessage[]) => void }> = ({ context, language, history, setHistory }) => {
  const t = translations[language as keyof typeof translations] || translations.English;
  const [question, setQuestion] = useState(''); const [thinking, setThinking] = useState(false);
  const handleAsk = async () => {
    if (!question.trim()) return; setThinking(true); const q = question; setQuestion('');
    setHistory([...history, { role: 'user', text: q }]);
    try { const res = await voxService.interrogate(context, q, history, language); setHistory([...history, { role: 'user', text: q }, { role: 'model', text: res }]); } finally { setThinking(false); }
  };
  return (
    <div className="mt-12 border-t border-zinc-900 pt-12 space-y-8 pb-10">
      <div className="flex items-center gap-3"><ICONS.Podcast className="w-6 h-6 text-violet-600 animate-pulse" /><h4 className="text-xl font-serif font-bold">{t.interrogateIntel}</h4></div>
      <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {history.map((m, i) => (<div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] p-6 rounded-3xl ${m.role === 'user' ? 'bg-zinc-900 border border-zinc-800' : 'bg-violet-600/10 border border-violet-600/20'}`}><RichText text={m.text} language={language} /></div></div>))}
        {thinking && <div className="text-[10px] text-violet-500 font-mono animate-pulse">{t.aiThinking}</div>}
      </div>
      <div className="relative">
        <input type="text" placeholder={t.askSomething} className="w-full bg-zinc-950 border border-zinc-800 rounded-[2.5rem] py-6 px-8 focus:outline-none focus:border-violet-600" value={question} onChange={e => setQuestion(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleAsk()} />
        <button onClick={handleAsk} disabled={thinking} className="absolute right-3 top-3 bottom-3 px-6 bg-white text-black rounded-3xl font-black">ASK</button>
      </div>
    </div>
  );
};

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
  const [dailyEditions, setDailyEditions] = useState<Record<EditionType, DailyData | null>>({ [EditionType.MORNING]: null, [EditionType.MIDDAY]: null, [EditionType.EVENING]: null });
  const [savedClips, setSavedClips] = useState<SavedClip[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shareClip, setShareClip] = useState<{ title: string, imageUrl: string | null, audio: string | null, text: string, autoGenerate?: boolean } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [researchResult, setResearchResult] = useState<{ text: string, grounding: GroundingLink[] } | null>(null);
  const [step, setStep] = useState(0);
  const [showMobileSettings, setShowMobileSettings] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const t = translations[language as keyof typeof translations] || translations.English;

  // Authentication effect
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Check for existing session
        const currentUser = await auth.getCurrentUser();
        setAuthUser(currentUser);
        
        if (currentUser) {
          // Load user profile from database
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
            
            // Load user's saved clips from database
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
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setAuthLoading(false);
      }
    };
    
    initAuth();
    
    // Listen for auth state changes
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

  // Load cached data on mount
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

  const handleGenerateDaily = async (ed: EditionType) => {
    setLoading(true); setStatus(t.searching);
    try {
      const { text, grounding } = await voxService.fetchTrendingNews(region, language);
      setStatus(t.writingScript); 
      const script = await voxService.generatePodcastScript(text, language);
      setStatus("VOX SYNC..."); 
      const [audio, imageUrl, flash] = await Promise.all([
        voxService.generateAudio(script), 
        voxService.generateCoverArt(`News ${region} ${ed}`), 
        voxService.generateFlashSummary(text, language)
      ]);
      
      const newData: DailyData = { text, script, audio: audio || null, links: grounding, imageUrl, flashSummary: flash, chatHistory: [] };
      const updatedEditions = { ...dailyEditions, [ed]: newData };
      
      setDailyEditions(updatedEditions);
      await voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
      setStatus('');
    } catch (e: any) { 
      setStatus(''); 
      setToastMessage(e.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleConductResearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setStatus("AGENT DEPLOYING...");
    setStep(1); 
    try {
        const result = await voxService.conductResearch(searchQuery, "High", "Professional", region, language);
        if (result) {
          setResearchResult(result);
          setStep(2);
        }
    } catch (e: any) {
        setStep(0);
        setToastMessage("Search Agent failed. Try refining your query.");
    } finally {
        setLoading(false);
        setStatus('');
    }
  };

  const saveToVault = async (title: string, data: DailyData | { text: string, grounding: GroundingLink[] }, type: 'Daily' | 'Research') => {
    if (!authUser) {
      setToastMessage('Please log in to save clips');
      return;
    }
    
    try {
      // Save to Supabase database
      const clip = await db.saveClip(
        authUser.id,
        title,
        type,
        data.text,
        {
          flashSummary: (data as DailyData).flashSummary,
          audioUrl: (data as DailyData).audio,
          imageUrl: (data as DailyData).imageUrl,
          chatHistory: (data as DailyData).chatHistory,
        }
      );
      
      // Update local state
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
      setToastMessage(t.savedSuccess);
      
      // Also log usage analytics
      await db.logUsage(authUser.id, 'save_clip', { type, title });
    } catch (error) {
      console.error('Save to vault error:', error);
      setToastMessage('Failed to save. Please try again.');
    }
  };

  const removeFromVault = async (id: string) => {
    try {
      // Delete from Supabase database
      await db.deleteClip(id);
      
      // Update local state
      setSavedClips(prev => prev.filter(c => c.id !== id));
      setToastMessage(t.deletedSuccess);
    } catch (error) {
      console.error('Delete clip error:', error);
      setToastMessage('Failed to delete. Please try again.');
    }
  };

  const playAudio = async (data: string) => {
    if (isPlaying) { sourceNodeRef.current?.stop(); setIsPlaying(false); return; }
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current!;
      if (ctx.state === 'suspended') await ctx.resume();

      const decoded = decodeBase64(data);
      const buffer = await decodeAudioData(decoded, ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);
      source.start(0);
      sourceNodeRef.current = source;
      setIsPlaying(true);
    } catch (e) { 
      console.error("Playback Error:", e);
      setIsPlaying(false);
      setToastMessage("Playback failed. Please try again.");
    }
  };

  // Show loading screen while checking auth
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
  
  // Show authentication screens if not logged in
  if (!authUser) {
    if (authView === 'login') {
      return <LoginScreen onSwitchToSignup={() => setAuthView('signup')} />;
    } else {
      return <SignupScreen onSwitchToLogin={() => setAuthView('login')} />;
    }
  }
  
  // Add logout function
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

  const currentDaily = dailyEditions[activeTab];

  return (
    <div className="h-screen bg-[#050505] text-zinc-100 flex flex-col md:flex-row overflow-hidden font-sans">
      <Toast message={toastMessage || ''} visible={!!toastMessage} onHide={() => setToastMessage(null)} />
      {shareClip && <ShareModal clip={shareClip} language={language} onClose={() => setShareClip(null)} autoGenerateVideo={shareClip.autoGenerate} />}

      {/* Mobile Settings Modal */}
      {showMobileSettings && (
        <div className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-xl flex items-end animate-in fade-in md:hidden">
          <div className="w-full bg-zinc-950 rounded-t-[3rem] p-10 border-t border-zinc-800 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-2xl font-serif font-bold">{t.preferences}</h3>
              <button onClick={() => setShowMobileSettings(false)} className="p-3 bg-zinc-900 rounded-full"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-xs font-black text-zinc-600 uppercase tracking-widest">{t.region}</label>
                <select value={region} onChange={e => { setRegion(e.target.value); setShowMobileSettings(false); }} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-6 text-sm font-bold focus:outline-none appearance-none cursor-pointer">
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
                <select value={language} onChange={e => { setLanguage(e.target.value); setShowMobileSettings(false); }} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 px-6 text-sm font-bold focus:outline-none appearance-none cursor-pointer">
                  <option value="English">English</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      <aside className="hidden md:flex w-72 border-r border-zinc-900 flex-col p-8 gap-10 bg-zinc-950/20 shrink-0">
        <div className="flex items-center gap-3"><ICONS.Podcast className="w-8 h-8 text-violet-600" /><span className="text-2xl font-serif font-bold">VoxTrends</span></div>
        <nav className="flex-1 space-y-2">
          <button onClick={() => setView('dashboard')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${view === 'dashboard' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}><ICONS.Trend className="w-5 h-5" /><span className="font-bold">Dashboard</span></button>
          <button onClick={() => setView('profile')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${view === 'profile' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}><ICONS.FileText className="w-5 h-5" /><span className="font-bold">Profile & Vault</span></button>
          <button onClick={handleLogout} className="w-full flex items-center gap-4 p-4 rounded-2xl text-zinc-500 hover:text-red-400 transition-all">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="font-bold">Logout</span>
          </button>
        </nav>
        <div className="p-6 bg-zinc-900/50 rounded-3xl border border-zinc-800 space-y-4">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{t.region}</label>
            <select value={region} onChange={e => setRegion(e.target.value)} className="w-full bg-transparent text-xs font-bold focus:outline-none appearance-none cursor-pointer">
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
            <select value={language} onChange={e => setLanguage(e.target.value)} className="w-full bg-transparent text-xs font-bold focus:outline-none appearance-none cursor-pointer">
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
            </select>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="px-6 md:px-10 py-6 border-b border-zinc-900 flex justify-between items-center backdrop-blur-3xl bg-[#050505]/80 sticky top-0 z-50">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
               <h2 className="text-xl md:text-2xl font-serif font-bold uppercase tracking-widest">{view === 'dashboard' ? t.broadcastCenter : 'Identity Vault'}</h2>
               {/* Mobile Settings Toggle */}
               <button onClick={() => setShowMobileSettings(true)} className="md:hidden p-2 bg-zinc-900 rounded-lg text-zinc-400"><ICONS.Settings className="w-5 h-5" /></button>
            </div>
            {view === 'dashboard' && (
              <div className="flex gap-2">
                {[EditionType.MORNING, EditionType.MIDDAY, EditionType.EVENING].map(ed => (
                  <button key={ed} onClick={() => setActiveTab(ed)} className={`px-3 md:px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${activeTab === ed ? 'bg-violet-600 border-violet-600 text-white' : 'bg-transparent border-zinc-800 text-zinc-500'}`}>{ed}</button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
             {loading && <div className="text-[10px] font-mono text-violet-500 animate-pulse hidden md:block">{status}</div>}
             {/* Simple Profile Button for Mobile */}
             <button onClick={() => setView(view === 'profile' ? 'dashboard' : 'profile')} className="md:hidden p-3 bg-zinc-900 rounded-xl text-white">
                {view === 'profile' ? <ICONS.Trend className="w-5 h-5" /> : <ICONS.FileText className="w-5 h-5" />}
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-32">
          {view === 'dashboard' && (
            <div className="flex flex-col lg:grid lg:grid-cols-12 gap-10">
              <div className="lg:col-span-8 space-y-8">
                <section className="bg-zinc-900/10 border border-zinc-900 rounded-[3rem] p-8 md:p-12 relative overflow-hidden">
                  <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-12 relative z-10">
                    <div className="animate-in slide-in-from-top duration-700">
                        <span className="text-violet-500 text-[10px] font-black uppercase tracking-widest mb-2 block">{activeTab} Pulse // {region}</span>
                        <h3 className="text-4xl md:text-5xl font-serif font-bold tracking-tighter">{t.thePulse}</h3>
                    </div>
                    <div className="flex gap-4 items-center">
                      {currentDaily ? (
                        <>
                          <div className="flex flex-col gap-2">
                            <button onClick={() => setShareClip({ ...currentDaily, title: `${activeTab} Audio News`, autoGenerate: true })} className="px-6 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[9px] font-black tracking-widest text-violet-400 hover:border-violet-600 transition-all">AUDIO IMAGE</button>
                            <button onClick={() => saveToVault(`${activeTab} ${region} Broadcast`, currentDaily, 'Daily')} className="px-6 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[9px] font-black tracking-widest text-emerald-400 hover:border-emerald-600 transition-all">SAVE TO VAULT</button>
                          </div>
                          <button onClick={() => currentDaily.audio && playAudio(currentDaily.audio)} className="w-16 h-16 md:w-20 md:h-20 bg-white rounded-3xl flex items-center justify-center shadow-2xl hover:scale-105 transition-all text-black">
                            {isPlaying ? <ICONS.Pause className="w-8 h-8 md:w-10 md:h-10" /> : <ICONS.Play className="w-8 h-8 md:w-10 md:h-10 ml-1" />}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleGenerateDaily(activeTab)} disabled={loading} className="px-8 md:px-10 py-4 md:py-5 bg-white text-black font-black rounded-3xl hover:bg-violet-600 hover:text-white transition-all shadow-xl">{loading ? 'SYNCING...' : t.sync + ' ' + activeTab.toUpperCase()}</button>
                      )}
                    </div>
                  </div>

                  {currentDaily && (
                    <div className="space-y-10 animate-in fade-in duration-1000">
                      <div className="w-full aspect-video rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl relative group">
                        <img src={currentDaily.imageUrl || ''} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-8">
                           <p className="text-xs font-mono text-violet-400 tracking-widest uppercase">VOX HOSTS: JOE & JANE</p>
                        </div>
                      </div>
                      <RichText text={currentDaily.text} language={language} />
                      <InterrogationHub context={currentDaily.text} language={language} history={currentDaily.chatHistory || []} setHistory={async (h) => {
                        const updatedDaily = { ...currentDaily, chatHistory: h };
                        const updatedEditions = { ...dailyEditions, [activeTab]: updatedDaily };
                        setDailyEditions(updatedEditions);
                        await voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
                      }} />
                    </div>
                  )}
                  {!currentDaily && !loading && (
                    <div className="py-24 flex flex-col items-center justify-center text-zinc-800 opacity-20"><ICONS.Podcast className="w-20 h-20 mb-4" /><p className="font-serif italic text-lg">Broadcast offline. Sync to begin.</p></div>
                  )}
                </section>
              </div>

              <div className="lg:col-span-4 space-y-8">
                <section className="bg-zinc-950 border border-zinc-900 rounded-[3rem] p-8 md:p-10">
                  <h3 className="text-xl font-bold mb-8 flex items-center gap-3"><div className="w-2 h-2 bg-violet-600 rounded-full animate-ping" />{t.guidedResearcher}</h3>
                  {step === 0 && (
                    <div className="space-y-6 animate-in slide-in-from-right">
                      <h4 className="text-2xl font-serif font-bold">{t.targetTopic}</h4>
                      <input type="text" placeholder="e.g. AI Trends 2025" className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-6 px-8 text-lg focus:outline-none focus:border-violet-600" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleConductResearch()} />
                      <button onClick={handleConductResearch} disabled={loading} className="w-full py-5 bg-white text-black font-black rounded-3xl hover:bg-violet-600 hover:text-white transition-all">NEXT</button>
                    </div>
                  )}
                  {step === 1 && (
                    <div className="py-20 text-center space-y-6">
                        <div className="w-16 h-16 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto" />
                        <p className="text-violet-500 font-mono text-sm uppercase tracking-widest animate-pulse">Scanning social vectors...</p>
                    </div>
                  )}
                  {step === 2 && researchResult && (
                    <div className="space-y-8 animate-in fade-in">
                        <h4 className="text-2xl font-serif font-bold">Research Dossier</h4>
                        <div className="text-sm text-zinc-400 line-clamp-[10] border-l border-zinc-800 pl-4 italic">{researchResult.text}</div>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => saveToVault(`Research: ${searchQuery}`, researchResult, 'Research')} className="w-full py-4 bg-violet-600 text-white font-black rounded-2xl">SAVE DOSSIER</button>
                            <button onClick={() => { setStep(0); setResearchResult(null); }} className="w-full py-4 bg-zinc-900 text-zinc-500 font-bold rounded-2xl">NEW INVESTIGATION</button>
                        </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {view === 'profile' && user && (
            <div className="max-w-4xl mx-auto space-y-12 pb-20 animate-in fade-in">
                <section className="flex flex-col md:flex-row items-center gap-10 p-12 bg-zinc-900/20 border border-zinc-900 rounded-[3rem]">
                    <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-violet-600 shadow-2xl"><img src={user.avatar} className="w-full h-full object-cover" /></div>
                    <div className="space-y-2 text-center md:text-left">
                        <h3 className="text-4xl font-serif font-bold text-white">{user.name}</h3>
                        <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Vox Investigator // Since {user.memberSince}</p>
                        <div className="flex justify-center md:justify-start gap-4 pt-4">
                            <div className="px-4 py-2 bg-violet-600/10 border border-violet-600/20 rounded-xl"><p className="text-[10px] text-violet-500 font-black uppercase">Plan</p><p className="text-sm font-bold">{user.plan}</p></div>
                            <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl"><p className="text-[10px] text-zinc-500 font-black uppercase">Vault Storage</p><p className="text-sm font-bold">{savedClips.length} items</p></div>
                        </div>
                    </div>
                </section>

                <section className="space-y-8">
                    <h4 className="text-2xl font-serif font-bold flex items-center gap-4">Intelligence Vault <div className="h-[1px] flex-1 bg-zinc-900" /></h4>
                    {savedClips.length === 0 ? (
                        <div className="py-20 text-center bg-zinc-950 border border-dashed border-zinc-800 rounded-[3rem] text-zinc-600 font-serif italic">Your vault is currently empty. Start investigating to store intel here.</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {savedClips.map(clip => (
                                <div key={clip.id} className="p-8 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] hover:border-violet-600/50 transition-all group relative overflow-hidden">
                                    <div className="absolute top-4 right-4 flex gap-2">
                                        <button onClick={() => removeFromVault(clip.id)} className="p-2 bg-zinc-950 rounded-lg text-zinc-600 hover:text-red-500 transition-colors"><ICONS.Trash className="w-4 h-4" /></button>
                                    </div>
                                    <span className="text-[9px] font-black text-violet-500 uppercase tracking-widest mb-2 block">{clip.type} // {clip.date}</span>
                                    <h5 className="text-xl font-bold text-white mb-4">{clip.title}</h5>
                                    <div className="flex gap-4">
                                        {clip.audioData && (
                                            <button onClick={() => playAudio(clip.audioData!)} className="flex-1 py-3 bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-violet-600 hover:text-white transition-all">Play Briefing</button>
                                        )}
                                        <button onClick={() => setShareClip({ title: clip.title, audio: clip.audioData || null, imageUrl: clip.imageUrl || null, text: clip.text })} className="px-6 py-3 bg-zinc-950 text-zinc-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:text-white transition-all">Open Report</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
          )}
        </div>
      </main>

      {isPlaying && (
        <div className="fixed bottom-8 right-4 left-4 md:left-auto md:right-8 z-[150] md:w-80 bg-zinc-950 border border-violet-600/30 p-4 rounded-3xl shadow-2xl animate-in slide-in-from-right">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center animate-pulse"><ICONS.Podcast className="w-6 h-6 text-white" /></div>
            <div className="flex-1 overflow-hidden"><p className="text-[10px] font-black text-violet-500 uppercase">On Air</p><p className="text-xs font-bold truncate">Broadcast Intelligence</p></div>
            <button onClick={() => { sourceNodeRef.current?.stop(); setIsPlaying(false); }} className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white"><ICONS.Pause className="w-4 h-4" /></button>
          </div>
          <AudioVisualizer isPlaying={isPlaying} />
        </div>
      )}
    </div>
  );
};

export default App;
