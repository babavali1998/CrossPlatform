import twitterText from "twitter-text";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const pictographic = /\p{Extended_Pictographic}/u;
const encoder = new TextEncoder();

/** Plain user-perceived characters (grapheme clusters). */
export function countGraphemes(text: string): number {
  return Array.from(segmenter.segment(text)).length;
}

/** Unicode code points: what Instagram and LinkedIn count against limits. */
export function countCodePoints(text: string): number {
  return Array.from(text).length;
}

/**
 * Threads counts emoji by their UTF-8 byte length (per the Threads API docs),
 * everything else as one character.
 */
export function countThreads(text: string): number {
  let n = 0;
  for (const { segment } of segmenter.segment(text)) {
    n += pictographic.test(segment) ? encoder.encode(segment).length : 1;
  }
  return n;
}

/** X weighted length: URLs count as 23, emoji and CJK as 2. */
export function countX(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
}
