import { interpolate, useCurrentFrame } from "remotion";
import {
  Background,
  Chinese,
  clamp,
  color,
  Icon,
  Kicker,
  Logo,
  progress,
  Reveal,
} from "../design";

export const Finale: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Background>
      <div
        style={{
          position: "absolute",
          top: 91,
          left: 0,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          gap: 22,
          alignItems: "center",
          opacity: progress(f, 0, 25),
        }}
      >
        <Logo size={84} />
        <span style={{ fontSize: 53, fontWeight: 600, letterSpacing: -2 }}>
          MyHKU
        </span>
        <span
          style={{
            alignSelf: "center",
            marginLeft: 3,
            border: "1px solid #50c8bd55",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 13,
            color: color.teal,
            letterSpacing: 2,
          }}
        >
          ALPHA
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 260,
          width: "100%",
          textAlign: "center",
        }}
      >
        <Reveal delay={10}>
          <h1
            style={{
              fontSize: 112,
              lineHeight: 1.13,
              fontWeight: 600,
              letterSpacing: -4,
              margin: 0,
            }}
          >
            Less searching.
            <br />
            <span style={{ color: color.teal }}>More learning.</span>
          </h1>
        </Reveal>
        <Reveal delay={29}>
          <Chinese style={{ fontSize: 30, marginTop: 26 }}>
            把时间，留给真正的学习。
          </Chinese>
        </Reveal>
        <Reveal
          delay={54}
          style={{ display: "flex", justifyContent: "center", marginTop: 55 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "20px 32px",
              borderRadius: 13,
              color: color.navy,
              background: color.teal,
              fontSize: 27,
              fontWeight: 600,
              boxShadow: "0 10px 50px #50c8bd22",
            }}
          >
            Find your next clear day{" "}
            <Icon name="arrow" color={color.navy} size={30} />
          </div>
        </Reveal>
        <Reveal delay={66}>
          <div
            style={{
              color: "#c1d4df",
              fontSize: 27,
              marginTop: 25,
              letterSpacing: 0.5,
            }}
          >
            github.com/StevenLee147/MyHKU
          </div>
        </Reveal>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 81,
          textAlign: "center",
          opacity: interpolate(f, [65, 85], [0, 1], clamp),
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 25,
          }}
        >
          <Kicker>Windows · macOS · Android</Kicker>
        </div>
        <div
          style={{
            color: "#91a9bb",
            fontSize: 17,
            lineHeight: 1.8,
            letterSpacing: 0.3,
          }}
        >
          Independent student-built project. Not an official HKU application. ·
          v0.2.1-alpha
        </div>
        <div
          style={{
            color: "#7c97aa",
            fontSize: 16,
            lineHeight: 1.8,
            fontFamily: '"Microsoft YaHei",sans-serif',
          }}
        >
          独立开发 · 非香港大学官方应用 · 画面使用示例数据
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          height: 3,
          background: color.teal,
          width: `${progress(f, 28, 140) * 420}px`,
          translate: "-50% 0",
        }}
      />
    </Background>
  );
};
