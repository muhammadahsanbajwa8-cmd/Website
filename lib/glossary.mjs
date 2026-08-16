/**
 * What a holiday is for.
 *
 * A date table tells you when a country stops; it does not tell you why. These
 * are the explanations, written once each and reused wherever the holiday
 * appears — the forty most common names account for about four fifths of every
 * holiday row on the site.
 *
 * The rule this file is written to: say only what is reliably true. Where a
 * name is a category rather than a specific occasion — "National Day",
 * "Independence Day", "Martyrs' Day" — the entry explains the category
 * honestly and leaves the country's own history to the country. A holiday with
 * no entry gets no explanation rather than an invented one, which is why
 * `explain()` returns null instead of guessing.
 */

/** Normalise a holiday name for matching: case, accents and punctuation. */
function key(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents: Bayramı and Bayrami are one name
    // Letters NFD leaves alone, because they are letters in their own right
    // rather than an accented a-z: Turkish dotless i, Nordic o-slash, Polish l.
    .replace(/ı/g, 'i')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/đ/g, 'd')
    .replace(/\(.*?\)/g, ' ') // "(observed)", "(substitute day)"
    .replace(/[^a-z0-9 ]/g, ' ') // punctuation, so "St. Stephen's" matches
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Each entry: the explanation, and the names it answers to. Aliases matter —
 * the same day is Boxing Day in one country and St. Stephen's Day in the next.
 */
const ENTRIES = [
  {
    names: ["new year's day", 'new year holiday', 'new year', "new year's holiday"],
    text: `The first day of the Gregorian calendar year. It is the most widely observed public holiday in the world, kept in almost every country regardless of religion, and in many places the evening before is the bigger occasion.`,
  },
  {
    names: ['labour day', 'labor day', 'may day', "international workers' day", "workers' day", 'spring and labour day', 'unity day of kazakhstan'],
    text: `International Workers' Day, marked on 1 May across most of the world. It commemorates the campaign for the eight-hour working day and the Haymarket affair in Chicago in 1886. The United States and Canada are the notable exceptions: both keep their Labor Day in September instead.`,
  },
  {
    names: ['christmas day', 'christmas'],
    text: `The Christian feast of the birth of Jesus, fixed at 25 December since the fourth century. It is a public holiday well beyond Christian-majority countries, often as an inheritance of colonial administration or simply as a commercial and family occasion.`,
  },
  {
    names: ['boxing day', "st. stephen's day", "st stephen's day", 'second day of christmas', 'christmas holiday', 'day of goodwill'],
    text: `The day after Christmas. In Britain and the Commonwealth it is Boxing Day, named for the boxes of food and money once given to servants and tradespeople; in much of Europe the same date is St. Stephen's Day, for the first Christian martyr. Either way it extends the Christmas break by a day.`,
  },
  {
    names: ['good friday'],
    text: `The Friday before Easter, marking the crucifixion of Jesus. Its date moves with Easter, so it can fall anywhere from late March to late April.`,
  },
  {
    names: ['easter monday', 'easter sunday', 'easter', 'family day'],
    text: `Easter marks the resurrection of Jesus, and is the moveable feast the Christian calendar is built around: the Sunday after the first full moon following the spring equinox. Many countries take the Monday after as the public holiday rather than the Sunday itself.`,
  },
  {
    names: ['orthodox easter', 'orthodox good friday'],
    text: `Easter as calculated on the Julian calendar, which most Orthodox churches still use for the purpose. It usually falls a week or more after the Western date, and occasionally on the same day.`,
  },
  {
    names: ['ascension day', 'ascension'],
    text: `Forty days after Easter, marking the ascension of Jesus into heaven. It always falls on a Thursday, which is why it is such a reliable long weekend in the countries that keep it.`,
  },
  {
    names: ['whit monday', 'pentecost', 'whit sunday', 'whitsun'],
    text: `Pentecost falls fifty days after Easter and marks the descent of the Holy Spirit on the apostles. Where it is a public holiday it is usually the Monday that is taken.`,
  },
  {
    names: ['corpus christi'],
    text: `A Catholic feast of the Eucharist, kept sixty days after Easter, on a Thursday. It is a public holiday in parts of Catholic Europe and Latin America.`,
  },
  {
    names: ['epiphany', 'three kings day'],
    text: `6 January, twelve days after Christmas, marking the visit of the Magi to the infant Jesus. In much of Spain and Latin America it, rather than Christmas Day, is when children traditionally receive presents.`,
  },
  {
    names: ['assumption', 'assumption of mary'],
    text: `15 August, the Catholic feast of the Virgin Mary being taken up into heaven. It falls in the middle of the European summer holidays and is one of the busiest travel days of the year in France, Italy and Spain.`,
  },
  {
    names: ["all saints' day", 'all saints day', 'all saints'],
    text: `1 November, honouring the Christian saints. In much of Europe and Latin America it is the day families visit and tend graves, and cemeteries stay open late.`,
  },
  {
    names: ["all souls' day", 'all souls day'],
    text: `2 November, a day of prayer for the dead. It is closely tied to All Saints' the day before, and in several countries the two run together as one occasion.`,
  },
  {
    names: ['immaculate conception'],
    text: `8 December, the Catholic feast of the Virgin Mary being conceived without sin. It marks the start of the Christmas season in much of Catholic Europe and Latin America.`,
  },
  {
    names: ['eid al-fitr', 'eid al fitr', 'hari raya puasa', 'ramazan bayrami', 'id al-fitr', 'eid ul-fitr'],
    text: `The festival that ends Ramadan, the month of fasting. It begins on the sighting of the new moon, so the date is confirmed only a day or two ahead and varies between countries; most governments schedule two to four days of holiday around it. It moves about eleven days earlier each Gregorian year.`,
  },
  {
    names: ['eid al-adha', 'eid al adha', 'hari raya haji', 'kurban bayrami', 'id al-adha', 'eid ul-adha'],
    text: `The feast of the sacrifice, marking Ibrahim's willingness to sacrifice his son, and falling at the close of the annual pilgrimage to Mecca. Like Eid al-Fitr it follows the lunar calendar and is usually given several days of holiday.`,
  },
  {
    names: ['islamic new year', 'hijri new year', 'muharram'],
    text: `The first day of Muharram, opening the Islamic year. The Hijri calendar counts from the migration of the Prophet Muhammad from Mecca to Medina in 622.`,
  },
  {
    names: ['ashura', 'tasua'],
    text: `The tenth of Muharram. It is a day of fasting in Sunni tradition, and in Shia Islam a major day of mourning for the killing of Husayn ibn Ali at Karbala in 680.`,
  },
  {
    names: ["prophet's birthday", 'mawlid', 'mawlid al-nabi', 'birthday of the prophet'],
    text: `Mawlid, the birthday of the Prophet Muhammad, kept on the twelfth of Rabi al-Awwal. It is a public holiday in most Muslim-majority countries, though a few do not observe it.`,
  },
  {
    names: ['isra and miraj', 'isra and mi raj', 'lailat al-miraj'],
    text: `Marks the Prophet Muhammad's night journey to Jerusalem and ascent through the heavens, on the twenty-seventh of Rajab.`,
  },
  {
    names: ['first day of ramadan', 'ramadan'],
    text: `The start of the month of fasting, when Muslims abstain from food and drink between dawn and sunset. Working hours are commonly shortened for the month in Muslim-majority countries.`,
  },
  {
    names: ['nowruz', 'nooruz', 'navruz', 'nauryz', 'novruz'],
    text: `The Persian new year, falling at the spring equinox around 21 March. It is some three thousand years old, predates Islam, and is kept from the Balkans through Iran and Central Asia — often for several days.`,
  },
  {
    names: ['orthodox christmas', 'christmas day '],
    text: `Christmas as kept by churches still using the Julian calendar for fixed feasts, which currently places it on 7 January rather than 25 December.`,
  },
  // --- Civic occasions, explained as the categories they are ----------------
  {
    names: ['independence day', 'independence', 'restoration of independence', 'independence restoration day', 'day of restoration of independence', 'proclamation of independence', 'independence movement day'],
    text: `The anniversary of the country becoming independent — usually the date independence was declared, or the day power formally transferred. It is typically the largest civic holiday of the year, with parades and official ceremonies.`,
  },
  {
    names: ['national day', 'national holiday'],
    text: `The country's principal civic holiday. Depending on the country the date marks a founding, a unification, a constitution, a monarch, or a patron saint rather than independence as such.`,
  },
  {
    names: ['republic day', 'proclamation of the republic', 'republic proclamation day'],
    text: `Marks the date the country became a republic, or the date its republican constitution took effect — which is often some years after independence itself.`,
  },
  {
    names: ['constitution day'],
    text: `Marks the adoption of the country's constitution. Where a country has had several, the date usually belongs to the one currently in force.`,
  },
  {
    names: ['statehood day', 'state foundation day', 'foundation day', 'founding day', 'national foundation day'],
    text: `Marks the founding of the state — in some countries a modern event, in others the traditional or legendary date on which the nation is held to have begun.`,
  },
  {
    names: ['victory day', 'victory in europe day', 'day of remembrance and victory', 'liberation day'],
    text: `Marks a military victory or the end of an occupation. In Europe the most common is the end of the Second World War on 8 or 9 May 1945 — the difference of a day reflects the time zone in which the German surrender took effect.`,
  },
  {
    names: ['armistice day', 'remembrance day'],
    text: `11 November, the hour the guns fell silent on the Western Front in 1918. It is kept as a day of remembrance for the dead of that war and, in most countries, of later ones.`,
  },
  {
    names: ['anzac day'],
    text: `25 April, the anniversary of the Australian and New Zealand landings at Gallipoli in 1915. It is the day both countries remember their war dead, and begins with dawn services.`,
  },
  {
    names: ['revolution day', 'revolution', 'uprising day', 'national uprising day'],
    text: `Marks the revolution or uprising the current state traces its origins to. The date is usually the day it began rather than the day it succeeded.`,
  },
  {
    names: ["martyrs' day", 'martyrs day', "national martyrs' day", 'memorial day', "national heroes' day", "heroes' day", 'national heroes day'],
    text: `A day of remembrance for those who died for the country — in war, in the independence struggle, or under an earlier regime. Ceremonies are usually solemn rather than celebratory.`,
  },
  {
    names: ["women's day", "international women's day"],
    text: `8 March, International Women's Day, which grew out of the early twentieth-century labour and suffrage movements. It is a full public holiday in much of the former Soviet Union and parts of Africa and Asia.`,
  },
  {
    names: ["youth day", "national youth day", 'youth and sports day'],
    text: `Honours the country's young people, and in several countries commemorates a specific occasion on which students or young people took a decisive part in its history.`,
  },
  {
    names: ['armed forces day', 'army day', 'defence forces day', 'defender of the fatherland day', 'navy day'],
    text: `Honours the country's armed forces, usually on the anniversary of their founding.`,
  },
  {
    names: ['africa day', 'africa freedom day'],
    text: `25 May, the founding of the Organisation of African Unity in 1963, now the African Union. It is marked across the continent as a day of African solidarity.`,
  },
  {
    names: ['thanksgiving', 'thanksgiving day'],
    text: `A harvest festival turned family occasion. The United States keeps it on the fourth Thursday in November and Canada on the second Monday in October — the earlier Canadian date reflecting an earlier harvest.`,
  },
  {
    names: ['emancipation day'],
    text: `Marks the abolition of slavery. Across the Caribbean the date is 1 August, when the Slavery Abolition Act took effect in the British colonies in 1834.`,
  },
  {
    names: ['human rights day'],
    text: `Marks the country's commitment to human rights; the date is usually one of national significance rather than the international observance on 10 December.`,
  },
  {
    names: ['freedom day'],
    text: `Marks the end of an undemocratic order — the first free elections, or the fall of a regime.`,
  },
  {
    names: ['unity day', 'national unity day', 'german unity day', 'unification day'],
    text: `Marks the unification of the country, or a deliberate day of national cohesion.`,
  },
  {
    names: ['flag day'],
    text: `Honours the national flag, usually on the anniversary of its adoption.`,
  },
  {
    names: ["king's birthday", "queen's birthday", "sultan's birthday", "king's day", "emperor's birthday"],
    text: `The reigning monarch's birthday, or an official birthday fixed for convenience — several countries celebrate on a date chosen for better weather rather than the true one.`,
  },
  {
    names: ['midsummer day', 'midsummer eve', "st. john's day"],
    text: `The summer solstice festival, kept around 24 June. In the Nordic and Baltic countries it is one of the biggest occasions of the year, and much of the country empties out of the cities for it.`,
  },
  {
    names: ['maundy thursday', 'holy thursday'],
    text: `The Thursday before Easter, marking the last supper. In Spain and much of Latin America it starts a week of holiday, and in the Nordic countries it simply extends the Easter break.`,
  },
  {
    names: ['christmas eve'],
    text: `24 December. In much of central and northern Europe and Latin America the evening of the 24th, not the morning of the 25th, is when families exchange presents and eat together — which is why several countries make it a holiday in its own right.`,
  },
  {
    names: ['saints peter and paul', 'saint peter and saint paul', 'feast of saint peter and saint paul'],
    text: `29 June, honouring the apostles Peter and Paul, traditionally held to have been martyred in Rome on the same day.`,
  },
  {
    names: ['saints cyril and methodius day', 'cyril and methodius day'],
    text: `Honours the ninth-century missionary brothers who devised the first Slavic alphabet and translated the scriptures into Slavonic. It is kept as a day of culture and literacy in several Slavic countries.`,
  },
  {
    names: ["mother's day"],
    text: `Honours mothers. The date varies widely between countries — the second Sunday in May in many, but fixed civic dates elsewhere, and in a few it is a public holiday rather than an observance.`,
  },
  {
    names: ['union day', 'unification day', 'union of the principalities'],
    text: `Marks the union of the territories that make up the modern country.`,
  },
  {
    names: ['children’s day', "children's day"],
    text: `A day for children, marked in dozens of countries on a variety of dates, usually with events for families and free admission to museums and parks.`,
  },
];

/** name -> explanation, built once. */
const INDEX = new Map();
for (const entry of ENTRIES) {
  for (const name of entry.names) INDEX.set(key(name), entry.text);
}

/**
 * The explanation for a holiday name, or null when there is not one to give.
 *
 * Matching is exact on the normalised name, with two safe relaxations: an
 * observance suffix such as "(observed)" is ignored, and a leading article is
 * dropped. Nothing is matched by keyword, because "Independence Day" and
 * "Independence of Cuenca" are not the same occasion.
 */
export function explain(name) {
  const cleaned = key(name);
  if (!cleaned) return null;
  return INDEX.get(cleaned) || INDEX.get(cleaned.replace(/^(the|day of) /, '')) || null;
}

/** How many of a list of holidays this file can explain. */
export function explainedShare(holidays) {
  if (!holidays.length) return 0;
  const known = holidays.filter((holiday) => explain(holiday.name)).length;
  return known / holidays.length;
}

export const GLOSSARY_SIZE = ENTRIES.length;
