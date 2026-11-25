import { ns, A, TYPES, rels, treeStart } from './xml.js';
const fmt = 'application/vnd.openxmlformats-officedocument.';
export const slideType = fmt + 'presentationml.slide+xml';
const clrMap =
  'accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"';
const colorKeys = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
];
const colors = [
  '222521',
  'FFFFFF',
  '394147',
  'F6F4EE',
  '354AE8',
  'CFD9B6',
  'E0AD83',
  '84AACA',
  'E0BC69',
  'A896BE',
  '354AE8',
  '7457A7',
];
const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const fontGroup = (n) =>
  `<a:${n}><a:latin typeface="Helvetica Neue"/><a:ea typeface="Hiragino Sans"/><a:cs typeface="Arial"/></a:${n}>`;
export function template() {
  const xml = {
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst/><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ]),
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${treeStart}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([
      ['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${ns}><p:cSld><p:spTree>${treeStart}</p:spTree></p:cSld><p:clrMap ${clrMap}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ]),
    'ppt/theme/theme1.xml': `<a:theme xmlns:a="${A}" name="Fieldwork"><a:themeElements><a:clrScheme name="Fieldwork">${colorKeys.map((k, i) => `<a:${k}><a:srgbClr val="${colors[i]}"/></a:${k}>`).join('')}</a:clrScheme><a:fontScheme name="System">${fontGroup('majorFont')}${fontGroup('minorFont')}</a:fontScheme><a:fmtScheme name="Fieldwork"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[12700, 25400, 38100].map((w) => `<a:ln w="${w}">${fill}<a:prstDash val="solid"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
  };
  const parts = {
    'ppt/presentation.xml': 'presentationml.presentation.main',
    'ppt/slideMasters/slideMaster1.xml': 'presentationml.slideMaster',
    'ppt/slideLayouts/slideLayout1.xml': 'presentationml.slideLayout',
    'ppt/theme/theme1.xml': 'theme',
  };
  xml['[Content_Types].xml'] =
    `<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
      parts
    )
      .map(
        ([p, t]) => `<Override PartName="/${p}" ContentType="${fmt + t}+xml"/>`
      )
      .join('')}</Types>`;
  return { xml, media: {} };
}
