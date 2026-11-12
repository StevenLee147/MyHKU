import { interpolate, useCurrentFrame } from "remotion";
import {
  Background,
  Chinese,
  clamp,
  color,
  Desktop,
  Feature,
  Footer,
  Kicker,
  Reveal,
} from "../design";

export const Coursework: React.FC = () => {
  const f = useCurrentFrame();
  const section = f < 118 ? 0 : f < 216 ? 1 : 2;
  return (
    <Background glow="#254e52">
      <div style={{ position: "absolute", left: 96, top: 80 }}>
        <Reveal>
          <Kicker>02 / Keep your momentum</Kicker>
        </Reveal>
        <Reveal delay={7}>
          <h1
            style={{
              margin: "22px 0 0",
              fontSize: 86,
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: -3,
            }}
          >
            Stay one step <span style={{ color: color.teal }}>ahead.</span>
          </h1>
        </Reveal>
      </div>
      <div style={{ position: "absolute", left: 96, top: 283 }}>
        {[
          { name: "calendar", start: 10, end: 118 },
          { name: "materials", start: 118, end: 216 },
          { name: "moodle", start: 216, end: 315 },
        ].map((shot, i) => (
          <div
            key={shot.name}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              opacity: interpolate(
                f,
                [shot.start, shot.start + 16, shot.end, shot.end + 16],
                [0, 1, 1, 0],
                clamp,
              ),
              translate: `0 ${interpolate(f, [shot.start, shot.start + 28], [45, 0], clamp)}px`,
              rotate: `${i === 0 ? -0.3 : 0.15}deg`,
            }}
          >
            <Desktop capture={shot.name} width={1080} />
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 1255,
          top: 308,
          width: 558,
          display: "grid",
          gap: 25,
        }}
      >
        <Feature
          icon="calendar"
          title="Your week, in perspective."
          text="SIS timetable · times & rooms"
          delay={15}
          active={section === 0}
        />
        <Feature
          icon="download"
          title="The right file. Within reach."
          text="Moodle materials · download on demand"
          delay={45}
          active={section === 1}
        />
        <Feature
          icon="check"
          title="Know where you stand."
          text="Assignments · submission status · grades"
          delay={75}
          active={section === 2}
        />
        <Reveal delay={96}>
          <Chinese style={{ marginTop: 15, fontSize: 26 }}>
            少一点寻找，多一点从容。
          </Chinese>
        </Reveal>
        <div style={{ height: 2, marginTop: 9, background: color.line }}>
          <div
            style={{
              height: 2,
              width: `${interpolate(f, [0, 288], [0, 100], clamp)}%`,
              background: color.teal,
            }}
          />
        </div>
      </div>
      <Footer index="04" label="KEEP LEARNING" demo />
    </Background>
  );
};
