'use strict';

const THAI_ONSET = {
  'ก':'k','ข':'kh','ค':'k','ง':'ng','จ':'j','ช':'ch','ซ':'s',
  'ญ':'y','ด':'d','ต':'t','ถ':'th','ท':'th','น':'n',
  'บ':'b','ป':'p','ผ':'ph','ฝ':'f','พ':'ph','ฟ':'f',
  'ม':'m','ย':'y','ร':'r','ล':'l','ว':'w','ส':'s',
  'ห':'h','ฮ':'h','อ':'',
  'เ':'e','แ':'ae','โ':'o','ใ':'i','ไ':'i',
};

function fixMixedThaiEng(text) {
  return text.replace(/(\S+)/g, token => {
    if (token.startsWith('#') || token.startsWith('http')) return token;
    let t = token;
    t = t.replace(/([฀-๿]+)([A-Z][a-zA-Z]{2,})/g, '$1 $2');
    t = t.replace(/([฀-๿])([a-z][a-zA-Z]{2,})/g, (_, thaiChar, engPart) => {
      const phoneme = THAI_ONSET[thaiChar] ?? '';
      if (!phoneme) return thaiChar + ' ' + engPart;
      if (engPart[0] === phoneme[0]) return engPart;
      return phoneme + engPart;
    });
    t = t.replace(/([฀-๿])([a-zA-Z]{2,})/g, '$1 $2');
    return t;
  });
}

module.exports = { fixMixedThaiEng };
