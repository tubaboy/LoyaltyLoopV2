import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CircleAlert,
  CirclePlus,
  Delete,
  LogOut,
  Loader2,
  Maximize,
  Minimize,
  Minus,
  Plus,
  RefreshCw,
  Star,
  Wrench,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useNetworkStatus } from "../context/NetworkStatusContext.jsx";

const PHONE_LENGTH = 10;
const COIN_SHOWER_SIZE_MULTIPLIER = 1.45;
const COIN_FLIP_SIZE_MULTIPLIER = 1.25;

const TERMINAL_THEMES = {
  indigo: {
    primary: "#4f46e5",
    primaryHover: "#4338ca",
    primarySoft: "#eef2ff",
    primaryLight: "#c7d2fe",
    primaryShadow: "rgb(79 70 229 / 0.22)",
    gradient: "linear-gradient(135deg, #5148f5 0%, #2454e8 100%)",
  },
  teal: {
    primary: "#0d9488",
    primaryHover: "#0f766e",
    primarySoft: "#f0fdfa",
    primaryLight: "#ccfbf1",
    primaryShadow: "rgb(13 148 136 / 0.22)",
    gradient: "linear-gradient(135deg, #0f9f96 0%, #087f83 100%)",
  },
  rose: {
    primary: "#e11d48",
    primaryHover: "#be123c",
    primarySoft: "#fff1f2",
    primaryLight: "#fecdd3",
    primaryShadow: "rgb(225 29 72 / 0.22)",
    gradient: "linear-gradient(135deg, #f43f5e 0%, #be123c 100%)",
  },
  amber: {
    primary: "#d97706",
    primaryHover: "#b45309",
    primarySoft: "#fffbeb",
    primaryLight: "#fde68a",
    primaryShadow: "rgb(217 119 6 / 0.22)",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #c2410c 100%)",
  },
  emerald: {
    primary: "#059669",
    primaryHover: "#047857",
    primarySoft: "#ecfdf5",
    primaryLight: "#a7f3d0",
    primaryShadow: "rgb(5 150 105 / 0.22)",
    gradient: "linear-gradient(135deg, #10b981 0%, #0f766e 100%)",
  },
  slate: {
    primary: "#334155",
    primaryHover: "#1e293b",
    primarySoft: "#f1f5f9",
    primaryLight: "#cbd5e1",
    primaryShadow: "rgb(51 65 85 / 0.22)",
    gradient: "linear-gradient(135deg, #475569 0%, #1e293b 100%)",
  },
};

function sanitizePhone(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, PHONE_LENGTH);
}

function formatPhone(value) {
  const phone = sanitizePhone(value);
  return phone.length > 4 ? `${phone.slice(0, 4)}-${phone.slice(4)}` : phone;
}

function getOptionValue(option) {
  return Number(option?.value_points ?? option?.value ?? 0);
}

function getOptionLabel(option) {
  return option?.label || `${getOptionValue(option)} 點`;
}

function positiveSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export default function CustomerTerminal({ terminal }) {
  const isOnline = useNetworkStatus();
  const navigate = useNavigate();
  const phoneDisplayRef = useRef(null);
  const effectCanvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const particlesRef = useRef([]);
  const logoImageRef = useRef(null);
  const audioRefs = useRef({ collection: null, redemption: null, reminder: null });
  const defaultAudioRefs = useRef({ collection: null, redemption: null });
  const resetTimerRef = useRef(null);
  const reminderTimerRef = useRef(null);
  const screensaverTimerRef = useRef(null);
  const screensaverActiveRef = useRef(false);
  const [step, setStep] = useState("lookup");
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState(null);
  const [redemptionCount, setRedemptionCount] = useState(0);
  const [options, setOptions] = useState([]);
  const [logoUrl, setLogoUrl] = useState("/logo.png");
  const [screensaverUrl, setScreensaverUrl] = useState("");
  const [isScreensaverActive, setIsScreensaverActive] = useState(false);
  const [isReminding, setIsReminding] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [customMode, setCustomMode] = useState("add");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const theme = TERMINAL_THEMES[terminal?.theme_color] ?? TERMINAL_THEMES.indigo;
  const terminalStyle = useMemo(() => ({
    "--legacy-terminal-primary": theme.primary,
    "--legacy-terminal-primary-hover": theme.primaryHover,
    "--legacy-terminal-primary-soft": theme.primarySoft,
    "--legacy-terminal-primary-light": theme.primaryLight,
    "--legacy-terminal-primary-shadow": theme.primaryShadow,
    "--legacy-terminal-gradient": theme.gradient,
  }), [theme]);

  const addOptions = options.filter((option) => option.type === "add" && getOptionValue(option) > 0);
  const redeemOptions = options.filter((option) => option.type === "redeem" && getOptionValue(option) > 0);
  const redemptionLimit = Number(terminal?.daily_redemption_limit ?? 0);
  const redemptionLimitReached = redemptionLimit > 0 && redemptionCount >= redemptionLimit;

  useEffect(() => {
    let mounted = true;
    api.terminal.options()
      .then((payload) => {
        if (mounted) setOptions(payload.options ?? []);
      })
      .catch((optionsError) => {
        if (mounted) setError(optionsError.message ?? "無法載入集點選項");
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    let objectUrl = "";
    if (!terminal?.logo_asset_id) return undefined;

    api.media.download(terminal.logo_asset_id)
      .then((blob) => {
        if (!mounted) return;
        objectUrl = URL.createObjectURL(blob);
        setLogoUrl(objectUrl);
      })
      .catch(() => {
        // The local fallback logo remains visible when a branch has no readable asset.
      });

    return () => {
      mounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [terminal?.logo_asset_id]);

  useEffect(() => {
    let mounted = true;
    let objectUrl = "";
    setScreensaverUrl("");
    screensaverActiveRef.current = false;
    setIsScreensaverActive(false);

    if (!terminal?.screensaver_asset_id) return undefined;

    api.media.download(terminal.screensaver_asset_id)
      .then((blob) => {
        if (!mounted) return;
        objectUrl = URL.createObjectURL(blob);
        setScreensaverUrl(objectUrl);
      })
      .catch(() => {
        if (mounted) setError("待機畫面載入失敗，請回設定頁重新上傳圖片。");
      });

    return () => {
      mounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [terminal?.screensaver_asset_id]);

  useEffect(() => {
    if (step === "lookup") phoneDisplayRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const collectionAudio = new Audio(`${import.meta.env.BASE_URL}coin.mp3`);
    const redemptionAudio = new Audio(`${import.meta.env.BASE_URL}celebration.mp3`);
    const reminderAudio = new Audio(`${import.meta.env.BASE_URL}universfield-ringtone-021-365652.mp3`);
    collectionAudio.preload = "auto";
    redemptionAudio.preload = "auto";
    reminderAudio.preload = "auto";
    collectionAudio.volume = 0.7;
    redemptionAudio.volume = 0.85;
    reminderAudio.volume = 0.55;
    defaultAudioRefs.current = { collection: collectionAudio, redemption: redemptionAudio };
    audioRefs.current = { collection: collectionAudio, redemption: redemptionAudio, reminder: reminderAudio };

    return () => {
      Object.values(audioRefs.current).forEach((audio) => {
        if (!audio) return;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
      audioRefs.current = { collection: null, redemption: null, reminder: null };
      defaultAudioRefs.current = { collection: null, redemption: null };
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const customAudios = [];
    const customSounds = [
      { key: "collection", assetId: terminal?.collection_sound_asset_id, volume: 0.7 },
      { key: "redemption", assetId: terminal?.redemption_sound_asset_id, volume: 0.85 },
    ];

    customSounds.forEach(({ key, assetId, volume }) => {
      audioRefs.current[key] = defaultAudioRefs.current[key];
      if (!assetId) return;
      api.media.download(assetId)
        .then((blob) => {
          if (!mounted) return;
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.preload = "auto";
          audio.volume = volume;
          customAudios.push({ key, audio, url });
          audioRefs.current[key] = audio;
        })
        .catch(() => {
          // Keep the bundled default sound if a custom asset is unavailable.
        });
    });

    return () => {
      mounted = false;
      customAudios.forEach(({ key, audio, url }) => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
        if (audioRefs.current[key] === audio) audioRefs.current[key] = defaultAudioRefs.current[key];
      });
    };
  }, [terminal?.collection_sound_asset_id, terminal?.redemption_sound_asset_id]);

  useEffect(() => {
    const image = new Image();
    image.onload = () => { logoImageRef.current = image; };
    image.onerror = () => { logoImageRef.current = null; };
    image.src = logoUrl;
    return () => {
      if (logoImageRef.current === image) logoImageRef.current = null;
    };
  }, [logoUrl]);

  useEffect(() => () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    const canvas = effectCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  function clearVisualEffect() {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    particlesRef.current = [];
    const canvas = effectCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function prepareEffectCanvas() {
    const canvas = effectCanvasRef.current;
    if (!canvas) return null;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { canvas, context, width, height };
  }

  function drawCoin(context, particle) {
    const radius = 31 * particle.scale;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);
    context.scale(Math.max(0.08, Math.cos(particle.flip)), 1);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.closePath();

    if (logoImageRef.current) {
      context.save();
      context.clip();
      context.drawImage(logoImageRef.current, -radius, -radius, radius * 2, radius * 2);
      context.restore();
      context.lineWidth = 4;
      context.strokeStyle = "#fbbf24";
      context.stroke();
    } else {
      context.fillStyle = "#fbbf24";
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = "#d97706";
      context.stroke();
      context.fillStyle = "#b45309";
      context.font = `900 ${Math.max(18, radius * 1.1)}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("$", 0, 2);
    }
    context.restore();
  }

  function triggerCoinShower() {
    const prepared = prepareEffectCanvas();
    if (!prepared) return;
    const { context, width, height } = prepared;
    clearVisualEffect();
    particlesRef.current = Array.from({ length: 18 }, () => ({
      x: width / 2,
      y: height + 40,
      vx: (Math.random() - 0.5) * 15,
      vy: -(Math.random() * 9 + 19),
      gravity: 0.72,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.22,
      flip: Math.random() * Math.PI * 2,
      flipSpeed: (Math.random() - 0.5) * 0.22,
      scale: (Math.random() * 0.38 + 0.42) * COIN_SHOWER_SIZE_MULTIPLIER,
    }));

    const render = () => {
      context.clearRect(0, 0, width, height);
      let activeParticles = 0;
      particlesRef.current.forEach((particle) => {
        particle.vy += particle.gravity;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.rotationSpeed;
        particle.flip += particle.flipSpeed;
        if (particle.y < height + 110) {
          activeParticles += 1;
          drawCoin(context, particle);
        }
      });
      if (activeParticles > 0) {
        animationFrameRef.current = requestAnimationFrame(render);
      } else {
        clearVisualEffect();
      }
    };
    render();
  }

  function triggerCoinFlip() {
    const prepared = prepareEffectCanvas();
    if (!prepared) return;
    const { context, width, height } = prepared;
    clearVisualEffect();
    const startTime = performance.now();
    const duration = 1600;
    const particle = {
      x: width / 2,
      y: height / 2,
      rotation: 0,
      flip: 0,
      scale: 1.05 * COIN_FLIP_SIZE_MULTIPLIER,
    };

    const render = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      context.clearRect(0, 0, width, height);
      particle.x = width / 2;
      particle.y = height / 2;
      particle.rotation = eased * Math.PI * 2;
      particle.flip = eased * Math.PI * 6;
      particle.scale = (1.05 + eased * 1.15) * COIN_FLIP_SIZE_MULTIPLIER;
      context.globalAlpha = progress > 0.78 ? 1 - ((progress - 0.78) / 0.22) : 1;
      drawCoin(context, particle);
      context.globalAlpha = 1;
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(render);
      } else {
        clearVisualEffect();
      }
    };
    animationFrameRef.current = requestAnimationFrame(render);
  }

  function drawConfettiPiece(context, particle) {
    context.save();
    context.globalAlpha = particle.opacity;
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);
    context.fillStyle = particle.color;
    context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
    context.restore();
  }

  function triggerConfetti() {
    const prepared = prepareEffectCanvas();
    if (!prepared) return;
    const { context, width, height } = prepared;
    clearVisualEffect();
    const colors = [theme.primary, theme.primaryLight, "#fbbf24", "#f472b6", "#ffffff"];
    particlesRef.current = Array.from({ length: 72 }, (_, index) => {
      const fromLeft = index % 2 === 0;
      return {
        x: fromLeft ? width * 0.14 : width * 0.86,
        y: height * 0.78,
        vx: (fromLeft ? 1 : -1) * (Math.random() * 7 + 3) + (Math.random() - 0.5) * 3,
        vy: -(Math.random() * 9 + 10),
        gravity: 0.28 + Math.random() * 0.12,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.28,
        width: Math.random() * 7 + 5,
        height: Math.random() * 12 + 7,
        opacity: 1,
        color: colors[index % colors.length],
      };
    });

    const render = () => {
      context.clearRect(0, 0, width, height);
      let activeParticles = 0;
      particlesRef.current.forEach((particle) => {
        particle.vy += particle.gravity;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.rotationSpeed;
        if (particle.y < height + 80) {
          activeParticles += 1;
          particle.opacity = particle.y > height * 0.82 ? Math.max(0, 1 - (particle.y - height * 0.82) / 170) : 1;
          drawConfettiPiece(context, particle);
        }
      });
      if (activeParticles > 0) {
        animationFrameRef.current = requestAnimationFrame(render);
      } else {
        clearVisualEffect();
      }
    };
    render();
  }

  function triggerBalloons() {
    const prepared = prepareEffectCanvas();
    if (!prepared) return;
    const { context, width, height } = prepared;
    clearVisualEffect();
    const colors = [theme.primary, theme.primaryLight, "#fbbf24", "#f472b6", "#ffffff"];
    particlesRef.current = Array.from({ length: 18 }, (_, index) => ({
      x: Math.random() * width,
      y: height + Math.random() * 180,
      speed: 2.5 + Math.random() * 2.4,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.018 + Math.random() * 0.018,
      swayRange: 18 + Math.random() * 30,
      radius: 18 + Math.random() * 13,
      stringLength: 45 + Math.random() * 25,
      color: colors[index % colors.length],
    }));

    const render = () => {
      context.clearRect(0, 0, width, height);
      let activeParticles = 0;
      particlesRef.current.forEach((particle) => {
        particle.y -= particle.speed;
        const currentX = particle.x + Math.sin(performance.now() * 0.002 + particle.sway) * particle.swayRange;
        if (particle.y > -150) {
          activeParticles += 1;
          context.save();
          context.strokeStyle = "rgb(148 163 184 / 0.55)";
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(currentX, particle.y + particle.radius);
          context.lineTo(currentX, particle.y + particle.radius + particle.stringLength);
          context.stroke();
          context.fillStyle = particle.color;
          context.beginPath();
          context.ellipse(currentX, particle.y, particle.radius * 0.8, particle.radius, 0, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = "rgb(255 255 255 / 0.35)";
          context.beginPath();
          context.ellipse(currentX - particle.radius * 0.28, particle.y - particle.radius * 0.3, particle.radius * 0.18, particle.radius * 0.13, -Math.PI / 4, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }
      });
      if (activeParticles > 0) {
        animationFrameRef.current = requestAnimationFrame(render);
      } else {
        clearVisualEffect();
      }
    };
    render();
  }

  function playFeedbackSound(type) {
    if (terminal.enable_sound === false) return;
    const audio = audioRefs.current[type];
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {
      // The action still succeeds when the browser or device is muted.
    });
  }

  function triggerFeedback(type) {
    if (terminal.enable_confetti === false) return;
    if (type === "collection") {
      if (terminal.point_collection_effect === "flip") triggerCoinFlip();
      else triggerCoinShower();
      return;
    }
    if (terminal.redemption_effect === "balloons") triggerBalloons();
    else triggerConfetti();
  }

  function clearResetTimer() {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }

  function clearReminderTimer() {
    if (reminderTimerRef.current) window.clearTimeout(reminderTimerRef.current);
    reminderTimerRef.current = null;
    setIsReminding(false);
  }

  function clearScreensaverTimer() {
    if (screensaverTimerRef.current) window.clearTimeout(screensaverTimerRef.current);
    screensaverTimerRef.current = null;
  }

  function startAutoReset() {
    clearResetTimer();
    clearReminderTimer();
    const seconds = positiveSeconds(terminal?.reset_interval);
    if (!seconds) return;

    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null;
      handleChangePhone();
    }, seconds * 1000);
  }

  function startReminderTimer() {
    if (reminderTimerRef.current) window.clearTimeout(reminderTimerRef.current);
    reminderTimerRef.current = null;
    const seconds = positiveSeconds(terminal?.reminder_interval);
    if (!seconds || step !== "action" || resetTimerRef.current) return;

    reminderTimerRef.current = window.setTimeout(() => {
      reminderTimerRef.current = null;
      triggerReminder();
    }, seconds * 1000);
  }

  function triggerReminder() {
    if (step !== "action" || resetTimerRef.current || !positiveSeconds(terminal?.reminder_interval)) return;
    playFeedbackSound("reminder");
    setIsReminding(true);
    startReminderTimer();
  }

  function resetReminderTimer() {
    if (step !== "action" || resetTimerRef.current) return;
    setIsReminding(false);
    startReminderTimer();
  }

  function scheduleScreensaverTimer() {
    clearScreensaverTimer();
    const seconds = positiveSeconds(terminal?.screensaver_timeout);
    if (step !== "lookup" || !screensaverUrl || !seconds) return;

    screensaverTimerRef.current = window.setTimeout(() => {
      screensaverTimerRef.current = null;
      screensaverActiveRef.current = true;
      setIsScreensaverActive(true);
    }, seconds * 1000);
  }

  function dismissScreensaver() {
    screensaverActiveRef.current = false;
    setIsScreensaverActive(false);
    scheduleScreensaverTimer();
  }

  useEffect(() => {
    if (step !== "action") {
      clearReminderTimer();
      return undefined;
    }

    startReminderTimer();
    return () => clearReminderTimer();
  }, [step, terminal?.reminder_interval]);

  useEffect(() => {
    const timeout = positiveSeconds(terminal?.screensaver_timeout);
    if (step !== "lookup" || !screensaverUrl || !timeout) {
      clearScreensaverTimer();
      screensaverActiveRef.current = false;
      setIsScreensaverActive(false);
      return undefined;
    }

    const events = ["pointerdown", "keydown", "touchstart", "mousemove", "scroll"];
    const handleActivity = () => {
      if (!screensaverActiveRef.current) scheduleScreensaverTimer();
    };
    scheduleScreensaverTimer();
    events.forEach((eventName) => window.addEventListener(eventName, handleActivity));

    return () => {
      clearScreensaverTimer();
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
    };
  }, [step, screensaverUrl, terminal?.screensaver_timeout]);

  useEffect(() => () => {
    clearResetTimer();
    clearReminderTimer();
    clearScreensaverTimer();
  }, []);

  function handleNumClick(value) {
    if (phone.length >= PHONE_LENGTH || loading) return;
    setError("");
    setMessage("");
    setPhone((current) => `${current}${value}`.slice(0, PHONE_LENGTH));
  }

  function handleClear() {
    setError("");
    setMessage("");
    setPhone("");
  }

  function handleBackspace() {
    setError("");
    setMessage("");
    setPhone((current) => current.slice(0, -1));
  }

  function handlePhoneKeyDown(event) {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      handleNumClick(event.key);
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      handleBackspace();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleClear();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      lookupCustomer();
    }
  }

  async function lookupCustomer(event) {
    event?.preventDefault();
    if (!isOnline) {
      setError("目前沒有網路連線，請恢復連線後再查詢會員。");
      return;
    }
    if (phone.length < PHONE_LENGTH) {
      setError(`請輸入完整的 ${PHONE_LENGTH} 位手機號碼`);
      return;
    }

    setError("");
    setMessage("");
    setLoading(true);
    try {
      const [customerPayload, redemptionPayload] = await Promise.all([
        api.terminal.customer(phone),
        api.terminal.redemptionCount(phone),
      ]);
      const foundCustomer = customerPayload.customer ?? {
        id: null,
        phone: formatPhone(phone),
        points: 0,
      };
      setCustomer(foundCustomer);
      setRedemptionCount(redemptionPayload.count ?? 0);
      setStep("action");
      if (!customerPayload.customer) {
        setMessage("尚未建立會員，完成第一次集點後會自動建立。");
      }
    } catch (lookupError) {
      setError(lookupError.message ?? "查詢失敗");
    } finally {
      setLoading(false);
    }
  }

  async function changePoints(action, requestedAmount) {
    const value = Number(requestedAmount);
    if (!isOnline || !phone || !Number.isInteger(value) || value < 1 || loading) {
      if (!isOnline) setError("目前沒有網路連線，點數操作未送出；請恢復連線後重試。");
      return;
    }

    clearResetTimer();
    resetReminderTimer();
    setError("");
    setMessage("");
    setLoading(true);
    const feedbackType = action === "add" ? "collection" : "redemption";
    // Start audio from the click handler before the API round trip so browsers do not reject it as autoplay.
    playFeedbackSound(feedbackType);
    try {
      const manual = action === "manual";
      const payload = action === "add"
        ? await api.terminal.addPoints({ phone, amount: value })
        : await api.terminal.redeemPoints({ phone, amount: value, manual });
      setCustomer((current) => ({
        ...(current ?? {}),
        id: payload.customerId ?? current?.id ?? null,
        phone: current?.phone ?? formatPhone(phone),
        points: payload.balance ?? 0,
      }));
      if (action === "redeem" && !payload.reused) {
        setRedemptionCount((current) => current + 1);
      }
      const resetSeconds = positiveSeconds(terminal?.reset_interval);
      const resetHint = resetSeconds ? `（${resetSeconds} 秒後自動返回）` : "";
      setMessage(`${action === "add" ? `已累積 ${value} 點` : manual ? `已手動扣除 ${value} 點` : `已兌換 ${value} 點`}${resetHint}`);
      triggerFeedback(feedbackType);
      startAutoReset();
    } catch (actionError) {
      setError(actionError.message ?? "操作失敗");
    } finally {
      setLoading(false);
    }
  }

  function handleChangePhone() {
    clearResetTimer();
    clearReminderTimer();
    clearScreensaverTimer();
    clearVisualEffect();
    setStep("lookup");
    setPhone("");
    setCustomer(null);
    setRedemptionCount(0);
    setCustomOpen(false);
    setCustomAmount("");
    setError("");
    setMessage("");
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      setError("瀏覽器不允許自動切換全螢幕，請手動操作。");
    }
  }

  async function logout() {
    clearVisualEffect();
    await api.terminal.logout().catch(() => undefined);
    navigate("/terminal-login", { replace: true });
  }

  function openCustomPoints() {
    clearResetTimer();
    resetReminderTimer();
    setCustomMode("add");
    setCustomAmount("");
    setError("");
    setCustomOpen(true);
  }

  function handleCustomDigit(value) {
    clearResetTimer();
    resetReminderTimer();
    setCustomAmount((current) => `${current}${value}`.replace(/^0+(?=\d)/, "").slice(0, 5));
  }

  function handleCustomSubmit() {
    const value = Number(customAmount);
    if (!Number.isInteger(value) || value < 1) return;
    setCustomOpen(false);
    setCustomAmount("");
    changePoints(customMode === "add" ? "add" : "manual", value);
  }

  if (!terminal) return null;

  return (
    <main className={`legacy-terminal-page legacy-terminal-page--${step}${isReminding ? " legacy-terminal-page--reminding" : ""}`} style={terminalStyle}>
      <canvas ref={effectCanvasRef} className="legacy-terminal-effects-canvas" aria-hidden="true" />
      {isScreensaverActive && screensaverUrl && (
        <div className="legacy-terminal-screensaver" role="button" tabIndex={0} aria-label="關閉待機畫面" onClick={dismissScreensaver} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") dismissScreensaver(); }}>
          <img src={screensaverUrl} alt="分店待機畫面" />
          <span>點擊畫面返回顧客查詢</span>
        </div>
      )}
      {step === "lookup" ? (
        <section className="legacy-terminal-lookup-card" aria-label="顧客查詢">
          <button type="button" className="legacy-terminal-logout legacy-terminal-logout--lookup" onClick={logout}>
            <LogOut size={17} aria-hidden="true" />
            <span>登出系統</span>
          </button>

          <div className="legacy-terminal-lookup-grid">
            <section className="legacy-terminal-lookup-copy">
              <div className="legacy-terminal-title-row">
                <div className="legacy-terminal-logo-wrap">
                  <img src={logoUrl} alt="分店 Logo" />
                </div>
                <div>
                  <h1>顧客查詢</h1>
                  <p>Customer Lookup</p>
                </div>
              </div>
              <p className="legacy-terminal-instruction">
                請輸入顧客的手機號碼，系統將自動查詢點數餘額並進入操作介面。
              </p>
              <div
                ref={phoneDisplayRef}
                className="legacy-terminal-phone-display"
                role="textbox"
                aria-label="顧客手機號碼"
                aria-valuetext={phone ? formatPhone(phone) : "尚未輸入"}
                tabIndex={0}
                onKeyDown={handlePhoneKeyDown}
              >
                {Array.from({ length: PHONE_LENGTH }).map((_, index) => (
                  <span key={index} className={phone[index] ? "is-filled" : ""}>{phone[index] || "•"}</span>
                )).reduce((items, item, index) => {
                  items.push(item);
                  if (index === 3) items.push(<i key="separator" aria-hidden="true">-</i>);
                  return items;
                }, [])}
              </div>
              <div className="legacy-terminal-lookup-status">
                <span className={phone.length === PHONE_LENGTH ? "is-ready" : ""} aria-hidden="true" />
                <div>
                  <strong>{terminal.store_name || "LoyaltyLoop"} - {terminal.branch_name || "分店終端"}</strong>
                  <small>{phone.length === PHONE_LENGTH ? "已就緒 - 可查詢" : `已輸入 ${phone.length}/${PHONE_LENGTH} 位數字`}</small>
                </div>
              </div>
            </section>

            <section className="legacy-terminal-keypad-column" aria-label="手機號碼鍵盤">
              <div className="legacy-terminal-keypad">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
                  <button key={number} type="button" onClick={() => handleNumClick(String(number))} disabled={loading}>
                    {number}
                  </button>
                ))}
                <button type="button" className="legacy-terminal-keypad-action" onClick={handleClear} disabled={loading}>清除</button>
                <button type="button" onClick={() => handleNumClick("0")} disabled={loading}>0</button>
                <button type="button" className="legacy-terminal-keypad-action legacy-terminal-keypad-action--backspace" aria-label="刪除最後一個數字" onClick={handleBackspace} disabled={loading}>
                  <Delete size={42} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
              <button type="button" className="legacy-terminal-start" onClick={lookupCustomer} disabled={!isOnline || phone.length < PHONE_LENGTH || loading}>
                {loading ? <><Loader2 size={24} className="spin" aria-hidden="true" />查詢中...</> : <>開始操作 <ArrowRight size={25} aria-hidden="true" /></>}
              </button>
            </section>
          </div>
        </section>
      ) : (
        <section className="legacy-terminal-action-layout" aria-label="顧客集點與兌換" onPointerDown={resetReminderTimer} onKeyDown={resetReminderTimer}>
          <div className="legacy-terminal-action-sidebar">
            <article className="legacy-terminal-customer-card">
              <div className="legacy-terminal-customer-card__header">
                <div>
                  <span>目前操作顧客</span>
                  <strong>{formatPhone(phone)}</strong>
                </div>
                <div className="legacy-terminal-customer-avatar">
                  <img src={logoUrl} alt="分店 Logo" />
                </div>
              </div>
              <div className="legacy-terminal-customer-balance">
                <span>累積剩餘點數</span>
                <strong>{customer?.points ?? 0}<small>PTS</small></strong>
              </div>
            </article>

            <article className="legacy-terminal-quick-card">
              <h2>快速操作 <span>ACTIONS</span></h2>
              <button type="button" onClick={openCustomPoints} disabled={!isOnline || loading}>
                <Plus size={27} aria-hidden="true" />
                <span>自訂點數</span>
              </button>
              <button type="button" className="is-outline" onClick={handleChangePhone} disabled={loading}>
                <RefreshCw size={19} aria-hidden="true" />
                <span>更換手機</span>
              </button>
            </article>

            <div className="legacy-terminal-sidebar-actions">
              <button type="button" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
                {isFullscreen ? "退出全螢幕" : "進入全螢幕"}
              </button>
              <button type="button" className="is-danger" onClick={logout}>
                <LogOut size={16} aria-hidden="true" />
                登出系統
              </button>
            </div>
          </div>

          <div className="legacy-terminal-action-content">
            <section className="legacy-terminal-action-section">
              <div className="legacy-terminal-section-heading">
                <span><CirclePlus size={22} aria-hidden="true" /></span>
                <h2>累積點數</h2>
              </div>
              <div className="legacy-terminal-add-options">
                {addOptions.length > 0 ? addOptions.map((option) => {
                  const value = getOptionValue(option);
                  return (
                    <button key={option.id} type="button" onClick={() => changePoints("add", value)} disabled={!isOnline || loading}>
                      <strong>+{value}</strong>
                      <small>{getOptionLabel(option)}</small>
                    </button>
                  );
                }) : <p className="legacy-terminal-empty-copy">請先在後台設定集點選項，或使用左側自訂點數。</p>}
              </div>
            </section>

            <div className="legacy-terminal-divider" />

            <section className="legacy-terminal-action-section legacy-terminal-action-section--rewards">
              <div className="legacy-terminal-section-heading">
                <span><Star size={21} fill="currentColor" aria-hidden="true" /></span>
                <h2>兌換獎勵</h2>
                <small className="legacy-terminal-redemption-count">
                  今日已兌換 {redemptionCount}{redemptionLimit > 0 ? ` / ${redemptionLimit}` : ""} 次
                </small>
              </div>

              {redemptionLimitReached ? (
                <div className="legacy-terminal-limit-notice">
                  <CircleAlert size={27} aria-hidden="true" />
                  <strong>兌換額度已達上限</strong>
                  <small>同顧客於本分店每日限兌換 {redemptionLimit} 次</small>
                </div>
              ) : (
                <div className="legacy-terminal-reward-options">
                  {redeemOptions.length > 0 ? redeemOptions.map((option) => {
                    const value = getOptionValue(option);
                    const canRedeem = Boolean(customer?.id) && Number(customer?.points ?? 0) >= value;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={canRedeem ? "is-available" : "is-disabled"}
                        disabled={!isOnline || loading || !canRedeem}
                        onClick={() => changePoints("redeem", value)}
                      >
                        <span>
                          <strong>{getOptionLabel(option)}</strong>
                          <small>消耗 {value} 點</small>
                        </span>
                        <b>兌換</b>
                      </button>
                    );
                  }) : <p className="legacy-terminal-empty-copy">目前沒有可兌換的獎勵。</p>}
                </div>
              )}
            </section>
          </div>
        </section>
      )}

      {isReminding && <div className="legacy-terminal-reminder" role="status"><CircleAlert size={18} aria-hidden="true" /><span>請繼續操作，終端正在等待您的操作</span></div>}
      {error && <div className="legacy-terminal-alert" role="alert"><strong>系統提示</strong><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="關閉提示"><X size={17} /></button></div>}
      {message && <div className="legacy-terminal-toast" role="status"><span>✓</span>{message}<button type="button" onClick={() => setMessage("")} aria-label="關閉訊息"><X size={16} /></button></div>}

      {customOpen && (
        <div className="legacy-terminal-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCustomOpen(false); }}>
          <section className="legacy-terminal-custom-modal" role="dialog" aria-modal="true" aria-labelledby="custom-points-title">
            <div className="legacy-terminal-custom-modal__header">
              <div>
                <h2 id="custom-points-title">自訂累積扣除點數</h2>
                <p>請輸入要手動增加／扣除的點數值</p>
              </div>
              <button type="button" onClick={() => setCustomOpen(false)} aria-label="關閉自訂點數"><X size={20} /></button>
            </div>
            <div className="legacy-terminal-custom-mode">
              <button type="button" className={customMode === "add" ? "is-active" : ""} onClick={() => setCustomMode("add")}><Plus size={18} />增加點數</button>
              <button type="button" className={customMode === "manual" ? "is-active is-danger" : ""} onClick={() => setCustomMode("manual")}><Minus size={18} />扣除點數</button>
            </div>
            <div className={`legacy-terminal-custom-value ${customMode === "manual" ? "is-danger" : ""}`}><span>{customMode === "add" ? "+" : "−"}</span>{customAmount || "0"}</div>
            <div className="legacy-terminal-custom-keypad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => <button key={number} type="button" onClick={() => handleCustomDigit(String(number))}>{number}</button>)}
              <button type="button" className="is-muted" onClick={() => setCustomAmount("")}>清除</button>
              <button type="button" onClick={() => handleCustomDigit("0")}>0</button>
              <button type="button" className="is-primary" onClick={handleCustomSubmit} disabled={!isOnline || !customAmount || loading}>確認</button>
            </div>
            <button type="button" className="legacy-terminal-custom-cancel" onClick={() => setCustomOpen(false)}><Wrench size={16} />取消並返回</button>
          </section>
        </div>
      )}
    </main>
  );
}
