import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const color = {
  navy: "#0a1929",
  teal: "#50c8bd",
  gold: "#e7c68b",
  white: "#f5f8fc",
  muted: "#9badc0",
  line: "rgba(173,205,223,.16)",
};
export const font =
  '"Bahnschrift", "Segoe UI Variable Display", "Segoe UI", sans-serif';
export const chinese = '"Microsoft YaHei", "PingFang SC", sans-serif';
export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const progress = (frame: number, from = 0, length = 30) =>
  interpolate(frame, [from, from + length], [0, 1], { ...clamp, easing: ease });

export const Reveal: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, delay, 30);
  return (
    <div style={{ opacity: p, translate: `0 ${(1 - p) * 42}px`, ...style }}>
      {children}
    </div>
  );
};

export const Background: React.FC<{
  children: React.ReactNode;
  glow?: string;
  light?: boolean;
}> = ({ children, glow = "#12535f", light = false }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        fontFamily: font,
        color: color.white,
        backgroundColor: color.navy,
        backgroundImage: `radial-gradient(ellipse at ${72 + Math.sin(frame / 160) * 5}% 37%, ${glow}88 0%, transparent 58%), linear-gradient(155deg, #132c42 0%, #0a1929 55%, #07131e 100%)`,
      }}
    >
      <AbsoluteFill
        style={{
          opacity: 0.13,
          backgroundImage: "radial-gradient(#b6d4df 0.7px, transparent 0.7px)",
          backgroundSize: "28px 28px",
          maskImage: "linear-gradient(90deg,transparent,#000)",
        }}
      />
      <svg
        width="1920"
        height="1080"
        style={{
          position: "absolute",
          opacity: light ? 0.07 : 0.11,
          translate: `${Math.sin(frame / 200) * 12}px ${Math.cos(frame / 180) * 12}px`,
        }}
      >
        {[330, 470, 620, 780, 960].map((r) => (
          <circle
            key={r}
            cx="1470"
            cy="450"
            r={r}
            fill="none"
            stroke="#a0dedb"
            strokeWidth="1"
          />
        ))}
        <path d="M 0 860 L 1920 210" stroke="#80c8cf" strokeWidth="1" />
      </svg>
      {children}
    </AbsoluteFill>
  );
};

export const Logo: React.FC<{ size?: number; style?: React.CSSProperties }> = ({
  size = 84,
  style,
}) => (
  <Img
    src={staticFile("brand/logo.svg")}
    style={{ width: size, height: size, borderRadius: size * 0.22, ...style }}
  />
);
export const Kicker: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div
    style={{
      display: "flex",
      gap: 14,
      alignItems: "center",
      color: color.teal,
      fontSize: 19,
      letterSpacing: 4,
      fontWeight: 600,
      textTransform: "uppercase",
    }}
  >
    <div style={{ width: 28, height: 2, background: color.teal }} />
    {children}
  </div>
);
export const Chinese: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      fontFamily: chinese,
      fontSize: 26,
      letterSpacing: 3,
      color: "#9cb9c9",
      lineHeight: 1.7,
      ...style,
    }}
  >
    {children}
  </div>
);
export const Footer: React.FC<{
  index: string;
  label: string;
  demo?: boolean;
}> = ({ index, label, demo }) => (
  <div
    style={{
      position: "absolute",
      left: 96,
      right: 96,
      bottom: 38,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 16,
      letterSpacing: 2,
      color: "#8ca5b8",
    }}
  >
    <span>
      MyHKU{" "}
      <span style={{ marginLeft: 24, opacity: 0.5 }}>
        A LITTLE MORE CLARITY.
      </span>
    </span>
    <span style={{ fontSize: 14, letterSpacing: 1 }}>
      {demo ? "ACTUAL UI · DEMO DATA" : label}{" "}
      <span style={{ marginLeft: 28, color: color.teal }}>{index} / 07</span>
    </span>
  </div>
);

export const Icon: React.FC<{
  name:
    | "calendar"
    | "book"
    | "check"
    | "file"
    | "lock"
    | "arrow"
    | "desktop"
    | "phone"
    | "download";
  size?: number;
  color?: string;
}> = ({ name, size = 32, color: stroke = color.teal }) => {
  const paths: Record<string, React.ReactNode> = {
    calendar: (
      <>
        <rect x="4" y="6" width="24" height="22" rx="4" />
        <path d="M10 3v6M22 3v6M4 13h24M10 18h3M19 18h3M10 23h3" />
      </>
    ),
    book: (
      <>
        <path d="M16 8C12 4 6 4 3 5v22c4-2 9-1 13 2 4-3 9-4 13-2V5c-4-1-9-1-13 3v21" />
        <path d="M7 11h5M7 16h5M20 11h5M20 16h5" />
      </>
    ),
    check: (
      <>
        <circle cx="16" cy="16" r="12" />
        <path d="m10 16 4 4 8-9" />
      </>
    ),
    file: (
      <>
        <path d="M19 3H7a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V11Z" />
        <path d="M19 3v8h8M10 17h12M10 22h8" />
      </>
    ),
    lock: (
      <>
        <rect x="6" y="13" width="20" height="16" rx="4" />
        <path d="M10 13V9a6 6 0 0 1 12 0v4M16 19v5" />
      </>
    ),
    arrow: <path d="M5 16h22M19 8l8 8-8 8" />,
    desktop: (
      <>
        <rect x="2" y="4" width="28" height="20" rx="3" />
        <path d="M16 24v5M10 29h12" />
      </>
    ),
    phone: (
      <>
        <rect x="8" y="2" width="16" height="28" rx="4" />
        <path d="M13 6h6M15 26h2" />
      </>
    ),
    download: (
      <>
        <path d="M16 3v18m-7-7 7 7 7-7M4 23v6h24v-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke={stroke}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
};

export const Desktop: React.FC<{
  capture: string;
  width: number;
  style?: React.CSSProperties;
}> = ({ capture, width, style }) => (
  <div
    style={{
      width,
      border: "1px solid #657b8e88",
      borderRadius: 17,
      overflow: "hidden",
      boxShadow: "0 45px 100px #0006,0 0 0 7px #82afbb0d",
      background: "#e9f0f6",
      ...style,
    }}
  >
    <div
      style={{
        height: 38,
        background: "#dce5ed",
        display: "flex",
        alignItems: "center",
        padding: "0 17px",
        gap: 7,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#c58e8b",
        }}
      />
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#d0b882",
        }}
      />
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#7fae9c",
        }}
      />
      <span
        style={{
          margin: "0 auto",
          color: "#526979",
          fontSize: 13,
          letterSpacing: 1.3,
          paddingRight: 45,
        }}
      >
        MyHKU · 学习空间
      </span>
    </div>
    <Img
      src={staticFile(`captures/${capture}.png`)}
      style={{ display: "block", width: "100%" }}
    />
  </div>
);

export const Phone: React.FC<{
  width?: number;
  style?: React.CSSProperties;
}> = ({ width = 350, style }) => (
  <div
    style={{
      width,
      padding: 10,
      borderRadius: 45,
      background: "linear-gradient(140deg,#77909b,#1c2e3b 35%,#4d646f)",
      boxShadow: "0 40px 100px #0008",
      ...style,
    }}
  >
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 35,
        border: "5px solid #101e2b",
        background: "#f4f7fb",
      }}
    >
      <Img
        src={staticFile("captures/mobile.png")}
        style={{ display: "block", width: "100%" }}
      />
      <div
        style={{
          position: "absolute",
          top: 10,
          left: "calc(50% - 7px)",
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#142334",
          boxShadow: "0 0 0 3px #fff7",
        }}
      />
    </div>
  </div>
);

export const Feature: React.FC<{
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  text: string;
  delay?: number;
  active?: boolean;
}> = ({ icon, title, text, delay = 0, active = true }) => (
  <Reveal
    delay={delay}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 24,
      padding: "24px 26px",
      border: `1px solid ${active ? "#50c8bd55" : color.line}`,
      borderRadius: 18,
      background: active
        ? "linear-gradient(100deg,#1f525b88,#122e3e88)"
        : "#142b3c88",
    }}
  >
    <div
      style={{
        width: 58,
        height: 58,
        display: "grid",
        placeItems: "center",
        borderRadius: 14,
        background: "#50c8bd14",
      }}
    >
      <Icon name={icon} />
    </div>
    <div>
      <div
        style={{
          fontSize: 28,
          marginBottom: 8,
          color: active ? color.white : "#acbfcd",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 19, color: color.muted, lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  </Reveal>
);

export const SceneEntrance: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 22, stiffness: 90, mass: 1.1 },
  });
  return (
    <div
      style={{
        opacity: interpolate(frame, [delay, delay + 18], [0, 1], clamp),
        translate: `0 ${(1 - p) * 110}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
