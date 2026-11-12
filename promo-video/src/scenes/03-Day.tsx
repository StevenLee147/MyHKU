import { useCurrentFrame } from "remotion";
import {
  Background,
  Chinese,
  color,
  Desktop,
  Footer,
  Icon,
  Kicker,
  Reveal,
  SceneEntrance,
} from "../design";

export const Day: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Background>
      <div style={{ position: "absolute", left: 96, top: 146, width: 495 }}>
        <Reveal>
          <Kicker>01 / The overview</Kicker>
        </Reveal>
        <Reveal delay={10}>
          <h1
            style={{
              margin: "42px 0 24px",
              fontSize: 94,
              fontWeight: 600,
              lineHeight: 1.06,
              letterSpacing: -4,
            }}
          >
            Start with
            <br />
            <span style={{ color: color.teal }}>a clear day.</span>
          </h1>
        </Reveal>
        <Reveal delay={24}>
          <Chinese>
            今天的课。下一项截止。
            <br />
            一眼就有方向。
          </Chinese>
        </Reveal>
        <div style={{ marginTop: 60, display: "grid", gap: 30 }}>
          {[
            {
              icon: "calendar" as const,
              text: "Know what’s next.",
              sub: "Classes, times & rooms",
              d: 54,
            },
            {
              icon: "check" as const,
              text: "Keep deadlines in sight.",
              sub: "Upcoming coursework",
              d: 88,
            },
          ].map((item) => (
            <Reveal
              key={item.text}
              delay={item.d}
              style={{ display: "flex", gap: 20, alignItems: "center" }}
            >
              <Icon name={item.icon} size={36} />
              <div>
                <div style={{ fontSize: 25, marginBottom: 7 }}>{item.text}</div>
                <div style={{ fontSize: 19, color: color.muted }}>
                  {item.sub}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
      <SceneEntrance
        delay={8}
        style={{
          position: "absolute",
          left: 621,
          top: 146,
          scale: `${1 + Math.min(f, 285) / 20000}`,
          transformOrigin: "left center",
        }}
      >
        <Desktop capture="overview" width={1200} />
      </SceneEntrance>
      <Footer index="03" label="A CLEARER DAY" demo />
    </Background>
  );
};
