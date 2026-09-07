import { useEffect, useRef, useState } from "react";
import { Camera, Mic, SendHorizonal, Sparkles, SquareX, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Minimal ambient typings for the Web Speech API (not in default TS DOM lib).
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Lang = "en" | "kn";

const copy = {
  en: {
    eyebrow: "Decision assistant",
    title: "Ask KRISHI-NEXUS",
    subtitle: "Describe what you see in the field, attach a photo, or speak in your own words.",
    placeholder: "Example: Yellow patches on paddy leaves in Plot B — should I spray now?",
    photo: "Add field photo",
    voice: "Speak",
    submit: "Get decision",
    prompts: [
      "Is today good for urea top dressing?",
      "Why is Plot B flagged for stem borer?",
      "When should I plan harvest?",
    ],
    note: "Interface preview — no advice is generated yet.",
    listening: "Listening…",
    removePhoto: "Remove photo",
    voiceUnsupported: "Voice input isn't supported in this browser.",
  },
  kn: {
    eyebrow: "ನಿರ್ಧಾರ ಸಹಾಯಕ",
    title: "ಕೃಷಿ-ನೆಕ್ಸಸ್‌ಗೆ ಕೇಳಿ",
    subtitle: "ಹೊಲದಲ್ಲಿ ಕಂಡದ್ದನ್ನು ಬರೆಯಿರಿ, ಫೋಟೋ ಸೇರಿಸಿ ಅಥವಾ ಮಾತಿನಲ್ಲಿ ಹೇಳಿ.",
    placeholder: "ಉದಾ: ಪ್ಲಾಟ್ B ಭತ್ತದ ಎಲೆಗಳಲ್ಲಿ ಹಳದಿ ಕಲೆಗಳಿವೆ — ಈಗ ಸಿಂಪಡಿಸಬೇಕೆ?",
    photo: "ಹೊಲದ ಫೋಟೋ ಸೇರಿಸಿ",
    voice: "ಮಾತನಾಡಿ",
    submit: "ನಿರ್ಧಾರ ಪಡೆಯಿರಿ",
    prompts: [
      "ಇಂದು ಯೂರಿಯಾ ಹಾಕಲು ಸೂಕ್ತವೇ?",
      "ಪ್ಲಾಟ್ B ಗೆ ಕಾಂಡಕೊರಕ ಎಚ್ಚರಿಕೆ ಏಕೆ?",
      "ಕಟಾವು ಯಾವಾಗ ಯೋಜಿಸಬೇಕು?",
    ],
    note: "ಇದು ವಿನ್ಯಾಸ ಮುನ್ನೋಟ — ಇನ್ನೂ ಸಲಹೆ ನೀಡುವುದಿಲ್ಲ.",
    listening: "ಆಲಿಸಲಾಗುತ್ತಿದೆ…",
    removePhoto: "ಫೋಟೋ ತೆಗೆದುಹಾಕಿ",
    voiceUnsupported: "ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಧ್ವನಿ ಇನ್‌ಪುಟ್ ಬೆಂಬಲಿತವಾಗಿಲ್ಲ.",
  },
} satisfies Record<Lang, unknown>;

const speechLangByUiLang: Record<Lang, string> = {
  en: "en-IN",
  kn: "kn-IN",
};

export function AskKrishiNexus() {
  const [lang, setLang] = useState<Lang>("en");
  const [query, setQuery] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const t = copy[lang];

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setVoiceSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // Keep an in-progress recognition session's language in sync if the user
  // switches languages mid-session, and always clean up on unmount.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const handlePhotoButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPhotoPreview(url);

    // Allow re-selecting the same file later (e.g. after removing it).
    event.target.value = "";
  };

  const handleRemovePhoto = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPhotoPreview(null);
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
  };

  const startListening = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setVoiceSupported(false);
      return;
    }

    const recognition = new Ctor();
    recognition.lang = speechLangByUiLang[lang];
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) {
          transcript += result[0].transcript;
        }
      }
      if (transcript) {
        setQuery((prev) => (prev ? `${prev} ${transcript}`.trim() : transcript.trim()));
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const handleVoiceButtonClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <section
      aria-labelledby="ask-krishi-heading"
      className="field-grid overflow-hidden rounded-3xl border border-primary/20 bg-primary-soft/60 p-1"
    >
      <div className="rounded-[calc(var(--radius-3xl)-2px)] bg-card/95 p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="size-3.5" />
              {t.eyebrow}
            </span>
            <h2
              id="ask-krishi-heading"
              className="mt-2 text-xl font-bold text-foreground sm:text-2xl"
            >
              {t.title}
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t.subtitle}</p>
          </div>

          <div
            role="group"
            aria-label="Language"
            className="flex shrink-0 rounded-full border border-border bg-muted p-1"
          >
            {(["en", "kn"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  lang === code
                    ? "bg-primary text-primary-foreground shadow-card"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {code === "en" ? "English" : "ಕನ್ನಡ"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-background p-2">
          <Textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.placeholder}
            rows={3}
            className="resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoSelected}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={handlePhotoButtonClick}
              >
                <Camera className="size-4" />
                <span className="hidden sm:inline">{t.photo}</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("rounded-full", isListening && "border-primary/50 text-primary")}
                onClick={handleVoiceButtonClick}
                aria-pressed={isListening}
              >
                <Mic className={cn("size-4", isListening && "animate-pulse")} />
                <span className="hidden sm:inline">{isListening ? t.listening : t.voice}</span>
              </Button>
            </div>
            <Button type="button" size="sm" className="rounded-full">
              {t.submit}
              <SendHorizonal className="size-4" />
            </Button>
          </div>

          {photoPreview && (
            <div className="mt-2 flex items-center gap-2 px-1">
              <img
                src={photoPreview}
                alt="Selected field photo preview"
                className="size-14 rounded-lg border border-border object-cover"
              />
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
              >
                <X className="size-3.5" />
                {t.removePhoto}
              </button>
            </div>
          )}

          {!voiceSupported && (
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              <SquareX className="mr-1 inline size-3" />
              {t.voiceUnsupported}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {t.prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setQuery(prompt)}
              className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{t.note}</p>
      </div>
    </section>
  );
}
