// test-bridge.mjs — the MangaBaka /source/ payload shape, captured from the live API for
// AniList 135561. Reading data.id instead of data.series[0] broke every MangaBaka link.
import { pickSourceSeries } from '../src/trackers/mangabaka.js';

const live = {
  status: 200,
  data: {
    source_response: null,
    series: [{
      id: 1471,
      state: 'active',
      canonical_url: 'https://mangabaka.org/manhwa/1471/Oroji-Neo-reul-Igigo-Sipeo',
      title: 'I Only Want to Beat You',
      native_title: '오로지 너를 이기고 싶어',
      romanized_title: "Oroji Neoreul Igigo Sipeo",
    }],
  },
};

let fail = 0;
const check = (name, ok) => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); };

const picked = pickSourceSeries(live);
check('picks the series out of data.series[]', picked?.id === 1471);
check('keeps the title', picked?.title === 'I Only Want to Beat You');
check('empty series list is null, not a crash', pickSourceSeries({ data: { series: [] } }) === null);
check('old flat shape still works', pickSourceSeries({ data: { id: 7 } })?.id === 7);

console.log(fail ? `\n${fail} bridge check(s) failed` : '\nbridge checks passed');
process.exit(fail ? 1 : 0);
