'use client';

import { useEffect, useState, useRef } from 'react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { StreamingAudioPlayer } from '@/utils/AudioPlayer';
import { offlineAllergyCheck } from '@/utils/offlineProtocols';
import { Mic, Activity, ShieldAlert, Heart, Droplet, FileText, Globe, UserRound, CheckCircle2, Circle, PhoneCall, MapPin, Camera, Plane, Syringe, X } from 'lucide-react';

export default function AmbulanceDashboard() {
  const [appState, setAppState] = useState<'IDLE' | 'RINGING' | 'DISPATCH' | 'ACTIVE'>('IDLE');
  const [lang, setLang] = useState('en-US');
  const { isListening, transcript, interimTranscript, startListening, stopListening, clearTranscript, hasSupport } = useSpeechRecognition(lang);
  
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [aiResponse, setAiResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // God Mode States
  const [demoMode, setDemoMode] = useState('NORMAL');
  const [vitals, setVitals] = useState({ hr: 75, spo2: 98, bpSys: 120, bpDia: 80 });
  const [patientProfile, setPatientProfile] = useState({ name: "John Doe", age: 42, weight: "85kg", allergies: "Penicillin", history: "Hypertension" });
  const [isEditingPatient, setIsEditingPatient] = useState(false);
  
    // God-Tier Pipeline & Predictive States
  const [pipelineSteps, setPipelineSteps] = useState<{id: string, name: string, ms: string, status: 'pending'|'done'|'error', color?: string}[]>([]);
  const [vitalsPrediction, setVitalsPrediction] = useState<{ active: boolean, type: 'vfib' | 'anaphylaxis', probability: number, text: string, countdown: number } | null>(null);

  // Advanced States
  const [flashWhite, setFlashWhite] = useState(false);
  const [triage, setTriage] = useState('UNASSIGNED');
  const [tasks, setTasks] = useState<{id: string, text: string, done: boolean}[]>([]);
  const [traumaZones, setTraumaZones] = useState({ head: false, chest: false, l_arm: false, r_arm: false, l_leg: false, r_leg: false });
  const [medevacActive, setMedevacActive] = useState(false);
  const [drugDose, setDrugDose] = useState<{drug: string, dose: string} | null>(null);
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [etaSeconds, setEtaSeconds] = useState(420);
  const [destination, setDestination] = useState('General Hospital');
  
  const [judgeMode, setJudgeMode] = useState(false);
  const prevHrRef = useRef(75);
  // Level 7: Tactical Multi-Cam
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);
  const videoRef3 = useRef<HTMLVideoElement>(null);
  const videoRef4 = useRef<HTMLVideoElement>(null);
  
  const flatlineOscillator = useRef<any>(null);
  const audioCtx = useRef<any>(null);
  
  const [chatHistory, setChatHistory] = useState<{role: string, content: string}[]>([]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportData, setReportData] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [mossStats, setMossStats] = useState<{latency_ms: number, protocol: string, session_turns: number} | null>(null);
  const [persona, setPersona] = useState('PARAMEDIC');
  const [e2eLatency, setE2eLatency] = useState<number | null>(null);
  
  const audioPlayerRef = useRef<StreamingAudioPlayer | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // ── BUG 2 FIX: isProcessing Watchdog Timeout ──
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isProcessing) {
      timeout = setTimeout(() => {
        setIsProcessing(false);
        setPipelineSteps(prev => [...prev, { id: 'timeout', name: 'UI Lock Timeout (Backend Stalled)', ms: '15000', status: 'done', color: 'text-red-500' }]);
      }, 15000);
    }
    return () => clearTimeout(timeout);
  }, [isProcessing]);

  const reconnectAttempts = useRef<number>(0);
  const defibTimerRef = useRef<NodeJS.Timeout | null>(null);
  const medevacTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => { 
        if (audioCtx.current) audioCtx.current.close(); 
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (defibTimerRef.current) clearTimeout(defibTimerRef.current);
        if (medevacTimerRef.current) clearTimeout(medevacTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    let streamRef: MediaStream | null = null;
    
    if (appState === 'ACTIVE' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => { 
            streamRef = stream;
            if (videoRef1.current) videoRef1.current.srcObject = stream; 
            if (videoRef2.current) videoRef2.current.srcObject = stream; 
            if (videoRef3.current) videoRef3.current.srcObject = stream; 
            if (videoRef4.current) videoRef4.current.srcObject = stream; 
        })
        .catch(e => console.log("Webcam err", e));
    }
    return () => {
        clearInterval(timer);
        if (streamRef) streamRef.getTracks().forEach(track => track.stop());
    };
  }, [appState]);

  useEffect(() => {
    const timer = setInterval(() => setEtaSeconds(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!vitalsPrediction?.active) return;
    const t = setInterval(() => {
      setVitalsPrediction(prev => prev ? ({ ...prev, countdown: Math.max(0, prev.countdown - 1) }) : null);
    }, 1000);
    return () => clearInterval(t);
  }, [vitalsPrediction?.active]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'j' || e.key === 'J') setJudgeMode(p => !p); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleIncomingCall = () => setAppState('RINGING');
  const acceptCall = () => {
    setAppState('DISPATCH');
    const u = new SpeechSynthesisUtterance("Dispatch to Ambulance 54. Priority One. 42-year-old male. Severe allergic reaction and suspected cardiac arrest. Proceed with caution.");
    u.rate = 0.9; u.pitch = 0.2;
    u.onend = () => setAppState('ACTIVE');
    window.speechSynthesis.speak(u);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (demoMode === 'NORMAL') {
        setVitalsPrediction(null);
        setVitals(prev => ({ hr: 75 + Math.floor(Math.random() * 5), spo2: 98 + Math.floor(Math.random() * 2), bpSys: 120, bpDia: 80 }));
        setDestination('General Hospital');
      } else if (demoMode === 'CARDIAC_ARREST') {
        setVitals({ hr: 0, spo2: 0, bpSys: 0, bpDia: 0 });
        setDestination('LEVEL 1 TRAUMA (REROUTE)');
        if (etaSeconds > 180) setEtaSeconds(180);
      } else if (demoMode === 'ANAPHYLAXIS') {
        setVitalsPrediction(prev => prev ? prev : { active: true, type: 'anaphylaxis', probability: 87, text: '⚠️ ANAPHYLACTIC SHOCK TRAJECTORY', countdown: 45 });
        setVitals(prev => ({ hr: 145 + Math.floor(Math.random()*5), spo2: 88, bpSys: 70, bpDia: 40 }));
        setDestination('LEVEL 1 TRAUMA (REROUTE)');
        if (etaSeconds > 180) setEtaSeconds(180);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [demoMode, etaSeconds]);

  useEffect(() => {
    if (vitals.hr === 0 && prevHrRef.current > 0) {
      audioPlayerRef.current?.interrupt();
      stopListening();
      const msg = new SpeechSynthesisUtterance("CRITICAL ALERT. Patient is in cardiac arrest. Heart rate is zero. Initiate CPR immediately.");
      msg.rate = 1.1; msg.pitch = 0.5; msg.volume = 1;
      window.speechSynthesis.speak(msg);
      setPipelineSteps(prev => [...prev, { id: 'interrupt', name: 'AI Auto-Interrupt: Cardiac Arrest', ms: '< 1', status: 'error', color: 'text-red-500' }]);
    }
    prevHrRef.current = vitals.hr;

    if (vitals.hr === 0 && appState === 'ACTIVE') {
      if (!flatlineOscillator.current && audioCtx.current) {
        flatlineOscillator.current = audioCtx.current.createOscillator();
        flatlineOscillator.current.type = 'sine';
        flatlineOscillator.current.frequency.value = 800;
        flatlineOscillator.current.connect(audioCtx.current.destination);
        flatlineOscillator.current.start();
      }
    } else {
      if (flatlineOscillator.current) {
        flatlineOscillator.current.stop();
        flatlineOscillator.current.disconnect();
        flatlineOscillator.current = null;
      }
    }
  }, [vitals.hr, appState]);

  // Commands
  useEffect(() => {
    const userText = (transcript + ' ' + interimTranscript).toLowerCase();
    
    if (userText.includes("clear") && (userText.includes("shock") || userText.includes("patient")) && demoMode === 'CARDIAC_ARREST') triggerDefibrillator();
    if (userText.includes("cpr") && (userText.includes("started") || userText.includes("doing"))) setTasks(p => p.map(t => t.id === 'cpr' ? {...t, done: true} : t));
    if (userText.includes("epi") && (userText.includes("given") || userText.includes("in"))) setTasks(p => p.map(t => t.id === 'epi' ? {...t, done: true} : t));
    
    if (userText.includes("head") || userText.includes("concussion")) setTraumaZones(z => ({...z, head: true}));
    if (userText.includes("chest") || userText.includes("rib")) setTraumaZones(z => ({...z, chest: true}));
    if (userText.includes("leg") || userText.includes("femur")) setTraumaZones(z => ({...z, l_leg: true, r_leg: true}));
    if (userText.includes("arm") || userText.includes("radius")) setTraumaZones(z => ({...z, l_arm: true, r_arm: true}));

    if (userText.includes("deploy") && userText.includes("medevac")) triggerMedevac();
  }, [transcript, interimTranscript, demoMode]);

  useEffect(() => {
    const aiText = aiResponse.toLowerCase();
    if (aiText.includes("cardiac arrest") || aiText.includes("anaphylaxis") || aiText.includes("severe bleeding")) setTriage('RED');
    else if (aiText.includes("fracture") || aiText.includes("stable")) { if (triage !== 'RED') setTriage('YELLOW'); }
    
    if (aiText.includes("cpr") && !tasks.find(t => t.id === 'cpr')) setTasks(p => [...p, {id: 'cpr', text: 'Initiate CPR', done: false}]);
    if (aiText.includes("epinephrine") && !tasks.find(t => t.id === 'epi')) setTasks(p => [...p, {id: 'epi', text: 'Administer Epinephrine (1mg)', done: false}]);
    if (aiText.includes("tourniquet") && !tasks.find(t => t.id === 'tq')) setTasks(p => [...p, {id: 'tq', text: 'Apply Tourniquet', done: false}]);

    // Drug Calculator Extraction
    if (aiText.includes("epinephrine") || aiText.includes("epi ")) setDrugDose({drug: "Epinephrine (1:10,000)", dose: "1 mg IV/IO every 3-5 min"});
    else if (aiText.includes("amiodarone")) setDrugDose({drug: "Amiodarone", dose: "300 mg IV/IO bolus"});
    else if (aiText.includes("naloxone") || aiText.includes("narcan")) setDrugDose({drug: "Naloxone", dose: "2 mg IN/IM/IV"});
  }, [aiResponse, tasks, triage]);

  const triggerDefibrillator = () => {
    setFlashWhite(true);
    try {
      const ctx = audioCtx.current;
      if(ctx) {
          const osc = ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3);
          osc.connect(ctx.destination);
          osc.start(); osc.stop(ctx.currentTime + 0.3);
      }
    } catch(e) {}
    if (defibTimerRef.current) clearTimeout(defibTimerRef.current);
    defibTimerRef.current = setTimeout(() => {
      setFlashWhite(false); setDemoMode('NORMAL');
      setTasks(p => p.map(t => t.id === 'cpr' ? {...t, done: true} : t));
      setChatHistory(prev => [...prev, {role: 'system', content: '[SYSTEM LOG: Defibrillator shock delivered. ROSC achieved.]'}]);
    }, 300);
  };

  const triggerMedevac = () => {
    setMedevacActive(true);
    setDestination('MEDEVAC INTERCEPT');
    if (etaSeconds > 120) setEtaSeconds(120);
    try {
      const ctx = audioCtx.current;
      if(ctx) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 1);
        osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 2);
        osc.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 2.5);
      }
    } catch(e) {}
    if (medevacTimerRef.current) clearTimeout(medevacTimerRef.current);
    medevacTimerRef.current = setTimeout(() => setMedevacActive(false), 5000);
  };

  useEffect(() => {
    if (appState !== 'ACTIVE') return;
    audioPlayerRef.current = new StreamingAudioPlayer();
    let wsInstance: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout; let isUnmounted = false;
    
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname === 'localhost' ? 'localhost:8000' : 'pulse-backend-297907968720.us-central1.run.app';
      const ws = new WebSocket(`${protocol}//${host}/ws/voice`);
      wsInstance = ws;
      
      ws.onopen = () => setIsConnected(true);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'start_response') {
          setIsProcessing(true); setAiResponse(''); audioPlayerRef.current?.init(); 
        } else if (data.type === 'text_chunk') {
          setAiResponse((prev) => prev + data.content);
        } else 
        if (data.type === 'moss_telemetry') {
          setMossStats({ latency_ms: data.latency_ms, protocol: data.protocol, session_turns: data.session_turns });
          setPipelineSteps(prev => {
            const newSteps = prev.filter(s => s.id !== 'moss');
            return [...newSteps, { id: 'moss', name: `Moss Hybrid Context Search (α=${data.alpha})`, ms: `${data.latency_ms}`, status: 'done', color: 'text-emerald-400' }, { id: 'llm', name: 'HiDevs Synthesizing Context', ms: '...', status: 'pending' }];
          });
        }
        if (data.type === 'e2e_latency') {
          setE2eLatency(data.latency_ms);
          setPipelineSteps(prev => {
            const newSteps = prev.filter(s => s.id !== 'llm');
            return [...newSteps, { id: 'llm', name: `HiDevs Synthesizing Context (${data.model})`, ms: `${data.latency_ms}`, status: 'done', color: 'text-emerald-400' }, { id: 'tts', name: 'Cartesia Sonic Streaming TTS', ms: '...', status: 'pending' }];
          });
        }

        if (data.type === 'audio_chunk') {
          audioPlayerRef.current?.playChunk(data.data);
        } else if (data.type === 'end_response') {
          setIsProcessing(false);
          const finalText = data.full_text || document.getElementById("ai-response-box")?.innerText || "Response recorded.";
          
          if (lang.startsWith('hi') || lang.startsWith('te')) {
             const utterance = new SpeechSynthesisUtterance(finalText);
             utterance.lang = lang;
             utterance.onend = () => { setTimeout(() => { startListening(); }, 500); };
             utterance.onerror = (e) => { console.error('TTS Error', e); setTimeout(() => { startListening(); }, 500); };
             window.speechSynthesis.speak(utterance);
          } else {
               if (audioPlayerRef.current) {
                  audioPlayerRef.current.onFinished = () => { setTimeout(() => { startListening(); }, 500); };
               }
            }
          setChatHistory(prev => {
            const newHistory = [...prev];
            if (newHistory.length > 0 && newHistory[newHistory.length - 1].content.includes("[AI_PLACEHOLDER]")) {
              newHistory[newHistory.length - 1].content = finalText;
            }
            return newHistory;
          });
        }
      };
      ws.onclose = () => { setIsConnected(false); setSocket(null); if (!isUnmounted) { const delay = Math.min(30000, (reconnectAttempts.current + 1) * 2000); reconnectAttempts.current += 1; reconnectTimer = setTimeout(connectWebSocket, delay); } };
      setSocket(ws);
    };

    connectWebSocket();
    return () => { 
        isUnmounted = true; clearTimeout(reconnectTimer); 
        if (wsInstance) wsInstance.close(); 
        audioPlayerRef.current?.stop(); 
        setSocket(null);
    };
  }, [appState]);

  const sendQuery = (fullText: string) => {
    if (fullText && socket && socket.readyState === WebSocket.OPEN) {
      audioPlayerRef.current?.interrupt();
      setChatHistory(prev => [...prev, {role: 'user', content: fullText}, {role: 'ai', content: '[AI_PLACEHOLDER]'}]);
      
      const localGuardrail = offlineAllergyCheck(fullText, patientProfile.allergies);
      if (localGuardrail) {
        setPipelineSteps([{ id: 'guardrail', name: 'Zero-Token Local Guardrail', ms: '< 1', status: 'error', color: 'text-red-500' }]);
        setAiResponse(localGuardrail);
        setIsProcessing(false);
        // Fix Bug 6: Replace placeholder
        setChatHistory(prev => {
          const newHistory = [...prev];
          newHistory[newHistory.length - 1].content = localGuardrail;
          return newHistory;
        });
        return;
      }
      
      // Imp 4: Auto-clear pipeline on new query
      setPipelineSteps([
        { id: 'stt', name: 'Voice -> Text Transcription', ms: '0', status: 'done' },
        { id: 'guardrail', name: 'Allergy Guardrail Check', ms: '< 1', status: 'done', color: 'text-emerald-400' },
        { id: 'moss', name: 'Moss Hybrid Context Search (Vector + BM25)', ms: '...', status: 'pending' }
      ]);

      // Fix Bug 1: Add persona to payload
      socket.send(JSON.stringify({ type: 'text', text: fullText, vitals: vitals, profile: patientProfile, lang: lang, persona: persona }));
      clearTranscript();
    }
  };

  useEffect(() => {
    const fullText = (transcript + ' ' + interimTranscript).trim();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (isListening && fullText.length > 0 && !isProcessing) {
      silenceTimerRef.current = setTimeout(() => sendQuery(fullText), 1500); 
    }
  }, [transcript, interimTranscript, isListening, socket, isProcessing]);

  const handleStartListening = () => { if (isListening) { handleStopAndSend(); } else { audioCtx.current?.resume(); audioPlayerRef.current?.init(); startListening(); } };
  useEffect(() => {
    if (!isListening && (transcript || interimTranscript)) {
      const fullText = (transcript + " " + interimTranscript).trim();
      if (fullText && !isProcessing) {
        handleStopAndSend();
      }
    }
  }, [isListening]);

  const handleStopAndSend = () => {
    audioPlayerRef.current?.init(); stopListening();
    const fullText = (transcript + ' ' + interimTranscript).trim();
    if (fullText) sendQuery(fullText);
  };

  const generateReport = async () => {
    setIsReportModalOpen(true); setIsGeneratingReport(true);
    try {
      const fullTranscript = chatHistory.map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n');
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const host = window.location.hostname === 'localhost' ? 'localhost:8000' : 'pulse-backend-297907968720.us-central1.run.app';
      const res = await fetch(`${protocol}//${host}/generate_epcr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: fullTranscript, patient: patientProfile }) });
      const data = await res.json();
      setReportData(data.report || "Error generating report.");
    } catch (e) { setReportData("Error connecting to report generator."); } finally { setIsGeneratingReport(false); }
  };

  if (!hasSupport) return <div className="text-red-500 font-mono">SYSTEM ERROR: Switch to Chrome.</div>;

  if (appState === 'IDLE' || appState === 'RINGING' || appState === 'DISPATCH') {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center font-sans">
        <div className="w-96 h-96 rounded-full border border-white/10 flex items-center justify-center relative">
          {appState === 'RINGING' && <div className="absolute inset-0 bg-red-600/20 rounded-full animate-ping" />}
          <div className="flex flex-col items-center z-10">
            <ShieldAlert className={`w-16 h-16 mb-6 ${appState === 'RINGING' ? 'text-red-500 animate-pulse' : 'text-neutral-600'}`} />
            {appState === 'IDLE' && <button onClick={handleIncomingCall} className="bg-neutral-900 border border-red-900 text-red-100 px-8 py-3 rounded-full hover:bg-red-900/50 hover:border-red-500 transition font-bold tracking-widest shadow-[0_0_15px_rgba(220,38,38,0.2)] animate-pulse">▶ BEGIN EMERGENCY SIMULATION</button>}
            {appState === 'RINGING' && (
              <div className="flex flex-col items-center">
                <div className="text-red-500 font-bold tracking-widest uppercase mb-8 animate-pulse">Incoming Dispatch...</div>
                <button onClick={acceptCall} className="bg-green-600 text-white p-6 rounded-full hover:bg-green-500 hover:scale-110 transition shadow-[0_0_30px_rgba(34,197,94,0.5)]"><PhoneCall className="w-8 h-8" /></button>
              </div>
            )}
            {appState === 'DISPATCH' && (
              <div className="flex flex-col items-center">
                <div className="text-blue-500 font-bold tracking-widest uppercase mb-4">Receiving Audio...</div>
                <div className="flex gap-2 h-10 items-end">
                   {[1,2,3,4,5,6].map(i => <div key={i} className="w-2 bg-blue-500 rounded-t-full animate-[bounce_0.5s_infinite_alternate]" style={{animationDelay: `${i*0.1}s`, height: `${Math.random()*100 + 20}%`}} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isCritical = demoMode !== 'NORMAL';

  return (
    <>
    <style dangerouslySetInnerHTML={{__html: `
      @media print { body * { display: none !important; } #printable-epcr, #printable-epcr * { display: block !important; } #printable-epcr { position: absolute; left: 0; top: 0; width: 100%; height: 100%; padding: 20px; color: black !important; background: white !important; } }
      @keyframes ekgWave { 0% { stroke-dashoffset: 300; } 100% { stroke-dashoffset: 0; } }
      @keyframes bounceBar { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
      @keyframes radarSweep { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      @keyframes flyAcross { 0% { left: -20%; transform: scale(1.5) rotate(5deg); } 100% { left: 120%; transform: scale(1.5) rotate(-5deg); } }
    `}} />
    <div className={`min-h-screen ${persona === 'ER_DOCTOR' ? 'bg-[#001114] text-teal-100' : 'bg-[#050505] text-neutral-200'} font-sans overflow-hidden relative transition-colors duration-1000 ${isCritical && persona !== 'ER_DOCTOR' ? 'bg-red-950/20' : ''}`}>
      {isCritical && <div className="absolute inset-0 bg-red-900/10 animate-pulse pointer-events-none z-0" />}
      {flashWhite && <div className="absolute inset-0 bg-white z-50 pointer-events-none" />}
      
      {medevacActive && (
        <div className="absolute top-1/3 animate-[flyAcross_3s_linear] z-[100] text-7xl pointer-events-none drop-shadow-[0_0_30px_white]">🚁</div>
      )}

      {/* TOP NAV */}
      <nav className="w-full h-16 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between px-8 relative z-20">
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-md ${persona === 'ER_DOCTOR' ? 'bg-teal-600' : 'bg-red-500'}`}><Activity className="w-5 h-5 text-white" /></div>
          <span className="font-bold text-xl text-white">PULSE</span>
          {/* Imp 2: Connection Status */}
          <div className={`w-3 h-3 rounded-full animate-pulse ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} title={isConnected ? 'UPLINK: ACTIVE' : 'UPLINK: LOST'} />
          
          <div className="ml-4 flex items-center gap-3 border-l border-white/20 pl-6 hidden md:flex">
            <span className={`bg-emerald-500/10 border border-emerald-500/50 text-emerald-400 text-[10px] font-mono tracking-widest px-2 py-1 rounded-sm flex items-center gap-1 ${persona === 'ER_DOCTOR' ? 'text-teal-400 border-teal-500/50 bg-teal-500/10' : ''}`}>
              <Circle className={`w-2 h-2 animate-pulse ${persona === 'ER_DOCTOR' ? 'fill-teal-500' : 'fill-emerald-500'}`} /> {persona === 'ER_DOCTOR' ? 'TRAUMA CENTER ACTIVE' : 'MOSS SEMANTIC LAYER: ACTIVE'}
            </span>
            <span className="bg-cyan-500/10 border border-cyan-500/50 text-cyan-400 text-[10px] font-mono tracking-widest px-2 py-1 rounded-sm flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-cyan-400" /> GUARDRAILS: ARMED
            </span>
          </div>
        </div>
        
        {triage !== 'UNASSIGNED' && (
          <div className={`flex items-center gap-2 px-6 py-1.5 rounded-full font-black tracking-widest uppercase text-sm border-2 shadow-2xl ${triage === 'RED' ? 'bg-red-600 text-white border-red-400 animate-pulse' : triage === 'YELLOW' ? 'bg-yellow-500 text-black border-yellow-300' : 'bg-green-600 text-white border-green-400'}`}>
            MASS CASUALTY TRIAGE: {triage}
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-full px-3 py-1.5">
                      <button onClick={() => setPersona(persona === 'PARAMEDIC' ? 'ER_DOCTOR' : 'PARAMEDIC')} className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2">
            {persona === 'PARAMEDIC' ? 'HANDOFF TO ER' : 'BACK TO PARAMEDIC'}
          </button>
<Globe className="w-4 h-4 text-blue-400" />
            <select value={lang} onChange={(e) => { if (isListening) stopListening(); setLang(e.target.value); }} className="bg-transparent text-xs text-white outline-none cursor-pointer"><option className="bg-neutral-900" value="en-US">English</option><option className="bg-neutral-900" value="hi-IN">Hindi</option><option className="bg-neutral-900" value="te-IN">Telugu</option><option className="bg-neutral-900" value="es-ES">Spanish (Español)</option><option className="bg-neutral-900" value="fr-FR">French (Français)</option><option className="bg-neutral-900" value="de-DE">German (Deutsch)</option><option className="bg-neutral-900" value="pt-PT">Portuguese</option><option className="bg-neutral-900" value="zh-CN">Chinese</option></select>
          </div>
          {chatHistory.length > 0 && (
             <button onClick={generateReport} className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2"><FileText className="w-3 h-3" /> Gen ePCR</button>
          )}
        </div>
      </nav>

      <main className="w-full h-[calc(100vh-64px)] p-6 flex max-w-[1600px] mx-auto gap-6 z-10 relative">
        
        {/* LEFT COLUMN: Vitals & Hologram */}
        <div className="w-[28%] min-w-[320px] flex flex-col gap-6">
          <div className="bg-neutral-900/50 border border-white/10 rounded-xl p-5 flex flex-col relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
            <div className="flex items-center justify-between mb-3">
               <div className="flex items-center gap-2 text-blue-400 text-xs font-mono uppercase tracking-widest"><UserRound className="w-4 h-4" /> Patient Context</div>
               <div className="text-xs font-mono text-neutral-500">{patientProfile.weight}</div>
            </div>
            
            <div className="flex justify-between items-center">
              <div>
                <div className="text-2xl font-bold text-white mb-1">{patientProfile.name} <span className="text-neutral-500 font-normal text-lg">{patientProfile.age}y</span></div>
                <div className="mt-2 bg-red-500/10 border border-red-500/20 p-2 rounded text-sm text-red-200 font-mono"><span className="text-red-500 font-bold">ALLERGIES:</span> {patientProfile.allergies}</div>
              </div>
              <div className="w-16 h-32 opacity-80 flex-shrink-0">
                <svg viewBox="0 0 100 200" className="w-full h-full drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                   <circle cx="50" cy="20" r="15" fill={traumaZones.head ? "rgba(239,68,68,0.8)" : "none"} stroke={traumaZones.head ? "#ef4444" : "#3b82f6"} strokeWidth="3" />
                   <rect x="35" y="35" width="30" height="60" fill={traumaZones.chest ? "rgba(239,68,68,0.8)" : "none"} stroke={traumaZones.chest ? "#ef4444" : "#3b82f6"} strokeWidth="3" />
                   <line x1="35" y1="40" x2="10" y2="90" stroke={traumaZones.l_arm ? "#ef4444" : "#3b82f6"} strokeWidth="5" strokeLinecap="round" />
                   <line x1="65" y1="40" x2="90" y2="90" stroke={traumaZones.r_arm ? "#ef4444" : "#3b82f6"} strokeWidth="5" strokeLinecap="round" />
                   <line x1="40" y1="95" x2="35" y2="170" stroke={traumaZones.l_leg ? "#ef4444" : "#3b82f6"} strokeWidth="6" strokeLinecap="round" />
                   <line x1="60" y1="95" x2="65" y2="170" stroke={traumaZones.r_leg ? "#ef4444" : "#3b82f6"} strokeWidth="6" strokeLinecap="round" />
                </svg>
              </div>
            </div>
          </div>

          <div className="flex-1 grid grid-rows-3 gap-4">
            <div className={`bg-neutral-900/50 border ${isCritical ? 'border-red-500 shadow-[0_0_20px_rgba(220,38,38,0.3)] animate-pulse' : 'border-white/10'} rounded-xl p-4 flex flex-col justify-center relative overflow-hidden`}>
              <div className="flex items-center justify-between mb-1">
                <div className={`${persona === 'ER_DOCTOR' ? 'text-teal-400' : 'text-red-400'} text-xs font-mono uppercase flex items-center gap-2`}><Heart className="w-3 h-3" /> Heart Rate</div>
                <div className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${isCritical ? 'bg-red-500/20 text-red-400 border border-red-500/30' : (vitals.hr > 110 || vitals.hr < 50) ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>
                  {isCritical ? 'CRITICAL' : (vitals.hr > 110 || vitals.hr < 50) ? 'ELEVATED' : 'STABLE'}
                </div>
              </div>
              <div className={`text-5xl font-bold ${isCritical ? 'text-red-500' : persona === 'ER_DOCTOR' ? 'text-teal-100' : 'text-red-100'}`}>{vitals.hr} <span className={`text-xl font-light ${persona === 'ER_DOCTOR' ? 'text-teal-500' : 'text-red-500'}`}>BPM</span></div>
              <div className="absolute bottom-4 right-4 left-[40%] h-8 flex items-center opacity-70">
                {vitals.hr > 0 ? (
                  <svg viewBox="0 0 200 40" className="w-full h-full drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]" preserveAspectRatio="none">
                    <path d="M0,20 L30,20 L40,5 L50,35 L60,2 L70,38 L80,20 L120,20 L130,5 L140,35 L150,2 L160,38 L170,20 L200,20" fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="300" style={{ animation: `ekgWave ${(60/vitals.hr).toFixed(2)}s linear infinite` }} />
                  </svg>
                ) : (
                  <div className="w-full h-[2px] bg-red-600 shadow-[0_0_10px_#dc2626]" />
                )}
              </div>
            </div>
            <div className={`bg-neutral-900/50 border ${demoMode === 'ANAPHYLAXIS' || demoMode === 'CARDIAC_ARREST' ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'border-white/10'} rounded-xl p-4 flex flex-col justify-center`}>
              <div className="text-blue-400 text-xs font-mono uppercase mb-1 flex items-center gap-2"><Droplet className="w-3 h-3" /> SpO2</div>
              <div className="text-5xl font-bold text-blue-100">{vitals.spo2}%</div>
            </div>
            <div className={`bg-neutral-900/50 border ${demoMode === 'ANAPHYLAXIS' ? 'border-purple-500' : 'border-white/10'} rounded-xl p-4 flex flex-col justify-center`}>
              <div className="text-purple-400 text-xs font-mono uppercase mb-1">Blood Pressure</div>
              <div className="text-4xl font-bold text-purple-100">{vitals.bpSys}/{vitals.bpDia}</div>
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: Subtitles & Chat */}
        <div className="flex-1 flex flex-col gap-6">
          
          {/* PREDICTIVE CRASH UI */}
          {vitalsPrediction?.active && (
            <div className="bg-red-900/30 border border-red-500 rounded-xl px-4 py-3 flex items-center justify-between animate-pulse shadow-[0_0_20px_rgba(239,68,68,0.3)]">
              <span className="text-red-400 text-sm font-mono font-bold">{vitalsPrediction.text}</span>
              <span className="text-red-200 text-3xl font-mono font-black">{vitalsPrediction.countdown}s</span>
              <span className="text-red-500 text-xs">{vitalsPrediction.probability}% probability</span>
            </div>
          )}
          
          {/* LEVEL 7: TACTICAL DRUG CALCULATOR */}
          {drugDose && (
             <div className="h-16 bg-yellow-500 text-black font-bold flex items-center justify-between px-6 rounded-xl animate-pulse shadow-[0_0_20px_rgba(234,179,8,0.4)]">
                <div className="flex items-center gap-3"><Syringe className="w-6 h-6" /> DOSAGE CALCULATION</div>
                <div className="text-2xl font-mono">{drugDose.drug} → {drugDose.dose}</div>
             </div>
          )}

          <div className={`flex-1 border ${isCritical ? 'border-red-500/50 bg-red-950/20' : 'border-white/10 bg-white/[0.02]'} rounded-2xl p-6 flex flex-col relative overflow-hidden backdrop-blur-xl transition-colors`}>
            {isProcessing && (
              <div className="absolute top-6 right-6 flex items-center justify-center gap-1 h-8">
                {[1,2,3,4,5,6].map(i => <div key={i} className="w-1.5 bg-red-500 rounded-full animate-[bounceBar_0.8s_infinite_ease-in-out] shadow-[0_0_8px_#ef4444]" style={{animationDelay: `${i*0.1}s`, height: '100%'}} />)}
              </div>
            )}
            
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2"><ShieldAlert className="w-4 h-4 text-neutral-500" /><span className="text-xs font-mono uppercase text-neutral-500">Field Medic Audio Feed</span></div>
              <div className="bg-black/60 border border-white/10 rounded-xl p-4 overflow-hidden relative font-mono min-h-[80px]">
                <div className="text-[10px] text-blue-500 mb-2">SAT-COM UPLINK // RAW TRANSCRIPT</div>
                <div className="text-xl text-neutral-300 relative z-10">{transcript} <span className="text-neutral-500 animate-pulse">{interimTranscript}</span></div>
                
              </div>
            </div>

            <div className="flex-1 flex flex-col">
              <div className="flex items-center gap-2 mb-2"><Activity className={`w-4 h-4 ${isProcessing ? 'text-red-500 animate-spin' : 'text-red-600'}`} /><span className="text-xs font-mono uppercase text-red-500 font-bold">Pulse AI Response</span></div>
              <div id="ai-response-box" className="flex-1 rounded-xl p-4 text-xl font-medium leading-snug bg-black/20 text-neutral-200 overflow-hidden">{aiResponse}</div>
            </div>
          </div>

          {/* Agentic Pipeline Telemetry */}
          {pipelineSteps.length > 0 && (
            <div className="bg-black/60 border border-white/10 rounded-xl p-4 mt-4 font-mono text-xs w-full">
              <div className="text-white/50 mb-3 flex items-center gap-2"><Activity className="w-3 h-3"/> AGENTIC PIPELINE TELEMETRY</div>
              <div className="flex flex-col gap-2">
                {pipelineSteps.map(step => (
                  <div key={step.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {step.status === 'pending' ? <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"/> : step.status === 'error' ? <div className="w-2 h-2 rounded-full bg-red-500"/> : <div className="w-2 h-2 rounded-full bg-emerald-500"/>}
                      <span className={step.color || 'text-white/80'}>{step.name}</span>
                    </div>
                    <span className="text-white/40">{step.ms}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="h-20">
            {!isConnected ? (
              <div className="w-full h-full flex items-center justify-center gap-3 bg-red-900/30 border border-red-500 text-red-400 rounded-xl font-bold text-sm font-mono shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                📡 OFFLINE — DEAD RECKONING ACTIVE — Voice Guardrails Running Locally
              </div>
            ) : !isListening ? (
              <button onClick={handleStartListening} disabled={!isConnected} className="w-full h-full flex items-center justify-center gap-3 bg-red-600 text-white rounded-xl font-bold text-xl hover:bg-red-500 transition-all shadow-[0_0_30px_rgba(220,38,38,0.4)]"><Mic className="w-6 h-6" /> Press to Speak</button>
            ) : (
              <button onClick={handleStopAndSend} className="w-full h-full flex items-center justify-center gap-3 bg-white text-black rounded-xl font-bold text-xl hover:scale-[1.02] transition-all shadow-[0_0_50px_rgba(255,255,255,0.4)]"><div className="w-4 h-4 bg-red-600 rounded-sm animate-pulse" /> Tap to Send</button>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Cameras & Tracking */}
        <div className="w-[28%] min-w-[320px] flex flex-col gap-6">
          
          {/* LEVEL 7: TACTICAL MULTI-CAM GRID */}
          <div className="h-48 bg-black border-2 border-white/10 rounded-xl overflow-hidden shadow-2xl p-1 relative">
            <div className="absolute top-2 left-2 flex items-center gap-1.5 z-50 bg-black/80 px-2 rounded">
              <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse" /><span className="text-[10px] font-mono text-red-500 font-bold tracking-widest">LIVE_LINK</span>
            </div>
            <div className="grid grid-cols-2 grid-rows-2 gap-1 w-full h-full">
               <div className="relative bg-zinc-900 rounded overflow-hidden">
                 <video ref={videoRef1} autoPlay playsInline muted className="w-full h-full object-cover opacity-80 grayscale contrast-125" />
                 <span className="absolute bottom-1 right-1 text-[8px] font-mono text-white/70 bg-black/50 px-1 rounded">BODY_CAM</span>
               </div>
               <div className="relative bg-zinc-900 rounded overflow-hidden">
                 <video ref={videoRef2} autoPlay playsInline muted className="w-full h-full object-cover invert hue-rotate-180 contrast-150" />
                 <span className="absolute bottom-1 right-1 text-[8px] font-mono text-white/70 bg-black/50 px-1 rounded">THERMAL</span>
               </div>
               <div className="relative bg-zinc-900 rounded overflow-hidden">
                 <video ref={videoRef3} autoPlay playsInline muted className="w-full h-full object-cover sepia hue-rotate-90 saturate-200 contrast-125 brightness-75" />
                 <span className="absolute bottom-1 right-1 text-[8px] font-mono text-white/70 bg-black/50 px-1 rounded">NIGHT_VIS</span>
               </div>
               <div className="relative bg-zinc-900 rounded overflow-hidden">
                 <video ref={videoRef4} autoPlay playsInline muted className="w-full h-full object-cover grayscale contrast-200 brightness-150 blur-[1px]" />
                 <span className="absolute bottom-1 right-1 text-[8px] font-mono text-white/70 bg-black/50 px-1 rounded">DRONE_UAV</span>
               </div>
            </div>
            <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.1)_2px,rgba(0,0,0,0.1)_4px)] mix-blend-overlay pointer-events-none" />
          </div>

          {/* GPS RADAR */}
          <div className={`h-40 bg-neutral-900/50 border ${isCritical ? 'border-red-500 shadow-[0_0_20px_rgba(220,38,38,0.2)]' : medevacActive ? 'border-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.3)]' : 'border-white/10'} rounded-xl p-4 flex gap-4 items-center`}>
            <div className={`relative w-24 h-24 rounded-full border flex-shrink-0 flex items-center justify-center overflow-hidden ${isCritical ? 'border-red-500/50 bg-red-900/20' : medevacActive ? 'border-yellow-500/50 bg-yellow-900/20' : 'border-green-500/50 bg-green-900/20'}`}>
              <div className="absolute inset-0 rounded-full animate-[radarSweep_2s_linear_infinite]" style={{background: `conic-gradient(from 0deg, transparent 70%, ${isCritical ? 'rgba(239, 68, 68, 0.8)' : medevacActive ? 'rgba(234,179,8,0.8)' : 'rgba(34, 197, 94, 0.8)'} 100%)`}} />
              <div className={`absolute w-full h-[1px] ${isCritical ? 'bg-red-500/30' : 'bg-green-500/30'}`} />
              <div className={`absolute h-full w-[1px] ${isCritical ? 'bg-red-500/30' : 'bg-green-500/30'}`} />
              <div className="absolute top-1/4 right-1/4 w-2 h-2 bg-white rounded-full shadow-[0_0_8px_white]"><div className="w-full h-full border border-white rounded-full animate-ping" /></div>
            </div>
            <div className="flex flex-col flex-1">
              <div className="text-xs font-mono uppercase text-neutral-500 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Routing</div>
              <div className={`text-sm font-bold uppercase mb-2 ${isCritical ? 'text-red-500' : medevacActive ? 'text-yellow-500' : 'text-neutral-200'}`}>{destination}</div>
              <div className="text-xs font-mono text-neutral-500">ETA</div>
              <div className={`text-3xl font-mono font-bold ${isCritical ? 'text-red-500' : medevacActive ? 'text-yellow-500' : 'text-green-400'}`}>
                {Math.floor(etaSeconds/60)}m {(etaSeconds%60).toString().padStart(2, '0')}s
              </div>
            </div>
          </div>

          {/* LIVE STATS DASHBOARD (Imp 1) */}
          <div className="bg-neutral-900/50 border border-white/10 rounded-xl p-4 flex flex-col gap-2 font-mono text-xs">
            <div className="text-white/50 mb-1 uppercase tracking-widest flex items-center gap-2"><Activity className="w-3 h-3"/> System Telemetry</div>
            <div className="flex justify-between items-center bg-black/40 p-2 rounded">
              <span className="text-neutral-400">Moss Vector Latency:</span>
              <span className={mossStats?.latency_ms ? "text-emerald-400 font-bold" : "text-neutral-600"}>{mossStats?.latency_ms ? `${mossStats.latency_ms}ms` : '---'}</span>
            </div>
            <div className="flex justify-between items-center bg-black/40 p-2 rounded">
              <span className="text-neutral-400">E2E Voice-to-Text:</span>
              <span className={e2eLatency ? "text-blue-400 font-bold" : "text-neutral-600"}>{e2eLatency ? `${e2eLatency}ms` : '---'}</span>
            </div>
            <div className="flex justify-between items-center bg-black/40 p-2 rounded">
              <span className="text-neutral-400">Memory Turns:</span>
              <span className="text-purple-400 font-bold">{mossStats?.session_turns || 0}</span>
            </div>
          </div>
          
          {/* CHECKLIST */}
          <div className="flex-1 bg-neutral-900/50 border border-white/10 rounded-xl p-4 flex flex-col overflow-y-auto">
            <div className="text-xs font-mono text-neutral-500 mb-3 uppercase">Protocol Checklist</div>
            <div className="flex flex-col gap-2">
              {tasks.length === 0 ? <div className="text-neutral-600 italic text-sm">Awaiting assessment...</div> : 
                tasks.map(t => (
                  <div key={t.id} className={`flex items-center gap-2 text-sm ${t.done ? 'text-green-500' : 'text-neutral-300'}`}>
                    {t.done ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <Circle className="w-4 h-4 flex-shrink-0" />}
                    <span className={t.done ? 'line-through opacity-50' : ''}>{t.text}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      


</main>

      <div className="fixed bottom-0 left-0 w-full bg-black/80 border-t border-white/10 p-2 flex justify-center gap-4 text-xs z-50 hover:opacity-100 opacity-0 transition-opacity">
        <select value={lang} onChange={(e) => { if (isListening) stopListening(); setLang(e.target.value); }} className="bg-neutral-900 border border-white/20 text-white px-2 py-1 rounded text-xs mr-4"><option className="bg-neutral-900" value="en-US">English</option><option className="bg-neutral-900" value="hi-IN">Hindi</option><option className="bg-neutral-900" value="te-IN">Telugu</option><option className="bg-neutral-900" value="es-ES">Spanish (Español)</option><option className="bg-neutral-900" value="fr-FR">French (Français)</option><option className="bg-neutral-900" value="de-DE">German (Deutsch)</option><option className="bg-neutral-900" value="pt-PT">Portuguese</option><option className="bg-neutral-900" value="zh-CN">Chinese</option></select><span className="text-neutral-500 flex items-center uppercase font-mono tracking-widest mr-4">Demo Controls:</span>
        <button onClick={() => setDemoMode('NORMAL')} className="px-3 py-1 rounded border border-white/20 text-white hover:bg-white/10">Normal</button>
        <button onClick={() => setDemoMode('ANAPHYLAXIS')} className="px-3 py-1 rounded border border-white/20 text-white hover:bg-white/10">Anaphylaxis</button>
        <button onClick={() => setDemoMode('CARDIAC_ARREST')} className="px-3 py-1 rounded border border-white/20 text-white hover:bg-white/10">Cardiac Arrest</button>
        <button onClick={triggerMedevac} className="px-3 py-1 rounded border border-yellow-500 text-yellow-500 hover:bg-yellow-500/20 ml-8 font-bold"><Plane className="w-3 h-3 inline mr-1" /> Deploy Medevac</button>
      </div>
      <div className="fixed bottom-1 w-full text-center text-[10px] text-neutral-600 z-40 font-mono pointer-events-none">
        Powered by Moss Hybrid Search · HiDevs Gemini · Cartesia Sonic TTS
      </div>
      
      {isReportModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8">
          <div className="bg-neutral-100 border border-neutral-300 rounded-xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden text-black">
            <div className="flex items-center justify-between p-4 border-b border-neutral-300 bg-white">
              <div className="flex items-center gap-2"><FileText className="w-5 h-5 text-blue-600" /><span className="font-bold text-lg">Electronic Patient Care Report (ePCR)</span></div>
              <div className="flex gap-2">
                 <button onClick={() => window.print()} className="bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1.5 rounded font-bold">Print PDF</button>
                 <button onClick={() => setIsReportModalOpen(false)} className="text-neutral-500 hover:text-black"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div id="printable-epcr" className="p-8 overflow-y-auto flex-1 text-sm font-serif leading-relaxed whitespace-pre-wrap bg-white text-black">
              {reportData || "Loading..."}
            </div>
          </div>
        </div>
      )}
    </div>
          {/* Patient Edit Modal */}
      {judgeMode && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center">
          <div className="border border-white/20 rounded-2xl p-10 max-w-lg w-full shadow-[0_0_50px_rgba(255,255,255,0.1)]">
            <div className="text-red-500 font-black text-3xl mb-8 flex items-center gap-3">
              <Activity className="w-8 h-8"/> PULSE — Architecture Overview
            </div>
            {[
              ["🧠", "Moss Hybrid RAG", "Vector + BM25 with adaptive α-reranking based on live vitals severity"],
              ["⚡", "Zero-Latency Guardrails", "Client-side drug/allergy check <1ms, no LLM token spend"],
              ["📡", "Dead Reckoning Offline", "Full protocol cache in localStorage, works with Wi-Fi OFF"],
              ["🏥", "ER Command Handoff", "Persistent Moss session memory survives ambulance → hospital handoff"],
              ["🔮", "Predictive Vitals AI", "Forecasts V-Fib/Anaphylaxis before flatline, 45s warning window"],
              ["🛑", "AI Auto-Interrupt", "System instantly interrupts and takes over audio channel if vitals drop to zero"],
            ].map(([icon, title, desc]) => (
              <div key={title} className="flex gap-4 mb-5">
                <div className="text-2xl">{icon}</div>
                <div>
                  <div className="text-white font-bold">{title}</div>
                  <div className="text-neutral-400 text-sm">{desc}</div>
                </div>
              </div>
            ))}
            <div className="text-neutral-600 text-xs mt-8 text-center animate-pulse">Press J to close</div>
          </div>
        </div>
      )}

      {isEditingPatient && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-4">Edit Patient File</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-neutral-400 text-xs font-mono mb-1">NAME</label>
                <input type="text" value={patientProfile.name} onChange={e => setPatientProfile({...patientProfile, name: e.target.value})} className="w-full bg-black border border-neutral-700 rounded p-2 text-white" />
              </div>
              <div>
                <label className="block text-neutral-400 text-xs font-mono mb-1">AGE</label>
                <input type="number" value={patientProfile.age} onChange={e => setPatientProfile({...patientProfile, age: parseInt(e.target.value) || 0})} className="w-full bg-black border border-neutral-700 rounded p-2 text-white" />
              </div>
              <div>
                <label className="block text-red-400 text-xs font-mono mb-1">ALLERGIES (comma separated)</label>
                <input type="text" value={patientProfile.allergies} onChange={e => setPatientProfile({...patientProfile, allergies: e.target.value})} className="w-full bg-black border border-red-900/50 rounded p-2 text-white focus:border-red-500 outline-none" />
              </div>
              <button onClick={() => setIsEditingPatient(false)} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded">SAVE PROFILE</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


















