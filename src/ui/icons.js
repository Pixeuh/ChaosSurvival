import { brandIcons, applicationLogo } from './identity.js';
const desktopIcons = {
  'arcade-game': './icons/chaos-survival.svg',
  'menu-computer': './icons/menu-computer.svg',
  computer: './icons/computer.svg',
  folder: './icons/folder.svg',
  bin: './icons/recycle-empty.svg',
};
const paths = {
  buddy:
    '<path d="M30 37V13c0-12-20-12-20 0v22c0 14 26 14 26 0V17c0-8-14-8-14 0v19" fill="none" stroke="#566473" stroke-width="6" stroke-linecap="round"/><path d="M30 37V13c0-12-20-12-20 0v22c0 14 26 14 26 0V17c0-8-14-8-14 0v19" fill="none" stroke="#c7d5e1" stroke-width="3" stroke-linecap="round"/><g class="buddy-eyes"><ellipse cx="18" cy="17" rx="5" ry="6" fill="#fff" stroke="#5b6673"/><ellipse cx="29" cy="17" rx="5" ry="6" fill="#fff" stroke="#5b6673"/><g class="buddy-pupils" fill="#24415b"><circle cx="19" cy="18" r="2"/><circle cx="28" cy="18" r="2"/></g></g>',
  picture:
    '<rect x="4" y="5" width="40" height="37" rx="2" fill="#f5f8fa" stroke="#648398" stroke-width="2"/><path d="M8 9h32v27H8z" fill="#94d8f2"/><circle cx="31" cy="16" r="5" fill="#fff28b"/><path d="m8 32 10-14 10 10 5-7 7 10v5H8z" fill="#75b554"/><path d="M10 39h28" stroke="#cad7df" stroke-width="2"/>',
  drive:
    '<path d="M6 17 13 7h23l7 10v24H6z" fill="#acbac8" stroke="#506176" stroke-width="2"/><path d="M8 19h33v10H8z" fill="#e8f2fa"/><path d="M11 34h22" stroke="#566c82" stroke-width="3"/><circle cx="37" cy="35" r="2" fill="#88d55a"/>',
  disc: '<circle cx="24" cy="24" r="20" fill="#d0def4" stroke="#7189a3" stroke-width="2"/><path d="m24 5 6 14 12-5M7 31l12-4 5 16" fill="#b3efd5"/><circle cx="24" cy="24" r="6" fill="#fff" stroke="#7189a3"/><path d="M11 14a17 17 0 0 1 9-6" fill="none" stroke="#fff" stroke-width="3"/>',
  document:
    '<path d="M10 4h22l8 8v32H10z" fill="#fbfeff" stroke="#69849a" stroke-width="2"/><path d="M32 4v10h8M16 21h18M16 27h18M16 33h12" fill="none" stroke="#82a3c1" stroke-width="2"/>',
  archive:
    '<path d="M6 10h36v8H6z" fill="#d7b94d" stroke="#826b24" stroke-width="2"/><path d="M9 18h30v26H9z" fill="#e9e5cf" stroke="#77715f" stroke-width="2"/><path d="M20 18h8v5h-8zm0 8h8v5h-8zm0 8h8v5h-8z" fill="#c8b45f" stroke="#82753c"/>',
  computer:
    '<rect x="5" y="3" width="36" height="27" rx="3" fill="#dce5eb" stroke="#536774" stroke-width="2"/><path d="M10 8h26v16H10z" fill="#0e7bcc"/><path d="m13 21 7-9 7 6 6-7v10" fill="#6ce5fc"/><path d="M20 31h8v5h-8z" fill="#919ca7"/><path d="M10 37h28l5 7H5z" fill="#e7e6dc" stroke="#69757c"/>',
  folder:
    '<path d="M3 11h16l5 5h20v26H3z" fill="#da9c19" stroke="#946400"/><path d="M3 19h42l-5 24H6z" fill="#ffda6a" stroke="#c18e17"/><path d="M7 23h32" stroke="#fff3ad" stroke-width="3"/>',
  bin: '<path d="m12 12 3 32h21l3-32" fill="#d3ebf0" fill-opacity=".85" stroke="#63899c" stroke-width="2"/><ellipse cx="25" cy="12" rx="14" ry="5" fill="#f6fcff" stroke="#63899c"/><path d="m19 24 5-6 6 6m-6-6v16m-7-1 7 4 7-4" fill="none" stroke="#47aa60" stroke-width="3"/>',
  error:
    '<circle cx="24" cy="24" r="19" fill="#ec4640" stroke="#ab251b" stroke-width="2"/><path d="m16 16 16 16m0-16L16 32" stroke="white" stroke-width="5"/>',
  shield:
    '<path d="M24 3 42 10v13c0 11-10 19-18 23C16 42 6 34 6 23V10z" fill="#f4c74f" stroke="#967018" stroke-width="2"/><path d="M24 8v31c6-4 13-10 13-17V14z" fill="#ef9737"/><path d="M24 15v12m0 5v3" stroke="#7b4318" stroke-width="4"/>',
  download:
    '<path d="M6 29h36v15H6z" fill="#dce7ed" stroke="#5f798b" stroke-width="2"/><path d="M9 34h30v6H9z" fill="#91adc1"/><path d="M18 4h12v17h8L24 34 10 21h8z" fill="#7ccb47" stroke="#41812c" stroke-width="2"/><path d="M21 7v16" stroke="#d7f59c" stroke-width="3"/>',
  'media-play': '<rect x="4" y="5" width="40" height="31" rx="3" fill="#d9f3ff" stroke="#38678d" stroke-width="2"/><path d="M7 9h34v22H7z" fill="#1876b9"/><path d="M18 36v5m12-5v5m-16 0h24" stroke="#748b9b" stroke-width="3"/><circle cx="24" cy="20" r="9" fill="#78d246" stroke="#f4ffdf" stroke-width="2"/><path d="m22 15 7 5-7 5z" fill="#fff"/>',
  help: '<circle cx="24" cy="24" r="20" fill="#58a8ee" stroke="#1b63b7"/><path d="M17 16c0-9 18-9 16 1-1 5-9 5-9 12m0 5v3" fill="none" stroke="white" stroke-width="4"/>',
};
export function icon(name, className = '') {
  if (desktopIcons[name])
    return `<img class="icon ${className}" src="${desktopIcons[name]}" alt="" aria-hidden="true" draggable="false" />`;
  if (brandIcons[name])
    return `<img class="icon ${className}" src="${applicationLogo(brandIcons[name])}" alt="" aria-hidden="true" draggable="false" />`;
  return `<svg class="icon ${className}" viewBox="0 0 48 48" aria-hidden="true">${paths[name] ?? paths.computer}</svg>`;
}
