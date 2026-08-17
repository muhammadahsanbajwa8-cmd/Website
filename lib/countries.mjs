/**
 * ISO 3166-1 alpha-2 reference data: name, region, subregion.
 *
 * This is reference data, not content — no page prose lives here. Holiday data
 * comes from lib/source.mjs (live) or lib/fallback.mjs (computed).
 */

const TABLE = `
AD|Andorra|Europe|Southern Europe
AE|United Arab Emirates|Asia|Western Asia
AF|Afghanistan|Asia|Southern Asia
AG|Antigua and Barbuda|Americas|Caribbean
AI|Anguilla|Americas|Caribbean
AL|Albania|Europe|Southern Europe
AM|Armenia|Asia|Western Asia
AO|Angola|Africa|Middle Africa
AQ|Antarctica|Antarctic|Antarctica
AR|Argentina|Americas|South America
AS|American Samoa|Oceania|Polynesia
AT|Austria|Europe|Western Europe
AU|Australia|Oceania|Australia and New Zealand
AW|Aruba|Americas|Caribbean
AX|Åland Islands|Europe|Northern Europe
AZ|Azerbaijan|Asia|Western Asia
BA|Bosnia and Herzegovina|Europe|Southern Europe
BB|Barbados|Americas|Caribbean
BD|Bangladesh|Asia|Southern Asia
BE|Belgium|Europe|Western Europe
BF|Burkina Faso|Africa|Western Africa
BG|Bulgaria|Europe|Eastern Europe
BH|Bahrain|Asia|Western Asia
BI|Burundi|Africa|Eastern Africa
BJ|Benin|Africa|Western Africa
BL|Saint Barthélemy|Americas|Caribbean
BM|Bermuda|Americas|Northern America
BN|Brunei|Asia|South-eastern Asia
BO|Bolivia|Americas|South America
BQ|Caribbean Netherlands|Americas|Caribbean
BR|Brazil|Americas|South America
BS|Bahamas|Americas|Caribbean
BT|Bhutan|Asia|Southern Asia
BV|Bouvet Island|Antarctic|Antarctica
BW|Botswana|Africa|Southern Africa
BY|Belarus|Europe|Eastern Europe
BZ|Belize|Americas|Central America
CA|Canada|Americas|Northern America
CC|Cocos (Keeling) Islands|Oceania|Australia and New Zealand
CD|Congo (Kinshasa)|Africa|Middle Africa
CF|Central African Republic|Africa|Middle Africa
CG|Congo (Brazzaville)|Africa|Middle Africa
CH|Switzerland|Europe|Western Europe
CI|Côte d'Ivoire|Africa|Western Africa
CK|Cook Islands|Oceania|Polynesia
CL|Chile|Americas|South America
CM|Cameroon|Africa|Middle Africa
CN|China|Asia|Eastern Asia
CO|Colombia|Americas|South America
CR|Costa Rica|Americas|Central America
CU|Cuba|Americas|Caribbean
CV|Cabo Verde|Africa|Western Africa
CW|Curaçao|Americas|Caribbean
CX|Christmas Island|Oceania|Australia and New Zealand
CY|Cyprus|Asia|Western Asia
CZ|Czechia|Europe|Eastern Europe
DE|Germany|Europe|Western Europe
DJ|Djibouti|Africa|Eastern Africa
DK|Denmark|Europe|Northern Europe
DM|Dominica|Americas|Caribbean
DO|Dominican Republic|Americas|Caribbean
DZ|Algeria|Africa|Northern Africa
EC|Ecuador|Americas|South America
EE|Estonia|Europe|Northern Europe
EG|Egypt|Africa|Northern Africa
EH|Western Sahara|Africa|Northern Africa
ER|Eritrea|Africa|Eastern Africa
ES|Spain|Europe|Southern Europe
ET|Ethiopia|Africa|Eastern Africa
FI|Finland|Europe|Northern Europe
FJ|Fiji|Oceania|Melanesia
FK|Falkland Islands|Americas|South America
FM|Micronesia|Oceania|Micronesia
FO|Faroe Islands|Europe|Northern Europe
FR|France|Europe|Western Europe
GA|Gabon|Africa|Middle Africa
GB|United Kingdom|Europe|Northern Europe
GD|Grenada|Americas|Caribbean
GE|Georgia|Asia|Western Asia
GF|French Guiana|Americas|South America
GG|Guernsey|Europe|Northern Europe
GH|Ghana|Africa|Western Africa
GI|Gibraltar|Europe|Southern Europe
GL|Greenland|Americas|Northern America
GM|Gambia|Africa|Western Africa
GN|Guinea|Africa|Western Africa
GP|Guadeloupe|Americas|Caribbean
GQ|Equatorial Guinea|Africa|Middle Africa
GR|Greece|Europe|Southern Europe
GS|South Georgia & South Sandwich Islands|Antarctic|Antarctica
GT|Guatemala|Americas|Central America
GU|Guam|Oceania|Micronesia
GW|Guinea-Bissau|Africa|Western Africa
GY|Guyana|Americas|South America
HK|Hong Kong|Asia|Eastern Asia
HM|Heard & McDonald Islands|Antarctic|Antarctica
HN|Honduras|Americas|Central America
HR|Croatia|Europe|Southern Europe
HT|Haiti|Americas|Caribbean
HU|Hungary|Europe|Eastern Europe
ID|Indonesia|Asia|South-eastern Asia
IE|Ireland|Europe|Northern Europe
IL|Israel|Asia|Western Asia
IM|Isle of Man|Europe|Northern Europe
IN|India|Asia|Southern Asia
IO|British Indian Ocean Territory|Asia|Southern Asia
IQ|Iraq|Asia|Western Asia
IR|Iran|Asia|Southern Asia
IS|Iceland|Europe|Northern Europe
IT|Italy|Europe|Southern Europe
JE|Jersey|Europe|Northern Europe
JM|Jamaica|Americas|Caribbean
JO|Jordan|Asia|Western Asia
JP|Japan|Asia|Eastern Asia
KE|Kenya|Africa|Eastern Africa
KG|Kyrgyzstan|Asia|Central Asia
KH|Cambodia|Asia|South-eastern Asia
KI|Kiribati|Oceania|Micronesia
KM|Comoros|Africa|Eastern Africa
KN|Saint Kitts and Nevis|Americas|Caribbean
KP|North Korea|Asia|Eastern Asia
KR|South Korea|Asia|Eastern Asia
KW|Kuwait|Asia|Western Asia
KY|Cayman Islands|Americas|Caribbean
KZ|Kazakhstan|Asia|Central Asia
LA|Laos|Asia|South-eastern Asia
LB|Lebanon|Asia|Western Asia
LC|Saint Lucia|Americas|Caribbean
LI|Liechtenstein|Europe|Western Europe
LK|Sri Lanka|Asia|Southern Asia
LR|Liberia|Africa|Western Africa
LS|Lesotho|Africa|Southern Africa
LT|Lithuania|Europe|Northern Europe
LU|Luxembourg|Europe|Western Europe
LV|Latvia|Europe|Northern Europe
LY|Libya|Africa|Northern Africa
MA|Morocco|Africa|Northern Africa
MC|Monaco|Europe|Western Europe
MD|Moldova|Europe|Eastern Europe
ME|Montenegro|Europe|Southern Europe
MF|Saint Martin|Americas|Caribbean
MG|Madagascar|Africa|Eastern Africa
MH|Marshall Islands|Oceania|Micronesia
MK|North Macedonia|Europe|Southern Europe
ML|Mali|Africa|Western Africa
MM|Myanmar|Asia|South-eastern Asia
MN|Mongolia|Asia|Eastern Asia
MO|Macao|Asia|Eastern Asia
MP|Northern Mariana Islands|Oceania|Micronesia
MQ|Martinique|Americas|Caribbean
MR|Mauritania|Africa|Western Africa
MS|Montserrat|Americas|Caribbean
MT|Malta|Europe|Southern Europe
MU|Mauritius|Africa|Eastern Africa
MV|Maldives|Asia|Southern Asia
MW|Malawi|Africa|Eastern Africa
MX|Mexico|Americas|Central America
MY|Malaysia|Asia|South-eastern Asia
MZ|Mozambique|Africa|Eastern Africa
NA|Namibia|Africa|Southern Africa
NC|New Caledonia|Oceania|Melanesia
NE|Niger|Africa|Western Africa
NF|Norfolk Island|Oceania|Australia and New Zealand
NG|Nigeria|Africa|Western Africa
NI|Nicaragua|Americas|Central America
NL|Netherlands|Europe|Western Europe
NO|Norway|Europe|Northern Europe
NP|Nepal|Asia|Southern Asia
NR|Nauru|Oceania|Micronesia
NU|Niue|Oceania|Polynesia
NZ|New Zealand|Oceania|Australia and New Zealand
OM|Oman|Asia|Western Asia
PA|Panama|Americas|Central America
PE|Peru|Americas|South America
PF|French Polynesia|Oceania|Polynesia
PG|Papua New Guinea|Oceania|Melanesia
PH|Philippines|Asia|South-eastern Asia
PK|Pakistan|Asia|Southern Asia
PL|Poland|Europe|Eastern Europe
PM|Saint Pierre and Miquelon|Americas|Northern America
PN|Pitcairn Islands|Oceania|Polynesia
PR|Puerto Rico|Americas|Caribbean
PS|Palestine|Asia|Western Asia
PT|Portugal|Europe|Southern Europe
PW|Palau|Oceania|Micronesia
PY|Paraguay|Americas|South America
QA|Qatar|Asia|Western Asia
RE|Réunion|Africa|Eastern Africa
RO|Romania|Europe|Eastern Europe
RS|Serbia|Europe|Southern Europe
RU|Russia|Europe|Eastern Europe
RW|Rwanda|Africa|Eastern Africa
SA|Saudi Arabia|Asia|Western Asia
SB|Solomon Islands|Oceania|Melanesia
SC|Seychelles|Africa|Eastern Africa
SD|Sudan|Africa|Northern Africa
SE|Sweden|Europe|Northern Europe
SG|Singapore|Asia|South-eastern Asia
SH|Saint Helena|Africa|Western Africa
SI|Slovenia|Europe|Southern Europe
SJ|Svalbard and Jan Mayen|Europe|Northern Europe
SK|Slovakia|Europe|Eastern Europe
SL|Sierra Leone|Africa|Western Africa
SM|San Marino|Europe|Southern Europe
SN|Senegal|Africa|Western Africa
SO|Somalia|Africa|Eastern Africa
SR|Suriname|Americas|South America
SS|South Sudan|Africa|Eastern Africa
ST|São Tomé and Príncipe|Africa|Middle Africa
SV|El Salvador|Americas|Central America
SX|Sint Maarten|Americas|Caribbean
SY|Syria|Asia|Western Asia
SZ|Eswatini|Africa|Southern Africa
TC|Turks and Caicos Islands|Americas|Caribbean
TD|Chad|Africa|Middle Africa
TF|French Southern Territories|Antarctic|Antarctica
TG|Togo|Africa|Western Africa
TH|Thailand|Asia|South-eastern Asia
TJ|Tajikistan|Asia|Central Asia
TK|Tokelau|Oceania|Polynesia
TL|Timor-Leste|Asia|South-eastern Asia
TM|Turkmenistan|Asia|Central Asia
TN|Tunisia|Africa|Northern Africa
TO|Tonga|Oceania|Polynesia
TR|Türkiye|Asia|Western Asia
TT|Trinidad and Tobago|Americas|Caribbean
TV|Tuvalu|Oceania|Polynesia
TW|Taiwan|Asia|Eastern Asia
TZ|Tanzania|Africa|Eastern Africa
UA|Ukraine|Europe|Eastern Europe
UG|Uganda|Africa|Eastern Africa
UM|U.S. Outlying Islands|Oceania|Micronesia
US|United States|Americas|Northern America
UY|Uruguay|Americas|South America
UZ|Uzbekistan|Asia|Central Asia
VA|Vatican City|Europe|Southern Europe
VC|Saint Vincent and the Grenadines|Americas|Caribbean
VE|Venezuela|Americas|South America
VG|British Virgin Islands|Americas|Caribbean
VI|U.S. Virgin Islands|Americas|Caribbean
VN|Vietnam|Asia|South-eastern Asia
VU|Vanuatu|Oceania|Melanesia
WF|Wallis and Futuna|Oceania|Polynesia
WS|Samoa|Oceania|Polynesia
XK|Kosovo|Europe|Southern Europe
YE|Yemen|Asia|Western Asia
YT|Mayotte|Africa|Eastern Africa
ZA|South Africa|Africa|Southern Africa
ZM|Zambia|Africa|Eastern Africa
ZW|Zimbabwe|Africa|Eastern Africa
`;

/** @type {Map<string, {code: string, name: string, region: string, subregion: string}>} */
export const COUNTRIES = new Map(
  TABLE.trim()
    .split('\n')
    .map((line) => {
      const [code, name, region, subregion] = line.split('|');
      return [code, { code, name, region, subregion }];
    }),
);

export const REGION_ORDER = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania', 'Antarctic'];

/** Metadata for a code, with a safe shape for codes we do not recognise. */
export function countryInfo(code) {
  const key = String(code || '').toUpperCase();
  return (
    COUNTRIES.get(key) || {
      code: key,
      name: key,
      region: 'Other',
      subregion: 'Other',
    }
  );
}

/** Regional-indicator emoji flag, derived from the code itself. */
export function flagEmoji(code) {
  const key = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(key)) return '';
  return String.fromCodePoint(...[...key].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Group country records by region, in a stable display order. */
export function groupByRegion(countries) {
  const groups = new Map();
  for (const country of countries) {
    const region = country.region || 'Other';
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(country);
  }
  const ordered = [];
  for (const region of REGION_ORDER) {
    if (groups.has(region)) ordered.push([region, sortByName(groups.get(region))]);
  }
  for (const [region, list] of groups) {
    if (!REGION_ORDER.includes(region)) ordered.push([region, sortByName(list)]);
  }
  return ordered;
}

function sortByName(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
