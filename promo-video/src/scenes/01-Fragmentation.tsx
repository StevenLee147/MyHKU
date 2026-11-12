import { interpolate, useCurrentFrame } from "remotion";
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

export const Fragmentation: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Background glow="#3e465b">
      <div style={{ position: "absolute", left: 104, top: 193, width: 740 }}>
        <Reveal>
          <Kicker>University life, simplified.</Kicker>
        </Reveal>
        <Reveal delay={8}>
          <h1
            style={{
              margin: "38px 0 25px",
              fontSize: 107,
              lineHeight: 1.04,
              fontWeight: 600,
              letterSpacing: -5,
            }}
          >
            Your day.
            <br />
            <span style={{ color: color.muted }}>Too many tabs.</span>
          </h1>
        </Reveal>
        <Reveal delay={28}>
          <Chinese>课程、课表、作业，不必散落各处。</Chinese>
        </Reveal>
        <Reveal delay={46}>
          <div
            style={{
              width: 84,
              height: 3,
              marginTop: 48,
              background: color.gold,
            }}
          />
        </Reveal>
      </div>
      {[
        {
          label: "Student Portal",
          sub: "The starting point",
          icon: "lock" as const,
          x: 998,
          y: 145,
          r: -8,
          tag: "SIGN IN",
        },
        {
          label: "SIS",
          sub: "A week to organise",
          icon: "calendar" as const,
          x: 1253,
          y: 360,
          r: 6,
          tag: "TIMETABLE",
        },
        {
          label: "Moodle",
          sub: "Work to keep track of",
          icon: "book" as const,
          x: 987,
          y: 595,
          r: -3,
          tag: "COURSEWORK",
        },
      ].map((item, i) => {
        const p = progress(f, 12 + i * 10, 40);
        return (
          <div
            key={item.label}
            style={{
              position: "absolute",
              left: item.x,
              top: item.y,
              width: 400,
              height: 248,
              padding: 31,
              borderRadius: 22,
              border: "1px solid #a8bcc338",
              background: "linear-gradient(130deg,#274052ed,#132839f5)",
              boxShadow: "0 28px 65px #0005",
              opacity: p,
              rotate: `${item.r}deg`,
              translate: `${(1 - p) * 220}px ${Math.sin(f / 36 + i * 2) * 8}px`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Icon
                name={item.icon}
                size={34}
                color={i === 1 ? color.gold : color.teal}
              />
              <span
                style={{ fontSize: 13, letterSpacing: 3, color: "#8cabbc" }}
              >
                {item.tag}
              </span>
            </div>
            <div style={{ marginTop: 28, fontSize: 34, fontWeight: 500 }}>
              {item.label}
            </div>
            <div style={{ marginTop: 10, fontSize: 20, color: color.muted }}>
              {item.sub}
            </div>
            <div
              style={{
                marginTop: 29,
                height: 4,
                width: interpolate(f, [0, 140], [160, 250]),
                borderRadius: 4,
                background: "#7298a640",
              }}
            />
          </div>
        );
      })}
      <Footer index="01" label="THE DAILY JUGGLE" />
    </Background>
  );
};
