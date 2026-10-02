/** Matching and replacement for the edit tool: one old_string, replaced once or everywhere. */

export function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");
	if (lfIdx === -1) return "\n";
	if (crlfIdx === -1) return "\n";
	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
export function normalizeForFuzzyMatch(text: string): string {
	return (
		text
			.normalize("NFKC")
			// Strip trailing whitespace per line
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n")
			// Smart single quotes to '
			.replace(/[‘’‚‛]/g, "'")
			// Smart double quotes to "
			.replace(/[“”„‟]/g, '"')
			// Various dashes/hyphens to -
			// U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
			// U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
			.replace(/[‐‑‒–—―−]/g, "-")
			// Special spaces to regular space
			// U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
			// U+205F medium math space, U+3000 ideographic space
			.replace(/[  -   　]/g, " ")
	);
}

function splitLinesWithEndings(content: string): string[] {
	return content.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

interface LineSpan {
	start: number;
	end: number;
}

interface TextReplacement {
	matchIndex: number;
	matchLength: number;
	newText: string;
}

function getLineSpans(content: string): LineSpan[] {
	let offset = 0;
	return splitLinesWithEndings(content).map((line) => {
		const span = { start: offset, end: offset + line.length };
		offset = span.end;
		return span;
	});
}

function getReplacementLineRange(lines: LineSpan[], replacement: TextReplacement) {
	const replacementStart = replacement.matchIndex;
	const replacementEnd = replacement.matchIndex + replacement.matchLength;

	let startLine = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (replacementStart >= line.start && replacementStart < line.end) {
			startLine = i;
			break;
		}
	}
	if (startLine === -1) {
		throw new Error("Replacement range is outside the base content.");
	}

	let endLine = startLine;
	while (endLine < lines.length && lines[endLine].end < replacementEnd) {
		endLine++;
	}
	if (endLine >= lines.length) {
		throw new Error("Replacement range is outside the base content.");
	}

	return { startLine, endLine: endLine + 1 };
}

function applyReplacements(content: string, replacements: readonly TextReplacement[], offset = 0): string {
	let result = content;
	for (let i = replacements.length - 1; i >= 0; i--) {
		const replacement = replacements[i];
		const matchIndex = replacement.matchIndex - offset;
		result =
			result.substring(0, matchIndex) + replacement.newText + result.substring(matchIndex + replacement.matchLength);
	}
	return result;
}

/**
 * Apply replacements matched against `baseContent` to `originalContent` while
 * preserving unchanged line blocks from the original.
 *
 * This is useful when `baseContent` is a normalized view of the original. Each
 * replacement is widened to the lines it actually touches, those touched lines
 * are rewritten from the normalized base, and all other lines are copied back
 * from `originalContent`. The actual replacement ranges drive preservation so
 * duplicate normalized lines cannot be aligned to the wrong occurrence.
 */
function applyReplacementsPreservingUnchangedLines(
	originalContent: string,
	baseContent: string,
	replacements: readonly TextReplacement[],
): string {
	const originalLines = splitLinesWithEndings(originalContent);
	const baseLines = getLineSpans(baseContent);
	if (originalLines.length !== baseLines.length) {
		throw new Error("Cannot preserve unchanged lines because the base content has a different line count.");
	}

	const groups: Array<{ startLine: number; endLine: number; replacements: TextReplacement[] }> = [];
	const sortedReplacements = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex);
	for (const replacement of sortedReplacements) {
		const range = getReplacementLineRange(baseLines, replacement);
		const current = groups[groups.length - 1];
		if (current && range.startLine < current.endLine) {
			current.endLine = Math.max(current.endLine, range.endLine);
			current.replacements.push(replacement);
			continue;
		}
		groups.push({ ...range, replacements: [replacement] });
	}

	let originalLineIndex = 0;
	let result = "";
	for (const group of groups) {
		result += originalLines.slice(originalLineIndex, group.startLine).join("");

		const groupStartOffset = baseLines[group.startLine].start;
		const groupEndOffset = baseLines[group.endLine - 1].end;
		result += applyReplacements(
			baseContent.slice(groupStartOffset, groupEndOffset),
			group.replacements,
			groupStartOffset,
		);
		originalLineIndex = group.endLine;
	}
	result += originalLines.slice(originalLineIndex).join("");

	return result;
}

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it */
export function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("﻿") ? { bom: "﻿", text: content.slice(1) } : { bom: "", text: content };
}

const MAX_LISTED_OCCURRENCES = 20;
const MAX_CONTEXT_LINE_LENGTH = 120;

function collectMatchIndices(content: string, needle: string): number[] {
	if (needle.length === 0) {
		return [];
	}
	const indices: number[] = [];
	for (let index = content.indexOf(needle); index !== -1; index = content.indexOf(needle, index + needle.length)) {
		indices.push(index);
	}
	return indices;
}

/** Line numbers (1-based) for ascending indices into content. */
function getLineNumbers(content: string, indices: readonly number[]): number[] {
	const lineNumbers: number[] = [];
	let line = 1;
	let cursor = 0;
	for (const index of indices) {
		while (cursor < index) {
			if (content[cursor] === "\n") line++;
			cursor++;
		}
		lineNumbers.push(line);
	}
	return lineNumbers;
}

function formatOccurrences(content: string, indices: readonly number[]): string {
	const lines = content.split("\n");
	const shown = indices.slice(0, MAX_LISTED_OCCURRENCES);
	const entries = getLineNumbers(content, shown).map((line) => {
		const text = lines[line - 1].trim();
		const context = text.length > MAX_CONTEXT_LINE_LENGTH ? `${text.slice(0, MAX_CONTEXT_LINE_LENGTH)}...` : text;
		return `  line ${line}: ${context}`;
	});
	const remaining = indices.length - shown.length;
	return (remaining > 0 ? [...entries, `  ... and ${remaining} more`] : entries).join("\n");
}

/** Where old_string occurs: exactly where it does, otherwise in the fuzzy-normalized content. */
interface EditMatches {
	readonly base: string;
	readonly fuzzy: boolean;
	readonly indices: readonly number[];
	readonly matchLength: number;
}

function findEditMatches(content: string, oldText: string): EditMatches {
	const exact = collectMatchIndices(content, oldText);
	if (exact.length > 0) {
		return { base: content, fuzzy: false, indices: exact, matchLength: oldText.length };
	}
	const base = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	return { base, fuzzy: true, indices: collectMatchIndices(base, fuzzyOldText), matchLength: fuzzyOldText.length };
}

export type EditOutcome = "applies" | "no_match" | "ambiguous";

/** Whether old_string selects what the edit would replace in LF-normalized content. */
export function editOutcome(normalizedContent: string, oldString: string, replaceAll: boolean): EditOutcome {
	const { indices } = findEditMatches(normalizedContent, normalizeToLF(oldString));
	if (indices.length === 0) return "no_match";
	return indices.length > 1 && !replaceAll ? "ambiguous" : "applies";
}

/** Replaces old_string once, or everywhere with replaceAll; an exact match wins over a fuzzy one, and deleting a text that ends a line removes its line break. */
export function applyEditToNormalizedContent(
	normalizedContent: string,
	oldString: string,
	newString: string,
	replaceAll: boolean,
): string {
	const oldText = normalizeToLF(oldString);
	const newText = normalizeToLF(newString);
	const { base, fuzzy, indices, matchLength } = findEditMatches(normalizedContent, oldText);
	if (indices.length === 0) {
		throw new Error("String to replace not found in file. old_string must match the file exactly, including whitespace and indentation.");
	}
	if (indices.length > 1 && !replaceAll) {
		throw new Error(
			`Found ${indices.length} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. ` +
				`To replace only one occurrence, please provide more context to uniquely identify the instance. Matches:\n${formatOccurrences(base, indices)}`,
		);
	}
	const removesLineBreak = newText === "" && !oldText.endsWith("\n");
	const replacements = indices.map((matchIndex) => ({
		matchIndex,
		matchLength: removesLineBreak && base[matchIndex + matchLength] === "\n" ? matchLength + 1 : matchLength,
		newText,
	}));
	const newContent = fuzzy
		? applyReplacementsPreservingUnchangedLines(normalizedContent, base, replacements)
		: applyReplacements(base, replacements);
	if (newContent === normalizedContent) {
		throw new Error("No changes made: the replacement produces the current content of the file.");
	}
	return newContent;
}
