'use client';

import { useState, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function useSpeechRecognition(language: string = 'en-US') {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [recognition, setRecognition] = useState<any>(null);
  const [hasSupport, setHasSupport] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recog: any = null;
    
    if (SpeechRecognition) {
      recog = new SpeechRecognition();
      recog.continuous = false;
      recog.interimResults = true;
      recog.lang = language;

      recog.onresult = (event: any) => {
        let currentTranscript = '';
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            currentTranscript += event.results[i][0].transcript;
          } else {
            currentInterim += event.results[i][0].transcript;
          }
        }
        
        if (currentTranscript) {
          setTranscript((prev) => prev + currentTranscript + ' ');
        }
        setInterimTranscript(currentInterim);
      };

      recog.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        console.log('Mic Error:', event.error);
        setIsListening(false);
      };

      recog.onend = () => {
        setIsListening(false);
      };

      setRecognition(recog);
    } else {
      setHasSupport(false);
    }
    
    return () => {
      if (recog) {
        try { recog.abort(); } catch(e) {}
      }
    };
  }, [language]);

  const startListening = useCallback(() => {
    if (recognition) {
      try {
        setInterimTranscript('');
        recognition.start();
        setIsListening(true);
      } catch (e) {
        console.log("Already started");
      }
    }
  }, [recognition]);

  const stopListening = useCallback(() => {
    if (recognition) {
      recognition.stop();
      setIsListening(false);
    }
  }, [recognition]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    clearTranscript,
    hasSupport
  };
}


