import {
  Background,
  Chinese,
  color,
  Desktop,
  Footer,
  Icon,
  Kicker,
  Phone,
  Reveal,
  SceneEntrance,
} from "../design";

export const Devices: React.FC = () => (
  <Background>
    <div style={{ position: "absolute", left: 96, top: 115, width: 640 }}>
      <Reveal>
        <Kicker>04 / Wherever the day goes</Kicker>
      </Reveal>
      <Reveal delay={8}>
        <h1
          style={{
            fontSize: 88,
            lineHeight: 1.09,
            letterSpacing: -4,
            fontWeight: 600,
            margin: "34px 0 26px",
          }}
        >
          At your desk.
          <br />
          <span style={{ color: color.teal }}>On your way.</span>
        </h1>
      </Reveal>
      <Reveal delay={22}>
        <Chinese>桌面到移动端，学习随行。</Chinese>
      </Reveal>
      <Reveal delay={35} style={{ marginTop: 52, display: "grid", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Icon name="desktop" size={35} />
          <div style={{ fontSize: 25 }}>
            Windows{" "}
            <span style={{ fontSize: 18, color: color.muted }}>x64</span>{" "}
            <span style={{ color: "#57778a", margin: "0 11px" }}>/</span> macOS{" "}
            <span style={{ fontSize: 18, color: color.muted }}>
              Apple Silicon
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Icon name="phone" size={35} />
          <div style={{ fontSize: 25 }}>
            Android <span style={{ fontSize: 18, color: color.muted }}>8+</span>
          </div>
        </div>
      </Reveal>
      <Reveal delay={50}>
        <div style={{ marginTop: 48, fontSize: 17, color: color.muted }}>
          Each device connects to your official HKU services.
        </div>
      </Reveal>
    </div>
    <SceneEntrance
      delay={5}
      style={{ position: "absolute", left: 803, top: 188, rotate: "-3deg" }}
    >
      <Desktop capture="overview" width={1000} />
    </SceneEntrance>
    <SceneEntrance
      delay={18}
      style={{ position: "absolute", left: 1335, top: 162, rotate: "5deg" }}
    >
      <Phone width={335} />
    </SceneEntrance>
    <Footer index="06" label="DESKTOP + ANDROID" demo />
  </Background>
);
