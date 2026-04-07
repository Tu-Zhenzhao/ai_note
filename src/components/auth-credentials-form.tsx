"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Mode = "login" | "register";
type LookKind = "email" | "text";
type MouthStatus = "small" | "medium" | "large";

type AvatarPose = {
  eyeLX: number;
  eyeLY: number;
  eyeRX: number;
  eyeRY: number;
  eyeScale: number;
  noseX: number;
  noseY: number;
  mouthX: number;
  mouthY: number;
  mouthR: number;
  chinX: number;
  chinY: number;
  chinScaleY: number;
  faceX: number;
  faceY: number;
  faceSkew: number;
  eyebrowX: number;
  eyebrowY: number;
  eyebrowSkew: number;
  outerEarX: number;
  outerEarY: number;
  hairX: number;
  hairScaleY: number;
  mouthStatus: MouthStatus;
};

const DEFAULT_POSE: AvatarPose = {
  eyeLX: 0,
  eyeLY: 0,
  eyeRX: 0,
  eyeRY: 0,
  eyeScale: 1,
  noseX: 0,
  noseY: 0,
  mouthX: 0,
  mouthY: 0,
  mouthR: 0,
  chinX: 0,
  chinY: 0,
  chinScaleY: 1,
  faceX: 0,
  faceY: 0,
  faceSkew: 0,
  eyebrowX: 0,
  eyebrowY: 0,
  eyebrowSkew: 0,
  outerEarX: 0,
  outerEarY: 0,
  hairX: 0,
  hairScaleY: 1,
  mouthStatus: "small",
};

function getAngle(x1: number, y1: number, x2: number, y2: number) {
  return Math.atan2(y1 - y2, x1 - x2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parsePx(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AuthCredentialsForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const svgId = useId().replace(/:/g, "");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  const [isUiReady, setIsUiReady] = useState(false);
  const [pose, setPose] = useState<AvatarPose>(DEFAULT_POSE);

  const viewerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const activeLookInputRef = useRef<HTMLInputElement | null>(null);
  const activeLookKindRef = useRef<LookKind>("text");
  const frameRef = useRef<number | null>(null);
  const armTimerRef = useRef<number | null>(null);

  const [armPose, setArmPose] = useState<"hidden" | "covering" | "covered" | "uncovering">("hidden");

  const isRegister = mode === "register";
  const armMaskId = `${svgId}-arm-mask`;
  const armMaskPathId = `${svgId}-arm-mask-path`;
  const mouthMaskId = `${svgId}-mouth-mask`;
  const mouthMaskPathId = `${svgId}-mouth-mask-path`;

  const mouthOutlinePath =
    "M100.2,101c-0.4,0-1.4,0-1.8,0c-2.7-0.3-5.3-1.1-8-2.5c-0.7-0.3-0.9-1.2-0.6-1.8c0.2-0.5,0.7-0.7,1.2-0.7c0.2,0,0.5,0.1,0.6,0.2c3,1.5,5.8,2.3,8.6,2.3s5.7-0.7,8.6-2.3c0.2-0.1,0.4-0.2,0.6-0.2c0.5,0,1,0.3,1.2,0.7c0.4,0.7,0.1,1.5-0.6,1.9c-2.6,1.4-5.3,2.2-7.9,2.5C101.7,101,100.5,101,100.2,101z";
  const mouthMediumPath =
    "M95,104.2c-4.5,0-8.2-3.7-8.2-8.2v-2c0-1.2,1-2.2,2.2-2.2h22c1.2,0,2.2,1,2.2,2.2v2c0,4.5-3.7,8.2-8.2,8.2H95z";
  const mouthLargePath =
    "M100 110.2c-9 0-16.2-7.3-16.2-16.2 0-2.3 1.9-4.2 4.2-4.2h24c2.3 0 4.2 1.9 4.2 4.2 0 9-7.2 16.2-16.2 16.2z";

  const mouthBackgroundPath =
    pose.mouthStatus === "large"
      ? mouthLargePath
      : pose.mouthStatus === "medium"
        ? mouthMediumPath
        : mouthOutlinePath;

  function resetPose() {
    setPose(DEFAULT_POSE);
  }

  function updatePoseFromInput(input: HTMLInputElement, kind: LookKind) {
    if (!viewerRef.current || !measureRef.current) return;

    const inputRect = input.getBoundingClientRect();
    const viewerRect = viewerRef.current.getBoundingClientRect();
    if (!inputRect.width || !viewerRect.width) return;

    const computed = window.getComputedStyle(input);
    const caretIndex = input.selectionEnd ?? input.value.length;
    const beforeCaret = input.value.slice(0, caretIndex);
    const measure = measureRef.current;
    measure.textContent = beforeCaret;
    measure.style.font = computed.font;
    measure.style.fontKerning = computed.fontKerning;
    measure.style.fontStretch = computed.fontStretch;
    measure.style.fontStyle = computed.fontStyle;
    measure.style.fontVariant = computed.fontVariant;
    measure.style.fontWeight = computed.fontWeight;
    measure.style.letterSpacing = computed.letterSpacing;
    measure.style.textTransform = computed.textTransform;
    measure.style.textIndent = computed.textIndent;
    measure.style.whiteSpace = "pre";

    const paddingLeft = parsePx(computed.paddingLeft);
    const paddingRight = parsePx(computed.paddingRight);
    const textWidth = measure.offsetWidth;
    const caretX = clamp(
      inputRect.left + paddingLeft + textWidth - input.scrollLeft,
      inputRect.left + paddingLeft,
      inputRect.right - paddingRight,
    );
    const caretY = inputRect.top + inputRect.height / 2;

    const svgScale = viewerRect.width / 200;
    const screenCenter = viewerRect.left + viewerRect.width / 2;
    const eyeLCoords = { x: viewerRect.left + 84 * svgScale, y: viewerRect.top + 76 * svgScale };
    const eyeRCoords = { x: viewerRect.left + 113 * svgScale, y: viewerRect.top + 76 * svgScale };
    const noseCoords = { x: viewerRect.left + 97 * svgScale, y: viewerRect.top + 81 * svgScale };
    const mouthCoords = { x: viewerRect.left + 100 * svgScale, y: viewerRect.top + 100 * svgScale };

    const eyeLAngle = getAngle(eyeLCoords.x, eyeLCoords.y, caretX, caretY);
    const eyeRAngle = getAngle(eyeRCoords.x, eyeRCoords.y, caretX, caretY);
    const noseAngle = getAngle(noseCoords.x, noseCoords.y, caretX, caretY);
    const mouthAngle = getAngle(mouthCoords.x, mouthCoords.y, caretX, caretY);

    const eyeLX = Math.cos(eyeLAngle) * 20;
    const eyeLY = Math.sin(eyeLAngle) * 10;
    const eyeRX = Math.cos(eyeRAngle) * 20;
    const eyeRY = Math.sin(eyeRAngle) * 10;
    const noseX = Math.cos(noseAngle) * 23;
    const noseY = Math.sin(noseAngle) * 10;
    const mouthX = Math.cos(mouthAngle) * 23;
    const mouthY = Math.sin(mouthAngle) * 10;
    const mouthR = Math.cos(mouthAngle) * 6;
    const chinX = mouthX * 0.8;
    const chinY = mouthY * 0.5;
    const dFromC = screenCenter - caretX;

    let chinScaleY = 1 - ((dFromC * 0.15) / 100);
    if (chinScaleY > 1) {
      chinScaleY = 1 - (chinScaleY - 1);
      if (chinScaleY < 0.5) {
        chinScaleY = 0.5;
      }
    }

    const faceX = mouthX * 0.3;
    const faceY = mouthY * 0.4;
    const faceSkew = Math.cos(mouthAngle) * 5;
    const eyebrowSkew = Math.cos(mouthAngle) * 25;
    const outerEarX = Math.cos(mouthAngle) * 4;
    const outerEarY = Math.cos(mouthAngle) * 5;
    const hairX = Math.cos(mouthAngle) * 6;

    const value = input.value;
    const mouthStatus: MouthStatus =
      value.length === 0 ? "small" : kind === "email" && value.includes("@") ? "large" : "medium";
    const eyeScale = mouthStatus === "large" ? 0.65 : mouthStatus === "medium" ? 0.85 : 1;

    setPose({
      eyeLX: -eyeLX,
      eyeLY: -eyeLY,
      eyeRX: -eyeRX,
      eyeRY: -eyeRY,
      eyeScale,
      noseX: -noseX,
      noseY: -noseY,
      mouthX: -mouthX,
      mouthY: -mouthY,
      mouthR,
      chinX: -chinX,
      chinY: -chinY,
      chinScaleY,
      faceX: -faceX,
      faceY: -faceY,
      faceSkew: -faceSkew,
      eyebrowX: -faceX,
      eyebrowY: -faceY,
      eyebrowSkew: -eyebrowSkew,
      outerEarX,
      outerEarY,
      hairX,
      hairScaleY: 1.2,
      mouthStatus,
    });
  }

  function schedulePoseUpdate() {
    if (typeof window === "undefined") return;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const activeInput = activeLookInputRef.current;
      if (activeInput && !isPasswordFocused) {
        updatePoseFromInput(activeInput, activeLookKindRef.current);
      }
    });
  }

  function handleLookFocus(input: HTMLInputElement, kind: LookKind) {
    activeLookInputRef.current = input;
    activeLookKindRef.current = kind;
    schedulePoseUpdate();
  }

  function handleLookBlur(input: HTMLInputElement) {
    if (activeLookInputRef.current === input) {
      activeLookInputRef.current = null;
    }
    if (!isPasswordFocused) {
      resetPose();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(isRegister ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: isRegister ? displayName : undefined,
          invite_code: isRegister ? inviteCode : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Authentication failed");
      }
      router.push("/askmore_v2/builder");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (activeLookInputRef.current && !isPasswordFocused) {
      schedulePoseUpdate();
    }
  }, [email, displayName, inviteCode, isPasswordFocused]);

  useEffect(() => {
    function handleResize() {
      if (activeLookInputRef.current && !isPasswordFocused) {
        schedulePoseUpdate();
      }
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [isPasswordFocused]);

  useEffect(() => {
    const readyTimer = window.requestAnimationFrame(() => {
      setIsUiReady(true);
    });

    return () => {
      window.cancelAnimationFrame(readyTimer);
    };
  }, []);

  useEffect(() => {
    if (isPasswordFocused) {
      return;
    }

    let blinkTimer: number;
    let resetTimer: number;

    const blink = () => {
      blinkTimer = window.setTimeout(() => {
        setIsBlinking(true);
        resetTimer = window.setTimeout(() => {
          setIsBlinking(false);
          blink();
        }, 140);
      }, 2400 + Math.random() * 2200);
    };

    blink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(resetTimer);
      setIsBlinking(false);
    };
  }, [isPasswordFocused]);

  useEffect(() => {
    const clearArmTimer = () => {
      if (armTimerRef.current !== null) {
        window.clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
    };

    clearArmTimer();

    if (isPasswordFocused) {
      setArmPose("covering");
      armTimerRef.current = window.setTimeout(() => {
        setArmPose("covered");
        armTimerRef.current = null;
      }, 420);
    } else {
      setArmPose((current) => (current === "hidden" ? "hidden" : "uncovering"));
      armTimerRef.current = window.setTimeout(() => {
        setArmPose("hidden");
        armTimerRef.current = null;
      }, 460);
    }

    return clearArmTimer;
  }, [isPasswordFocused]);

  const faceTransition = "transform 0.95s cubic-bezier(0.19, 1, 0.22, 1)";
  const featureTransition = "transform 0.95s cubic-bezier(0.19, 1, 0.22, 1)";
  const eyeTransition = "transform 0.95s cubic-bezier(0.19, 1, 0.22, 1)";
  const blinkTransition = "transform 0.12s ease-out";

  return (
    <div className={`v2-auth-page ${isUiReady ? "is-ui-ready" : ""}`}>
      <div className="v2-auth-container">
        <div ref={viewerRef} className="v2-dog-viewer" aria-hidden="true">
          <div className="v2-dog-inner">
            <svg className="v2-dog-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <rect id={armMaskPathId} x="-120" y="-20" width="440" height="320" />
                <clipPath id={armMaskId}>
                  <use href={`#${armMaskPathId}`} overflow="visible" />
                </clipPath>
                <path id={mouthMaskPathId} d={mouthBackgroundPath} />
                <clipPath id={mouthMaskId}>
                  <use href={`#${mouthMaskPathId}`} overflow="visible" />
                </clipPath>
              </defs>

              <g className="body">
                <path
                  stroke="#2D2B29"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="#FFFFFF"
                  d="M200,158.5c0-20.2-14.8-36.5-35-36.5h-14.9V72.8c0-27.4-21.7-50.4-49.1-50.8c-28-0.5-50.9,22.1-50.9,50v50 H35.8C16,122,0,138,0,157.8L0,213h200L200,158.5z"
                />
                <path
                  fill="#E5E2DA"
                  d="M100,156.4c-22.9,0-43,11.1-54.1,27.7c15.6,10,34.2,15.9,54.1,15.9s38.5-5.8,54.1-15.9 C143,167.5,122.9,156.4,100,156.4z"
                />
              </g>

              <g className="earL">
                <g
                  className="outerEar"
                  style={{
                    transform: `translate(${pose.outerEarX}px, ${-pose.outerEarY}px)`,
                    transformOrigin: "center center",
                    transformBox: "fill-box",
                    transition: featureTransition,
                  }}
                >
                  <circle cx="47" cy="83" r="11.5" fill="#E5E2DA" stroke="#2D2B29" strokeWidth="2.5" />
                  <path
                    d="M46.3 78.9c-2.3 0-4.1 1.9-4.1 4.1 0 2.3 1.9 4.1 4.1 4.1"
                    fill="none"
                    stroke="#2D2B29"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
                <g
                  className="earHair"
                  style={{
                    transform: `translate(${-pose.outerEarX}px, ${-pose.outerEarY}px)`,
                    transformOrigin: "center center",
                    transformBox: "fill-box",
                    transition: featureTransition,
                  }}
                >
                  <rect x="51" y="64" fill="#FFFFFF" width="15" height="35" />
                  <path
                    d="M53.4 62.8C48.5 67.4 45 72.2 42.8 77c3.4-.1 6.8-.1 10.1.1-4 3.7-6.8 7.6-8.2 11.6 2.1 0 4.2 0 6.3.2-2.6 4.1-3.8 8.3-3.7 12.5 1.2-.7 3.4-1.4 5.2-1.9"
                    fill="#FFFFFF"
                    stroke="#2D2B29"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </g>

              <g className="earR">
                <g
                  className="outerEar"
                  style={{
                    transform: `translate(${pose.outerEarX}px, ${pose.outerEarY}px)`,
                    transformOrigin: "center center",
                    transformBox: "fill-box",
                    transition: featureTransition,
                  }}
                >
                  <circle cx="153" cy="83" r="11.5" fill="#E5E2DA" stroke="#2D2B29" strokeWidth="2.5" />
                  <path
                    d="M153.7,78.9c2.3,0,4.1,1.9,4.1,4.1c0,2.3-1.9,4.1-4.1,4.1"
                    fill="none"
                    stroke="#2D2B29"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
                <g
                  className="earHair"
                  style={{
                    transform: `translate(${-pose.outerEarX}px, ${pose.outerEarY}px)`,
                    transformOrigin: "center center",
                    transformBox: "fill-box",
                    transition: featureTransition,
                  }}
                >
                  <rect x="134" y="64" fill="#FFFFFF" width="15" height="35" />
                  <path
                    d="M146.6,62.8c4.9,4.6,8.4,9.4,10.6,14.2c-3.4-0.1-6.8-0.1-10.1,0.1c4,3.7,6.8,7.6,8.2,11.6c-2.1,0-4.2,0-6.3,0.2c2.6,4.1,3.8,8.3,3.7,12.5c-1.2-0.7-3.4-1.4-5.2-1.9"
                    fill="#FFFFFF"
                    stroke="#2D2B29"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </g>

              <path
                className="chin"
                d="M84.1 121.6c2.7 2.9 6.1 5.4 9.8 7.5l.9-4.5c2.9 2.5 6.3 4.8 10.2 6.5 0-1.9-.1-3.9-.2-5.8 3 1.2 6.2 2 9.7 2.5-.3-2.1-.7-4.1-1.2-6.1"
                fill="none"
                stroke="#2D2B29"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: `translate(${pose.chinX}px, ${pose.chinY}px) scaleY(${pose.chinScaleY})`,
                  transformOrigin: "center top",
                  transformBox: "fill-box",
                  transition: featureTransition,
                }}
              />

              <path
                className="face"
                fill="#E5E2DA"
                d="M134.5,46v35.5c0,21.815-15.446,39.5-34.5,39.5s-34.5-17.685-34.5-39.5V46"
                style={{
                  transform: `translate(${pose.faceX}px, ${pose.faceY}px) skewX(${pose.faceSkew}deg)`,
                  transformOrigin: "center top",
                  transformBox: "fill-box",
                  transition: faceTransition,
                }}
              />

              <g
                className="eyebrow"
                style={{
                  transform: `translate(${pose.eyebrowX}px, ${pose.eyebrowY}px) skewX(${pose.eyebrowSkew}deg)`,
                  transformOrigin: "center top",
                  transformBox: "fill-box",
                  transition: faceTransition,
                }}
              >
                <path
                  fill="#FFFFFF"
                  d="M138.142,55.064c-4.93,1.259-9.874,2.118-14.787,2.599c-0.336,3.341-0.776,6.689-1.322,10.037c-4.569-1.465-8.909-3.222-12.996-5.226c-0.98,3.075-2.07,6.137-3.267,9.179c-5.514-3.067-10.559-6.545-15.097-10.329c-1.806,2.889-3.745,5.73-5.816,8.515c-7.916-4.124-15.053-9.114-21.296-14.738l1.107-11.768h73.475V55.064z"
                />
                <path
                  fill="none"
                  stroke="#2D2B29"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M63.56,55.102c6.243,5.624,13.38,10.614,21.296,14.738c2.071-2.785,4.01-5.626,5.816-8.515c4.537,3.785,9.583,7.263,15.097,10.329c1.197-3.043,2.287-6.104,3.267-9.179c4.087,2.004,8.427,3.761,12.996,5.226c0.545-3.348,0.986-6.696,1.322-10.037c4.913-0.481,9.857-1.34,14.787-2.599"
                />
              </g>

              <path
                className="hair"
                fill="#FFFFFF"
                stroke="#2D2B29"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M81.457,27.929c1.755-4.084,5.51-8.262,11.253-11.77c0.979,2.565,1.883,5.14,2.712,7.723c3.162-4.265,8.626-8.27,16.272-11.235c-0.737,3.293-1.588,6.573-2.554,9.837c4.857-2.116,11.049-3.64,18.428-4.156c-2.403,3.23-5.021,6.391-7.852,9.474"
                style={{
                  transform: `translateX(${pose.hairX}px) scaleY(${pose.hairScaleY})`,
                  transformOrigin: "center bottom",
                  transformBox: "fill-box",
                  transition: featureTransition,
                }}
              />

              <g
                className="eyeL"
                style={{
                  transform: `translate(${pose.eyeLX}px, ${pose.eyeLY}px)`,
                  transformOrigin: "center center",
                  transformBox: "fill-box",
                  transition: eyeTransition,
                }}
              >
                <g
                  style={{
                    transform: `scale(${pose.eyeScale}, ${isBlinking ? 0.08 : pose.eyeScale})`,
                    transformOrigin: "center center",
                    transformBox: "fill-box",
                    transition: `${eyeTransition}, ${blinkTransition}`,
                  }}
                >
                  <circle cx="85.5" cy="78.5" r="3.5" fill="#2D2B29" />
                  <circle cx="84" cy="76" r="1" fill="#FFFFFF" />
                </g>
              </g>

              <g
                className="eyeR"
                style={{
                  transform: `translate(${pose.eyeRX}px, ${pose.eyeRY}px)`,
                  transformOrigin: "center center",
                  transformBox: "fill-box",
                  transition: eyeTransition,
                }}
              >
                <g
                  style={{
                    transform: `scale(${pose.eyeScale}, ${isBlinking ? 0.08 : pose.eyeScale})`,
                    transformOrigin: "center center",
                    transformBox: "fill-box",
                    transition: `${eyeTransition}, ${blinkTransition}`,
                  }}
                >
                  <circle cx="114.5" cy="78.5" r="3.5" fill="#2D2B29" />
                  <circle cx="113" cy="76" r="1" fill="#FFFFFF" />
                </g>
              </g>

              <g
                className="mouth"
                style={{
                  transform: `translate(${pose.mouthX}px, ${pose.mouthY}px) rotate(${pose.mouthR}deg)`,
                  transformOrigin: "center center",
                  transformBox: "fill-box",
                  transition: featureTransition,
                }}
              >
                <path
                  className="mouthBG"
                  d={mouthBackgroundPath}
                  fill="#5A5551"
                />
                <g clipPath={`url(#${mouthMaskId})`}>
                  <g
                    className="tongue"
                    style={{
                      transform: `translate(${pose.mouthStatus === "large" ? 0 : 0}px, ${pose.mouthStatus === "large" ? 2 : pose.mouthStatus === "medium" ? 1 : 0}px)`,
                      transformOrigin: "center center",
                      transformBox: "fill-box",
                      transition: featureTransition,
                    }}
                  >
                    <circle cx="100" cy="107" r="8" fill="#C56472" />
                    <ellipse cx="100" cy="100.5" rx="3" ry="1.5" opacity="0.12" fill="#FFFFFF" />
                  </g>
                </g>
                <path
                  clipPath={`url(#${mouthMaskId})`}
                  className="tooth"
                  fill="#FFFFFF"
                  d="M106,97h-4c-1.1,0-2-0.9-2-2v-2h8v2C108,96.1,107.1,97,106,97z"
                  style={{
                    transform: `translate(${pose.mouthStatus === "large" ? 3 : 0}px, ${pose.mouthStatus === "large" ? -2 : 0}px)`,
                    transformOrigin: "center center",
                    transformBox: "fill-box",
                    transition: featureTransition,
                  }}
                />
                <path
                  className="mouthOutline"
                  fill="none"
                  stroke="#2D2B29"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  d={mouthBackgroundPath}
                />
              </g>

              <path
                className="nose"
                d="M97.7 79.9h4.7c1.9 0 3 2.2 1.9 3.7l-2.3 3.3c-.9 1.3-2.9 1.3-3.8 0l-2.3-3.3c-1.3-1.6-.2-3.7 1.8-3.7z"
                fill="#2D2B29"
                style={{
                  transform: `translate(${pose.noseX}px, ${pose.noseY}px) rotate(${pose.mouthR}deg)`,
                  transformOrigin: "center center",
                  transformBox: "fill-box",
                  transition: featureTransition,
                }}
              />

              <g className="arms" clipPath={`url(#${armMaskId})`}>
                <g className={`v2-armL is-${armPose}`}>
                  <g transform="translate(-10 -108)">
                    <polygon fill="#EAF5F2" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points="121.3,98.4 111,59.7 149.8,49.3 169.8,85.4" />
                    <path fill="#EAF5F2" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M134.4,53.5l19.3-5.2c2.7-0.7,5.4,0.9,6.1,3.5v0c0.7,2.7-0.9,5.4-3.5,6.1l-10.3,2.8" />
                    <path fill="#EAF5F2" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M150.9,59.4l26-7c2.7-0.7,5.4,0.9,6.1,3.5v0c0.7,2.7-0.9,5.4-3.5,6.1l-21.3,5.7" />
                    <g className={`v2-twoFingers ${showPassword ? "is-spread" : "is-closed"}`}>
                      <path fill="#EAF5F2" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M158.3,67.8l23.1-6.2c2.7-0.7,5.4,0.9,6.1,3.5v0c0.7,2.7-0.9,5.4-3.5,6.1l-23.1,6.2" />
                      <path fill="#0D7B64" d="M180.1,65l2.2-0.6c1.1-0.3,2.2,0.3,2.4,1.4v0c0.3,1.1-0.3,2.2-1.4,2.4l-2.2,0.6L180.1,65z" />
                      <path fill="#EAF5F2" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M160.8,77.5l19.4-5.2c2.7-0.7,5.4,0.9,6.1,3.5v0c0.7,2.7-0.9,5.4-3.5,6.1l-18.3,4.9" />
                      <path fill="#0D7B64" d="M178.8,75.7l2.2-0.6c1.1-0.3,2.2,0.3,2.4,1.4v0c0.3,1.1-0.3,2.2-1.4,2.4l-2.2,0.6L178.8,75.7z" />
                    </g>
                    <path fill="#0D7B64" d="M175.5,55.9l2.2-0.6c1.1-0.3,2.2,0.3,2.4,1.4v0c0.3,1.1-0.3,2.2-1.4,2.4l-2.2,0.6L175.5,55.9z" />
                    <path fill="#0D7B64" d="M152.1,50.4l2.2-0.6c1.1-0.3,2.2,0.3,2.4,1.4v0c0.3,1.1-0.3,2.2-1.4,2.4l-2.2,0.6L152.1,50.4z" />
                    <path fill="#FFFFFF" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M123.5,97.8c-41.4,14.9-84.1,30.7-108.2,35.5L1.2,81c33.5-9.9,71.9-16.5,111.9-21.8" />
                    <path fill="#FFFFFF" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M108.5,60.4c7.7-5.3,14.3-8.4,22.8-13.2c-2.4,5.3-4.7,10.3-6.7,15.1c4.3,0.3,8.4,0.7,12.3,1.3c-4.2,5-8.1,9.6-11.5,13.9c3.1,1.1,6,2.4,8.7,3.8c-1.4,2.9-2.7,5.8-3.9,8.5c2.5,3.5,4.6,7.2,6.3,11c-4.9-0.8-9-0.7-16.2-2.7" />
                    <path fill="#FFFFFF" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M94.5,103.8c-0.6,4-3.8,8.9-9.4,14.7c-2.6-1.8-5-3.7-7.2-5.7c-2.5,4.1-6.6,8.8-12.2,14c-1.9-2.2-3.4-4.5-4.5-6.9c-4.4,3.3-9.5,6.9-15.4,10.8c-0.2-3.4,0.1-7.1,1.1-10.9" />
                    <path fill="#FFFFFF" stroke="#2D2B29" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" d="M97.5,63.9c-1.7-2.4-5.9-4.1-12.4-5.2c-0.9,2.2-1.8,4.3-2.5,6.5c-3.8-1.8-9.4-3.1-17-3.8c0.5,2.3,1.2,4.5,1.9,6.8c-5-0.6-11.2-0.9-18.4-1c2,2.9,0.9,3.5,3.9,6.2" />
                  </g>
                </g>

                <g className={`v2-armR is-${armPose}`}>
                  <g transform="translate(-374 -108)">
                    <path fill="#EAF5F2" stroke="#2D2B29" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M265.4 97.3l10.4-38.6-38.9-10.5-20 36.1z" />
                    <path fill="#EAF5F2" stroke="#2D2B29" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M252.4 52.4L233 47.2c-2.7-.7-5.4.9-6.1 3.5-.7 2.7.9 5.4 3.5 6.1l10.3 2.8M226 76.4l-19.4-5.2c-2.7-.7-5.4.9-6.1 3.5-.7 2.7.9 5.4 3.5 6.1l18.3 4.9M228.4 66.7l-23.1-6.2c-2.7-.7-5.4.9-6.1 3.5-.7 2.7.9 5.4 3.5 6.1l23.1 6.2M235.8 58.3l-26-7c-2.7-.7-5.4.9-6.1 3.5-.7 2.7.9 5.4 3.5 6.1l21.3 5.7" />
                    <path fill="#0D7B64" d="M207.9 74.7l-2.2-.6c-1.1-.3-2.2.3-2.4 1.4-.3 1.1.3 2.2 1.4 2.4l2.2.6 1-3.8zM206.7 64l-2.2-.6c-1.1-.3-2.2.3-2.4 1.4-.3 1.1.3 2.2 1.4 2.4l2.2.6 1-3.8zM211.2 54.8l-2.2-.6c-1.1-.3-2.2.3-2.4 1.4-.3 1.1.3 2.2 1.4 2.4l2.2.6 1-3.8zM234.6 49.4l-2.2-.6c-1.1-.3-2.2.3-2.4 1.4-.3 1.1.3 2.2 1.4 2.4l2.2.6 1-3.8z" />
                    <path fill="#FFFFFF" stroke="#2D2B29" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M263.3 96.7c41.4 14.9 84.1 30.7 108.2 35.5l14-52.3C352 70 313.6 63.5 273.6 58.1" />
                    <path fill="#FFFFFF" stroke="#2D2B29" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M278.2 59.3l-18.6-10 2.5 11.9-10.7 6.5 9.9 8.7-13.9 6.4 9.1 5.9-13.2 9.2 23.1-.9M284.5 100.1c-.4 4 1.8 8.9 6.7 14.8 3.5-1.8 6.7-3.6 9.7-5.5 1.8 4.2 5.1 8.9 10.1 14.1 2.7-2.1 5.1-4.4 7.1-6.8 4.1 3.4 9 7 14.7 11 1.2-3.4 1.8-7 1.7-10.9M314 66.7s5.4-5.7 12.6-7.4c1.7 2.9 3.3 5.7 4.9 8.6 3.8-2.5 9.8-4.4 18.2-5.7.1 3.1.1 6.1 0 9.2 5.5-1 12.5-1.6 20.8-1.9-1.4 3.9-2.5 8.4-2.5 8.4" />
                  </g>
                </g>
              </g>
            </svg>
          </div>
        </div>

        <form onSubmit={onSubmit} className="v2-auth-card">
          <div className="v2-auth-header">
            <h1>
              {isRegister ? (
                <>
                  来
                  <span className="v2-brand-link-wrapper">
                    <a href="https://askmore.ulfilter.com" target="_blank" rel="noreferrer" className="v2-brand-link">
                      多问AI
                    </a>
                    <div className="v2-brand-tooltip">
                      我是干啥的？看看首页吧
                      <div className="v2-tooltip-tail" />
                    </div>
                  </span>
                  开问吧
                </>
              ) : (
                <>
                  来啦？
                  <span className="v2-brand-link-wrapper">
                    <a href="https://askmore.ulfilter.com" target="_blank" rel="noreferrer" className="v2-brand-link">
                      多问AI
                    </a>
                    <div className="v2-brand-tooltip">
                      我是干啥的？看看首页吧
                      <div className="v2-tooltip-tail" />
                    </div>
                  </span>
                  准备好了
                </>
              )}
            </h1>
            <p className="v2-auth-tagline">好的答案，来自被理解的过程</p>
          </div>

          {isRegister && (
            <>
              <div className="v2-auth-field">
                <label>称呼 / Name</label>
                <input
                  type="text"
                  value={displayName}
                  onFocus={(event) => handleLookFocus(event.currentTarget, "text")}
                  onBlur={(event) => handleLookBlur(event.currentTarget)}
                  onClick={schedulePoseUpdate}
                  onKeyUp={schedulePoseUpdate}
                  onSelect={schedulePoseUpdate}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="怎么称呼你？ / How should we address you?"
                  required
                />
              </div>

              <div className="v2-auth-field">
                <label>邀请码 / Invite Code</label>
                <input
                  type="text"
                  value={inviteCode}
                  onFocus={(event) => handleLookFocus(event.currentTarget, "text")}
                  onBlur={(event) => handleLookBlur(event.currentTarget)}
                  onClick={schedulePoseUpdate}
                  onKeyUp={schedulePoseUpdate}
                  onSelect={schedulePoseUpdate}
                  onChange={(event) => setInviteCode(event.target.value)}
                  placeholder="请输入邀请码 / Enter beta invite code"
                  required
                />
              </div>
            </>
          )}

          <div className="v2-auth-field">
            <label>邮箱 / Email</label>
            <input
              type="email"
              value={email}
              onFocus={(event) => handleLookFocus(event.currentTarget, "email")}
              onBlur={(event) => handleLookBlur(event.currentTarget)}
              onClick={schedulePoseUpdate}
              onKeyUp={schedulePoseUpdate}
              onSelect={schedulePoseUpdate}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="请输入邮箱 / you@company.com"
              required
            />
          </div>

          <div className="v2-auth-field">
            <label>密码 / Password</label>
            <div className="v2-input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onFocus={() => {
                  setIsPasswordFocused(true);
                  activeLookInputRef.current = null;
                }}
                onBlur={() => {
                  setIsPasswordFocused(false);
                  if (activeLookInputRef.current) {
                    schedulePoseUpdate();
                  } else {
                    resetPose();
                  }
                }}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位密码 / At least 8 characters"
                required
              />
              <button
                type="button"
                className="v2-pwd-toggle"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "隐藏密码 / Hide password" : "显示密码 / Show password"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {error && <div className="v2-auth-error">{error}</div>}

          <button type="submit" className="v2-auth-submit" disabled={submitting}>
            {submitting ? "处理中... / Processing..." : isRegister ? "开问 / Create Account" : "登录 / Login"}
          </button>

          <div className="v2-auth-footer">
            {isRegister ? (
              <Link href="/login">
                已有账号？<span>去登录 / Login</span>
              </Link>
            ) : (
              <Link href="/register">
                还没有账号？<span>去注册 / Register</span>
              </Link>
            )}
          </div>
        </form>
      </div>

      <span ref={measureRef} className="v2-measure" />

      <style jsx>{`
        .v2-auth-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f0ede5;
          padding: 40px 20px;
        }

        .v2-auth-container {
          width: 100%;
          max-width: 420px;
          position: relative;
          padding-top: 170px;
        }

        .v2-dog-viewer {
          position: absolute;
          top: -10px;
          left: 50%;
          width: 262px;
          height: 232px;
          transform: translateX(-50%);
          z-index: 1;
          pointer-events: none;
        }

        .v2-dog-inner {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        .v2-dog-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
          filter: drop-shadow(0 12px 18px rgba(45, 43, 41, 0.08));
        }

        .v2-armL,
        .v2-armR {
          transition: transform 0.56s cubic-bezier(0.2, 0.7, 0.2, 1), filter 0.2s ease, opacity 0.12s ease;
          transform-origin: 0 0;
        }

        .v2-armL.is-hidden,
        .v2-armL.is-uncovering {
          transform: translate(-40px, 176px) rotate(72deg);
          filter: none;
        }

        .v2-armL.is-hidden {
          opacity: 0;
        }

        .v2-armL.is-covering,
        .v2-armL.is-covered {
          transform: translate(-40px, 176px) rotate(-28deg);
          filter: drop-shadow(0 3px 4px rgba(45, 43, 41, 0.12));
          opacity: 1;
        }

        .v2-armL.is-uncovering {
          opacity: 1;
        }

        .v2-armR.is-hidden,
        .v2-armR.is-uncovering {
          transform: translate(240px, 176px) rotate(-72deg);
          filter: none;
        }

        .v2-armR.is-hidden {
          opacity: 0;
        }

        .v2-armR.is-covering,
        .v2-armR.is-covered {
          transform: translate(240px, 176px) rotate(28deg);
          filter: drop-shadow(0 3px 4px rgba(45, 43, 41, 0.12));
          opacity: 1;
        }

        .v2-armR.is-uncovering {
          opacity: 1;
        }

        .v2-twoFingers {
          transition: transform 0.35s ease-in-out;
          transform-origin: bottom left;
          transform-box: fill-box;
        }

        .v2-twoFingers.is-closed {
          transform: rotate(0deg) translate(0, 0);
        }

        .v2-twoFingers.is-spread {
          transform: rotate(30deg) translate(-9px, -2px);
        }

        .v2-auth-page:not(.is-ui-ready) .v2-armL,
        .v2-auth-page:not(.is-ui-ready) .v2-armR,
        .v2-auth-page:not(.is-ui-ready) .v2-twoFingers,
        .v2-auth-page:not(.is-ui-ready) .face,
        .v2-auth-page:not(.is-ui-ready) .eyebrow,
        .v2-auth-page:not(.is-ui-ready) .hair,
        .v2-auth-page:not(.is-ui-ready) .chin,
        .v2-auth-page:not(.is-ui-ready) .nose,
        .v2-auth-page:not(.is-ui-ready) .mouth,
        .v2-auth-page:not(.is-ui-ready) .eyeL,
        .v2-auth-page:not(.is-ui-ready) .eyeR,
        .v2-auth-page:not(.is-ui-ready) .outerEar,
        .v2-auth-page:not(.is-ui-ready) .earHair {
          transition: none !important;
        }

        .v2-auth-card {
          background: #ffffff;
          border: 1px solid #e5e2da;
          border-radius: 20px;
          padding: 64px 32px 32px;
          box-shadow: 0 20px 60px rgba(45, 43, 41, 0.08);
          position: relative;
          z-index: 10;
          overflow: visible;
        }

        .v2-auth-header {
          text-align: center;
          margin-bottom: 28px;
        }

        .v2-auth-header h1 {
          font-size: 24px;
          font-weight: 800;
          color: #2d2b29;
          margin: 0 0 4px;
          line-height: 1.4;
        }

        .v2-brand-link-wrapper {
          position: relative;
          display: inline-block;
          margin: 0 4px;
        }

        .v2-brand-link {
          color: #0d7b64 !important;
          text-decoration: underline dashed 2px;
          text-underline-offset: 4px;
          transition: transform 0.2s ease;
          display: inline-block;
        }

        .v2-brand-link:hover {
          transform: scale(1.05);
        }

        .v2-brand-tooltip {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%) rotate(-4deg);
          margin-bottom: 12px;
          background: #fffbeb;
          border: 2px solid #2d2b29;
          border-radius: 12px;
          padding: 6px 10px;
          font-size: 13px;
          font-weight: 700;
          color: #2d2b29;
          white-space: nowrap;
          box-shadow: 4px 4px 0 rgba(45, 43, 41, 0.1);
          pointer-events: none;
          animation: v2-float 3s ease-in-out infinite;
          z-index: 20;
          line-height: 1.2;
        }

        .v2-tooltip-tail {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 10px solid #2d2b29;
          margin-top: -1px;
        }

        .v2-tooltip-tail::after {
          content: '';
          position: absolute;
          top: -11px;
          left: -6px;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid #fffbeb;
        }

        @keyframes v2-float {
          0%, 100% { transform: translateX(-50%) rotate(-4deg) translateY(0); }
          50% { transform: translateX(-50%) rotate(-4deg) translateY(-5px); }
        }

        .v2-auth-tagline {
          font-size: 14px;
          color: #78756e;
          margin: 0;
        }

        .v2-auth-field {
          margin-bottom: 20px;
        }

        .v2-auth-field label {
          display: block;
          font-size: 12px;
          font-weight: 700;
          color: #2d2b29;
          margin-bottom: 8px;
          letter-spacing: 0.02em;
        }

        .v2-auth-field input {
          width: 100%;
          padding: 12px 14px;
          border: 2px solid #2d2b29;
          border-radius: 8px;
          font-size: 15px;
          background: #fcfbf9;
          color: #2d2b29;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .v2-auth-field input:focus {
          outline: none;
          border-color: #0d7b64;
          box-shadow: 0 0 0 4px rgba(13, 123, 100, 0.08);
        }

        .v2-input-wrapper {
          position: relative;
        }

        .v2-input-wrapper input {
          padding-right: 48px;
        }

        .v2-pwd-toggle {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: transparent;
          border: none;
          border-radius: 999px;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }

        .v2-pwd-toggle:focus-visible {
          outline: 2px solid #0d7b64;
          outline-offset: 2px;
        }

        .v2-auth-error {
          margin-bottom: 16px;
          border-radius: 10px;
          background: #fff0ef;
          color: #b43d2a;
          padding: 12px 14px;
          font-size: 14px;
        }

        .v2-auth-submit {
          width: 100%;
          padding: 14px;
          background: #2d2b29;
          color: #ffffff;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.2s ease, opacity 0.2s ease;
        }

        .v2-auth-submit:hover:not(:disabled) {
          background: #171614;
        }

        .v2-auth-submit:disabled {
          cursor: wait;
          opacity: 0.75;
        }

        .v2-auth-footer {
          text-align: center;
          margin-top: 24px;
          font-size: 14px;
          color: #78756e;
        }

        .v2-auth-footer a {
          color: inherit;
          text-decoration: none;
        }

        .v2-auth-footer span {
          color: #0d7b64;
          font-weight: 700;
        }

        .v2-measure {
          position: absolute;
          visibility: hidden;
          pointer-events: none;
          white-space: pre;
          inset: 0 auto auto 0;
        }

        @media (max-width: 480px) {
          .v2-auth-container {
            padding-top: 146px;
          }

          .v2-dog-viewer {
            width: 236px;
            height: 212px;
          }

          .v2-auth-card {
            padding: 40px 24px 28px;
            border-radius: 18px;
          }
        }
      `}</style>
    </div>
  );
}
