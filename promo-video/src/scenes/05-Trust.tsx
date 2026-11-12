import { useCurrentFrame } from "remotion";
import {
  Background,
  Chinese,
  color,
  Footer,
  Icon,
  Kicker,
  progress,
  Reveal,
} from "../design";

export const Trust: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Background glow="#23454d">
      <div style={{ position: "absolute", left: 96, top: 166, width: 900 }}>
        <Reveal>
          <Kicker>03 / Thoughtfully connected</Kicker>
        </Reveal>
        <Reveal delay={8}>
          <h1
            style={{
              fontSize: 100,
              lineHeight: 1.07,
              letterSpacing: -4,
              fontWeight: 600,
              margin: "40px 0 28px",
            }}
          >
            Your learning.
            <br />
            <span style={{ color: color.teal }}>Your device.</span>
          </h1>
        </Reveal>
        <Reveal delay={20}>
          <Chinese>官方认证，本地保存。</Chinese>
        </Reveal>
        <Reveal delay={35}>
          <p
            style={{
              color: "#c2d0db",
              fontSize: 27,
              lineHeight: 1.65,
              marginTop: 40,
            }}
          >
            Sign in through official HKU services.
            <br />
            Learning data stays local.
          </p>
        </Reveal>
        <Reveal delay={46}>
          <p style={{ color: color.muted, fontSize: 19, marginTop: 30 }}>
            Official MFA still applies when required.
          </p>
        </Reveal>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1202,
          top: 236,
          width: 465,
          height: 465,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 18 - i * 33,
              borderRadius: "50%",
              border: `1px solid #50c8bd${i === 0 ? "55" : "20"}`,
              scale: `${0.92 + progress(f, i * 7, 70) * 0.08}`,
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            inset: 75,
            borderRadius: 58,
            background: "linear-gradient(145deg,#2d6266,#122f41)",
            border: "1px solid #50c8bd66",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 30px 100px #0004",
            opacity: progress(f, 6, 24),
            translate: `0 ${(1 - progress(f, 6, 45)) * 70}px`,
          }}
        >
          <Icon name="lock" size={122} />
        </div>
        <Reveal
          delay={38}
          style={{
            position: "absolute",
            bottom: -67,
            left: 49,
            display: "flex",
            gap: 12,
            alignItems: "center",
            fontSize: 21,
            color: color.teal,
            letterSpacing: 3,
          }}
        >
          <Icon name="check" size={24} /> LOCAL BY DESIGN
        </Reveal>
      </div>
      <Footer index="05" label="BUILT WITH CARE" />
    </Background>
  );
};
