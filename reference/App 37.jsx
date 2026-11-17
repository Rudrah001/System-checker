import { useState, useEffect, useRef } from "react";
import { CandidateWebRTC, AdminWebRTC } from "./components/WebRTCStreams";
import CodingApp from "./components/CodingApp";
import VideoBox from "./components/VideoBox";
import Feedback from "./components/Feedback";
import FloatingCamera from "./components/FloatingCamera"; // adjust path if needed
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  validateInterviewLink,
  fetchRandomCodingQuestion,
  fetchInterviewDetails,
} from "./utils/api";
import { getInterviewSettings } from "../jobTemplate/services/settingsapi";
import Footer from "./layout/Footer";
import ValidationPanel from "./components/ValidationPanel";
import SystemCheckModal from "./components/SystemCheckModal";
import { NotificationProvider, useNotification } from "./NotificationContext";
import SecondCameraQRModal from "./components/SecondCameraQRModal";
import VoiceInterview from "./components/VoiceInterview";
import AIPanel from "./components/AIPanel";
import PublicHeader from "./layout/PublicHeader";
import "./CandidateLanding.css";
import "./InterviewGuidelines.css";
import "./MonitoringDashboard.css";
import "./AdminInterviewEnded.css";
import { getInterviewLanguage } from "./utils/interviewLanguage";

const useMediaQuery = (query) => {
  const getMatches = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);
    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);
    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, [query]);

  return matches;
};

// ---------------- Main App ----------------
const AppInner = ({ role = "candidate" }) => {
  const { notify } = useNotification();
  const [started, setStarted] = useState(false);
  const [stopVideo, setStopVideo] = useState(false);
  const [showCodingApp, setShowCodingApp] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [candidateEnded, setCandidateEnded] = useState(false);
  const [interviewEnded, setInterviewEnded] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const isDesktopLayout = useMediaQuery("(min-width: 768px)");

  // fetch a random coding question when the code panel is shown; call directly on button click
  const [codingQuestionFetched, setCodingQuestionFetched] = useState(false);
  const [codePanelDisabled, setCodePanelDisabled] = useState(false);
  const [compilerEnabled, setCompilerEnabled] = useState(false);
  const [showSecondCameraQR, setShowSecondCameraQR] = useState(false);

  // State for multiple coding questions
  const [allCodingQuestions, setAllCodingQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [totalTimeLimit, setTotalTimeLimit] = useState(0);

  const fetchRandomQuestion = async (INTERVIEW_ID) => {
    try {
      if (codingQuestionFetched) return;

      const data = await fetchRandomCodingQuestion(INTERVIEW_ID);
      // Extract questions array and total_time_limit from response
      const questions = data.questions || [];
      // Convert total_time_limit from minutes to seconds (API returns in minutes)
      const timeLimitMinutes = parseInt(data.total_time_limit || 0, 10);
      const timeLimitSeconds = timeLimitMinutes * 60; // Convert minutes to seconds

      console.log("Coding questions fetched:", {
        questions,
        timeLimitMinutes,
        timeLimitSeconds,
      });

      setAllCodingQuestions(questions);
      setTotalTimeLimit(timeLimitSeconds);
      setCurrentQuestionIndex(0);
      setCodingQuestionFetched(true);
    } catch (e) {
      console.error("Fetch coding question error", e);
    }
  };

  useEffect(() => {
    // clear questions when panel is hidden
    if (!showCodingApp) {
      setAllCodingQuestions([]);
      setCurrentQuestionIndex(0);
      setTotalTimeLimit(0);
    }
  }, [showCodingApp]);

  const [showFeedback, setShowFeedback] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [quickChecks, setQuickChecks] = useState({
    screen: "checking",
    microphone: "checking",
    camera: "checking",
    internet: "checking",
  });
  const [sharedStream, setSharedStream] = useState(null);
  const [showSystemCheck, setShowSystemCheck] = useState(false);
  const [showScreenShareError, setShowScreenShareError] = useState(false);
  const [showFullscreenFallback, setShowFullscreenFallback] = useState(false);
  const [showEndInterviewConfirm, setShowEndInterviewConfirm] = useState(false);
  const [endInterviewConfirmSource, setEndInterviewConfirmSource] =
    useState("manual");

  const candidateRef = useRef(null);
  const voiceInterviewRef = useRef(null);
  const codingAppRef = useRef(null);
  const screenStreamRef = useRef(null);
  const screenShareRequestRef = useRef(null);

  const requestInterviewFullscreen = async () => {
    const fullscreenElement =
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement ||
      document.webkitIsFullScreen;

    if (fullscreenElement) {
      setShowFullscreenFallback(false);
      return true;
    }

    const elem = document.documentElement;
    const request =
      elem.requestFullscreen ||
      elem.webkitRequestFullscreen ||
      elem.msRequestFullscreen;

    if (!request) {
      setShowFullscreenFallback(true);
      return false;
    }

    try {
      await request.call(elem);
      setShowFullscreenFallback(false);
      return true;
    } catch (error) {
      console.warn("Browser blocked the fullscreen request:", error);
      setShowFullscreenFallback(true);
      return false;
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement ||
        document.webkitIsFullScreen,
      );

      if (isFullscreen) {
        setShowFullscreenFallback(false);
      } else if (
        role === "candidate" &&
        started &&
        screenStreamRef.current?.getVideoTracks?.()[0]?.readyState === "live"
      ) {
        setShowFullscreenFallback(true);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange,
      );
    };
  }, [role, started]);

  // Get current question from array
  const currentQuestion = allCodingQuestions[currentQuestionIndex] || null;

  // Update validation state to include timezone, duration, and interview settings
  const [validation, setValidation] = useState({
    loading: true,
    ok: false,
    status: "",
    message: "",
    scheduled_date: null,
    scheduled_time: null,
    interview_timezone: null,
    interview_duration: 30,
    candidate_name: null,
    second_camera_enabled: false,
    system_check_enabled: false,
  });
  const [interviewLinkExpiry, setInterviewLinkExpiry] = useState(30);

  const params = new URLSearchParams(window.location.search);
  const INTERVIEW_ID = params.get("interviewId");
  const [interviewLocale, setInterviewLocale] = useState("en-US");

  useEffect(() => {
    let cancelled = false;
    if (!INTERVIEW_ID) return undefined;
    fetchInterviewDetails(INTERVIEW_ID)
      .then((interview) => {
        if (!cancelled) setInterviewLocale(getInterviewLanguage(interview).locale);
      })
      .catch(() => {
        if (!cancelled) setInterviewLocale("en-US");
      });
    return () => {
      cancelled = true;
    };
  }, [INTERVIEW_ID]);

  // Admin monitoring state (hooks must be top-level)
  const [candidateOnline, setCandidateOnline] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [adminTranscripts, setAdminTranscripts] = useState([]);
  const [showVoiceChat, setShowVoiceChat] = useState(true); // New: Controls only VoiceInterview visibility
  const monitorSocketRef = useRef(null);

  // 🎧 Audio context and stream refs for proper cleanup
  const audioContextRef = useRef(null);
  const micStreamRef = useRef(null);
  const micSourceRef = useRef(null);
  const micAttachPromiseRef = useRef(null);
  const recordingMicRestoreTimerRef = useRef(null);
  const recordingMicRestorePendingRef = useRef(false);
  const audioDestinationRef = useRef(null);
  const attachMicToAudioGraphRef = useRef(null);

  // Voice Interview state for AI Panel
  const [voiceStatus, setVoiceStatus] = useState("AI Speaking...");
  const [voiceMessages, setVoiceMessages] = useState([]);

  // Admin candidate name state
  const [adminCandidateName, setAdminCandidateName] = useState(null);

  // Proctoring event state
  const [proctoringEvent, setProctoringEvent] = useState(null);

  const [endingInterview, setEndingInterview] = useState(false);
  // Helper function to perform frontend-side validation using expiry duration
  const performFrontendValidation = (
    scheduledDate,
    scheduledTime,
    timezone,
    expiryDuration,
  ) => {
    if (!scheduledDate || !scheduledTime || !timezone) {
      return null; // Can't validate without these fields
    }

    try {
      // Parse the scheduled date and time
      const scheduledDateTimeString = `${scheduledDate}T${scheduledTime}:00`;
      const scheduledDateTime = new Date(scheduledDateTimeString);
      const nowUTC = new Date();

      // Create formatter for the interview timezone to get offset
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      // Get the offset between UTC and the interview timezone
      const parts = formatter.formatToParts(nowUTC);
      const tzYear = parseInt(parts.find((p) => p.type === "year").value);
      const tzMonth = parseInt(parts.find((p) => p.type === "month").value);
      const tzDay = parseInt(parts.find((p) => p.type === "day").value);
      const tzHour = parseInt(parts.find((p) => p.type === "hour").value);
      const tzMinute = parseInt(parts.find((p) => p.type === "minute").value);
      const tzSecond = parseInt(parts.find((p) => p.type === "second").value);

      const tzDateTime = new Date(
        tzYear,
        tzMonth - 1,
        tzDay,
        tzHour,
        tzMinute,
        tzSecond,
      );
      const offsetMs = nowUTC.getTime() - tzDateTime.getTime();

      // Apply timezone offset to scheduled time to get UTC equivalent
      const scheduledDateTimeUTC = new Date(
        scheduledDateTime.getTime() + offsetMs,
      );

      // Calculate window end time using configured expiry duration
      const windowEndUTC = new Date(
        scheduledDateTimeUTC.getTime() + expiryDuration * 60 * 1000,
      );

      // Return validation result
      return {
        hasStarted: nowUTC >= scheduledDateTimeUTC,
        hasExpired: nowUTC > windowEndUTC,
        isValid: nowUTC >= scheduledDateTimeUTC && nowUTC <= windowEndUTC,
      };
    } catch (error) {
      console.error("Error performing frontend validation:", error);
      return null;
    }
  };

  useEffect(() => {
    if (role !== "admin" || !INTERVIEW_ID) return;
    const SIGNALING_SERVER =
      process.env.REACT_APP_SIGNALING_SERVER ||
      "wss://talenttalks.vlinkinfo.com/api/ws/signaling";
    let disposed = false;
    let reconnectTimer = null;
    let stableTimer = null;
    let reconnectAttempt = 0;
    let generation = 0;

    const connect = () => {
      if (disposed || candidateEnded) return;
      const socketGeneration = ++generation;
      let mon;
      try {
        mon = new WebSocket(
          `${SIGNALING_SERVER}?interviewId=${INTERVIEW_ID}&role=admin&monitor=1`,
        );
      } catch (error) {
        console.error("Monitor socket creation failed:", error);
        scheduleReconnect();
        return;
      }
      monitorSocketRef.current = mon;
      const isCurrentSocket = () =>
        !disposed &&
        monitorSocketRef.current === mon &&
        generation === socketGeneration;

      mon.onmessage = (e) => {
        if (!isCurrentSocket()) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "candidate_status") {
            setCandidateOnline(Boolean(msg.connected));
            return;
          }
          if (
            msg.type === "offer" ||
            msg.type === "candidate" ||
            msg.type === "transcript"
          ) {
            setCandidateOnline(true);
          }
          if (msg.type === "transcript") {
            const txt =
              (msg.question || "").toString().toLowerCase() +
              " " +
              (msg.answer || "").toString().toLowerCase();
            if (
              txt.includes("interview finished") ||
              txt.includes("thank you")
            ) {
              setCandidateEnded(true);
              setCandidateOnline(false);
            }
          }
        } catch (err) {
          // ignore non-json
        }
      };

      mon.onopen = () => {
        if (!isCurrentSocket()) return;
        clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          reconnectAttempt = 0;
        }, 10000);
      };
      mon.onclose = () => {
        if (!isCurrentSocket()) return;
        monitorSocketRef.current = null;
        clearTimeout(stableTimer);
        setCandidateOnline(false);
        scheduleReconnect();
      };
      mon.onerror = () => {
        if (!isCurrentSocket()) return;
        setCandidateOnline(false);
        mon.close();
      };
    };

    const scheduleReconnect = () => {
      if (disposed || candidateEnded || reconnectTimer) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(stableTimer);
      reconnectTimer = null;
      generation += 1;
      const socket = monitorSocketRef.current;
      monitorSocketRef.current = null;
      try {
        socket?.close();
      } catch (error) {
        console.warn("Monitor socket cleanup failed:", error);
      }
    };
  }, [role, INTERVIEW_ID, candidateEnded]);

  // Fetch candidate name for admin monitoring UI
  useEffect(() => {
    if (role !== "admin" || !INTERVIEW_ID) return;

    const fetchAdminCandidateName = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_REST_BASE_URL}/interviews/${INTERVIEW_ID}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (data.candidateName) {
            setAdminCandidateName(data.candidateName);
          }
        }
      } catch (error) {
        console.error("Error fetching admin candidate name:", error);
      }
    };

    fetchAdminCandidateName();
  }, [role, INTERVIEW_ID]);

  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  useEffect(() => {
    if (role !== "candidate") return undefined;

    let active = true;
    const checkAvailability = async () => {
      const mediaDevices = navigator.mediaDevices;
      let hasMicrophone = false;
      let hasCamera = false;

      try {
        const devices = await mediaDevices?.enumerateDevices?.();
        hasMicrophone = devices?.some((device) => device.kind === "audioinput");
        hasCamera = devices?.some((device) => device.kind === "videoinput");
      } catch (error) {
        console.warn("Unable to list media devices for quick check:", error);
      }

      // Keep the checking animation visible before showing the real result.
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (!active) return;
      setQuickChecks({
        screen: mediaDevices?.getDisplayMedia ? "ready" : "error",
        microphone: hasMicrophone ? "ready" : "error",
        camera: hasCamera ? "ready" : "error",
        internet: navigator.onLine ? "ready" : "error",
      });
    };

    checkAvailability();
    const updateInternet = () =>
      setQuickChecks((current) => ({
        ...current,
        internet: navigator.onLine ? "ready" : "error",
      }));
    window.addEventListener("online", updateInternet);
    window.addEventListener("offline", updateInternet);
    return () => {
      active = false;
      window.removeEventListener("online", updateInternet);
      window.removeEventListener("offline", updateInternet);
    };
  }, [role]);

  const getUserFacingCameraStream = async ({
    width = 640,
    height = 480,
  } = {}) => {
    const baseVideo = {
      width: { ideal: width },
      height: { ideal: height },
    };

    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...baseVideo, facingMode: { exact: "user" } },
        audio: false,
      });
    } catch (exactErr) {
      console.warn("Front camera exact constraint failed:", exactErr);
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const frontCamera = devices.find(
        (device) =>
          device.kind === "videoinput" &&
          /front|user|face/i.test(device.label || ""),
      );

      if (frontCamera) {
        return await navigator.mediaDevices.getUserMedia({
          video: {
            ...baseVideo,
            deviceId: { exact: frontCamera.deviceId },
          },
          audio: false,
        });
      }
    } catch (deviceErr) {
      console.warn("Front camera device lookup failed:", deviceErr);
    }

    return navigator.mediaDevices.getUserMedia({
      video: { ...baseVideo, facingMode: "user" },
      audio: false,
    });
  };

  const isMobileDevice = () =>
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // iPadOS reports as "MacIntel" with touch support, so it needs the extra check.
  const isIOSDevice = () =>
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const ensureAudioGraph = async () => {
    if (window.__AI_AUDIO_CONTEXT__ && window.__AI_AUDIO_DESTINATION__) {
      audioContextRef.current = window.__AI_AUDIO_CONTEXT__;
      audioDestinationRef.current = window.__AI_AUDIO_DESTINATION__;
      return {
        audioContext: window.__AI_AUDIO_CONTEXT__,
        destination: window.__AI_AUDIO_DESTINATION__,
      };
    }

    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextImpl) {
      throw new Error("Web Audio API is not available in this browser");
    }

    const audioCtx = new AudioContextImpl();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const destination = audioCtx.createMediaStreamDestination();
    window.__AI_AUDIO_CONTEXT__ = audioCtx;
    window.__AI_AUDIO_DESTINATION__ = destination;
    audioContextRef.current = audioCtx;
    audioDestinationRef.current = destination;
    window.dispatchEvent(new CustomEvent("ai-audio-graph-ready"));

    return { audioContext: audioCtx, destination };
  };

  const stopMicAudioGraph = () => {
    try {
      if (micSourceRef.current) {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      }
    } catch (e) {
      console.warn("Error disconnecting mic source:", e);
    }

    try {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => {
          try {
            track.enabled = false;
            track.stop();
          } catch (e) {}
        });
        micStreamRef.current = null;
      }
    } catch (e) {
      console.warn("Error stopping mic stream:", e);
    }
  };

  const attachMicToAudioGraph = async () => {
    const currentTrack = micStreamRef.current?.getAudioTracks?.().find(
      (track) => track.readyState === "live",
    );
    if (currentTrack && micSourceRef.current) {
      return true;
    }
    if (micAttachPromiseRef.current) return micAttachPromiseRef.current;

    let audioCtx = audioContextRef.current || window.__AI_AUDIO_CONTEXT__;
    let destination =
      audioDestinationRef.current || window.__AI_AUDIO_DESTINATION__;

    if (!audioCtx || !destination) {
      const graph = await ensureAudioGraph();
      audioCtx = graph.audioContext;
      destination = graph.destination;
    }

    const attachPromise = (async () => {
      try {
        stopMicAudioGraph();

        if (audioCtx.state === "closed") {
          throw new Error("Shared audio context was closed before interview end");
        }
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }

        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        const micTrack = micStream.getAudioTracks()[0];
        if (!micTrack || micTrack.readyState !== "live") {
          micStream.getTracks().forEach((track) => track.stop());
          throw new Error("Microphone stream has no live audio track");
        }

        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(destination);
        micStreamRef.current = micStream;
        micSourceRef.current = micSource;

        audioContextRef.current = audioCtx;
        audioDestinationRef.current = destination;
        window.__AI_AUDIO_CONTEXT__ = audioCtx;
        window.__AI_AUDIO_DESTINATION__ = destination;
        return true;
      } catch (err) {
        console.error("Mic audio graph attach failed:", err);
        return false;
      } finally {
        micAttachPromiseRef.current = null;
      }
    })();

    micAttachPromiseRef.current = attachPromise;
    return attachPromise;
  };
  attachMicToAudioGraphRef.current = attachMicToAudioGraph;

  useEffect(() => {
    ensureAudioGraph().catch((err) =>
      console.warn("Audio graph init failed:", err),
    );

    window.__RELEASE_APP_MIC_FOR_STT__ = async () => {
      if (!isMobileDevice()) return;
      console.log("🎤 [APP] Releasing app mic for STT...");
      stopMicAudioGraph();
      // Fix 9: 700ms gives Android OS enough time to fully release the mic device
      await new Promise((resolve) => setTimeout(resolve, 1800));
      console.log("🎤 [APP] App mic released — STT can now start.");
    };

    window.__RESTORE_APP_MIC_AFTER_STT__ = async () => {
      if (!isMobileDevice()) return;
      console.log("🎤 [APP] Restoring app mic after STT...");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (window.__MIC_STARTED__) {
        console.warn("🎤 [APP] Deferring mic restore while SpeechRecognition is active.");
        return;
      }
      const restored = await attachMicToAudioGraphRef.current();
      if (!restored) {
        notify("error", "Recording microphone could not be restored. Check microphone permissions and device availability.");
        return;
      }
      console.log("🎤 [APP] App mic restored.");
    };

    window.__RESTORE_APP_MIC_FOR_RECORDING__ = async () => {
      if (window.__MIC_STARTED__) {
        console.warn("🎤 [APP] Deferring recording mic restore while SpeechRecognition is active.");
        recordingMicRestorePendingRef.current = true;
        if (!recordingMicRestoreTimerRef.current) {
          recordingMicRestoreTimerRef.current = setTimeout(() => {
            recordingMicRestoreTimerRef.current = null;
            if (recordingMicRestorePendingRef.current) {
              void window.__RESTORE_APP_MIC_FOR_RECORDING__?.();
            }
          }, 500);
        }
        return { restored: false, deferred: true };
      }
      const restored = await attachMicToAudioGraphRef.current();
      if (restored) {
        recordingMicRestorePendingRef.current = false;
        clearTimeout(recordingMicRestoreTimerRef.current);
        recordingMicRestoreTimerRef.current = null;
      }
      if (!restored) {
        notify("error", "Recording microphone could not be restored. Check microphone permissions and device availability.");
      }
      return { restored };
    };

    return () => {
      clearTimeout(recordingMicRestoreTimerRef.current);
      recordingMicRestoreTimerRef.current = null;
      recordingMicRestorePendingRef.current = false;
      window.__RELEASE_APP_MIC_FOR_STT__ = null;
      window.__RESTORE_APP_MIC_AFTER_STT__ = null;
      window.__RESTORE_APP_MIC_FOR_RECORDING__ = null;
    };
  }, [notify]);

  const handleCandidateEnded = () => {
    setCandidateEnded(true);
    setMonitoring(false);
    setCandidateOnline(false);
  };
  // ---------------- BROWSER / OS COMPATIBILITY CHECK ----------------
  const checkBrowserCompatibility = () => {
    const userAgent = navigator.userAgent || "";
    const platform = navigator.platform || "";

    console.log("🔍 RAW BROWSER INFO:", {
      userAgent,
      platform,
    });

    // IMPORTANT:
    // Do not apply browser restrictions on Android/iPhone/iPad.
    const isMobile =
      /Android|iPhone|iPad|iPod/i.test(userAgent) ||
      (platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if (isMobile) {
      console.log(
        "📱 Mobile device detected — skipping browser compatibility check",
      );

      return {
        supported: true,
        skipped: true,
        os: "Mobile",
        browser: "Mobile Browser",
      };
    }

    // Desktop OS detection
    const isWindows = /Windows NT/i.test(userAgent);
    const isMacOS = /Macintosh|Mac OS X/i.test(userAgent);

    // Browser detection
    const isEdge = /Edg\//i.test(userAgent) || /Edge\//i.test(userAgent);

    const isOpera = /OPR\//i.test(userAgent) || /Opera\//i.test(userAgent);

    const isFirefox =
      /Firefox\//i.test(userAgent) || /FxiOS\//i.test(userAgent);

    const isChrome = /Chrome\//i.test(userAgent) && !isEdge && !isOpera;

    const isSafari =
      /Safari\//i.test(userAgent) &&
      !isEdge &&
      !isOpera &&
      !isFirefox &&
      !isChrome;

    let os = "Unknown";
    let browser = "Unknown";

    if (isWindows) {
      os = "Windows";
    } else if (isMacOS) {
      os = "macOS";
    }

    if (isEdge) {
      browser = "Microsoft Edge";
    } else if (isOpera) {
      browser = "Opera";
    } else if (isFirefox) {
      browser = "Mozilla Firefox";
    } else if (isChrome) {
      browser = "Google Chrome";
    } else if (isSafari) {
      browser = "Safari";
    }

    const supported =
      (isWindows && (isChrome || isEdge)) ||
      (isMacOS && (isChrome || isEdge || isSafari));

    console.log("🌐 Browser Compatibility Check:", {
      os,
      browser,
      supported,
      userAgent,
      platform,
    });

    return {
      supported,
      skipped: false,
      os,
      browser,
    };
  };

  const requestEntireScreen = async () => {
    const activeStream = screenStreamRef.current;
    const activeVideoTrack = activeStream?.getVideoTracks?.()[0];

    if (activeVideoTrack?.readyState === "live") {
      return activeStream;
    }

    if (screenShareRequestRef.current) {
      return screenShareRequestRef.current;
    }

    const request = (async () => {
    try {
      console.log("🖥️ [SCREEN SHARE] Requesting screen share...");

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          cursor: "always",
        },
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];

      if (!videoTrack) {
        stream.getTracks().forEach((track) => track.stop());

        notify(
          "error",
          "Please select Entire Screen to continue the interview.",
        );

        return null;
      }

      const settings = videoTrack.getSettings();

      console.log("🖥️ [SCREEN SHARE] Selected display surface:", {
        displaySurface: settings.displaySurface,
        label: videoTrack.label,
      });

      if (settings.displaySurface !== "monitor") {
        console.warn(
          "🚫 [SCREEN SHARE] Candidate selected:",
          settings.displaySurface,
        );

        // Stop the incorrectly selected screen/window/tab
        stream.getTracks().forEach((track) => track.stop());

        // Show the error on the candidate UI
        setShowScreenShareError(true);

        notify(
          "error",
          "Please select Entire Screen. Chrome Tab and Window sharing are not allowed.",
        );

        // The screen picker may leave the selected Window/Tab focused.
        // Give the browser a moment to close the picker, then try to
        // restore focus to the TalentTalks interview page.
        const restoreInterviewFocus = () => {
          try {
            window.focus();

            // Some browsers respond better when focus is requested
            // more than once after the picker closes.
            setTimeout(() => {
              try {
                window.focus();
              } catch (e) {
                console.warn("Second focus restore failed:", e);
              }
            }, 300);
          } catch (e) {
            console.warn("Could not restore interview window focus:", e);
          }
        };

        requestAnimationFrame(() => {
          restoreInterviewFocus();
        });

        return null;
      }

      console.log("✅ [SCREEN SHARE] Entire Screen selected successfully");

      setShowScreenShareError(false);
      screenStreamRef.current = stream;
      videoTrack.addEventListener("ended", () => {
        if (screenStreamRef.current === stream) {
          screenStreamRef.current = null;
        }
      }, { once: true });

      return stream;
    } catch (err) {
      console.error("❌ [SCREEN SHARE FAILED]", err);

      notify(
        "error",
        `Screen Share failed: ${err?.name || "UnknownError"} - ${
          err?.message || "Unknown error"
        }`,
      );

      return null;
    }
    })();

    screenShareRequestRef.current = request;
    try {
      return await request;
    } finally {
      if (screenShareRequestRef.current === request) {
        screenShareRequestRef.current = null;
      }
    }
  };

  const startInterview = async () => {
    try {
      // Check if screen share is supported
      const screenShareSupported = !!(
        navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia
      );

      let out = new MediaStream();
      let screenStream = null;

      // 1) Try screen share first if supported
      if (screenShareSupported && !isMobileDevice()) {
        screenStream = await requestEntireScreen();

        if (!screenStream) {
          return;
        }

        // Request fullscreen as soon as the screen picker closes, before
        // subsequent media setup can further delay the browser's decision.
        await requestInterviewFullscreen();

        screenStream.getVideoTracks().forEach((track) => {
          out.addTrack(track);
        });
      }

      // 2) AUDIO MIXING (MIC + AI)
      const { audioContext: audioCtx, destination } = await ensureAudioGraph();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      // 🔴 STORE IN REF FOR CLEANUP
      audioContextRef.current = audioCtx;
      audioDestinationRef.current = destination;

      // 🎤 Mic audio
      const micReady = await attachMicToAudioGraph();
      if (!micReady) {
        notify("error", "Please allow Microphone access.");
        return;
      }

      if (isMobileDevice()) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // 🌍 Expose destination globally for AI voice (VoiceInterview.jsx)
      window.__AI_AUDIO_DESTINATION__ = destination;

      // 🎧 Mixed audio track (mic + AI)
      destination.stream.getAudioTracks().forEach((t) => out.addTrack(t));

      // 3) Get camera stream (always needed - front-facing first)
      let cam;
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      try {
        if (isMobile) {
          cam = await getUserFacingCameraStream();
        } else {
          cam = await getUserFacingCameraStream();
        }
      } catch (err) {
        console.warn(
          "Front camera not available or selection failed, falling back to any camera",
          err,
        );
        cam = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
      }

      setCameraStream(cam);

      if (cam) {
        const videoTrack = cam.getVideoTracks()[0];
        if (videoTrack) {
          console.log("Camera selected:", videoTrack.getSettings());
        }
      }

      // If no screen share (mobile), add camera to shared stream
      if (!screenStream) {
        cam.getVideoTracks().forEach((t) => out.addTrack(t));
      }

      setSharedStream(out);

      setStarted(true);

      setShowFeedback(false);
      setStopVideo(false);
    } catch (err) {
      console.error("Failed to start interview:", err);
      notify("error", "Please allow Microphone and Camera access.");
    }
  };

  // Track tab switch count and show warning overlay
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [showTabWarning, setShowTabWarning] = useState(false);

  // Handle tab switch detection
  useEffect(() => {
    if (role !== "candidate" || !started) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchCount((prev) => prev + 1);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [role, started]);

  // Respond to tab switches
  useEffect(() => {
    if (role !== "candidate" || tabSwitchCount === 0) return;

    if (tabSwitchCount === 1 || tabSwitchCount === 2) {
      setShowTabWarning(true); // ✅ only show, no auto-hide
      notify(
        "warning",
        `⚠️ You switched tabs (${tabSwitchCount}/3). Please stay on the interview window.`,
      );
    }

    if (tabSwitchCount >= 3) {
      (async () => {
        notify("error", "🚫 Interview ended due to multiple tab switches.");
        await endInterview();

        // 👇 Ensure UI cleanup happens properly
        setStarted(false);
        setStopVideo(true);
        setShowFeedback(true);

        // Optionally exit fullscreen too
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      })();
    }
  }, [tabSwitchCount, role]);
  // Handle tab/window close and page refresh detection
  useEffect(() => {
    if (role !== "candidate" || !started) return;

    // ❌ Do NOT call API here — only show warning popup
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    // ✅ Call End Interview API ONLY when user actually leaves the page
    const handlePageHide = () => {
      if (INTERVIEW_ID) {
        navigator.sendBeacon(
          `${process.env.REACT_APP_REST_BASE_URL}/interview_ai/end_interview/${INTERVIEW_ID}`,
          JSON.stringify({ forced: true }),
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [role, started, INTERVIEW_ID]);

  const handleEndInterviewDecision = async (confirmed) => {
    // If user cancels
    if (!confirmed) {
      if (endInterviewConfirmSource === "voice") {
        voiceInterviewRef.current?.sendEndInterviewDecision(false);
      }

      setShowEndInterviewConfirm(false);
      return;
    }

    // User confirmed ending
    setEndingInterview(true);

    // Tell VoiceInterview/backend that AI end request was confirmed
    if (endInterviewConfirmSource === "voice") {
      voiceInterviewRef.current?.sendEndInterviewDecision(true);
    }

    // Close confirmation popup
    setShowEndInterviewConfirm(false);

    try {
      // Submit ALL coding questions before ending the interview
      if (
        endInterviewConfirmSource === "manual" &&
        showCodingApp &&
        allCodingQuestions.length > 0
      ) {
        notify(
          "info",
          "Submitting all coding answers..."
        );
    
        await codingAppRef.current?.submitAllCodingAnswers();
    
        notify(
          "success",
          "All coding answers submitted successfully."
        );
      }
    
      // Now actually end the interview
      await endInterview();
    
      setStarted(false);
      setShowFeedback(true);
      setShowCodingApp(false);
      setStopVideo(true);
    
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch (e) {
        console.warn("Error exiting fullscreen:", e);
      }
    } catch (error) {
      console.error(
        "Error while submitting coding answers / ending interview:",
        error
      );
    
      notify(
        "error",
        error?.message ||
          "Failed to submit coding answers. Interview was not ended."
      );
    
      setEndingInterview(false);
    }
  };

  const openEndInterviewConfirmation = () => {
    setEndInterviewConfirmSource("manual");
    setShowEndInterviewConfirm(true);
  };

  const handleVoiceEndInterviewRequest = () => {
    setEndInterviewConfirmSource("voice");
    setShowEndInterviewConfirm(true);
  };

  const endInterview = async () => {
    setInterviewEnded(true);
    try {
      const res = await fetch(
        `${process.env.REACT_APP_REST_BASE_URL}/interview_ai/end_interview/${INTERVIEW_ID}`,
        { method: "POST", keepalive: true },
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("❌ Failed to end interview:", errorData);
      } else {
        const data = await res.json();
        console.log("✅ Interview ended:", data);
      }
    } catch (error) {
      console.error("⚠️ Error ending interview:", error);
    } finally {
      // 🛑 STOP ALL TEXT-TO-SPEECH
      try {
        window.speechSynthesis?.cancel();
      } catch (e) {}

      stopMicAudioGraph();

      // 🛑 STOP MICROPHONE STREAM (used in audio context)
      try {
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch (e) {}
          });
          micStreamRef.current = null;
        }
      } catch (e) {
        console.warn("Error stopping micStream in endInterview:", e);
      }

      // 🛑 CLOSE AUDIO CONTEXT
      try {
        if (audioContextRef.current) {
          if (audioContextRef.current.state !== "closed") {
            await audioContextRef.current.close();
          }
          audioContextRef.current = null;
          audioDestinationRef.current = null;
        }
      } catch (e) {
        console.warn("Error closing audioContext in endInterview:", e);
      }

      // 🛑 CLEAR GLOBAL AUDIO DESTINATION
      try {
        window.__AI_AUDIO_DESTINATION__ = null;
      } catch (e) {}

      // 🛑 STOP SHARED STREAM (screen + mixed audio)
      try {
        if (sharedStream) {
          sharedStream.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch (e) {}
          });
          setSharedStream(null);
        }
      } catch (e) {
        console.warn("Error stopping sharedStream in endInterview:", e);
      }

      // 🛑 STOP CAMERA STREAM
      try {
        if (cameraStream) {
          cameraStream.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch (e) {}
          });
          setCameraStream(null);
        }
      } catch (e) {
        console.warn("Error stopping cameraStream in endInterview:", e);
      }

      // 🛑 STOP ALL AUDIO ELEMENTS
      try {
        const audioElements = document.querySelectorAll("audio");
        audioElements.forEach((audio) => {
          audio.pause();
          audio.srcObject = null;
        });
      } catch (e) {}

      setCandidateEnded(true);
      setInterviewEnded(true);
    }
  };
  useEffect(() => {
    if (INTERVIEW_ID) {
      localStorage.setItem("interviewId", INTERVIEW_ID);

      // Skip validation for admin monitoring UI
      if (role === "admin") {
        setValidation({ loading: false, ok: true });
        return;
      }

      (async () => {
        setValidation({ loading: true });

        // Fetch interview settings first to get the configured expiry duration
        let expiryDuration = 30;
        try {
          const settings = await getInterviewSettings();
          expiryDuration = settings.INTERVIEW_LINK_EXPIRY || 30;
          setInterviewLinkExpiry(expiryDuration);
        } catch (error) {
          console.error("Error fetching interview settings:", error);
          setInterviewLinkExpiry(30);
        }

        // Fetch interview details
        const interviewDetails = await fetchInterviewDetails(INTERVIEW_ID);
        let secondCameraEnabled = false;
        let systemCheckEnabled = false;

        if (interviewDetails) {
          console.log("✅ Interview details fetched:", interviewDetails);
          secondCameraEnabled = interviewDetails.secondCameraEnabled || false;
          systemCheckEnabled = interviewDetails.systemCheckEnabled || false;
        }

        // Then validate the interview link
        let result = await validateInterviewLink(INTERVIEW_ID);

        // If backend returns 403 with "expired" error, perform frontend-side validation using expiry duration
        if (
          !result.ok &&
          result.status === "forbidden" &&
          result.message &&
          result.message.toLowerCase().includes("expired") &&
          result.scheduled_date &&
          result.scheduled_time &&
          result.interview_timezone
        ) {
          const frontendValidation = performFrontendValidation(
            result.scheduled_date,
            result.scheduled_time,
            result.interview_timezone,
            expiryDuration,
          );

          if (frontendValidation && frontendValidation.isValid) {
            // Frontend validation says it's still valid, override the backend response
            console.log(
              "ℹ️ Frontend validation overrides backend 403: Interview link is still valid",
            );
            result = {
              ok: true,
              status: "valid",
              message: "Interview link is valid",
              scheduled_date: result.scheduled_date,
              scheduled_time: result.scheduled_time,
              interview_timezone: result.interview_timezone,
              interview_duration: result.interview_duration || 30,
              candidate_name: result.candidate_name,
            };
          } else if (frontendValidation && frontendValidation.hasExpired) {
            // Frontend validation confirms it's expired
            console.log(
              "✅ Frontend validation confirms: Interview link is expired",
            );
          } else if (frontendValidation && !frontendValidation.hasStarted) {
            // Interview hasn't started yet
            console.log(
              "ℹ️ Frontend validation: Interview has not started yet",
            );
          }
        }

        setValidation({
          loading: false,
          ...result,
          second_camera_enabled: secondCameraEnabled,
          system_check_enabled: systemCheckEnabled,
          expiry_duration: expiryDuration,
        });
      })();
    }
  }, [INTERVIEW_ID, role]);

  if (showFeedback) return <Feedback />;

  if (validation.loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        ⏳ Checking interview link...
      </div>
    );
  }
  if (!validation.ok) {
    const {
      message,
      scheduled_date,
      scheduled_time,
      interview_timezone,
      expiry_duration,
    } = validation;

    // Enhance the error message with expiry duration if the interview link has expired
    let enhancedMessage = message;
    if (
      message &&
      message.toLowerCase().includes("expired") &&
      expiry_duration
    ) {
      enhancedMessage = `${message} The interview link is valid for ${expiry_duration} minutes from the scheduled start time.`;
    }

    return (
      <>
        <ValidationPanel
          variant="error"
          title="Access Denied"
          description={enhancedMessage}
          scheduled_date={scheduled_date}
          scheduled_time={scheduled_time}
          interviewTimezone={interview_timezone}
          actions={
            <a
              href="/"
              className="px-4 py-2 rounded-md bg-[#0F766E] text-white"
            >
              Go to home
            </a>
          }
        />
      </>
    );
  }
  // Timezone-aware validation of interview timing
  if (!started && role !== "admin") {
    const {
      scheduled_date,
      scheduled_time,
      interview_timezone,
      interview_duration,
    } = validation;

    // If scheduled date/time/timezone are present, perform the time check
    if (scheduled_date && scheduled_time && interview_timezone) {
      try {
        // Parse the scheduled date and time
        const [year, month, day] = scheduled_date.split("-").map(Number);
        const [hour, minute] = scheduled_time.split(":").map(Number);

        // Create a date string in ISO format (YYYY-MM-DDTHH:mm:ss)
        const scheduledDateTimeString = `${scheduled_date}T${scheduled_time}:00`;
        const scheduledDateTime = new Date(scheduledDateTimeString);

        // Get current time in UTC
        const nowUTC = new Date();

        // Create formatter for the interview timezone to get offset
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: interview_timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        // Get the offset between UTC and the interview timezone
        const parts = formatter.formatToParts(nowUTC);
        const tzYear = parseInt(parts.find((p) => p.type === "year").value);
        const tzMonth = parseInt(parts.find((p) => p.type === "month").value);
        const tzDay = parseInt(parts.find((p) => p.type === "day").value);
        const tzHour = parseInt(parts.find((p) => p.type === "hour").value);
        const tzMinute = parseInt(parts.find((p) => p.type === "minute").value);
        const tzSecond = parseInt(parts.find((p) => p.type === "second").value);

        const tzDateTime = new Date(
          tzYear,
          tzMonth - 1,
          tzDay,
          tzHour,
          tzMinute,
          tzSecond,
        );
        const offsetMs = nowUTC.getTime() - tzDateTime.getTime();

        // Apply timezone offset to scheduled time to get UTC equivalent
        const scheduledDateTimeUTC = new Date(
          scheduledDateTime.getTime() + offsetMs,
        );

        // Calculate window end time using configured expiry duration
        const windowEndUTC = new Date(
          scheduledDateTimeUTC.getTime() + interviewLinkExpiry * 60 * 1000,
        );

        // Check if interview hasn't started yet
        if (nowUTC < scheduledDateTimeUTC) {
          return (
            <>
              <ValidationPanel
                variant="warn"
                title="Interview link not yet active"
                description={`Your interview is scheduled on ${scheduled_date} at ${scheduled_time} (${interview_timezone}).`}
                scheduled_date={scheduled_date}
                scheduled_time={scheduled_time}
                interviewTimezone={interview_timezone}
                actions={
                  <a
                    className="px-4 py-2 rounded-md bg-[#0F766E] text-white"
                    href="/"
                  >
                    Contact support
                  </a>
                }
              />
            </>
          );
        }

        // Check if interview has expired
        if (nowUTC > windowEndUTC) {
          return (
            <>
              <ValidationPanel
                variant="error"
                title="Interview link expired"
                description={`The scheduled interview was on ${scheduled_date} at ${scheduled_time} (${interview_timezone}). The interview link is valid for ${interviewLinkExpiry} minutes from the scheduled start time.`}
                scheduled_date={scheduled_date}
                scheduled_time={scheduled_time}
                interviewTimezone={interview_timezone}
                actions={
                  <a
                    className="px-4 py-2 rounded-md bg-[#0F766E] text-white"
                    href="/"
                  >
                    Go to home
                  </a>
                }
              />
            </>
          );
        }
      } catch (error) {
        console.error("Error processing scheduled time:", error);
        return (
          <ValidationPanel
            variant="error"
            title="Validation Error"
            description="There was an issue validating the interview time. Please contact support."
            actions={
              <a
                className="px-4 py-2 rounded-md bg-[#0F766E] text-white"
                href="/support"
              >
                Contact support
              </a>
            }
          />
        );
      }
    }
    return (
      <div className="candidate-landing min-h-screen flex flex-col bg-white text-[#4a5163]">
        {/* Header */}
        <PublicHeader />

        {/* Main Section */}
        <main className="relative flex-grow overflow-hidden bg-gradient-to-b from-[#f7f4fe] to-[#fbfaff] px-4 py-11 sm:px-8 sm:py-16">
          <span aria-hidden="true" className="absolute -left-60 -top-52 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#eee6ff,transparent_68%)]" />
          <span aria-hidden="true" className="absolute -right-80 top-32 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,#ebe1ff_45%,transparent_70%)]" />
          <span aria-hidden="true" className="candidate-ring absolute left-10 top-[76px] z-0 h-[60px] w-[60px] rounded-full bg-[#ede5fd]" />
          <span aria-hidden="true" className="candidate-dots candidate-dots-right absolute right-[3%] top-7 h-24 w-24" />
          <span aria-hidden="true" className="candidate-dots candidate-dots-left absolute left-[3%] top-[58%] h-24 w-24" />
          <div className="relative mx-auto max-w-[1240px] text-center">
            {/* Header Section */}
            <div className="mb-10">
              <h1 className="text-[clamp(32px,4vw,54px)] font-extrabold leading-[1.12] tracking-tight text-[#191f2d] mb-3">
                Welcome to{" "}
                <span className="bg-gradient-to-r from-[#4b1498] via-[#6a2bc8] to-[#7b3be0] bg-clip-text text-transparent">
                  Your Viriqo Hires
                </span>
              </h1>
              <p className="mx-auto mb-8 max-w-[680px] text-[clamp(16px,1.4vw,19px)] leading-relaxed text-[#4a5163]">
                You're about to begin an AI-powered interview experience. Get
                ready to showcase your skills in a modern, interactive
                environment.
              </p>
            </div>
            {/* Process Overview */}
            <div className="mb-10 mt-16">
              <h2 className="mb-8 text-[clamp(24px,2.2vw,30px)] font-bold tracking-tight text-[#191f2d]">
                How It Works
              </h2>
              <div className="grid grid-cols-1 gap-6 max-w-[1240px] mx-auto md:grid-cols-3">
                <div className="relative rounded-[14px] border border-[#ece8f5] bg-white/85 p-7 pb-[30px] shadow-sm transition hover:-translate-y-1.5 hover:border-[#d9c9f7] hover:shadow-[0_22px_44px_-22px_rgba(75,20,152,.35)]">
                  <span aria-hidden="true" className="absolute left-[30px] top-[30px] grid h-[50px] w-[50px] place-items-center rounded-full bg-[#ede5fd] text-xl font-bold text-[#4b1498]">1</span>
                  <div className="mx-auto mb-3.5 grid h-[76px] w-[76px] place-items-center rounded-full bg-[#ede5fd] text-[#4b1498]">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V11M8 8h5M8 12h4M8 16h3M19.2 4.3a1.7 1.7 0 0 1 2.4 2.4l-6.4 6.4-3.2.8.8-3.2 6.4-6.4Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-[#191f2d]">
                    Answer Questions
                  </h3>
                  <p className="text-[#4a5163] text-base leading-relaxed">
                    Respond to AI-generated questions tailored to your role.
                  </p>
                </div>

                <div className="relative rounded-[14px] border border-[#ece8f5] bg-white/85 p-7 pb-[30px] shadow-sm transition hover:-translate-y-1.5 hover:border-[#d9c9f7] hover:shadow-[0_22px_44px_-22px_rgba(75,20,152,.35)]">
                  <span aria-hidden="true" className="absolute left-[30px] top-[30px] grid h-[50px] w-[50px] place-items-center rounded-full bg-[#ede5fd] text-xl font-bold text-[#4b1498]">2</span>
                  <div className="mx-auto mb-3.5 grid h-[76px] w-[76px] place-items-center rounded-full bg-[#ede5fd] text-[#4b1498]">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-[#191f2d]">
                    Showcase Skills
                  </h3>
                  <p className="text-[#4a5163] text-base leading-relaxed">
                    Demonstrate your problem-solving abilities and expertise.
                  </p>
                </div>

                <div className="relative rounded-[14px] border border-[#ece8f5] bg-white/85 p-7 pb-[30px] shadow-sm transition hover:-translate-y-1.5 hover:border-[#d9c9f7] hover:shadow-[0_22px_44px_-22px_rgba(75,20,152,.35)]">
                  <span aria-hidden="true" className="absolute left-[30px] top-[30px] grid h-[50px] w-[50px] place-items-center rounded-full bg-[#ede5fd] text-xl font-bold text-[#4b1498]">3</span>
                  <div className="mx-auto mb-3.5 grid h-[76px] w-[76px] place-items-center rounded-full bg-[#ede5fd] text-[#4b1498]">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="13" width="4" height="7" rx="1.2" stroke="currentColor" strokeWidth="2" /><rect x="10" y="8.5" width="4" height="11.5" rx="1.2" stroke="currentColor" strokeWidth="2" /><rect x="16.5" y="3.5" width="4" height="16.5" rx="1.2" stroke="currentColor" strokeWidth="2" /></svg>
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-[#191f2d]">
                    Get Feedback
                  </h3>
                  <p className="text-[#4a5163] text-base leading-relaxed">
                    Receive detailed analysis of your performance.
                  </p>
                </div>
              </div>
            </div>
            {/* Tech Requirements */}
            <div className="mb-10 mt-[72px] max-w-[1060px] mx-auto">
              <h2 className="mb-8 text-[clamp(24px,2.2vw,30px)] font-bold tracking-tight text-[#191f2d]">
                Quick Tech Check
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
                {[
                  ["screen", "Screen Share", "M2.5 3.5h19v13h-19zM8 20.5h8M12 16.5v4"],
                  ["microphone", "Microphone", "M8.5 2.5h7v12h-7zM5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7"],
                  ["camera", "Camera", "M12 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 4.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2ZM6 21.5h12"],
                  ["internet", "Internet", "M2 8.5a15 15 0 0 1 20 0M5.2 12a10.5 10.5 0 0 1 13.6 0M8.5 15.4a5.6 5.6 0 0 1 7 0M12 19h.01"],
                ].map(([key, label, path]) => {
                  const status = quickChecks[key];
                  const isChecking = status === "checking";
                  const isReady = status === "ready";
                  return (
                  <div key={label} className="candidate-check flex items-start gap-4 rounded-xl border border-[#ece8f5] bg-white/90 p-[22px] pb-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-[0_18px_36px_-20px_rgba(75,20,152,.32)]">
                    <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-[#f3eefd] text-[#4b1498]">
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={path} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <div>
                      <h3 className="mb-3 mt-1.5 text-[17px] font-semibold text-[#191f2d]">{label}</h3>
                      <span className={`inline-flex h-[38px] items-center gap-2 rounded-lg px-3.5 text-base font-medium ${isChecking ? "bg-[#f3eefd] text-[#4b1498]" : isReady ? "bg-[#e8f7ee] text-[#167a43]" : "bg-red-50 text-red-700"}`}>
                        {isChecking ? <span className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-[2.5px] border-[#4b1498]/20 border-t-[#4b1498]" /> : isReady ? <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#16a34a" /><path d="m6 10.3 2.6 2.6L14 7.6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg> : <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-600 text-xs text-white">!</span>}
                        {isChecking ? "Checking" : isReady ? "Ready" : "Unavailable"}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
              <p className="mx-auto mt-7 max-w-[940px] text-sm sm:text-base leading-relaxed text-[#4a5163]">
                <i className="fas fa-info-circle mr-1"></i>
                Devices required for screen sharing, monitoring (for fair
                recordings). Mobile devices supported with camera access.
              </p>
            </div>
            {/* Start Button */}
            <button
              onClick={() => {
                const compatibility = checkBrowserCompatibility();

                console.log("🔍 Interview compatibility:", compatibility);

                if (!compatibility.supported) {
                  notify(
                    "error",
                    `Unsupported browser/system. You are using ${compatibility.browser} on ${compatibility.os}. Please use Google Chrome or Microsoft Edge on Windows, or Google Chrome, Microsoft Edge, or Safari on macOS.`,
                  );

                  return;
                }

                // Supported desktop browser OR mobile device
                setShowGuidelines(true);
              }}
              className="mt-4 inline-flex h-[60px] w-full items-center justify-center rounded-[10px] bg-gradient-to-r from-[#4b1498] via-[#5b1fc0] to-[#6a2be0] px-5 text-[17.5px] font-bold text-white shadow-[0_18px_36px_-16px_rgba(75,20,152,.6)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-16px_rgba(75,20,152,.7)] sm:h-[72px] sm:w-auto sm:px-11 sm:text-[21px]"
            >
              <span className="mr-2">🚀</span> Start Interview Now
            </button>
          </div>
        </main>
        {showGuidelines && (
          /* ── Mobile-friendly overlay: fills the whole screen, allows touch scroll ── */
          <div className="guidelines-overlay fixed inset-0 z-50 grid place-items-end bg-[rgba(25,31,45,.42)] p-3 backdrop-blur-[6px] sm:place-items-center sm:p-6">
            {/* Modal: flex-col so header + scroll-body + footer stack correctly;
                max-height ensures it never overflows the viewport on mobile */}
            <div
              className="guidelines-modal relative flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-[18px] bg-white font-['Inter',sans-serif] text-[#191F2D] shadow-[0_40px_90px_-30px_rgba(25,31,45,.55)] sm:max-h-[calc(100dvh-48px)] sm:max-w-[760px] sm:rounded-[20px]"
            >
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                <span className="absolute -right-24 -top-24 h-[390px] w-[390px] rounded-full bg-[#f3effc]" />
                <span className="absolute -right-24 top-[112px] h-[300px] w-[300px] rounded-full bg-[#eee8fc]" />
                <span className="absolute -left-24 -top-24 h-[210px] w-[310px] rounded-full bg-[#f7f4fc]" />
                <span className="absolute right-[175px] top-[98px] h-[85px] w-[120px] bg-[radial-gradient(#cdbdf0_2px,transparent_2.5px)] bg-[length:22px_20px]" />
              </div>
              {/* ❌ Close Button */}
              <button
                onClick={() => setShowGuidelines(false)}
                className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-white/70 text-[#4A5163] transition duration-200 hover:rotate-90 hover:bg-white hover:text-[#4B1498] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A66FFF] sm:right-[22px] sm:top-[22px]"
                aria-label="Close Guidelines"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              </button>

              {/* Header — fixed at top, never scrolls away */}
              <div className="guidelines-body relative z-[1] flex-none px-[22px] pt-10 sm:px-[70px] sm:pt-[22px]">
                <h2 className="pr-12 text-[28px] font-extrabold leading-[1.1] tracking-[-.025em] sm:text-[36px]">
                  Interview <span className="bg-gradient-to-r from-[#4B1498] to-[#6A2BE0] bg-clip-text text-transparent">Guidelines</span>
                </h2>
                <p className="guidelines-subtitle">Before we begin, please make sure to:</p>
              </div>

              {/* Content — scrollable on mobile */}
              <div className="guidelines-content relative z-[1] flex-1 overflow-y-auto overscroll-contain px-[22px] pb-6 text-[#191F2D] sm:px-[70px] sm:pb-[26px]">
                <ul className="guidelines-list grid max-w-[690px] text-[15px] sm:text-base">
                  <li><span className="guidelines-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M8 20.5h8M12 16.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span><div><h3>Desktop required for full recording experience</h3><p>(screen sharing is mandatory). Mobile devices work with camera only.</p></div></li>
                  <li><span className="guidelines-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.2 12a10.5 10.5 0 0 1 13.6 0M8.5 15.4a5.6 5.6 0 0 1 7 0" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg></span><div><h3>Have a reliable internet connection</h3><p>and ensure your webcam and microphone are working properly.</p></div></li>
                  <li><span className="guidelines-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="4.5" width="14" height="17" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span><div><h3>Choose a quiet, well-lit environment</h3><p>that minimizes distractions.</p></div></li>
                  <li><span className="guidelines-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="7.5" r="4" stroke="currentColor" strokeWidth="2"/><path d="M4.5 20.5v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span><div><h3>Dress in professional attire</h3><p>appropriate for the interview setting.</p></div></li>
                  <li><span className="guidelines-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/></svg></span><div><h3>Speak clearly, and maintain eye contact</h3><p>by looking into the camera.</p></div></li>
                </ul>
                <ul className="guidelines-list legacy-guidelines-list mt-6 grid max-w-[690px] gap-[18px] text-[15px] sm:gap-4 sm:text-base" aria-hidden="true">
                  <li className="flex gap-4 leading-[1.5] text-[#4A5163] sm:gap-6"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-[#EEE8FC] text-[#4B1498] sm:h-14 sm:w-14 sm:rounded-xl"><svg width="27" height="27" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="3.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M8 20.5h8M12 16.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span><span><strong className="block text-base leading-[1.4] text-[#191F2D] sm:text-lg">Desktop required for full recording experience</strong>(screen sharing is mandatory). Mobile devices work with camera only.</span>
                  </li>
                  <li className="flex gap-4 leading-[1.5] text-[#4A5163] sm:gap-6"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-[#EEE8FC] text-[#4B1498] sm:h-14 sm:w-14 sm:rounded-xl"><svg width="27" height="27" viewBox="0 0 24 24" fill="none"><path d="M2 8.5a15 15 0 0 1 20 0M5.2 12a10.5 10.5 0 0 1 13.6 0M8.5 15.4a5.6 5.6 0 0 1 7 0" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg></span><span><strong>Have a reliable internet connection</strong><p>and ensure your webcam and microphone are working properly.</p></span>
                  </li>
                  <li className="flex gap-4 leading-[1.5] text-[#4A5163] sm:gap-6"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-[#EEE8FC] text-[#4B1498] sm:h-14 sm:w-14 sm:rounded-xl">⌑</span><span>
                    Choose a quiet, well-lit environment that minimizes
                    distractions.</span>
                  </li>
                  <li className="flex gap-4 leading-[1.5] text-[#4A5163] sm:gap-6"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-[#EEE8FC] text-[#4B1498] sm:h-14 sm:w-14 sm:rounded-xl">♙</span><span>
                    Dress in professional attire appropriate for the interview
                    setting.</span>
                  </li>
                  <li className="flex gap-4 leading-[1.5] text-[#4A5163] sm:gap-6"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-[#EEE8FC] text-[#4B1498] sm:h-14 sm:w-14 sm:rounded-xl">◉</span><span>
                    Speak clearly, and maintain eye contact by looking into the
                    camera.</span>
                  </li>
                </ul>

                {/* ✅ Important Notice Section */}
                <div className="guidelines-notice mt-7 flex gap-3 rounded-xl border-l-4 border-[#e11d48] bg-[#fdeef1] p-4 sm:gap-5 sm:px-[26px] sm:py-5">
                  <span className="bang" aria-hidden="true">!</span>
                  <div>
                    <h4 className="text-sm sm:text-lg font-bold text-red-700 mb-1 sm:mb-2">
                      Important Notice:
                    </h4>
                    <p className="text-xs sm:text-base font-medium text-gray-800 dark:text-gray-300 leading-relaxed">
                      During this interview, you are expected to demonstrate your
                      own skills and knowledge without assistance from any
                      external resources, including but not limited to ChatGPT, AI
                      tools, search engines, or collaboration with others. Use of
                      such aids is strictly prohibited and will result in
                      immediate disqualification. By attending the interview, you
                      confirm that all responses will be your own unaided work.
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer — always pinned at bottom, never hidden */}
              <div className="guidelines-footer relative z-[1] flex flex-none justify-center border-t border-[#ECE8F5] bg-white px-5 py-4 sm:px-6 sm:py-[18px]">
                <button
                  onClick={async () => {
                    // 🔓 iOS FIX: speechSynthesis.speak() is silently ignored on
                    // iPhone/iPad unless speak() has been called at least once
                    // directly inside a user gesture (tap/click), with nothing
                    // awaited beforehand. Every later speak() call fired async
                    // from the websocket (the actual interview questions) then
                    // works for the rest of the session. This does nothing on
                    // desktop/Android but is required on iOS — must stay first.
                    if (isIOSDevice()) {
                      try {
                        window.speechSynthesis.cancel();
                        const unlockUtterance = new SpeechSynthesisUtterance(
                          " ",
                        );
                        unlockUtterance.volume = 0.01;
                        window.speechSynthesis.speak(unlockUtterance);
                        window.__TTS_UNLOCKED__ = true;
                      } catch (e) {
                        console.warn("iOS speechSynthesis unlock failed:", e);
                      }

                      // 🔓 iOS FIX: priming SpeechRecognition inside the same
                      // gesture surfaces the mic permission prompt immediately
                      // and reduces "not-allowed"/silent-fail starts later when
                      // recognition.start() is called async after TTS ends.
                      try {
                        const SR =
                          window.SpeechRecognition ||
                          window.webkitSpeechRecognition;
                        if (SR) {
                          const primer = new SR();
                          primer.onstart = () => {
                            try {
                              primer.stop();
                            } catch (e) {}
                          };
                          primer.onerror = () => {};
                          primer.start();
                        }
                      } catch (e) {
                        console.warn(
                          "iOS SpeechRecognition priming failed:",
                          e,
                        );
                      }
                    }

                    // Resume AudioContext on user interaction (critical for mobile)
                    try {
                      if (window.__AI_AUDIO_DESTINATION__?.context) {
                        const ctx = window.__AI_AUDIO_DESTINATION__.context;
                        if (ctx.state === "suspended") {
                          await ctx.resume();
                        }
                      } else {
                        const tempCtx = new (
                          window.AudioContext || window.webkitAudioContext
                        )();
                        if (tempCtx.state === "suspended") {
                          await tempCtx.resume();
                        }
                        tempCtx.close();
                      }
                    } catch (e) {
                      console.warn(
                        "Error with AudioContext on user interaction",
                        e,
                      );
                    }

                    const granted = await requestPermissions();
                    if (!granted) {
                      notify(
                        "error",
                        "Please allow microphone and camera access.",
                      );
                      return;
                    }

                    setShowGuidelines(false);

                    await new Promise((resolve) => setTimeout(resolve, 500));

                    // Determine which section to show next based on enabled settings
                    if (validation.system_check_enabled) {
                      setShowSystemCheck(true);
                    } else if (validation.second_camera_enabled) {
                      setShowSecondCameraQR(true);
                    } else {
                      startInterview();
                    }
                  }}
                  className="guidelines-continue relative inline-flex h-[54px] w-full items-center justify-center gap-3.5 overflow-hidden rounded-[10px] bg-gradient-to-r from-[#4B1498] via-[#5B1FC0] to-[#6A2BE0] px-9 text-lg font-bold text-white shadow-[0_18px_36px_-16px_rgba(75,20,152,.6)] transition hover:-translate-y-0.5 sm:h-[54px] sm:w-auto sm:text-[17px]"
                >
                  Continue
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </div>
          </div>
        )}
        {showSystemCheck && (
          <SystemCheckModal
            interviewId={INTERVIEW_ID}
            onPass={() => {
              setShowSystemCheck(false);
              // Determine which section to show next
              if (validation.second_camera_enabled) {
                setShowSecondCameraQR(true);
              } else {
                // Second Camera disabled, proceed directly to interview
                setTimeout(() => startInterview(), 50);
              }
            }}
            onClose={() => setShowSystemCheck(false)}
          />
        )}
        {showSecondCameraQR && (
          <SecondCameraQRModal
            interviewId={INTERVIEW_ID}
            onProceed={() => {
              setShowSecondCameraQR(false);
              setTimeout(() => startInterview(), 50); // Proceed to start interview
            }}
            onClose={() => setShowSecondCameraQR(false)} // Fallback close
          />
        )}
        {showScreenShareError && (
          <div className="fixed inset-0 z-[1300] bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 text-center border border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                Entire Screen Required
              </h2>

              <p className="text-gray-600 dark:text-gray-300 mb-6">
                Please choose <strong>Entire Screen</strong> from the screen
                sharing options to continue the interview.
              </p>

<button
onClick={async () => {
  setShowScreenShareError(false);

  try {
    window.focus();
  } catch (e) {}

  await new Promise((resolve) => setTimeout(resolve, 100));

  await startInterview();
}}
className="mt-2 w-full rounded-lg bg-[#4B1498] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3B0F7A] focus:outline-none focus:ring-2 focus:ring-[#A66FFF] focus:ring-offset-2"
>
Choose Entire Screen
</button>
            </div>
          </div>
        )}
        <Footer />
      </div>
    );
  }
  if (role === "admin") {
    if (candidateEnded) {
      return (
        <div className="tt-admin-ended-page">
          <PublicHeader />
          <main className="tt-admin-ended-main" aria-labelledby="tt-admin-ended-title">
            <div className="tt-admin-ended-card">
              <div className="tt-admin-ended-orbit" aria-hidden="true"><span /><span /><span /></div>
              <div className="tt-admin-ended-badge" aria-label="Interview completed">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2.8 20 6v5.1c0 5.1-3.4 8.3-8 10.1-4.6-1.8-8-5-8-10.1V6l8-3.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="m8.2 12.1 2.5 2.5 5.2-5.3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="tt-admin-ended-eyebrow"><i aria-hidden="true" /> Interview complete</span>
              <h1 id="tt-admin-ended-title">Interview Ended</h1>
              <p className="tt-admin-ended-subtitle">The interview session has been completed</p>
              <p className="tt-admin-ended-description">
                The candidate has successfully finished the interview. You can now review the session details, access recordings, and provide your feedback.
              </p>
              <p className="tt-admin-ended-secure">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 14v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                All data has been securely stored in your Viriqo Hires dashboard.
              </p>

              <section className="tt-admin-ended-detail" aria-labelledby="tt-admin-ended-detail-title">
                <span className="tt-admin-ended-detail-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M12 3 20 6v5c0 5-3.3 8.2-8 10-4.7-1.8-8-5-8-10V6l8-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="m8.4 12.1 2.3 2.3 4.9-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                <div>
                  <h2 id="tt-admin-ended-detail-title">Session Completed Successfully</h2>
                  <p>Monitoring and recording have ended securely. All candidate activity, audio, and video data are safely stored for your reference.</p>
                  <p className="tt-admin-ended-thanks">Thank you for maintaining professionalism throughout the interview with Viriqo Hires.</p>
                </div>
              </section>

              <button onClick={() => window.location.reload()} className="tt-admin-ended-refresh">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.6 9a7 7 0 0 1 11.8-2L20 12M4 12l2.6 5a7 7 0 0 0 11.8-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Refresh Dashboard
              </button>
            </div>
          </main>
          <Footer />
        </div>
      );
    }
    return (
      <>
        {/* Header */}
        <PublicHeader />
        {/* Main Layout */}
        <div className="tt-monitoring-shell">
          {/* Left Sidebar */}
          <aside className="tt-monitoring-panel tt-monitoring-sidebar" aria-labelledby="tt-monitoring-title">
            <div className="tt-monitoring-side-heading">
              <span className="tt-monitoring-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="3.5" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M8 20.5h8M12 16.5v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </span>
              <h1 id="tt-monitoring-title">Monitoring Dashboard</h1>
            </div>
            <dl className="tt-monitoring-meta">
              <div>
                <dt>Status:</dt>
                {candidateOnline ? (
                  <dd className="tt-monitoring-status is-online"><span className="tt-monitoring-dot" aria-hidden="true" />
                    Candidate connected
                  </dd>
                ) : (
                  <dd className="tt-monitoring-status is-waiting"><span className="tt-monitoring-dot" aria-hidden="true" />
                    Waiting for candidate
                  </dd>
                )}
              </div>
              <div>
                <dt>Candidate:</dt>
                <dd className="tt-monitoring-candidate">
                  {adminCandidateName || "Loading..."}
                </dd>
              </div>
            </dl>
            <hr className="tt-monitoring-divider" />
            <button
              onClick={() => setMonitoring(true)}
              disabled={!candidateOnline || monitoring}
              className={`tt-monitoring-start ${
                candidateOnline && !monitoring
                  ? "is-enabled"
                  : "is-disabled"
              }`}
            >
              <svg className="tt-monitoring-play" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4.5v15l12-7.5-12-7.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
              Start Monitoring
            </button>
          </aside>
          {/* Right Panel / Candidate Viewer */}
          <main className="tt-monitoring-panel tt-monitoring-stage">
              {monitoring ? (
                <div
                  id="candidate-video"
                  className="tt-monitoring-video"
                >
                  <AdminWebRTC
                    interviewId={INTERVIEW_ID}
                    onCandidateEnded={handleCandidateEnded}
                    onCandidateStarted={() => setCandidateOnline(true)}
                  />
                  {/* Minimal Fullscreen Icon */}
                  <div
                    onClick={() => {
                      const elem = document.getElementById("candidate-video");
                      if (elem.requestFullscreen) {
                        elem.requestFullscreen();
                      } else if (elem.webkitRequestFullscreen) {
                        elem.webkitRequestFullscreen();
                      } else if (elem.msRequestFullscreen) {
                        elem.msRequestFullscreen();
                      }
                    }}
                    className="tt-monitoring-fullscreen"
                    title="Fullscreen"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="tt-monitoring-fullscreen-icon"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z"
                      />
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="tt-monitoring-empty" role="status" aria-live="polite">
                  <svg className="tt-monitoring-empty-icon" viewBox="0 0 360 250" fill="none" aria-hidden="true">
                    <defs><linearGradient id="tt-monitoring-screen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F3EEFE"/><stop offset="1" stopColor="#E7DDFB"/></linearGradient></defs>
                    <g className="tt-monitoring-cloud"><circle cx="140" cy="118" r="78" fill="#F1ECFB"/><circle cx="230" cy="110" r="70" fill="#F1ECFB"/><circle cx="262" cy="170" r="60" fill="#F1ECFB"/><circle cx="92" cy="186" r="44" fill="#EEE7FB"/><rect x="70" y="150" width="240" height="78" rx="39" fill="#F1ECFB"/></g>
                    <g className="tt-monitoring-float"><rect x="108" y="70" width="152" height="104" rx="10" fill="url(#tt-monitoring-screen)" stroke="#B89BF4" strokeWidth="4.5"/><path d="M176 174h16v20h-16z" fill="#DCCFF8"/><rect x="150" y="194" width="68" height="8" rx="4" fill="#DCCFF8"/><path className="tt-monitoring-glyph" d="m168 112 14 9-14 9v-18Zm32 0-14 9 14 9v-18Z" stroke="#A47BF2" strokeWidth="3.2" strokeLinejoin="round"/></g>
                    <path className="tt-monitoring-twinkle" d="m86 56 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#6A2BC8"/><path className="tt-monitoring-twinkle" d="m100 82 1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" fill="#8B5CF6"/><path className="tt-monitoring-twinkle" d="m272 36 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#6A2BC8"/><path className="tt-monitoring-twinkle" d="m274 70 1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" fill="#8B5CF6"/><path className="tt-monitoring-twinkle" d="m86 196 1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill="#6A2BC8"/><path className="tt-monitoring-twinkle" d="m86 176 1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="#8B5CF6"/><circle className="tt-monitoring-twinkle" cx="252" cy="62" r="2" fill="#C9B3F5"/><circle className="tt-monitoring-twinkle" cx="74" cy="90" r="2.4" fill="#C9B3F5"/>
                  </svg>
                  <h2>Monitoring is inactive.</h2>
                  <p className="tt-monitoring-empty-copy">
                    Click “Start Monitoring” once the candidate has started.
                  </p>
                </div>
              )}
          </main>
        </div>
        <Footer />
      </>
    );
  }
  return (
    <>
      {role === "candidate" && showFullscreenFallback && !isMobileDevice() && (
        <div
          className="fixed bottom-4 left-1/2 z-[1400] flex w-[min(94vw,560px)] -translate-x-1/2 flex-col items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-950 shadow-xl sm:flex-row sm:justify-between sm:text-left"
          role="alert"
        >
          <span>
            Fullscreen is not active. Your browser requires a page interaction
            to enter fullscreen again.
          </span>
          <button
            type="button"
            onClick={requestInterviewFullscreen}
            className="shrink-0 rounded-lg bg-[#4B1498] px-4 py-2 font-semibold text-white transition-colors hover:bg-[#3B0F7A] focus:outline-none focus:ring-2 focus:ring-[#A66FFF] focus:ring-offset-2"
          >
            Enter fullscreen
          </button>
        </div>
      )}
      <div className="w-screen h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-gray-950 dark:via-gray-900 dark:to-black text-gray-900 dark:text-white overflow-hidden">
        {/* VideoBox always mounted to maintain continuous recording */}
        <div className="hidden">
          <VideoBox
            stop={stopVideo}
            interviewID={INTERVIEW_ID}
            onFinalizeComplete={endInterview}
            uploadStream={sharedStream}
            previewStream={cameraStream}
            onProctoringEvent={setProctoringEvent}
          />
        </div>

        {/* VoiceInterview: Always mounted to maintain active AI interview */}
        <div className="hidden">
          <VoiceInterview
            ref={voiceInterviewRef}
            interviewId={INTERVIEW_ID}
            endInterview={() => {
              setInterviewEnded(true);
              setStopVideo(true);
            }}
            onEndInterviewRequested={handleVoiceEndInterviewRequest}
            role={role}
            onTranscript={({ question, answer }) => {
              if (candidateRef.current?.sendTranscript) {
                candidateRef.current.sendTranscript(question, answer);
              }
            }}
            onStatusChange={setVoiceStatus}
            onMessagesChange={setVoiceMessages}
            onCompilerEnabled={setCompilerEnabled}
            compilerEnabled={compilerEnabled}
            isPaused={showCodingApp}
            interviewEnded={interviewEnded}
          />
        </div>

        {/* Flex layout container for proper height management */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* CandidateWebRTC: Always mounted to maintain admin monitoring stream */}
          {!showCodingApp && (
            <>
              {/* ── MOBILE layout: stacked vertically (< md) ─────────────────── */}
              {!isDesktopLayout && (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* AI Avatar panel — top 45% of remaining viewport */}
                <div
                  className="w-full bg-black overflow-hidden"
                  style={{ height: "45dvh" }}
                >
                  <AIPanel status={voiceStatus} messages={voiceMessages} languageLocale={interviewLocale} />
                </div>
                {/* Camera / WebRTC panel — bottom 45% */}
                <div
                  className="w-full flex-1 bg-gray-900 overflow-hidden p-2"
                  style={{ minHeight: 0 }}
                >
                  <CandidateWebRTC
                    ref={candidateRef}
                    interviewId={INTERVIEW_ID}
                    stream={sharedStream}
                    previewStream={cameraStream}
                    proctoringEvent={proctoringEvent}
                    interviewEnded={interviewEnded}
                    onDismissEvent={() => setProctoringEvent(null)}
                  />
                </div>
              </div>
              )}

              {/* ── DESKTOP layout: original horizontal PanelGroup (md+) ──────── */}
              {isDesktopLayout && (
              <div className="flex flex-1 min-h-0">
                <PanelGroup direction="horizontal" className="flex-1 h-full">
                  <Panel defaultSize={25} minSize={22} maxSize={32}>
                    <div className="w-full h-full bg-white dark:bg-gray-900 flex flex-col overflow-hidden min-h-0">
                      <AIPanel status={voiceStatus} messages={voiceMessages} languageLocale={interviewLocale} />
                    </div>
                  </Panel>
                  <PanelResizeHandle className="w-1 bg-gray-300 dark:bg-gray-700 hover:bg-[#A66FFF] dark:hover:bg-[#A66FFF] cursor-col-resize transition-all duration-200" />
                  <Panel defaultSize={75} minSize={68}>
                    <div className="w-full h-full p-3 md:p-3 relative flex flex-col bg-white dark:bg-gray-900/50 min-h-0">
                      <CandidateWebRTC
                        ref={candidateRef}
                        interviewId={INTERVIEW_ID}
                        stream={sharedStream}
                        previewStream={cameraStream}
                        proctoringEvent={proctoringEvent}
                        interviewEnded={interviewEnded}
                        onDismissEvent={() => setProctoringEvent(null)}
                      />
                    </div>
                  </Panel>
                </PanelGroup>
              </div>
              )}
            </>
          )}

          {/* Hidden but mounted WebRTC to keep stream alive during coding */}
          {showCodingApp && (
            <div className="hidden">
              <CandidateWebRTC
                ref={candidateRef}
                interviewId={INTERVIEW_ID}
                stream={sharedStream}
                previewStream={cameraStream}
                proctoringEvent={proctoringEvent}
                interviewEnded={interviewEnded}
                onDismissEvent={() => setProctoringEvent(null)}
              />
            </div>
          )}

          {/* Coding Mode */}
          {showCodingApp && (
            <div className="w-full h-[calc(100vh-80px)] flex flex-col">
            <CodingApp
  ref={codingAppRef}
  interviewId={INTERVIEW_ID}
  questions={allCodingQuestions}
  currentQuestionIndex={currentQuestionIndex}
  onQuestionIndexChange={setCurrentQuestionIndex}
  totalTimeLimit={totalTimeLimit}
  panelVisible={true}
  endInterview={endInterview}
/>
            </div>
          )}
        </div>
        {showTabWarning && role === "candidate" && (
          <div className="fixed inset-0 z-[9999] bg-gradient-to-br from-[#F7F4FE] via-[#F6F3FD] to-[#F0EBFF] flex flex-col items-center justify-center text-[#191F2D] text-center px-8 py-10 animate-fade-in">
            <div className="bg-white/85 backdrop-blur-md p-10 rounded-3xl shadow-[0_30px_80px_-36px_rgba(75,20,152,.5)] border border-white max-w-xl">
              <div className="flex flex-col items-center gap-6">
                {/* Warning Icon */}
                <div className="w-20 h-20 bg-[#FFF4DC] rounded-full flex items-center justify-center shadow-inner animate-pulse">
                  <span className="text-5xl text-[#F59E0B]">⚠️</span>
                </div>

                {/* Title */}
                <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight text-[#191F2D]">
                  Warning: <span className="text-[#6A1FD0]">Tab Switch Detected!</span>
                </h1>

                {/* Message */}
                <p className="text-xl md:text-2xl font-medium mt-2 text-[#4A5163]">
                  Please stay on the interview screen.
                </p>
                <p className="text-lg text-[#6B7185] max-w-md">
                  Multiple tab switches may lead to{" "}
                  <span className="font-bold text-[#B45309]">termination</span>{" "}
                  of your interview.
                </p>

                {/* OK Button */}
                <button
                  onClick={() => setShowTabWarning(false)}
                  className="mt-6 px-8 py-3 text-lg font-semibold bg-gradient-to-b from-[#7A2EEA] to-[#5A18C2] text-white rounded-xl shadow-[0_18px_36px_-14px_rgba(90,24,194,.65)] hover:from-[#6A1FD0] hover:to-[#4B1498] transition-transform transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A66FFF]"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        {showEndInterviewConfirm && (
          <div className="fixed inset-0 z-[1100] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                Are you sure you want to end the interview?
              </h3>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => handleEndInterviewDecision(false)}
                  disabled={endingInterview}
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>

                <button
                  onClick={() => handleEndInterviewDecision(true)}
                  disabled={endingInterview}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {endingInterview ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Ending...
                    </>
                  ) : (
                    "End Interview"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        {endingInterview && (
          <div className="fixed inset-0 z-[1200] bg-black/60 flex items-center justify-center">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl px-8 py-10 max-w-sm w-full mx-4 text-center">
              {/* Spinner */}
              <div className="flex justify-center mb-6">
                <div className="w-14 h-14 border-4 border-gray-300 dark:border-gray-700 border-t-red-600 rounded-full animate-spin" />
              </div>

              {/* Title */}
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Ending Interview...
              </h2>

              {/* Message */}
              <p className="text-gray-600 dark:text-gray-400">
                Please wait while we safely end the interview.
              </p>
            </div>
          </div>
        )}

        {/* Global sticky footer for actions */}
        <div className="w-full flex justify-center gap-2 md:gap-4 bg-white/95 dark:bg-gray-900 px-2 py-2 md:p-4 sticky bottom-0 border-t border-[#E6E0F3] dark:border-gray-700 shadow-lg z-10">
          <button
            onClick={async () => {
              const willShow = !showCodingApp;
              setShowCodingApp(willShow);
              if (willShow) {
                setShowChatPanel(false);
                setShowVoiceChat(false);
                await fetchRandomQuestion(INTERVIEW_ID);
              } else {
                setShowChatPanel(true);
                setShowVoiceChat(true);
              }
            }}
            disabled={!compilerEnabled || showCodingApp}
            className={`flex-1 px-3 md:px-6 py-2 md:py-2.5 text-sm md:text-base font-semibold rounded-lg transition-all duration-200 text-center shadow-md ${
              !compilerEnabled || showCodingApp
                ? "bg-[#EAE3FA] dark:bg-gray-700 cursor-not-allowed text-[#7A5BC7] dark:text-gray-400"
                : "bg-gradient-to-r from-[#8F5BF0] via-[#6A2BE0] to-[#4B1498] hover:brightness-105 text-white shadow-[#4B1498]/20 hover:shadow-lg"
            }`}
          >
            <span className="hidden sm:inline">💻 Code Compiler</span>
            <span className="sm:hidden">💻 Compiler</span>
          </button>
          <button
            disabled={endingInterview}
            onClick={async () => {
              if (endingInterview) return;
              openEndInterviewConfirmation();
            }}
            className={`flex-1 px-3 md:px-6 py-2 md:py-2.5 text-sm md:text-base font-semibold rounded-lg transition-all duration-200 text-center shadow-md text-white ${
              endingInterview
                ? "bg-gray-500 cursor-not-allowed"
                : "bg-gradient-to-r from-[#EF4444] to-[#B91C1C] hover:brightness-105"
            }`}
          >
            {endingInterview ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span className="hidden sm:inline">
                  Ending the Interview...
                </span>
                <span className="sm:hidden">Ending...</span>
              </div>
            ) : (
              <>
                <span className="hidden sm:inline">🛑 End Interview</span>
                <span className="sm:hidden">🛑 End</span>
              </>
            )}
          </button>
        </div>
      </div>
      {/* Show floating self-camera ONLY during coding */}
      {showCodingApp && <FloatingCamera />}
    </>
  );
};

// Wrap the main app with NotificationProvider so any child can use notifications
export default function App(props) {
  return (
    <NotificationProvider>
      <AppInner {...props} />
    </NotificationProvider>
  );
}
