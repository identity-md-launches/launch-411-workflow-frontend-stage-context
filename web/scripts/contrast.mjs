// WCAG 2 contrast ratios for the declared token pairs in web/src/styles.css.
const hex = (h) => h.replace('#','').match(/../g).map((x) => parseInt(x, 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (h) => { const [r,g,b] = hex(h).map(lin); return 0.2126*r + 0.7152*g + 0.0722*b; };
const ratio = (fg, bg) => { const a = L(fg), b = L(bg); return ((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)); };
const pairs = [
  ['text-primary on surface', '#171c26', '#ffffff'],
  ['text-primary on page bg', '#171c26', '#f7f8fa'],
  ['text-secondary on surface', '#5b6577', '#ffffff'],
  ['text-secondary on sunken', '#5b6577', '#eef0f4'],
  ['accent-text (links) on surface', '#1d4197', '#ffffff'],
  ['accent-text on sunken (quote box)', '#1d4197', '#eef0f4'],
  ['on-accent on accent-solid (primary button)', '#ffffff', '#2b5fd9'],
  ['on-accent on accent-solid-hover', '#ffffff', '#2450b8'],
  ['accent-text on accent-bg-subtle (selected chip)', '#1d4197', '#e3ecfb'],
  ['success-text on success-bg', '#1a5a33', '#e2f5e8'],
  ['warning-text on warning-bg', '#6b4a00', '#fff3d6'],
  ['danger-text on danger-bg', '#a12222', '#fde8e8'],
  ['danger-text on surface (field error)', '#a12222', '#ffffff'],
  ['danger-text on sunken (quote box notice bg is danger-bg)', '#a12222', '#fde8e8'],
  ['border (#c6ccd6) vs surface (UI component 3:1)', '#c6ccd6', '#ffffff'],
  ['border-subtle (#dfe3ea) vs surface (separator, decorative)', '#dfe3ea', '#ffffff'],
  ['focus ring (#2b5fd9) vs surface', '#2b5fd9', '#ffffff'],
  ['focus ring vs page bg', '#2b5fd9', '#f7f8fa'],
  ['focus ring vs sunken', '#2b5fd9', '#eef0f4'],
  ['accent-solid (progress fill) vs sunken track', '#2b5fd9', '#eef0f4'],
  ['badge neutral text (#5b6577) on sunken', '#5b6577', '#eef0f4'],
  ['disabled primary button text (55% opacity approx: white on blended)', '#ffffff', '#8aa5e8'],
];
for (const [name, fg, bg] of pairs) console.log(ratio(fg, bg).toFixed(2).padStart(6), name, fg, 'on', bg);
