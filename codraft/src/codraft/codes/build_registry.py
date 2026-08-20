"""Generates registry/countries.json.

Kept as source rather than hand-edited JSON so the shape of what is claimed
stays visible: a regime block says what a group of countries has in common,
and a country line says which regime it follows. Nothing is asserted about
a country beyond the regime it is mapped to and the authority named.

`confidence` is not decoration. It is the difference between "this rule was
read off the published code" and "this is where to go and look", and the
report prints it either way.
"""

import json
import pathlib

# ---------------------------------------------------------------------------
# Regimes: the code families that countries adopt, and what codraft can check
# against each. `rule_packs` lists the packs in codes/rules that apply.
# ---------------------------------------------------------------------------
REGIMES = {
    "icc": {
        "family": "ICC model codes",
        "description": "International Building Code and International Residential "
                       "Code, as adopted and amended locally.",
        "codes": ["International Building Code (IBC)",
                  "International Residential Code (IRC)"],
        "rule_packs": ["baseline", "ibc-2021", "irc-2021"],
        "publisher": "International Code Council",
        "url": "https://codes.iccsafe.org/",
        "confidence": "high",
        "note": "The IBC is a model code with no force of its own. A state, "
                "emirate or municipality adopts an edition and amends it, so "
                "the adopted edition and its local amendments always govern.",
    },
    "icc-derived": {
        "family": "ICC-derived national code",
        "description": "A national code built on an IBC edition, with local "
                       "amendments for climate, seismicity and practice.",
        "codes": ["National code derived from the IBC"],
        "rule_packs": ["baseline", "ibc-2021"],
        "confidence": "medium",
        "note": "Checks run against the IBC provisions the national code was "
                "built from. Local amendments are not encoded and can be "
                "stricter; confirm each finding against the national document.",
    },
    "eurocode": {
        "family": "Eurocodes plus national regulations",
        "description": "EN Eurocodes for structural design, with fire, egress "
                       "and energy set by national building regulations.",
        "codes": ["EN Eurocodes (EN 1990-1999)",
                  "National building regulations and national annexes"],
        "rule_packs": ["baseline"],
        "publisher": "CEN",
        "url": "https://eurocodes.jrc.ec.europa.eu/",
        "confidence": "medium",
        "note": "The Eurocodes cover structural design, not room sizes or "
                "egress geometry. Those sit in each country's own building "
                "regulations and its National Annex, which are not encoded "
                "here. Only the practice baseline is applied.",
    },
    "uk": {
        "family": "Approved Documents",
        "description": "The Building Regulations for England, with Approved "
                       "Documents giving practical guidance.",
        "codes": ["The Building Regulations 2010",
                  "Approved Documents B, K, M and others"],
        "rule_packs": ["baseline", "uk-approved-documents"],
        "publisher": "HM Government",
        "url": "https://www.gov.uk/government/collections/approved-documents",
        "confidence": "medium",
        "note": "Scotland, Wales and Northern Ireland have their own, divergent "
                "regulations. Resolve to the nation, not to 'UK'.",
    },
    "pk": {
        "family": "Building Code of Pakistan and provincial by-laws",
        "description": "A national code for structural and fire provisions, "
                       "with planning controls set by each city's development "
                       "authority.",
        "codes": ["Building Code of Pakistan (Seismic Provisions) 2021",
                  "Building Code of Pakistan (Fire Safety Provisions) 2016",
                  "Provincial and municipal building by-laws"],
        "rule_packs": ["baseline", "pk-bylaws"],
        "authority": "Pakistan Engineering Council; provincial development "
                     "authorities (CDA, LDA, RDA, SBCA, PDA)",
        "url": "https://www.pec.org.pk/",
        "confidence": "low",
        "note": "Setbacks, coverage and height are fixed by the development "
                "authority for each city and vary by plot size and scheme. "
                "The encoded values are common by-law figures and must be "
                "confirmed against the authority for the specific scheme.",
    },
    "in": {
        "family": "National Building Code of India",
        "description": "NBC 2016, adopted through state and municipal "
                       "building by-laws.",
        "codes": ["National Building Code of India 2016",
                  "State and municipal building by-laws"],
        "rule_packs": ["baseline", "in-nbc-2016"],
        "publisher": "Bureau of Indian Standards",
        "url": "https://www.bis.gov.in/",
        "authority": "State urban development departments and municipal corporations",
        "confidence": "low",
        "note": "The NBC is a model code. States and municipalities adopt it "
                "with amendments, and the local development control rules "
                "govern setbacks, ground coverage and FAR/FSI.",
    },
    "au": {
        "family": "National Construction Code",
        "description": "The NCC, adopted with variations by each state and "
                       "territory. Volume One covers Class 2 to 9, Volume Two "
                       "with the ABCB Housing Provisions covers Class 1 and 10, "
                       "and Volume Three is the Plumbing Code of Australia.",
        "codes": [
            "NCC Volume Two and ABCB Housing Provisions (Class 1 and 10)",
            "NCC Volume One (Class 2 to 9)",
            "NCC Volume Three, Plumbing Code of Australia",
        ],
        "rule_packs": ["baseline", "au-ncc-housing", "au-ncc-livable", "au-ncc-vol1"],
        "publisher": "Australian Building Codes Board",
        "url": "https://ncc.abcb.gov.au/",
        "authority": "State and territory building authorities; council or "
                     "private building surveyors",
        "confidence": "high",
        "note": "Australia publishes its building code free to the public, "
                "which is why this is one of the few jurisdictions where the "
                "encoded rules cite real clauses at high confidence. Two "
                "things still need confirming on any project: WHICH EDITION "
                "the state has adopted -- NCC 2022 Amendment 2 applies from "
                "29 July 2025, and NCC 2025 was published on 1 May 2026 for "
                "progressive adoption -- and the state variations, which are "
                "not encoded. Setbacks, site coverage and height limits do "
                "NOT come from the NCC: the council's planning scheme sets "
                "them, so no site controls are supplied here. Volume Three "
                "(plumbing) is named but not encoded.",
    },
    "ca": {
        "family": "National Building Code of Canada",
        "description": "The NBC, adopted with amendments by each province.",
        "codes": ["National Building Code of Canada",
                  "Provincial building codes"],
        "rule_packs": ["baseline"],
        "publisher": "National Research Council Canada",
        "url": "https://nrc.canada.ca/en/certifications-evaluations-standards/codes-canada",
        "confidence": "medium",
        "note": "No NBC rule pack is encoded yet. Ontario, Quebec, BC and "
                "Alberta each publish their own code, which governs.",
    },
    "cn": {
        "family": "GB national standards",
        "description": "Mandatory GB standards for design, fire and residential "
                       "buildings.",
        "codes": ["GB 50352 Uniform standard for design of civil buildings",
                  "GB 50016 Code for fire protection design of buildings",
                  "GB 50096 Design code for residential buildings"],
        "rule_packs": ["baseline"],
        "confidence": "low",
        "note": "No GB rule pack is encoded. The GB standards are mandatory "
                "and published in Chinese; a translation is not authoritative.",
    },
    "jp": {
        "family": "Building Standards Act",
        "description": "The Building Standards Act and its Enforcement Order.",
        "codes": ["Building Standards Act (建築基準法)"],
        "rule_packs": ["baseline"],
        "confidence": "low",
        "note": "No rule pack encoded. Setbacks and bulk are governed by the "
                "city planning system, including sunlight and setback slope "
                "controls with no equivalent in other codes.",
    },
    "national": {
        "family": "National building code",
        "description": "A national code administered by a central ministry or "
                       "standards body.",
        "codes": ["National building code"],
        "rule_packs": ["baseline"],
        "confidence": "low",
        "note": "The national code for this country is not encoded, so only "
                "the practice baseline is applied. Its provisions govern and "
                "must be checked directly.",
    },
    "unknown": {
        "family": "Not established",
        "description": "codraft has no mapping for which code governs here.",
        "codes": [],
        "rule_packs": ["baseline"],
        "confidence": "none",
        "note": "No code has been mapped for this country. Nothing in the "
                "report should be read as a statement about local law. "
                "Identify the authority having jurisdiction before relying on "
                "any of it.",
    },
}


# ---------------------------------------------------------------------------
# Every country, and the regime it is mapped to. `unknown` is used wherever
# the governing code has not been established -- it is a real answer, and a
# more useful one than a confident guess.
# Format: ISO 3166-1 alpha-2: (name, region, regime)
# ---------------------------------------------------------------------------
COUNTRIES = {
    # -- Americas ----------------------------------------------------------
    "US": ("United States", "Northern America", "icc"),
    "CA": ("Canada", "Northern America", "ca"),
    "MX": ("Mexico", "Central America", "national"),
    "GT": ("Guatemala", "Central America", "national"),
    "BZ": ("Belize", "Central America", "unknown"),
    "SV": ("El Salvador", "Central America", "national"),
    "HN": ("Honduras", "Central America", "unknown"),
    "NI": ("Nicaragua", "Central America", "national"),
    "CR": ("Costa Rica", "Central America", "national"),
    "PA": ("Panama", "Central America", "national"),
    "CU": ("Cuba", "Caribbean", "national"),
    "HT": ("Haiti", "Caribbean", "unknown"),
    "DO": ("Dominican Republic", "Caribbean", "national"),
    "JM": ("Jamaica", "Caribbean", "icc-derived"),
    "TT": ("Trinidad and Tobago", "Caribbean", "icc-derived"),
    "BS": ("Bahamas", "Caribbean", "icc-derived"),
    "BB": ("Barbados", "Caribbean", "icc-derived"),
    "AG": ("Antigua and Barbuda", "Caribbean", "icc-derived"),
    "DM": ("Dominica", "Caribbean", "icc-derived"),
    "GD": ("Grenada", "Caribbean", "icc-derived"),
    "KN": ("Saint Kitts and Nevis", "Caribbean", "icc-derived"),
    "LC": ("Saint Lucia", "Caribbean", "icc-derived"),
    "VC": ("Saint Vincent and the Grenadines", "Caribbean", "icc-derived"),
    "BR": ("Brazil", "South America", "national"),
    "AR": ("Argentina", "South America", "national"),
    "CL": ("Chile", "South America", "national"),
    "CO": ("Colombia", "South America", "national"),
    "PE": ("Peru", "South America", "national"),
    "VE": ("Venezuela", "South America", "national"),
    "EC": ("Ecuador", "South America", "national"),
    "BO": ("Bolivia", "South America", "national"),
    "PY": ("Paraguay", "South America", "unknown"),
    "UY": ("Uruguay", "South America", "national"),
    "GY": ("Guyana", "South America", "unknown"),
    "SR": ("Suriname", "South America", "unknown"),
    # -- Europe ------------------------------------------------------------
    "GB": ("United Kingdom", "Northern Europe", "uk"),
    "IE": ("Ireland", "Northern Europe", "eurocode"),
    "FR": ("France", "Western Europe", "eurocode"),
    "DE": ("Germany", "Western Europe", "eurocode"),
    "NL": ("Netherlands", "Western Europe", "eurocode"),
    "BE": ("Belgium", "Western Europe", "eurocode"),
    "LU": ("Luxembourg", "Western Europe", "eurocode"),
    "AT": ("Austria", "Western Europe", "eurocode"),
    "CH": ("Switzerland", "Western Europe", "eurocode"),
    "LI": ("Liechtenstein", "Western Europe", "eurocode"),
    "MC": ("Monaco", "Western Europe", "eurocode"),
    "ES": ("Spain", "Southern Europe", "eurocode"),
    "PT": ("Portugal", "Southern Europe", "eurocode"),
    "IT": ("Italy", "Southern Europe", "eurocode"),
    "GR": ("Greece", "Southern Europe", "eurocode"),
    "MT": ("Malta", "Southern Europe", "eurocode"),
    "CY": ("Cyprus", "Southern Europe", "eurocode"),
    "SM": ("San Marino", "Southern Europe", "eurocode"),
    "VA": ("Vatican City", "Southern Europe", "unknown"),
    "AD": ("Andorra", "Southern Europe", "eurocode"),
    "HR": ("Croatia", "Southern Europe", "eurocode"),
    "SI": ("Slovenia", "Southern Europe", "eurocode"),
    "RS": ("Serbia", "Southern Europe", "eurocode"),
    "BA": ("Bosnia and Herzegovina", "Southern Europe", "eurocode"),
    "ME": ("Montenegro", "Southern Europe", "eurocode"),
    "MK": ("North Macedonia", "Southern Europe", "eurocode"),
    "AL": ("Albania", "Southern Europe", "eurocode"),
    "XK": ("Kosovo", "Southern Europe", "eurocode"),
    "DK": ("Denmark", "Northern Europe", "eurocode"),
    "SE": ("Sweden", "Northern Europe", "eurocode"),
    "NO": ("Norway", "Northern Europe", "eurocode"),
    "FI": ("Finland", "Northern Europe", "eurocode"),
    "IS": ("Iceland", "Northern Europe", "eurocode"),
    "EE": ("Estonia", "Northern Europe", "eurocode"),
    "LV": ("Latvia", "Northern Europe", "eurocode"),
    "LT": ("Lithuania", "Northern Europe", "eurocode"),
    "PL": ("Poland", "Eastern Europe", "eurocode"),
    "CZ": ("Czechia", "Eastern Europe", "eurocode"),
    "SK": ("Slovakia", "Eastern Europe", "eurocode"),
    "HU": ("Hungary", "Eastern Europe", "eurocode"),
    "RO": ("Romania", "Eastern Europe", "eurocode"),
    "BG": ("Bulgaria", "Eastern Europe", "eurocode"),
    "UA": ("Ukraine", "Eastern Europe", "national"),
    "MD": ("Moldova", "Eastern Europe", "national"),
    "BY": ("Belarus", "Eastern Europe", "national"),
    "RU": ("Russia", "Eastern Europe", "national"),
    # -- Middle East and Central Asia --------------------------------------
    "TR": ("Turkey", "Western Asia", "national"),
    "GE": ("Georgia", "Western Asia", "national"),
    "AM": ("Armenia", "Western Asia", "national"),
    "AZ": ("Azerbaijan", "Western Asia", "national"),
    "IL": ("Israel", "Western Asia", "national"),
    "PS": ("Palestine", "Western Asia", "national"),
    "JO": ("Jordan", "Western Asia", "national"),
    "LB": ("Lebanon", "Western Asia", "national"),
    "SY": ("Syria", "Western Asia", "unknown"),
    "IQ": ("Iraq", "Western Asia", "national"),
    "IR": ("Iran", "Southern Asia", "national"),
    "SA": ("Saudi Arabia", "Western Asia", "icc-derived"),
    "AE": ("United Arab Emirates", "Western Asia", "icc-derived"),
    "QA": ("Qatar", "Western Asia", "icc-derived"),
    "KW": ("Kuwait", "Western Asia", "icc-derived"),
    "BH": ("Bahrain", "Western Asia", "icc-derived"),
    "OM": ("Oman", "Western Asia", "icc-derived"),
    "YE": ("Yemen", "Western Asia", "unknown"),
    "KZ": ("Kazakhstan", "Central Asia", "national"),
    "UZ": ("Uzbekistan", "Central Asia", "national"),
    "TM": ("Turkmenistan", "Central Asia", "unknown"),
    "KG": ("Kyrgyzstan", "Central Asia", "national"),
    "TJ": ("Tajikistan", "Central Asia", "national"),
    "AF": ("Afghanistan", "Southern Asia", "unknown"),
    # -- South and East Asia -----------------------------------------------
    "PK": ("Pakistan", "Southern Asia", "pk"),
    "IN": ("India", "Southern Asia", "in"),
    "BD": ("Bangladesh", "Southern Asia", "national"),
    "LK": ("Sri Lanka", "Southern Asia", "national"),
    "NP": ("Nepal", "Southern Asia", "national"),
    "BT": ("Bhutan", "Southern Asia", "national"),
    "MV": ("Maldives", "Southern Asia", "national"),
    "CN": ("China", "Eastern Asia", "cn"),
    "JP": ("Japan", "Eastern Asia", "jp"),
    "KR": ("South Korea", "Eastern Asia", "national"),
    "KP": ("North Korea", "Eastern Asia", "unknown"),
    "MN": ("Mongolia", "Eastern Asia", "national"),
    "TW": ("Taiwan", "Eastern Asia", "national"),
    "HK": ("Hong Kong", "Eastern Asia", "national"),
    "MO": ("Macao", "Eastern Asia", "national"),
    "SG": ("Singapore", "South-Eastern Asia", "national"),
    "MY": ("Malaysia", "South-Eastern Asia", "national"),
    "ID": ("Indonesia", "South-Eastern Asia", "national"),
    "TH": ("Thailand", "South-Eastern Asia", "national"),
    "VN": ("Vietnam", "South-Eastern Asia", "national"),
    "PH": ("Philippines", "South-Eastern Asia", "national"),
    "MM": ("Myanmar", "South-Eastern Asia", "national"),
    "KH": ("Cambodia", "South-Eastern Asia", "unknown"),
    "LA": ("Laos", "South-Eastern Asia", "unknown"),
    "BN": ("Brunei", "South-Eastern Asia", "national"),
    "TL": ("Timor-Leste", "South-Eastern Asia", "unknown"),
    # -- Africa ------------------------------------------------------------
    "EG": ("Egypt", "Northern Africa", "national"),
    "LY": ("Libya", "Northern Africa", "unknown"),
    "TN": ("Tunisia", "Northern Africa", "national"),
    "DZ": ("Algeria", "Northern Africa", "national"),
    "MA": ("Morocco", "Northern Africa", "national"),
    "SD": ("Sudan", "Northern Africa", "unknown"),
    "SS": ("South Sudan", "Eastern Africa", "unknown"),
    "ET": ("Ethiopia", "Eastern Africa", "national"),
    "ER": ("Eritrea", "Eastern Africa", "unknown"),
    "DJ": ("Djibouti", "Eastern Africa", "unknown"),
    "SO": ("Somalia", "Eastern Africa", "unknown"),
    "KE": ("Kenya", "Eastern Africa", "national"),
    "UG": ("Uganda", "Eastern Africa", "national"),
    "TZ": ("Tanzania", "Eastern Africa", "national"),
    "RW": ("Rwanda", "Eastern Africa", "national"),
    "BI": ("Burundi", "Eastern Africa", "unknown"),
    "MW": ("Malawi", "Eastern Africa", "national"),
    "ZM": ("Zambia", "Eastern Africa", "national"),
    "ZW": ("Zimbabwe", "Eastern Africa", "national"),
    "MZ": ("Mozambique", "Eastern Africa", "unknown"),
    "MG": ("Madagascar", "Eastern Africa", "unknown"),
    "MU": ("Mauritius", "Eastern Africa", "national"),
    "SC": ("Seychelles", "Eastern Africa", "unknown"),
    "KM": ("Comoros", "Eastern Africa", "unknown"),
    "ZA": ("South Africa", "Southern Africa", "national"),
    "NA": ("Namibia", "Southern Africa", "national"),
    "BW": ("Botswana", "Southern Africa", "national"),
    "LS": ("Lesotho", "Southern Africa", "unknown"),
    "SZ": ("Eswatini", "Southern Africa", "unknown"),
    "AO": ("Angola", "Middle Africa", "unknown"),
    "CD": ("DR Congo", "Middle Africa", "unknown"),
    "CG": ("Republic of the Congo", "Middle Africa", "unknown"),
    "CM": ("Cameroon", "Middle Africa", "unknown"),
    "GA": ("Gabon", "Middle Africa", "unknown"),
    "GQ": ("Equatorial Guinea", "Middle Africa", "unknown"),
    "CF": ("Central African Republic", "Middle Africa", "unknown"),
    "TD": ("Chad", "Middle Africa", "unknown"),
    "ST": ("Sao Tome and Principe", "Middle Africa", "unknown"),
    "NG": ("Nigeria", "Western Africa", "national"),
    "GH": ("Ghana", "Western Africa", "national"),
    "CI": ("Cote d'Ivoire", "Western Africa", "unknown"),
    "SN": ("Senegal", "Western Africa", "national"),
    "ML": ("Mali", "Western Africa", "unknown"),
    "BF": ("Burkina Faso", "Western Africa", "unknown"),
    "NE": ("Niger", "Western Africa", "unknown"),
    "GN": ("Guinea", "Western Africa", "unknown"),
    "GW": ("Guinea-Bissau", "Western Africa", "unknown"),
    "SL": ("Sierra Leone", "Western Africa", "unknown"),
    "LR": ("Liberia", "Western Africa", "unknown"),
    "TG": ("Togo", "Western Africa", "unknown"),
    "BJ": ("Benin", "Western Africa", "unknown"),
    "MR": ("Mauritania", "Western Africa", "unknown"),
    "GM": ("Gambia", "Western Africa", "unknown"),
    "CV": ("Cabo Verde", "Western Africa", "unknown"),
    # -- Oceania -----------------------------------------------------------
    "AU": ("Australia", "Australia and New Zealand", "au"),
    "NZ": ("New Zealand", "Australia and New Zealand", "national"),
    "PG": ("Papua New Guinea", "Melanesia", "unknown"),
    "FJ": ("Fiji", "Melanesia", "national"),
    "SB": ("Solomon Islands", "Melanesia", "unknown"),
    "VU": ("Vanuatu", "Melanesia", "unknown"),
    "NC": ("New Caledonia", "Melanesia", "eurocode"),
    "PF": ("French Polynesia", "Polynesia", "eurocode"),
    "WS": ("Samoa", "Polynesia", "unknown"),
    "TO": ("Tonga", "Polynesia", "unknown"),
    "TV": ("Tuvalu", "Polynesia", "unknown"),
    "KI": ("Kiribati", "Micronesia", "unknown"),
    "FM": ("Micronesia", "Micronesia", "icc-derived"),
    "MH": ("Marshall Islands", "Micronesia", "icc-derived"),
    "PW": ("Palau", "Micronesia", "icc-derived"),
    "NR": ("Nauru", "Micronesia", "unknown"),
    "GU": ("Guam", "Micronesia", "icc"),
    "PR": ("Puerto Rico", "Caribbean", "icc"),
}

# ---------------------------------------------------------------------------
# What the governing document is actually called, where the regime block is
# too general to say. Only countries whose code could be named with
# reasonable confidence appear here; the rest keep the regime's description,
# which says plainly that the document has not been identified.
# ---------------------------------------------------------------------------
OVERRIDES = {
    "ZA": {"codes": ["National Building Regulations and Building Standards Act",
                     "SANS 10400 series"],
           "authority": "Local municipality building control",
           "url": "https://www.sabs.co.za/"},
    "NG": {"codes": ["National Building Code of Nigeria"],
           "authority": "State physical planning authorities"},
    "KE": {"codes": ["Building Code 2024", "Physical and Land Use Planning Act"],
           "authority": "County governments"},
    "EG": {"codes": ["Egyptian Code of Practice (ECP) series",
                     "Unified Building Law 119/2008"],
           "authority": "Housing and Building National Research Center"},
    "MA": {"codes": ["Reglement de Construction Parasismique (RPS 2011)"],
           "authority": "Ministere de l'Amenagement du Territoire"},
    "DZ": {"codes": ["Regles Parasismiques Algeriennes (RPA 99/2003)"],
           "authority": "CGS"},
    "ET": {"codes": ["Ethiopian Building Code Standards (EBCS)"],
           "authority": "Ministry of Urban Development and Construction"},
    "GH": {"codes": ["Ghana Building Code (GS 1207:2018)"],
           "authority": "Metropolitan, municipal and district assemblies"},
    "BR": {"codes": ["ABNT NBR 9050, NBR 15575 and related standards",
                     "Municipal Codigo de Obras"],
           "authority": "Municipal building departments",
           "url": "https://www.abnt.org.br/"},
    "MX": {"codes": ["Reglamento de Construcciones (per municipality)",
                     "Normas Tecnicas Complementarias"],
           "authority": "Municipal building authorities"},
    "CL": {"codes": ["Ordenanza General de Urbanismo y Construcciones (OGUC)"],
           "authority": "Direccion de Obras Municipales"},
    "CO": {"codes": ["NSR-10 Reglamento Colombiano de Construccion Sismo Resistente"],
           "authority": "Curadurias urbanas"},
    "PE": {"codes": ["Reglamento Nacional de Edificaciones (RNE)"],
           "authority": "Municipalidades"},
    "AR": {"codes": ["CIRSOC standards", "Codigo de Edificacion (per municipality)"],
           "authority": "Municipal building departments"},
    "RU": {"codes": ["SP (Svod Pravil) series, successors to SNiP"],
           "authority": "Ministry of Construction (Minstroy)"},
    "UA": {"codes": ["DBN (Derzhavni Budivelni Normy) series"],
           "authority": "Ministry of Communities and Territories Development"},
    "TR": {"codes": ["Turkiye Bina Deprem Yonetmeligi (TBDY 2018)",
                     "Planli Alanlar Imar Yonetmeligi"],
           "authority": "Municipal imar directorates"},
    "IL": {"codes": ["Israeli Standard SI 1205", "Planning and Building Law"],
           "authority": "Local planning and building committees"},
    "JO": {"codes": ["Jordanian National Building Code"],
           "authority": "Jordan Engineers Association"},
    "SA": {"codes": ["Saudi Building Code (SBC 201, 301, 401, 801)"],
           "authority": "Saudi Building Code National Committee",
           "url": "https://sbc.gov.sa/"},
    "AE": {"codes": ["Dubai Building Code", "Abu Dhabi International Building Code"],
           "authority": "Dubai Municipality; Abu Dhabi Department of Municipalities",
           "note": "Each emirate publishes its own code and they differ. "
                   "Resolve to the emirate, not to the country."},
    "QA": {"codes": ["Qatar Construction Specifications (QCS)"],
           "authority": "Ministry of Municipality"},
    "SG": {"codes": ["Building Control Regulations", "SCDF Fire Code",
                     "BCA Approved Documents"],
           "authority": "Building and Construction Authority",
           "url": "https://www1.bca.gov.sg/",
           "note": "Singapore's CORENET X system accepts machine-checkable "
                   "submissions, and is the furthest developed rule-checking "
                   "regime anywhere."},
    "MY": {"codes": ["Uniform Building By-Laws 1984 (UBBL)"],
           "authority": "Local authorities under the Street, Drainage and Building Act"},
    "ID": {"codes": ["SNI standards", "Peraturan Menteri PUPR"],
           "authority": "Dinas Penataan Bangunan (city level)"},
    "TH": {"codes": ["Building Control Act B.E. 2522 and ministerial regulations"],
           "authority": "Department of Public Works and Town and Country Planning"},
    "VN": {"codes": ["QCVN national technical regulations"],
           "authority": "Ministry of Construction"},
    "PH": {"codes": ["National Building Code of the Philippines (PD 1096)"],
           "authority": "Office of the Building Official"},
    "KR": {"codes": ["Building Act and Enforcement Decree"],
           "authority": "Local government building departments"},
    "BD": {"codes": ["Bangladesh National Building Code (BNBC) 2020"],
           "authority": "RAJUK and local authorities"},
    "LK": {"codes": ["UDA Planning and Development Regulations"],
           "authority": "Urban Development Authority"},
    "NP": {"codes": ["Nepal National Building Code (NBC) series"],
           "authority": "Department of Urban Development and Building Construction"},
    "NZ": {"codes": ["New Zealand Building Code (Schedule 1, Building Regulations 1992)"],
           "authority": "Building Consent Authorities",
           "url": "https://www.building.govt.nz/"},
    "HK": {"codes": ["Buildings Ordinance and Practice Notes",
                     "Code of Practice for Fire Safety in Buildings"],
           "authority": "Buildings Department"},
    "TW": {"codes": ["Building Technical Regulations"],
           "authority": "Construction and Planning Agency"},
    "FJ": {"codes": ["Fiji National Building Code"],
           "authority": "Local authorities"},
    "MU": {"codes": ["Building Control Act and Building Control Regulations"],
           "authority": "Local authorities"},
}

# ---------------------------------------------------------------------------
# Subdivisions worth resolving to, because the answer genuinely changes.
# A state that adopts its own edition, an emirate with its own code, a city
# whose development authority sets the setbacks -- these are the places where
# "which country" is not a specific enough question.
# ---------------------------------------------------------------------------
SUBDIVISIONS = {
    "PK": [
        {"slug": "punjab", "name": "Punjab",
         "authority": "Lahore Development Authority; Rawalpindi Development Authority",
         "localities": [
             {"slug": "lahore", "name": "Lahore",
              "authority": "Lahore Development Authority (LDA)",
              "note": "LDA Building and Zoning Regulations set setbacks, "
                      "coverage and height by plot size and by scheme."},
             {"slug": "rawalpindi", "name": "Rawalpindi",
              "authority": "Rawalpindi Development Authority (RDA)"},
             {"slug": "faisalabad", "name": "Faisalabad",
              "authority": "Faisalabad Development Authority (FDA)"},
             {"slug": "multan", "name": "Multan",
              "authority": "Multan Development Authority (MDA)"},
         ]},
        {"slug": "sindh", "name": "Sindh",
         "authority": "Sindh Building Control Authority (SBCA)",
         "localities": [
             {"slug": "karachi", "name": "Karachi",
              "authority": "Sindh Building Control Authority (SBCA)",
              "note": "The Karachi Building and Town Planning Regulations 2002 "
                      "govern, as amended."},
         ]},
        {"slug": "islamabad", "name": "Islamabad Capital Territory",
         "authority": "Capital Development Authority (CDA)",
         "localities": [
             {"slug": "islamabad", "name": "Islamabad",
              "authority": "Capital Development Authority (CDA)",
              "note": "CDA building control regulations differ by sector and "
                      "by plot category."},
         ]},
        {"slug": "kpk", "name": "Khyber Pakhtunkhwa",
         "authority": "Peshawar Development Authority (PDA)"},
        {"slug": "balochistan", "name": "Balochistan",
         "authority": "Quetta Development Authority (QDA)"},
    ],
    "GB": [
        {"slug": "england", "name": "England",
         "authority": "Local authority building control",
         "rule_packs": ["baseline", "uk-approved-documents"]},
        {"slug": "wales", "name": "Wales",
         "authority": "Local authority building control",
         "note": "Wales has diverged from England; the Welsh Approved "
                 "Documents govern."},
        {"slug": "scotland", "name": "Scotland",
         "authority": "Local authority verifiers",
         "rule_packs": ["baseline"],
         "note": "Scotland uses the Building (Scotland) Regulations and "
                 "Technical Handbooks, not the Approved Documents. The "
                 "England pack does not apply."},
        {"slug": "northern-ireland", "name": "Northern Ireland",
         "authority": "District council building control",
         "rule_packs": ["baseline"],
         "note": "Northern Ireland uses its own Technical Booklets."},
    ],
    "AE": [
        {"slug": "dubai", "name": "Dubai", "authority": "Dubai Municipality",
         "note": "The Dubai Building Code governs."},
        {"slug": "abu-dhabi", "name": "Abu Dhabi",
         "authority": "Department of Municipalities and Transport",
         "note": "Abu Dhabi has adopted an IBC-based code set."},
        {"slug": "sharjah", "name": "Sharjah",
         "authority": "Sharjah Municipality"},
    ],
    "IN": [
        {"slug": "maharashtra", "name": "Maharashtra",
         "authority": "Urban Development Department",
         "localities": [{"slug": "mumbai", "name": "Mumbai",
                         "authority": "Municipal Corporation of Greater Mumbai",
                         "note": "The Development Control and Promotion "
                                 "Regulations 2034 govern FSI and setbacks."}]},
        {"slug": "delhi", "name": "Delhi",
         "authority": "Delhi Development Authority",
         "localities": [{"slug": "new-delhi", "name": "New Delhi",
                         "authority": "Delhi Development Authority",
                         "note": "The Master Plan for Delhi and the Unified "
                                 "Building Bye-Laws 2016 govern."}]},
        {"slug": "karnataka", "name": "Karnataka",
         "authority": "Bruhat Bengaluru Mahanagara Palike",
         "localities": [{"slug": "bengaluru", "name": "Bengaluru",
                         "authority": "BBMP / BDA"}]},
        {"slug": "tamil-nadu", "name": "Tamil Nadu",
         "authority": "Directorate of Town and Country Planning"},
    ],
    "US": [
        {"slug": "california", "name": "California",
         "authority": "California Building Standards Commission",
         "note": "Title 24 is the California Building Standards Code, an "
                 "amended IBC/IRC. Local jurisdictions amend it further."},
        {"slug": "texas", "name": "Texas",
         "authority": "Municipal building departments",
         "note": "Adoption is by municipality; there is no statewide "
                 "commercial code for all building types."},
        {"slug": "florida", "name": "Florida",
         "authority": "Florida Building Commission",
         "note": "The Florida Building Code carries wind-borne debris and "
                 "high-velocity hurricane zone provisions the IBC does not."},
        {"slug": "new-york", "name": "New York",
         "authority": "NYS Division of Building Standards and Codes",
         "note": "New York City has its own Construction Codes, separate "
                 "from the state code."},
    ],
    "CA": [
        {"slug": "ontario", "name": "Ontario",
         "authority": "Ministry of Municipal Affairs and Housing",
         "note": "The Ontario Building Code governs, not the NBC directly."},
        {"slug": "british-columbia", "name": "British Columbia",
         "authority": "BC Building and Safety Standards Branch"},
        {"slug": "quebec", "name": "Quebec",
         "authority": "Regie du batiment du Quebec"},
        {"slug": "alberta", "name": "Alberta",
         "authority": "Alberta Municipal Affairs"},
    ],
    "AU": [
        {"slug": "nsw", "name": "New South Wales",
         "authority": "NSW Department of Planning, Housing and Infrastructure; "
                      "council or private certifier",
         "rule_packs": ["baseline", "au-ncc-housing", "au-ncc-vol1", "au-nsw-codes-sepp"],
         "note": "New South Wales did not adopt the NCC 2022 livable housing "
                 "provisions on the national timetable, so that pack is not "
                 "applied here. Apartment (Class 2) work is also governed by "
                 "the Apartment Design Guide under SEPP 65, which sets room "
                 "sizes and solar access the NCC does not -- and which is not "
                 "encoded."},
        {"slug": "victoria", "name": "Victoria",
         "rule_packs": ["baseline", "au-ncc-housing", "au-ncc-livable", "au-ncc-vol1", "au-vic-rescode"],
         "authority": "Victorian Building Authority; municipal building surveyor",
         "note": "Victoria adopted the livable housing provisions. ResCode "
                 "(Clauses 54 and 55 of the planning scheme) sets setbacks, "
                 "site coverage, overlooking and overshadowing, none of which "
                 "are in the NCC or encoded here."},
        {"slug": "queensland", "name": "Queensland",
         "rule_packs": ["baseline", "au-ncc-housing", "au-ncc-livable", "au-ncc-vol1", "au-qld-qdc"],
         "authority": "Queensland Building and Construction Commission; "
                      "building certifier",
         "note": "Much of Queensland is in a cyclonic wind region, and the "
                 "Queensland Development Code adds state variations. Neither "
                 "is encoded."},
        {"slug": "wa", "name": "Western Australia",
         "authority": "WA Building and Energy; permit authority",
         "rule_packs": ["baseline", "au-ncc-housing", "au-ncc-vol1", "au-wa-rcodes"],
         "note": "Western Australia deferred the livable housing provisions, "
                 "so that pack is not applied here. The R-Codes set setbacks, "
                 "site coverage and open space, and are not encoded."},
        {"slug": "sa", "name": "South Australia",
         "authority": "SA Office of the Technical Regulator; relevant authority",
         "note": "No South Australian planning pack is encoded. Setbacks and "
                 "site cover come from the Planning and Design Code, which "
                 "governs and must be checked directly."},
        {"slug": "tasmania", "name": "Tasmania",
         "authority": "Tasmanian Consumer, Building and Occupational Services"},
        {"slug": "act", "name": "Australian Capital Territory",
         "authority": "ACT Access Canberra"},
        {"slug": "nt", "name": "Northern Territory",
         "authority": "NT Building Advisory Services",
         "note": "Cyclonic wind region. NT variations are not encoded."},
    ],
}


# ---------------------------------------------------------------------------
# Major cities, so that naming one resolves at least to its country.
# This is a geographic fact, not a claim about codes: a city here that has no
# entry in SUBDIVISIONS resolves to the country and says plainly that the
# local authority has not been identified. That is far more useful than
# refusing to recognise the place at all.
# ---------------------------------------------------------------------------
CITY_ALIASES = {
    "nairobi": "KE", "mombasa": "KE", "lagos": "NG", "abuja": "NG", "kano": "NG",
    "accra": "GH", "kumasi": "GH", "addis ababa": "ET", "dar es salaam": "TZ",
    "kampala": "UG", "kigali": "RW", "lusaka": "ZM", "harare": "ZW",
    "johannesburg": "ZA", "cape town": "ZA", "durban": "ZA", "pretoria": "ZA",
    "gaborone": "BW", "windhoek": "NA", "maputo": "MZ", "luanda": "AO",
    "kinshasa": "CD", "abidjan": "CI", "dakar": "SN", "bamako": "ML",
    "casablanca": "MA", "rabat": "MA", "marrakesh": "MA", "algiers": "DZ",
    "tunis": "TN", "tripoli": "LY", "cairo": "EG", "alexandria": "EG",
    "khartoum": "SD", "antananarivo": "MG", "port louis": "MU",
    "riyadh": "SA", "jeddah": "SA", "mecca": "SA", "medina": "SA", "dammam": "SA",
    "doha": "QA", "kuwait city": "KW", "manama": "BH", "muscat": "OM",
    "amman": "JO", "beirut": "LB", "damascus": "SY", "baghdad": "IQ",
    "basra": "IQ", "erbil": "IQ", "tehran": "IR", "isfahan": "IR", "mashhad": "IR",
    "tel aviv": "IL", "jerusalem": "IL", "haifa": "IL", "gaza": "PS", "ramallah": "PS",
    "istanbul": "TR", "ankara": "TR", "izmir": "TR", "antalya": "TR",
    "baku": "AZ", "tbilisi": "GE", "yerevan": "AM",
    "almaty": "KZ", "astana": "KZ", "tashkent": "UZ", "bishkek": "KG", "dushanbe": "TJ",
    "kabul": "AF", "peshawar": "PK", "quetta": "PK", "hyderabad sindh": "PK",
    "gujranwala": "PK", "sialkot": "PK", "sargodha": "PK", "bahawalpur": "PK",
    "dhaka": "BD", "chittagong": "BD", "colombo": "LK", "kathmandu": "NP",
    "thimphu": "BT", "male": "MV",
    "kolkata": "IN", "chennai": "IN", "hyderabad": "IN", "pune": "IN",
    "ahmedabad": "IN", "jaipur": "IN", "lucknow": "IN", "surat": "IN",
    "beijing": "CN", "shanghai": "CN", "guangzhou": "CN", "shenzhen": "CN",
    "chengdu": "CN", "wuhan": "CN", "tianjin": "CN", "chongqing": "CN",
    "tokyo": "JP", "osaka": "JP", "kyoto": "JP", "yokohama": "JP", "nagoya": "JP",
    "seoul": "KR", "busan": "KR", "incheon": "KR",
    "taipei": "TW", "kaohsiung": "TW", "ulaanbaatar": "MN",
    "bangkok": "TH", "chiang mai": "TH", "hanoi": "VN", "ho chi minh city": "VN",
    "saigon": "VN", "jakarta": "ID", "surabaya": "ID", "bandung": "ID", "bali": "ID",
    "kuala lumpur": "MY", "penang": "MY", "johor bahru": "MY",
    "manila": "PH", "quezon city": "PH", "cebu": "PH",
    "yangon": "MM", "phnom penh": "KH", "vientiane": "LA",
    "london": "GB", "manchester": "GB", "birmingham": "GB", "leeds": "GB",
    "bristol": "GB", "liverpool": "GB",
    "dublin": "IE", "cork": "IE",
    "paris": "FR", "marseille": "FR", "lyon": "FR", "toulouse": "FR", "nice": "FR",
    "berlin": "DE", "munich": "DE", "hamburg": "DE", "frankfurt": "DE",
    "cologne": "DE", "stuttgart": "DE",
    "amsterdam": "NL", "rotterdam": "NL", "the hague": "NL", "utrecht": "NL",
    "brussels": "BE", "antwerp": "BE", "ghent": "BE",
    "vienna": "AT", "salzburg": "AT", "graz": "AT",
    "zurich": "CH", "geneva": "CH", "basel": "CH", "bern": "CH",
    "madrid": "ES", "barcelona": "ES", "valencia": "ES", "seville": "ES",
    "lisbon": "PT", "porto": "PT",
    "rome": "IT", "milan": "IT", "naples": "IT", "turin": "IT", "florence": "IT",
    "venice": "IT", "athens": "GR", "thessaloniki": "GR",
    "copenhagen": "DK", "aarhus": "DK", "stockholm": "SE", "gothenburg": "SE",
    "oslo": "NO", "bergen": "NO", "helsinki": "FI", "reykjavik": "IS",
    "tallinn": "EE", "riga": "LV", "vilnius": "LT",
    "warsaw": "PL", "krakow": "PL", "gdansk": "PL", "wroclaw": "PL",
    "prague": "CZ", "brno": "CZ", "bratislava": "SK",
    "budapest": "HU", "bucharest": "RO", "sofia": "BG",
    "zagreb": "HR", "ljubljana": "SI", "belgrade": "RS", "sarajevo": "BA",
    "skopje": "MK", "tirana": "AL", "podgorica": "ME", "pristina": "XK",
    "kyiv": "UA", "kiev": "UA", "lviv": "UA", "odesa": "UA", "chisinau": "MD",
    "minsk": "BY", "moscow": "RU", "saint petersburg": "RU", "novosibirsk": "RU",
    "chicago": "US", "houston": "US", "phoenix": "US", "philadelphia": "US",
    "san antonio": "US", "san diego": "US", "dallas": "US", "austin": "US",
    "seattle": "US", "denver": "US", "boston": "US", "atlanta": "US",
    "miami": "US", "las vegas": "US", "portland": "US", "detroit": "US",
    "toronto": "CA", "vancouver": "CA", "montreal": "CA", "calgary": "CA",
    "ottawa": "CA", "edmonton": "CA",
    "mexico city": "MX", "guadalajara": "MX", "monterrey": "MX", "cancun": "MX",
    "guatemala city": "GT", "san salvador": "SV", "tegucigalpa": "HN",
    "managua": "NI", "san jose": "CR", "panama city": "PA",
    "havana": "CU", "santo domingo": "DO", "kingston": "JM",
    "port of spain": "TT", "nassau": "BS", "bridgetown": "BB",
    "sao paulo": "BR", "rio de janeiro": "BR", "brasilia": "BR",
    "salvador": "BR", "fortaleza": "BR", "belo horizonte": "BR", "recife": "BR",
    "buenos aires": "AR", "cordoba": "AR", "rosario": "AR",
    "santiago": "CL", "valparaiso": "CL",
    "bogota": "CO", "medellin": "CO", "cali": "CO", "cartagena": "CO",
    "lima": "PE", "arequipa": "PE", "cusco": "PE",
    "quito": "EC", "guayaquil": "EC", "caracas": "VE",
    "la paz": "BO", "santa cruz": "BO", "montevideo": "UY", "asuncion": "PY",
    "sydney": "AU:nsw", "melbourne": "AU:victoria", "brisbane": "AU:queensland", "perth": "AU:wa",
    "adelaide": "AU:sa", "canberra": "AU:act", "hobart": "AU:tasmania", "darwin": "AU:nt",
    "auckland": "NZ", "wellington": "NZ", "christchurch": "NZ",
    "suva": "FJ", "port moresby": "PG", "honolulu": "US",
}


def build() -> dict:
    """Assemble the registry, resolving overrides onto their regimes."""
    countries: dict[str, dict] = {}
    for iso, (name, region, regime_key) in sorted(COUNTRIES.items()):
        regime = REGIMES[regime_key]
        entry: dict = {
            "name": name,
            "region": region,
            "regime": regime_key,
            "codes": list(regime.get("codes", ())),
            "rule_packs": list(regime["rule_packs"]),
            "confidence": regime["confidence"],
        }
        if "authority" in regime:
            entry["authority"] = regime["authority"]
        if "url" in regime:
            entry["url"] = regime["url"]
        entry.update(OVERRIDES.get(iso, {}))
        if iso in OVERRIDES and "codes" in OVERRIDES[iso]:
            # A named national code is a firmer footing than a regime default,
            # but naming the document is not the same as encoding its rules.
            entry["confidence"] = max(entry["confidence"], "medium", key=_rank)
        subs = SUBDIVISIONS.get(iso)
        if subs:
            entry["subdivisions"] = subs
        countries[iso] = entry

    unknown = sorted(
        {target.split(":")[0] for target in CITY_ALIASES.values()
         if target.split(":")[0] not in countries}
    )
    if unknown:
        raise SystemExit(f"city aliases name countries not in the registry: {unknown}")

    return {
        "city_aliases": CITY_ALIASES,
        "$comment": (
            "Which code governs where, and how much of it codraft can check. "
            "A country listed here is NOT a claim that its code is encoded -- "
            "read rule_packs and confidence. Nothing in this file is legal "
            "advice, and no entry substitutes for the authority having "
            "jurisdiction."
        ),
        "version": 1,
        "regimes": REGIMES,
        "countries": countries,
    }


_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}


def _rank(level: str) -> int:
    return _ORDER.get(level, 0)


if __name__ == "__main__":
    out = pathlib.Path(__file__).parent / "registry" / "countries.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n")
    data = build()
    packs = sum(1 for c in data["countries"].values() if len(c["rule_packs"]) > 1)
    print(f"{out}: {len(data['countries'])} countries, "
          f"{len(data['regimes'])} regimes, "
          f"{packs} with a rule pack beyond the baseline")
