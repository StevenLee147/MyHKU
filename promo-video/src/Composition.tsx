import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Composition, staticFile } from "remotion";
import { Fragmentation } from "./scenes/01-Fragmentation";
import { Brand } from "./scenes/02-Brand";
import { Day } from "./scenes/03-Day";
import { Coursework } from "./scenes/04-Coursework";
import { Trust } from "./scenes/05-Trust";
import { Devices } from "./scenes/06-Devices";
import { Finale } from "./scenes/07-Finale";

export const MyHKUPromo: React.FC = () => (
  <AbsoluteFill style={{ background: "#0a1929" }}>
    <Audio src={staticFile("audio/myhku-original.wav")} volume={0.92} />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={162} name="Too many tabs">
        <Fragmentation />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        timing={linearTiming({ durationInFrames: 18 })}
        presentation={fade()}
      />
      <TransitionSeries.Sequence durationInFrames={162} name="Meet MyHKU">
        <Brand />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        timing={linearTiming({ durationInFrames: 18 })}
        presentation={fade()}
      />
      <TransitionSeries.Sequence durationInFrames={306} name="A clearer day">
        <Day />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        timing={linearTiming({ durationInFrames: 18 })}
        presentation={fade()}
      />
      <TransitionSeries.Sequence durationInFrames={306} name="Stay ahead">
        <Coursework />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        timing={linearTiming({ durationInFrames: 18 })}
        presentation={fade()}
      />
      <TransitionSeries.Sequence durationInFrames={162} name="Local by design">
        <Trust />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        timing={linearTiming({ durationInFrames: 18 })}
        presentation={fade()}
      />
      <TransitionSeries.Sequence
        durationInFrames={162}
        name="Desktop and Android"
      >
        <Devices />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        timing={linearTiming({ durationInFrames: 18 })}
        presentation={fade()}
      />
      <TransitionSeries.Sequence durationInFrames={288} name="More learning">
        <Finale />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export const MyComposition: React.FC = () => (
  <>
    <Composition
      id="MyHKU-Launch"
      component={MyHKUPromo}
      durationInFrames={1440}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="MyHKU-Poster"
      component={Finale}
      durationInFrames={288}
      fps={30}
      width={1920}
      height={1080}
    />
  </>
);
