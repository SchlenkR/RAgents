export type HomepageStructure = { features: { id: string; guide: string }[] };

function elementBody(html: string, openingTagEnd: number, tag: string): string {
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  let depth = 1;
  for (const match of html.slice(openingTagEnd).matchAll(pattern)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(openingTagEnd, openingTagEnd + match.index);
  }
  throw new Error(`Nicht geschlossenes Element <${tag}> auf der Homepage.`);
}

export function assertHomepageStructure(html: string): HomepageStructure {
  const stickers = [...html.matchAll(/<a\b[^>]*\bdata-sticker\b[^>]*>([\s\S]*?)<\/a>/g)].map((match) => {
    const href = /\bhref="([^"]*)"/.exec(match[0])?.[1] ?? "";
    if (!href.startsWith("#") || href.length < 2) throw new Error(`Ein Sticker muss auf einen Abschnitt der Hauptseite zeigen: ${href || "ohne href"}`);
    const label = /<strong>([\s\S]*?)<\/strong>/.exec(match[1])?.[1] ?? "";
    if (!label.trim()) throw new Error(`Der Sticker ${href} hat keinen Text.`);
    if ((label.match(/<br\s*\/?>/g) ?? []).length > 1) throw new Error(`Der Sticker ${href} hat mehr als zwei Zeilen.`);
    return href.slice(1);
  });
  const features = [...html.matchAll(/<(section|article)\b[^>]*\bdata-core-feature\b[^>]*>/g)].map((match) => {
    const id = /\bid="([^"]+)"/.exec(match[0])?.[1];
    if (!id) throw new Error("Ein Abschnitt mit data-core-feature braucht eine id.");
    const body = elementBody(html, match.index + match[0].length, match[1]);
    const guide = /<a\b[^>]*\bhref="(guide-[a-z-]+\.html(?:#[^"]*)?)"/.exec(body)?.[1];
    if (!guide) throw new Error(`Die Kernfunktion ${id} verweist auf kein Guide-Kapitel.`);
    return { id, guide };
  });
  const duplicate = (values: string[]) => values.find((value, index) => values.indexOf(value) !== index);
  const doubleSticker = duplicate(stickers);
  if (doubleSticker) throw new Error(`Zwei Sticker zeigen auf ${doubleSticker}.`);
  const doubleFeature = duplicate(features.map(({ id }) => id));
  if (doubleFeature) throw new Error(`Die Kernfunktion ${doubleFeature} ist zweimal ausgezeichnet.`);
  for (const target of stickers) if (!features.some(({ id }) => id === target)) throw new Error(`Der Sticker ${target} hat keinen Abschnitt mit data-core-feature.`);
  for (const { id } of features) if (!stickers.includes(id)) throw new Error(`Die Kernfunktion ${id} hat keinen Sticker im Einstieg.`);
  if (!features.length) throw new Error("Die Homepage nennt keine Kernfunktion.");
  return { features };
}
