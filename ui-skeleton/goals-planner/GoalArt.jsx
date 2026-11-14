// Flat, hand-drawn-feeling scenes in the S-Pankki palette. One per goal theme.
const C = { forest: '#007841', deep: '#004628', mint: '#91FA9B', pale: '#EBF7EC', ink: '#18221C', sand: '#F3DDB0', white: '#FFFFFF' };

const THEMES = [
  { id: 'car', words: ['car', 'auto', 'vehicle', 'driving', 'licence', 'license'] },
  { id: 'home', words: ['home', 'house', 'apartment', 'flat', 'deposit', 'mortgage', 'rent', 'koti', 'asunto'] },
  { id: 'travel', words: ['trip', 'travel', 'holiday', 'vacation', 'flight', 'tallinn', 'japan', 'interrail', 'weekend', 'matka'] },
  { id: 'tech', words: ['phone', 'iphone', 'laptop', 'computer', 'macbook', 'ipad', 'console', 'playstation', 'camera', 'headphones'] },
  { id: 'music', words: ['concert', 'ticket', 'festival', 'gig', 'music', 'show'] },
  { id: 'gift', words: ['gift', 'present', 'birthday', 'christmas', 'joulu', 'wedding'] },
  { id: 'study', words: ['study', 'studies', 'course', 'school', 'university', 'books', 'education', 'exam'] },
  { id: 'safety', words: ['emergency', 'buffer', 'cushion', 'safety', 'rainy', 'backup', 'puskuri'] },
  { id: 'bike', words: ['bike', 'bicycle', 'cycling', 'scooter'] },
];

export function themeFor(label = '') {
  const text = label.toLowerCase();
  return THEMES.find(theme => theme.words.some(word => text.includes(word)))?.id ?? 'seed';
}

const scenes = {
  car: <>
    <rect x="0" y="54" width="120" height="10" fill={C.forest} opacity=".18"/>
    <path d="M8 59h104" stroke={C.white} strokeWidth="1.5" strokeDasharray="6 5"/>
    <circle cx="96" cy="16" r="7" fill={C.sand}/>
    <path d="M30 46l8-12c1.5-2.2 3.8-3.5 6.4-3.5h21.4c2.6 0 5 1.3 6.5 3.4L81 46" fill={C.forest}/>
    <rect x="22" y="44" width="68" height="11" rx="5.5" fill={C.forest}/>
    <path d="M41 44l5-9h9v9zM59 44v-9h9l6 9z" fill={C.pale}/>
    <circle cx="38" cy="55" r="6" fill={C.ink}/><circle cx="38" cy="55" r="2.3" fill={C.pale}/>
    <circle cx="75" cy="55" r="6" fill={C.ink}/><circle cx="75" cy="55" r="2.3" fill={C.pale}/>
    <rect x="85" y="47" width="4" height="3" rx="1.5" fill={C.mint}/>
  </>,
  home: <>
    <rect x="0" y="56" width="120" height="8" fill={C.forest} opacity=".18"/>
    <path d="M34 34l22-17 22 17v22H34z" fill={C.white}/>
    <path d="M30 36l26-21 26 21" fill="none" stroke={C.forest} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="51" y="41" width="10" height="15" rx="1.5" fill={C.forest}/>
    <rect x="39" y="38" width="8" height="7" rx="1" fill={C.mint}/><rect x="65" y="38" width="8" height="7" rx="1" fill={C.mint}/>
    <rect x="66" y="18" width="5" height="9" fill={C.deep}/>
    <circle cx="94" cy="44" r="10" fill={C.forest}/><rect x="93" y="50" width="2.4" height="7" fill={C.deep}/>
    <circle cx="18" cy="48" r="6" fill={C.mint}/>
  </>,
  travel: <>
    <path d="M10 22c10-8 26-8 36 2" fill="none" stroke={C.forest} strokeWidth="1.4" strokeDasharray="3 3" opacity=".6"/>
    <path d="M46 24l9-2-3 4z" fill={C.forest}/>
    <ellipse cx="88" cy="20" rx="14" ry="5" fill={C.white}/><ellipse cx="80" cy="17" rx="7" ry="5" fill={C.white}/>
    <rect x="44" y="30" width="34" height="26" rx="5" fill={C.forest}/>
    <path d="M54 30v-5a3 3 0 013-3h8a3 3 0 013 3v5" fill="none" stroke={C.deep} strokeWidth="3"/>
    <rect x="44" y="40" width="34" height="3" fill={C.mint}/>
    <circle cx="51" cy="58" r="2.4" fill={C.ink}/><circle cx="71" cy="58" r="2.4" fill={C.ink}/>
    <rect x="82" y="44" width="14" height="10" rx="2" fill={C.sand} transform="rotate(-8 89 49)"/>
  </>,
  tech: <>
    <circle cx="90" cy="20" r="12" fill={C.mint} opacity=".55"/>
    <rect x="42" y="10" width="30" height="50" rx="7" fill={C.ink}/>
    <rect x="45.5" y="15" width="23" height="38" rx="3" fill={C.pale}/>
    <rect x="49" y="20" width="16" height="10" rx="2" fill={C.forest}/>
    <rect x="49" y="33" width="10" height="3" rx="1.5" fill={C.forest} opacity=".5"/>
    <rect x="49" y="39" width="14" height="3" rx="1.5" fill={C.forest} opacity=".3"/>
    <rect x="53" y="55.5" width="8" height="2" rx="1" fill={C.pale} opacity=".6"/>
    <path d="M82 46l4 4 8-9" fill="none" stroke={C.forest} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
  </>,
  music: <>
    <g transform="rotate(-8 60 36)">
      <path d="M28 22h64v10a4 4 0 000 8v10H28V40a4 4 0 000-8z" fill={C.forest}/>
      <path d="M74 24v24" stroke={C.pale} strokeWidth="1.4" strokeDasharray="2.5 2.5"/>
      <rect x="35" y="29" width="28" height="4" rx="2" fill={C.mint}/>
      <rect x="35" y="37" width="18" height="3" rx="1.5" fill={C.pale} opacity=".7"/>
      <circle cx="83" cy="36" r="4" fill={C.sand}/>
    </g>
    <path d="M100 14v14" stroke={C.ink} strokeWidth="2"/><circle cx="97" cy="29" r="3.4" fill={C.ink}/><path d="M100 14l7 3" stroke={C.ink} strokeWidth="2" strokeLinecap="round"/>
  </>,
  gift: <>
    <circle cx="26" cy="20" r="3" fill={C.mint}/><circle cx="96" cy="14" r="2" fill={C.forest}/><circle cx="92" cy="40" r="2.5" fill={C.sand}/>
    <rect x="40" y="30" width="40" height="28" rx="3" fill={C.forest}/>
    <rect x="37" y="24" width="46" height="9" rx="2.5" fill={C.deep}/>
    <rect x="57" y="24" width="6" height="34" fill={C.mint}/>
    <path d="M60 24c-6-9-15-7-12-1 2 3 8 2 12 1zM60 24c6-9 15-7 12-1-2 3-8 2-12 1z" fill={C.mint}/>
  </>,
  study: <>
    <rect x="34" y="46" width="52" height="9" rx="2" fill={C.forest}/>
    <rect x="38" y="37" width="46" height="9" rx="2" fill={C.sand}/>
    <rect x="36" y="28" width="48" height="9" rx="2" fill={C.deep}/>
    <path d="M60 8l24 9-24 9-24-9z" fill={C.ink}/>
    <path d="M80 18v9" stroke={C.ink} strokeWidth="1.6"/><circle cx="80" cy="28" r="2" fill={C.mint}/>
  </>,
  safety: <>
    <path d="M60 10l22 8v14c0 13-9 21-22 26-13-5-22-13-22-26V18z" fill={C.forest}/>
    <path d="M60 16l16 6v10c0 9-6 15-16 19z" fill={C.deep} opacity=".35"/>
    <path d="M51 34l6 6 12-13" fill="none" stroke={C.mint} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="22" cy="44" r="5" fill={C.mint}/><circle cx="98" cy="22" r="4" fill={C.sand}/>
  </>,
  bike: <>
    <rect x="0" y="56" width="120" height="8" fill={C.forest} opacity=".18"/>
    <circle cx="38" cy="44" r="12" fill="none" stroke={C.ink} strokeWidth="3"/>
    <circle cx="82" cy="44" r="12" fill="none" stroke={C.ink} strokeWidth="3"/>
    <path d="M38 44l12-18h22l10 18M50 26l10 18h-22M60 44l12-18" fill="none" stroke={C.forest} strokeWidth="3.4" strokeLinejoin="round"/>
    <path d="M46 22h9M70 20l2 6" stroke={C.ink} strokeWidth="3" strokeLinecap="round"/>
  </>,
  seed: <>
    <circle cx="90" cy="18" r="8" fill={C.sand}/>
    <path d="M44 42h32l-4 16H48z" fill={C.forest}/>
    <rect x="42" y="38" width="36" height="6" rx="2" fill={C.deep}/>
    <path d="M60 38V22" stroke={C.deep} strokeWidth="2.4"/>
    <path d="M60 28c-10 0-14-6-14-12 8 0 14 4 14 12zM60 24c0-8 6-12 14-12 0 7-5 12-14 12z" fill={C.mint}/>
    <circle cx="24" cy="52" r="5" fill={C.mint}/><circle cx="24" cy="52" r="2" fill={C.forest}/>
    <circle cx="96" cy="52" r="4" fill={C.mint}/>
  </>,
};

export function GoalArt({ theme, className = '' }) {
  return <svg className={`goal-art ${className}`} viewBox="0 0 120 64" role="presentation" aria-hidden="true">{scenes[theme] ?? scenes.seed}</svg>;
}

export const QUICK_PICKS = {
  short: ['Weekend trip', 'New phone', 'Concert tickets', 'Birthday gift', 'Bike'],
  long: ['Car', 'Home deposit', 'Studies', 'Safety cushion', 'Big trip'],
};
