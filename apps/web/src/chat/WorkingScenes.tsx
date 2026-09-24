import { useEffect, useState } from "react";
import { cn } from "cn";

const SPUR = 13;
const GRUNDTAKT_MS = 90;
const SZENENWECHSEL_MS = 2600;

/** Eine Zelle je Figur: Emoji und Satzzeichen teilen sich kein Raster, geschobener Text ruckelt. */
function bahn(figuren: Record<number, string>, breite = SPUR): string[] {
  return Array.from({ length: breite }, (_, x) => figuren[x] ?? " ");
}

interface Szene {
  id: string;
  takt: number;
  laufend?: true;
  compact?: true;
  zeichne: (schritt: number) => string | string[];
}

/**
 * Kleine Szenen, in denen etwas Erkennbares passiert - der Zustand aendert sich sichtbar,
 * statt dass nur eine Figur vorbeilaeuft. Szenen mit Bewegung geben ihre Bahn als Zellen
 * zurueck, alle anderen als schlichten Text.
 */
const SZENEN: Szene[] = [
  {
    id: "denken",
    takt: 2,
    zeichne: (schritt) => {
      const takt = schritt % 10;
      if (takt >= 8) return "\u{1F929}\u{1F4A1}";
      return "\u{1F914}" + "\u{1F4AD}".repeat(Math.min(takt, 3));
    },
  },
  {
    // Fliegt nach rechts und zieht ihren Schweif hinterher.
    id: "rakete",
    takt: 2,
    laufend: true,
    zeichne: (schritt) => {
      const x = schritt % SPUR;
      return bahn({ [x - 2]: "·", [x - 1]: "\u{1F4A8}", [x]: "\u{1F680}" });
    },
  },
  {
    // Die Punkte bleiben stehen und werden einzeln gefressen.
    id: "pacman",
    takt: 2,
    laufend: true,
    zeichne: (schritt) => {
      const x = schritt % SPUR;
      const figuren: Record<number, string> = {};
      for (let i = x + 1; i < SPUR; i++) {
        figuren[i] = "·";
      }
      figuren[x] = schritt % 2 === 0 ? "\u{1F7E1}" : "\u{1F315}";
      return bahn(figuren);
    },
  },
  {
    // Aus einem Samen wird ein Baum, dann von vorn.
    id: "wachsen",
    compact: true,
    takt: 2,
    zeichne: (schritt) => {
      const stufen = ["\u{1F331}", "\u{1F331}", "\u{1F33F}", "\u{1F33F}", "\u{1F343}", "\u{1F333}", "\u{1F333}", "\u{1F333}"];
      return stufen[schritt % stufen.length];
    },
  },
  {
    // Das Ei bekommt Risse, das Kueken schluepft.
    id: "schluepfen",
    compact: true,
    takt: 2,
    zeichne: (schritt) => {
      const takt = schritt % 12;
      if (takt < 4) return "\u{1F95A}";
      if (takt < 6) return "\u{1F95A}*";
      if (takt < 9) return "\u{1F423}";
      return "\u{1F425}";
    },
  },
  {
    // Morse-artiges Signal, das sich zu einem OK aufloest.
    id: "signal",
    takt: 2,
    zeichne: (schritt) => {
      const takt = schritt % 14;
      if (takt >= 11) return "\u{1F4E1} OK";
      const muster = ["·", "··", "·-", "-·", "··-", "-··"];
      return "\u{1F4E1} " + muster[takt % muster.length];
    },
  },
  {
    // Sanduhr: der Sand laeuft durch, dann wird gedreht.
    id: "sanduhr",
    takt: 2,
    zeichne: (schritt) => {
      const takt = schritt % 12;
      const koerner = "·".repeat(Math.max(0, 5 - Math.floor(takt / 2)));
      return (takt < 10 ? "⏳" : "⌛") + " " + koerner;
    },
  },
  {
    // Ei, Kueken, Henne - und die legt das naechste Ei.
    id: "huhn-kreislauf",
    compact: true,
    takt: 3,
    zeichne: (schritt) => {
      const takt = schritt % 16;
      if (takt < 3) return "\u{1F95A}";
      if (takt < 5) return "\u{1F95A}*";
      if (takt < 8) return "\u{1F423}";
      if (takt < 11) return "\u{1F424}";
      if (takt < 14) return "\u{1F414}";
      return "\u{1F414}\u{1F95A}";
    },
  },
  {
    // Hut, Funken - und das Kaninchen tuermt.
    id: "zauberhut",
    compact: true,
    takt: 3,
    zeichne: (schritt) => {
      const takt = schritt % 14;
      if (takt < 4) return "\u{1F3A9}";
      if (takt < 7) return "\u{1F3A9}*";
      if (takt < 11) return "\u{1F3A9}\u{1F407}";
      return "\u{1F407}\u{1F4A8}";
    },
  },
  {
    // Rot, Gelb, Gruen - und ab.
    id: "ampel",
    compact: true,
    takt: 3,
    zeichne: (schritt) => {
      const takt = schritt % 12;
      if (takt < 4) return "\u{1F534}";
      if (takt < 6) return "\u{1F7E1}";
      if (takt < 8) return "\u{1F7E2}";
      return "\u{1F697}\u{1F4A8}";
    },
  },
  {
    // Klingeln, verschlafen, losrennen.
    id: "wecker",
    compact: true,
    takt: 2,
    zeichne: (schritt) => {
      const takt = schritt % 14;
      if (takt < 5) return takt % 2 === 0 ? "⏰" : "\u{1F514}";
      if (takt < 8) return "\u{1F634}";
      if (takt < 10) return "\u{1F633}";
      return "\u{1F3C3}\u{1F4A8}";
    },
  },
  {
    // Schnecke kriecht zur Flagge - und feiert.
    id: "schnecke",
    takt: 4,
    zeichne: (schritt) => {
      const takt = schritt % 8;
      if (takt < 5) return bahn({ [takt]: "\u{1F40C}", 4: "\u{1F3C1}" }, 5);
      return bahn({ 4: "\u{1F389}" }, 5);
    },
  },
];

const COMPACT_SCENES = SZENEN.filter((scene) => scene.compact);

export interface WorkingScenesProps {
  /** Limits scenes to one or two visible characters for small status fields. */
  compact?: boolean;
  /** Text fuer Screenreader, Default "Arbeitet ...". */
  label?: string;
}

/**
 * Der Default-Working-Indikator: zufaellig rotierende Mini-Szenen. Zufaellige Reihenfolge
 * und Startphase, damit dieselben Szenen nie wie eine Schleife wirken. Ueber die
 * working-Prop von ChatMessages laesst er sich komplett ersetzen.
 */
export function WorkingScenes({ label = "Arbeitet ...", compact = false }: WorkingScenesProps) {
  const scenes = compact ? COMPACT_SCENES : SZENEN;
  const [sceneIndex, setSceneIndex] = useState(() => Math.floor(Math.random() * scenes.length));
  const [offset, setOffset] = useState(() => Math.floor(Math.random() * 20));
  const [frameTick, setFrameTick] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const scene = scenes[sceneIndex % scenes.length];

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    update();
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      setSceneIndex((previous) => (previous + 1 + Math.floor(Math.random() * (scenes.length - 1))) % scenes.length);
      setOffset(Math.floor(Math.random() * 20));
      setFrameTick(0);
    }, SZENENWECHSEL_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion, scenes]);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => setFrameTick((value) => value + 1), GRUNDTAKT_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  const frame = scene.zeichne(Math.floor(frameTick / scene.takt) + (scene.laufend ? offset : 0));
  return (
    <span aria-label={label} className={cn("flex items-center gap-2.5 text-[13px]", compact ? "text-inherit" : "mt-4 text-foreground")} data-chat="working" role="status">
      {!compact && <span aria-hidden="true" className="text-muted-foreground opacity-70">&gt;</span>}
      <span aria-hidden="true" className={cn("inline-block flex-none font-mono [font-variant-ligatures:none]", compact ? "w-[2.4em] text-center" : "w-[15rem]")} key={scene.id}>
        <span className="tracking-[0.02em] whitespace-pre motion-reduce:opacity-60">
          {typeof frame === "string"
            ? frame
            : frame.map((cell, index) => (
                <span className="inline-block w-[1.35em] text-center" key={index}>
                  {cell}
                </span>
              ))}
        </span>
      </span>
    </span>
  );
}
