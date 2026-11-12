import { interpolate, useCurrentFrame } from "remotion";
import {
  Background,
  Chinese,
  clamp,
  color,
  Footer,
  Kicker,
  Logo,
  progress,
  Reveal,
} from "../design";

export const Brand: React.FC = () => {
  const f = useCurrentFrame();
  const p = progress(f, 0, 65);
  return (
    <Background>
      <svg
        width="1920"
        height="1080"
        style={{ position: "absolute", opacity: progress(f, 10, 25) * 0.4 }}
      >
        <circle
          cx="960"
          cy="410"
          r={170 + p * 20}
          fill="none"
          stroke="#50c8bd"
          strokeWidth="1"
        />
        <circle
          cx="960"
          cy="410"
          r={240 + p * 30}
          fill="none"
          stroke="#50c8bd"
          strokeWidth="1"
          strokeDasharray="3 14"
        />
        <path
          d="M600 410h160m400 0h160M960 110v100"
          stroke="#50c8bd"
          strokeWidth="1"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: 77,
          width: "100%",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Reveal>
          <Kicker>A clearer way through your day</Kicker>
        </Reveal>
      </div>
      <div
        style={{
          position: "absolute",
          left: 830,
          top: 280,
          scale: `${0.8 + p * 0.2}`,
          opacity: progress(f, 0, 20),
          filter: "drop-shadow(0 25px 45px #0005)",
        }}
      >
        <Logo size={260} />
      </div>
      <div
        style={{
          position: "absolute",
          width: "100%",
          top: 610,
          textAlign: "center",
        }}
      >
        <Reveal delay={18}>
          <h1
            style={{
              margin: 0,
              fontSize: 128,
              fontWeight: 600,
              letterSpacing: -5,
            }}
          >
            Meet <span style={{ color: color.teal }}>MyHKU.</span>
          </h1>
        </Reveal>
        <Reveal delay={33}>
          <div
            style={{
              fontSize: 30,
              color: "#c2d0db",
              marginTop: 23,
              letterSpacing: 0.5,
            }}
          >
            Portal. SIS. Moodle. One learning space.
          </div>
        </Reveal>
        <Reveal delay={43}>
          <Chinese style={{ marginTop: 18 }}>把学习日常，放在一起。</Chinese>
        </Reveal>
      </div>
      {[
        { t: "PORTAL", x: 430, y: 394 },
        { t: "SIS", x: 1403, y: 394 },
        { t: "MOODLE", x: 891, y: 135 },
      ].map((item, i) => (
        <div
          key={item.t}
          style={{
            position: "absolute",
            left: item.x,
            top: item.y,
            color: color.teal,
            fontSize: 19,
            letterSpacing: 5,
            opacity: interpolate(
              f,
              [20 + i * 6, 40 + i * 6, 130, 161],
              [0, 0.8, 0.8, 0.2],
              clamp,
            ),
          }}
        >
          {item.t}
        </div>
      ))}
      <Footer index="02" label="ONE LEARNING SPACE" />
    </Background>
  );
};
