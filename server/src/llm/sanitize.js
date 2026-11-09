// server/src/llm/sanitize.js
const INVISIBLE = /[\u200B-\u200F\u2060\uFEFF]/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const HIDDEN_STYLE = /style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const HIDDEN_STYLE_RULE = /(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\s*[^;]*)?|color\s*:\s*(?:white|#fff(?:fff)?|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)))(?:\s*!important)?/i;

export function sanitize(text) {
  const source = String(text ?? '');
  const flags = {
    zero_width: /[\u200B-\u200F\u2060\uFEFF]/.test(source),
    html_comment: /<!--[\s\S]*?-->/.test(source),
    hidden_style: [...source.matchAll(HIDDEN_STYLE)].some((match) => HIDDEN_STYLE_RULE.test(match[1] ?? match[2] ?? match[3] ?? '')),
  };
  const clean_text = source
    .replace(INVISIBLE, '')
    .replace(HTML_COMMENT, ' ')
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  return { clean_text, flags };
}
