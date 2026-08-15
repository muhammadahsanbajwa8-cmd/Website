/**
 * Principal national public holidays for the rest of the world.
 *
 * This is deliberately a different thing from `lib/fallback.mjs`. Those eight
 * countries have full statutory rule sets, including each country's own
 * weekend-observance law. What follows is the *core* set: the national holidays
 * a country observes everywhere, written as rules rather than dates.
 *
 * Read the limits before trusting a number:
 *   - It is not a complete list. Regional, religious-minority and sector
 *     holidays are missing, so working-day counts derived from it are an upper
 *     bound — the true figure is usually lower.
 *   - Islamic dates are computed from the arithmetic calendar and are marked
 *     as estimates: the observed date depends on the moon sighting and can move
 *     a day either way.
 *   - Holidays set by lunisolar calendars that this codebase does not
 *     implement — Chinese New Year, Tet, Diwali, Vesak, the Hebrew calendar,
 *     the Bikram Sambat and Ethiopian calendars — are simply absent.
 *
 * Live API data always wins over anything here; this is what the site falls
 * back to when the network or the upstream source is unavailable.
 *
 * Notation, one line per country:
 *   `3-21`      fixed date, March 21
 *   `E+1`       days from Gregorian Easter Sunday
 *   `O-2`       days from Orthodox Easter Sunday
 *   `H10-1*3`   Hijri month 10 day 1, running 3 days (estimated)
 *   `N3.1-1`    third Monday in January; a negative count is from the end
 */

const TABLE = `
# --- Africa ---------------------------------------------------------------
AO 1-1 New Year's Day|2-4 Liberation Day|4-4 Peace Day|5-1 Labour Day|11-11 Independence Day|12-25 Christmas Day
BJ 1-1 New Year's Day|5-1 Labour Day|8-1 Independence Day|8-15 Assumption|11-1 All Saints' Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
BW 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|7-1 Sir Seretse Khama Day|9-30 Botswana Day|12-25 Christmas Day|12-26 Boxing Day
BF 1-1 New Year's Day|1-3 Revolution Day|5-1 Labour Day|8-5 Independence Day|12-11 Proclamation of the Republic|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
BI 1-1 New Year's Day|2-5 Unity Day|5-1 Labour Day|7-1 Independence Day|8-15 Assumption|12-25 Christmas Day
CV 1-1 New Year's Day|1-20 Heroes' Day|5-1 Labour Day|7-5 Independence Day|8-15 Assumption|12-25 Christmas Day
CM 1-1 New Year's Day|2-11 Youth Day|5-1 Labour Day|5-20 National Day|8-15 Assumption|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
CF 1-1 New Year's Day|3-29 Boganda Day|5-1 Labour Day|8-13 Independence Day|12-1 Republic Day|12-25 Christmas Day
TD 1-1 New Year's Day|5-1 Labour Day|8-11 Independence Day|11-28 Republic Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
KM 1-1 New Year's Day|7-6 Independence Day|11-27 Maore Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|H3-12 Prophet's Birthday
CD 1-1 New Year's Day|1-4 Martyrs' Day|1-16 Laurent-Désiré Kabila Day|5-1 Labour Day|6-30 Independence Day|12-25 Christmas Day
CG 1-1 New Year's Day|5-1 Labour Day|6-10 Reconciliation Day|8-15 Independence Day|12-25 Christmas Day
CI 1-1 New Year's Day|5-1 Labour Day|8-7 Independence Day|8-15 Assumption|11-1 All Saints' Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
DJ 1-1 New Year's Day|5-1 Labour Day|6-27 Independence Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
EG 1-1 New Year's Day|1-25 Revolution Day|4-25 Sinai Liberation Day|5-1 Labour Day|6-30 Revolution Day|7-23 Revolution Day|10-6 Armed Forces Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
GQ 1-1 New Year's Day|5-1 Labour Day|6-5 President's Day|8-15 Constitution Day|10-12 Independence Day|12-25 Christmas Day
ER 1-1 New Year's Day|3-8 International Women's Day|5-1 Labour Day|5-24 Independence Day|6-20 Martyrs' Day|9-1 Start of the Armed Struggle|12-25 Christmas Day
SZ 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|4-19 King's Birthday|4-25 National Flag Day|5-1 Labour Day|7-22 Birthday of King Sobhuza II|9-6 Independence Day|12-25 Christmas Day|12-26 Boxing Day
ET 1-7 Ethiopian Christmas|3-2 Adwa Victory Day|5-1 Labour Day|5-5 Patriots' Victory Day|5-28 Downfall of the Derg|9-11 Ethiopian New Year|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|H3-12 Prophet's Birthday
GA 1-1 New Year's Day|5-1 Labour Day|8-16 Independence Day|8-17 Independence Day|12-25 Christmas Day
GM 1-1 New Year's Day|2-18 Independence Day|5-1 Labour Day|7-22 Revolution Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|H3-12 Prophet's Birthday
GH 1-1 New Year's Day|1-7 Constitution Day|3-6 Independence Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|8-4 Founders' Day|9-21 Kwame Nkrumah Memorial Day|12-25 Christmas Day|12-26 Boxing Day
GN 1-1 New Year's Day|4-3 Second Republic Day|5-1 Labour Day|10-2 Independence Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
GW 1-1 New Year's Day|1-20 Death of Amílcar Cabral|5-1 Labour Day|9-24 Independence Day|12-25 Christmas Day
KE 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|6-1 Madaraka Day|10-20 Mashujaa Day|12-12 Jamhuri Day|12-25 Christmas Day|12-26 Boxing Day|H10-1 Eid al-Fitr
LS 1-1 New Year's Day|3-11 Moshoeshoe Day|E-2 Good Friday|E+1 Easter Monday|5-1 Workers' Day|5-25 Africa Day|7-17 King's Birthday|10-4 Independence Day|12-25 Christmas Day|12-26 Boxing Day
LR 1-1 New Year's Day|3-15 J. J. Roberts Day|7-26 Independence Day|11-29 President Tubman's Birthday|12-25 Christmas Day
LY 2-17 Revolution Day|5-1 Labour Day|10-23 Liberation Day|12-24 Independence Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
MG 1-1 New Year's Day|3-29 Martyrs' Day|E+1 Easter Monday|5-1 Labour Day|6-26 Independence Day|8-15 Assumption|11-1 All Saints' Day|12-25 Christmas Day
MW 1-1 New Year's Day|1-15 John Chilembwe Day|3-3 Martyrs' Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|7-6 Independence Day|12-25 Christmas Day|12-26 Boxing Day
ML 1-1 New Year's Day|1-20 Army Day|5-1 Labour Day|9-22 Independence Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|H3-12 Prophet's Birthday
MR 1-1 New Year's Day|5-1 Labour Day|11-28 Independence Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
MU 1-1 New Year's Day|2-1 Abolition of Slavery|3-12 Independence Day|5-1 Labour Day|11-2 Arrival of Indentured Labourers|12-25 Christmas Day|H10-1 Eid al-Fitr
MA 1-1 New Year's Day|1-11 Proclamation of Independence|5-1 Labour Day|7-30 Throne Day|8-14 Oued Ed-Dahab Day|8-20 Revolution Day|8-21 Youth Day|11-6 Green March|11-18 Independence Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
MZ 1-1 New Year's Day|2-3 Heroes' Day|4-7 Women's Day|5-1 Labour Day|6-25 Independence Day|9-7 Victory Day|9-25 Armed Forces Day|12-25 Family Day
NA 1-1 New Year's Day|3-21 Independence Day|E-2 Good Friday|E+1 Easter Monday|5-1 Workers' Day|5-4 Cassinga Day|5-25 Africa Day|8-26 Heroes' Day|12-10 Human Rights Day|12-25 Christmas Day|12-26 Family Day
NE 1-1 New Year's Day|4-24 Concord Day|5-1 Labour Day|8-3 Independence Day|12-18 Republic Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
NG 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Workers' Day|6-12 Democracy Day|10-1 Independence Day|12-25 Christmas Day|12-26 Boxing Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha|H3-12 Prophet's Birthday
RW 1-1 New Year's Day|2-1 National Heroes' Day|4-7 Genocide Memorial Day|5-1 Labour Day|7-1 Independence Day|7-4 Liberation Day|8-15 Assumption|12-25 Christmas Day
ST 1-1 New Year's Day|5-1 Labour Day|7-12 Independence Day|9-30 Agricultural Reform Day|12-25 Christmas Day
SN 1-1 New Year's Day|4-4 Independence Day|E+1 Easter Monday|5-1 Labour Day|8-15 Assumption|11-1 All Saints' Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|H3-12 Prophet's Birthday
SC 1-1 New Year's Day|E-2 Good Friday|5-1 Labour Day|6-18 Constitution Day|6-29 Independence Day|8-15 Assumption|11-1 All Saints' Day|12-25 Christmas Day
SL 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|4-27 Independence Day|5-1 Labour Day|12-25 Christmas Day|12-26 Boxing Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
SO 5-1 Labour Day|6-26 Independence Day|7-1 Republic Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
ZA 1-1 New Year's Day|3-21 Human Rights Day|E-2 Good Friday|E+1 Family Day|4-27 Freedom Day|5-1 Workers' Day|6-16 Youth Day|8-9 National Women's Day|9-24 Heritage Day|12-16 Day of Reconciliation|12-25 Christmas Day|12-26 Day of Goodwill
SS 1-1 New Year's Day|5-1 Labour Day|7-9 Independence Day|7-30 Martyrs' Day|12-25 Christmas Day
SD 5-1 Labour Day|12-19 Revolution Day|H10-1*3 Eid al-Fitr|H12-10*3 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
TZ 1-1 New Year's Day|1-12 Zanzibar Revolution Day|E-2 Good Friday|E+1 Easter Monday|4-7 Karume Day|4-26 Union Day|5-1 Workers' Day|7-7 Saba Saba|8-8 Nane Nane|10-14 Nyerere Day|12-9 Independence Day|12-25 Christmas Day|12-26 Boxing Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
TG 1-1 New Year's Day|1-13 Liberation Day|4-27 Independence Day|5-1 Labour Day|6-21 Martyrs' Day|8-15 Assumption|11-1 All Saints' Day|12-25 Christmas Day
TN 1-1 New Year's Day|1-14 Revolution Day|3-20 Independence Day|4-9 Martyrs' Day|5-1 Labour Day|7-25 Republic Day|8-13 Women's Day|10-15 Evacuation Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
UG 1-1 New Year's Day|1-26 Liberation Day|3-8 Women's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|6-3 Martyrs' Day|6-9 National Heroes' Day|10-9 Independence Day|12-25 Christmas Day|12-26 Boxing Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
ZM 1-1 New Year's Day|3-8 Youth Day|E-2 Good Friday|5-1 Labour Day|5-25 Africa Freedom Day|7-6 Heroes' Day|8-3 Farmers' Day|10-24 Independence Day|12-25 Christmas Day
ZW 1-1 New Year's Day|2-21 Youth Day|E-2 Good Friday|E+1 Easter Monday|4-18 Independence Day|5-1 Workers' Day|5-25 Africa Day|8-11 Heroes' Day|8-12 Defence Forces Day|12-22 Unity Day|12-25 Christmas Day|12-26 Boxing Day

# --- Americas -------------------------------------------------------------
AG 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|11-1 Independence Day|12-25 Christmas Day|12-26 Boxing Day
AR 1-1 New Year's Day|3-24 Day of Remembrance|4-2 Malvinas Day|E-2 Good Friday|5-1 Labour Day|5-25 May Revolution|6-20 Flag Day|7-9 Independence Day|12-8 Immaculate Conception|12-25 Christmas Day
BS 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|7-10 Independence Day|10-12 National Heroes' Day|12-25 Christmas Day|12-26 Boxing Day
BB 1-1 New Year's Day|1-21 Errol Barrow Day|E-2 Good Friday|E+1 Easter Monday|4-28 National Heroes' Day|5-1 May Day|8-1 Emancipation Day|11-30 Independence Day|12-25 Christmas Day|12-26 Boxing Day
BZ 1-1 New Year's Day|3-9 National Heroes' Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|9-10 Saint George's Caye Day|9-21 Independence Day|10-12 Indigenous Peoples' Day|11-19 Garifuna Settlement Day|12-25 Christmas Day|12-26 Boxing Day
BO 1-1 New Year's Day|1-22 Plurinational State Day|5-1 Labour Day|8-6 Independence Day|11-2 All Souls' Day|12-25 Christmas Day
BR 1-1 New Year's Day|E-2 Good Friday|4-21 Tiradentes|5-1 Labour Day|9-7 Independence Day|10-12 Our Lady of Aparecida|11-2 All Souls' Day|11-15 Republic Day|11-20 Black Awareness Day|12-25 Christmas Day
CL 1-1 New Year's Day|E-2 Good Friday|5-1 Labour Day|5-21 Navy Day|6-29 Saints Peter and Paul|7-16 Our Lady of Mount Carmel|8-15 Assumption|9-18 Independence Day|9-19 Army Day|10-12 Columbus Day|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day
CO 1-1 New Year's Day|5-1 Labour Day|7-20 Independence Day|8-7 Battle of Boyacá|12-8 Immaculate Conception|12-25 Christmas Day
CR 1-1 New Year's Day|4-11 Juan Santamaría Day|E-4 Maundy Thursday|E-2 Good Friday|5-1 Labour Day|7-25 Annexation of Guanacaste|8-2 Our Lady of the Angels|8-15 Mother's Day|9-15 Independence Day|12-25 Christmas Day
CU 1-1 Liberation Day|1-2 Victory Day|5-1 Labour Day|7-25 Revolution Day|7-26 Revolution Day|7-27 Revolution Day|10-10 Independence Day|12-25 Christmas Day
DM 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|11-3 Independence Day|12-25 Christmas Day|12-26 Boxing Day
DO 1-1 New Year's Day|1-21 Our Lady of Altagracia|1-26 Juan Pablo Duarte Day|2-27 Independence Day|E-2 Good Friday|5-1 Labour Day|8-16 Restoration Day|9-24 Our Lady of Mercedes|12-25 Christmas Day
EC 1-1 New Year's Day|5-1 Labour Day|5-24 Battle of Pichincha|8-10 Independence Day|10-9 Independence of Guayaquil|11-2 All Souls' Day|11-3 Independence of Cuenca|12-25 Christmas Day
SV 1-1 New Year's Day|E-4 Maundy Thursday|E-2 Good Friday|5-1 Labour Day|5-10 Mother's Day|8-6 August Festivals|9-15 Independence Day|11-2 All Souls' Day|12-25 Christmas Day
GD 1-1 New Year's Day|2-7 Independence Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|8-1 Emancipation Day|10-25 Thanksgiving Day|12-25 Christmas Day|12-26 Boxing Day
GT 1-1 New Year's Day|E-4 Maundy Thursday|E-2 Good Friday|5-1 Labour Day|6-30 Army Day|9-15 Independence Day|10-20 Revolution Day|11-1 All Saints' Day|12-25 Christmas Day
GY 1-1 New Year's Day|2-23 Republic Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|5-26 Independence Day|8-1 Emancipation Day|12-25 Christmas Day|12-26 Boxing Day
HT 1-1 Independence Day|1-2 Ancestors' Day|5-1 Labour Day|5-18 Flag Day|11-18 Battle of Vertières|12-25 Christmas Day
HN 1-1 New Year's Day|E-4 Maundy Thursday|E-2 Good Friday|4-14 Americas Day|5-1 Labour Day|9-15 Independence Day|10-3 Morazán Day|12-25 Christmas Day
JM 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-23 Labour Day|8-1 Emancipation Day|8-6 Independence Day|10-20 National Heroes' Day|12-25 Christmas Day|12-26 Boxing Day
MX 1-1 New Year's Day|N1.1-2 Constitution Day|N3.1-3 Benito Juárez Day|5-1 Labour Day|9-16 Independence Day|N3.1-11 Revolution Day|12-25 Christmas Day
NI 1-1 New Year's Day|E-4 Maundy Thursday|E-2 Good Friday|5-1 Labour Day|7-19 Revolution Day|9-14 Battle of San Jacinto|9-15 Independence Day|12-8 Immaculate Conception|12-25 Christmas Day
PA 1-1 New Year's Day|1-9 Martyrs' Day|5-1 Labour Day|11-3 Separation Day|11-5 Colón Day|11-10 First Cry of Independence|11-28 Independence from Spain|12-8 Mothers' Day|12-25 Christmas Day
PY 1-1 New Year's Day|3-1 Heroes' Day|E-4 Maundy Thursday|E-2 Good Friday|5-1 Labour Day|5-14 Independence Day|5-15 Independence Day|6-12 Chaco Armistice|8-15 Founding of Asunción|12-8 Virgin of Caacupé|12-25 Christmas Day
PE 1-1 New Year's Day|E-4 Maundy Thursday|E-2 Good Friday|5-1 Labour Day|6-29 Saints Peter and Paul|7-28 Independence Day|7-29 Independence Day|8-30 Santa Rosa de Lima|10-8 Battle of Angamos|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day
KN 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|9-19 Independence Day|12-25 Christmas Day|12-26 Boxing Day
LC 1-1 New Year's Day|2-22 Independence Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|8-1 Emancipation Day|12-13 National Day|12-25 Christmas Day|12-26 Boxing Day
VC 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|8-1 Emancipation Day|10-27 Independence Day|12-25 Christmas Day|12-26 Boxing Day
SR 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|7-1 Emancipation Day|11-25 Independence Day|12-25 Christmas Day|12-26 Boxing Day
TT 1-1 New Year's Day|3-30 Spiritual Baptist Liberation Day|E-2 Good Friday|E+1 Easter Monday|6-19 Labour Day|8-1 Emancipation Day|8-31 Independence Day|9-24 Republic Day|12-25 Christmas Day|12-26 Boxing Day|H10-1 Eid al-Fitr
UY 1-1 New Year's Day|5-1 Labour Day|7-18 Constitution Day|8-25 Independence Day|12-25 Christmas Day
VE 1-1 New Year's Day|E-2 Good Friday|4-19 Declaration of Independence|5-1 Labour Day|6-24 Battle of Carabobo|7-5 Independence Day|7-24 Bolívar's Birthday|10-12 Indigenous Resistance Day|12-25 Christmas Day

# --- Asia -----------------------------------------------------------------
AF 3-21 Nowruz|4-28 Victory Day|5-1 Labour Day|8-19 Independence Day|H10-1*3 Eid al-Fitr|H12-10*3 Eid al-Adha|H1-10 Ashura|H3-12 Prophet's Birthday
AM 1-1 New Year's Day|1-2 New Year Holiday|1-6 Christmas Day|4-24 Genocide Remembrance Day|5-1 Labour Day|5-9 Victory Day|5-28 Republic Day|7-5 Constitution Day|9-21 Independence Day
AZ 1-1 New Year's Day|1-20 Martyrs' Day|3-8 Women's Day|3-20 Nowruz|3-21 Nowruz|5-28 Independence Day|6-15 National Salvation Day|11-8 Victory Day|11-9 Flag Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha
BH 1-1 New Year's Day|5-1 Labour Day|12-16 National Day|12-17 National Day|H10-1*3 Eid al-Fitr|H12-10*3 Eid al-Adha|H1-1 Islamic New Year|H1-10 Ashura
BD 2-21 Language Martyrs' Day|3-17 Sheikh Mujib's Birthday|3-26 Independence Day|4-14 Bengali New Year|5-1 May Day|8-15 National Mourning Day|12-16 Victory Day|12-25 Christmas Day|H10-1*3 Eid al-Fitr|H12-10*3 Eid al-Adha|H1-10 Ashura|H3-12 Prophet's Birthday
BT 5-2 Birth Anniversary of the Third King|11-11 Birth Anniversary of the Fourth King|12-17 National Day
BN 1-1 New Year's Day|2-23 National Day|5-31 Armed Forces Day|7-15 Sultan's Birthday|12-25 Christmas Day|H10-1*2 Eid al-Fitr|H12-10 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
KH 1-1 New Year's Day|1-7 Victory over Genocide Day|3-8 Women's Day|4-14 Khmer New Year|4-15 Khmer New Year|4-16 Khmer New Year|5-1 Labour Day|5-14 King's Birthday|9-24 Constitution Day|10-15 King Father Commemoration Day|10-29 King's Coronation Day|11-9 Independence Day
CN 1-1 New Year's Day|5-1 Labour Day|10-1 National Day|10-2 National Day|10-3 National Day
CY 1-1 New Year's Day|1-6 Epiphany|3-25 Greek Independence Day|4-1 Cyprus National Day|O-2 Good Friday|O+1 Easter Monday|5-1 Labour Day|8-15 Assumption|10-1 Independence Day|10-28 Ohi Day|12-25 Christmas Day|12-26 Boxing Day
GE 1-1 New Year's Day|1-7 Orthodox Christmas|1-19 Epiphany|3-3 Mother's Day|3-8 Women's Day|4-9 National Unity Day|5-9 Victory Day|5-12 Saint Andrew's Day|5-26 Independence Day|8-28 Assumption|10-14 Svetitskhovloba|11-23 Saint George's Day
ID 1-1 New Year's Day|5-1 Labour Day|6-1 Pancasila Day|8-17 Independence Day|12-25 Christmas Day|H10-1*2 Eid al-Fitr|H12-10 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday|H7-27 Isra and Miraj
IR 2-11 Revolution Day|3-20 Nowruz|3-21 Nowruz|3-22 Nowruz|3-23 Nowruz|4-1 Islamic Republic Day|4-2 Nature Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|H1-9 Tasua|H1-10 Ashura
IQ 1-1 New Year's Day|1-6 Army Day|5-1 Labour Day|7-14 Republic Day|10-3 Independence Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H1-10 Ashura|H3-12 Prophet's Birthday
JP 1-1 New Year's Day|N2.1-1 Coming of Age Day|2-11 National Foundation Day|2-23 Emperor's Birthday|4-29 Shōwa Day|5-3 Constitution Memorial Day|5-4 Greenery Day|5-5 Children's Day|N3.1-7 Marine Day|8-11 Mountain Day|N3.1-9 Respect for the Aged Day|N2.1-10 Sports Day|11-3 Culture Day|11-23 Labour Thanksgiving Day
JO 1-1 New Year's Day|5-1 Labour Day|5-25 Independence Day|12-25 Christmas Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
KZ 1-1 New Year's Day|1-2 New Year Holiday|1-7 Orthodox Christmas|3-8 Women's Day|3-21 Nauryz|3-22 Nauryz|3-23 Nauryz|5-1 Unity Day|5-7 Defender of the Fatherland Day|5-9 Victory Day|7-6 Capital City Day|8-30 Constitution Day|10-25 Republic Day|12-16 Independence Day
KW 1-1 New Year's Day|2-25 National Day|2-26 Liberation Day|H10-1*3 Eid al-Fitr|H12-10*3 Eid al-Adha|H1-1 Islamic New Year|H7-27 Isra and Miraj
KG 1-1 New Year's Day|1-7 Orthodox Christmas|2-23 Defender of the Fatherland Day|3-8 Women's Day|3-21 Nooruz|5-1 Labour Day|5-5 Constitution Day|5-9 Victory Day|8-31 Independence Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
LA 1-1 New Year's Day|3-8 Women's Day|4-14 Lao New Year|4-15 Lao New Year|4-16 Lao New Year|5-1 Labour Day|12-2 National Day
LB 1-1 New Year's Day|2-9 Saint Maroun's Day|3-25 Annunciation|E-2 Good Friday|5-1 Labour Day|8-15 Assumption|11-22 Independence Day|12-25 Christmas Day|H10-1*2 Eid al-Fitr|H12-10*2 Eid al-Adha|H1-1 Islamic New Year|H1-10 Ashura|H3-12 Prophet's Birthday
MY 1-1 New Year's Day|5-1 Labour Day|8-31 National Day|9-16 Malaysia Day|12-25 Christmas Day|H10-1*2 Eid al-Fitr|H12-10 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
MV 5-1 Labour Day|7-26 Independence Day|11-3 Victory Day|11-11 Republic Day|H10-1*3 Eid al-Fitr|H12-10*3 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
MN 1-1 New Year's Day|3-8 Women's Day|6-1 Children's Day|7-11 Naadam|7-12 Naadam|7-13 Naadam|11-26 Republic Day|12-29 Independence Day
MM 1-4 Independence Day|2-12 Union Day|3-2 Peasants' Day|3-27 Armed Forces Day|4-13 Thingyan|4-17 Burmese New Year|5-1 Labour Day|7-19 Martyrs' Day|12-25 Christmas Day
NP 1-11 Prithvi Jayanti|2-19 Democracy Day|3-8 Women's Day|5-1 Labour Day|5-29 Republic Day|9-19 Constitution Day
KP 1-1 New Year's Day|2-16 Day of the Shining Star|4-15 Day of the Sun|5-1 May Day|7-27 Victory Day|8-15 Liberation Day|9-9 Republic Day|10-10 Party Foundation Day
OM 1-1 New Year's Day|7-23 Renaissance Day|11-18 National Day|11-19 National Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
PK 2-5 Kashmir Day|3-23 Pakistan Day|5-1 Labour Day|8-14 Independence Day|11-9 Iqbal Day|12-25 Quaid-e-Azam Day|H10-1*3 Eid al-Fitr|H12-10*3 Eid al-Adha|H1-9 Ashura|H1-10 Ashura|H3-12 Prophet's Birthday
PS 1-1 New Year's Day|5-1 Labour Day|11-15 Independence Day|12-25 Christmas Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
PH 1-1 New Year's Day|2-25 EDSA Revolution Anniversary|4-9 Day of Valour|E-3 Maundy Thursday|E-2 Good Friday|5-1 Labour Day|6-12 Independence Day|N-1.1-8 National Heroes' Day|11-1 All Saints' Day|11-30 Bonifacio Day|12-25 Christmas Day|12-30 Rizal Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
QA 12-18 National Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha
SA 2-22 Founding Day|9-23 National Day|H10-1*4 Eid al-Fitr|H12-10*4 Eid al-Adha
SG 1-1 New Year's Day|E-2 Good Friday|5-1 Labour Day|8-9 National Day|12-25 Christmas Day|H10-1 Hari Raya Puasa|H12-10 Hari Raya Haji
KR 1-1 New Year's Day|3-1 Independence Movement Day|5-5 Children's Day|6-6 Memorial Day|8-15 Liberation Day|10-3 National Foundation Day|10-9 Hangul Day|12-25 Christmas Day
LK 2-4 Independence Day|5-1 May Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|H3-12 Prophet's Birthday
SY 1-1 New Year's Day|3-8 Revolution Day|4-17 Independence Day|5-1 Labour Day|10-6 October War Day|12-25 Christmas Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
TW 1-1 Founding Day of the Republic|2-28 Peace Memorial Day|4-4 Children's Day|4-5 Tomb Sweeping Day|5-1 Labour Day|10-10 National Day
TJ 1-1 New Year's Day|3-8 Women's Day|3-21 Nowruz|3-22 Nowruz|5-1 Labour Day|5-9 Victory Day|6-27 National Unity Day|9-9 Independence Day|11-6 Constitution Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
TH 1-1 New Year's Day|4-6 Chakri Day|4-13 Songkran|4-14 Songkran|4-15 Songkran|5-1 Labour Day|5-4 Coronation Day|6-3 Queen Suthida's Birthday|7-28 King's Birthday|8-12 Queen Mother's Birthday|10-13 King Bhumibol Memorial Day|10-23 Chulalongkorn Day|12-5 King Bhumibol's Birthday|12-10 Constitution Day|12-31 New Year's Eve
TL 1-1 New Year's Day|E-2 Good Friday|5-1 Labour Day|5-20 Restoration of Independence|8-30 Popular Consultation Day|11-12 National Youth Day|11-28 Independence Day|12-8 Immaculate Conception|12-25 Christmas Day
TR 1-1 New Year's Day|4-23 National Sovereignty Day|5-1 Labour Day|5-19 Youth and Sports Day|7-15 Democracy Day|8-30 Victory Day|10-29 Republic Day|H10-1*3 Ramazan Bayramı|H12-10*4 Kurban Bayramı
TM 1-1 New Year's Day|1-12 Memorial Day|3-8 Women's Day|3-21 Nowruz|3-22 Nowruz|5-9 Victory Day|5-18 Constitution Day|9-27 Independence Day|12-12 Neutrality Day
AE 1-1 New Year's Day|12-1 Commemoration Day|12-2 National Day|12-3 National Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday
UZ 1-1 New Year's Day|3-8 Women's Day|3-21 Navruz|5-9 Day of Remembrance|9-1 Independence Day|10-1 Teachers' Day|12-8 Constitution Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
VN 1-1 New Year's Day|4-30 Reunification Day|5-1 Labour Day|9-2 National Day
YE 1-1 New Year's Day|5-1 Labour Day|5-22 Unity Day|9-26 Revolution Day|10-14 Revolution Day|11-30 Independence Day|H10-1*3 Eid al-Fitr|H12-10*4 Eid al-Adha|H1-1 Islamic New Year|H3-12 Prophet's Birthday

# --- Europe ---------------------------------------------------------------
AL 1-1 New Year's Day|1-2 New Year Holiday|3-14 Summer Day|3-22 Nowruz|E-2 Catholic Good Friday|O+0 Orthodox Easter|5-1 May Day|9-5 Mother Teresa Day|11-28 Independence Day|11-29 Liberation Day|12-8 Youth Day|12-25 Christmas Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha
AD 1-1 New Year's Day|1-6 Epiphany|3-14 Constitution Day|5-1 Labour Day|8-15 Assumption|9-8 National Day|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day
AT 1-1 New Year's Day|1-6 Epiphany|E+1 Easter Monday|5-1 Labour Day|E+39 Ascension Day|E+50 Whit Monday|E+60 Corpus Christi|8-15 Assumption|10-26 National Day|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day|12-26 St. Stephen's Day
BY 1-1 New Year's Day|1-7 Orthodox Christmas|3-8 Women's Day|5-1 Labour Day|5-9 Victory Day|7-3 Independence Day|11-7 October Revolution Day|12-25 Christmas Day
BE 1-1 New Year's Day|E+1 Easter Monday|5-1 Labour Day|E+39 Ascension Day|E+50 Whit Monday|7-21 National Day|8-15 Assumption|11-1 All Saints' Day|11-11 Armistice Day|12-25 Christmas Day
BA 1-1 New Year's Day|1-2 New Year Holiday|5-1 Labour Day|5-2 Labour Day|11-25 Statehood Day
BG 1-1 New Year's Day|3-3 Liberation Day|O-2 Good Friday|O+1 Easter Monday|5-1 Labour Day|5-6 Saint George's Day|5-24 Culture and Literacy Day|9-6 Unification Day|9-22 Independence Day|12-24 Christmas Eve|12-25 Christmas Day|12-26 Christmas Holiday
HR 1-1 New Year's Day|1-6 Epiphany|E+1 Easter Monday|5-1 Labour Day|5-30 Statehood Day|E+60 Corpus Christi|6-22 Anti-Fascist Struggle Day|8-5 Victory Day|8-15 Assumption|11-1 All Saints' Day|11-18 Remembrance Day|12-25 Christmas Day|12-26 St. Stephen's Day
CZ 1-1 Restoration Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|5-8 Liberation Day|7-5 Saints Cyril and Methodius Day|7-6 Jan Hus Day|9-28 Statehood Day|10-28 Independence Day|11-17 Freedom and Democracy Day|12-24 Christmas Eve|12-25 Christmas Day|12-26 St. Stephen's Day
DK 1-1 New Year's Day|E-3 Maundy Thursday|E-2 Good Friday|E+1 Easter Monday|E+39 Ascension Day|E+50 Whit Monday|6-5 Constitution Day|12-25 Christmas Day|12-26 Second Day of Christmas
EE 1-1 New Year's Day|2-24 Independence Day|E-2 Good Friday|E+0 Easter Sunday|5-1 Spring Day|E+50 Whit Sunday|6-23 Victory Day|6-24 Midsummer Day|8-20 Day of Restoration of Independence|12-24 Christmas Eve|12-25 Christmas Day|12-26 Boxing Day
FI 1-1 New Year's Day|1-6 Epiphany|E-2 Good Friday|E+1 Easter Monday|5-1 May Day|E+39 Ascension Day|12-6 Independence Day|12-24 Christmas Eve|12-25 Christmas Day|12-26 St. Stephen's Day
GR 1-1 New Year's Day|1-6 Epiphany|3-25 Independence Day|O-2 Good Friday|O+1 Easter Monday|5-1 Labour Day|O+50 Whit Monday|8-15 Assumption|10-28 Ohi Day|12-25 Christmas Day|12-26 Boxing Day
HU 1-1 New Year's Day|3-15 Revolution Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|E+50 Whit Monday|8-20 State Foundation Day|10-23 Republic Day|11-1 All Saints' Day|12-25 Christmas Day|12-26 Second Day of Christmas
IS 1-1 New Year's Day|E-3 Maundy Thursday|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|E+39 Ascension Day|E+50 Whit Monday|6-17 National Day|12-25 Christmas Day|12-26 Boxing Day
IT 1-1 New Year's Day|1-6 Epiphany|E+1 Easter Monday|4-25 Liberation Day|5-1 Labour Day|6-2 Republic Day|8-15 Assumption|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day|12-26 St. Stephen's Day
LV 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|5-4 Independence Restoration Day|6-23 Midsummer Eve|6-24 Midsummer Day|11-18 Proclamation Day|12-24 Christmas Eve|12-25 Christmas Day|12-26 Second Day of Christmas
LI 1-1 New Year's Day|1-6 Epiphany|2-2 Candlemas|3-19 Saint Joseph's Day|E+1 Easter Monday|5-1 Labour Day|E+39 Ascension Day|E+50 Whit Monday|E+60 Corpus Christi|8-15 National Day|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day|12-26 St. Stephen's Day
LT 1-1 New Year's Day|2-16 State Restoration Day|3-11 Independence Restoration Day|E+0 Easter Sunday|E+1 Easter Monday|5-1 Labour Day|6-24 Midsummer Day|7-6 Statehood Day|8-15 Assumption|11-1 All Saints' Day|12-24 Christmas Eve|12-25 Christmas Day|12-26 Second Day of Christmas
LU 1-1 New Year's Day|E+1 Easter Monday|5-1 Labour Day|5-9 Europe Day|E+39 Ascension Day|E+50 Whit Monday|6-23 National Day|8-15 Assumption|11-1 All Saints' Day|12-25 Christmas Day|12-26 St. Stephen's Day
MT 1-1 New Year's Day|2-10 Feast of Saint Paul's Shipwreck|3-19 Feast of Saint Joseph|3-31 Freedom Day|E-2 Good Friday|5-1 Labour Day|6-7 Sette Giugno|6-29 Feast of Saint Peter and Saint Paul|8-15 Assumption|9-8 Victory Day|9-21 Independence Day|12-8 Immaculate Conception|12-13 Republic Day|12-25 Christmas Day
MD 1-1 New Year's Day|1-7 Orthodox Christmas|3-8 Women's Day|O+0 Orthodox Easter|O+1 Easter Monday|5-1 Labour Day|5-9 Victory Day|8-27 Independence Day|8-31 Language Day|12-25 Christmas Day
MC 1-1 New Year's Day|1-27 Saint Devote's Day|E+1 Easter Monday|5-1 Labour Day|E+39 Ascension Day|E+50 Whit Monday|E+60 Corpus Christi|8-15 Assumption|11-1 All Saints' Day|11-19 National Day|12-8 Immaculate Conception|12-25 Christmas Day
ME 1-1 New Year's Day|1-2 New Year Holiday|5-1 Labour Day|5-2 Labour Day|5-21 Independence Day|5-22 Independence Day|7-13 Statehood Day|7-14 Statehood Day
NL 1-1 New Year's Day|E-2 Good Friday|E+0 Easter Sunday|E+1 Easter Monday|4-27 King's Day|5-5 Liberation Day|E+39 Ascension Day|E+50 Whit Monday|12-25 Christmas Day|12-26 Boxing Day
MK 1-1 New Year's Day|1-7 Orthodox Christmas|O+0 Orthodox Easter|5-1 Labour Day|5-24 Saints Cyril and Methodius Day|8-2 Republic Day|9-8 Independence Day|10-11 Revolution Day|10-23 Revolutionary Struggle Day|12-8 Saint Clement of Ohrid Day
NO 1-1 New Year's Day|E-3 Maundy Thursday|E-2 Good Friday|E+0 Easter Sunday|E+1 Easter Monday|5-1 Labour Day|5-17 Constitution Day|E+39 Ascension Day|E+50 Whit Monday|12-25 Christmas Day|12-26 Boxing Day
PL 1-1 New Year's Day|1-6 Epiphany|E+0 Easter Sunday|E+1 Easter Monday|5-1 Labour Day|5-3 Constitution Day|E+49 Pentecost|E+60 Corpus Christi|8-15 Assumption|11-1 All Saints' Day|11-11 Independence Day|12-25 Christmas Day|12-26 Second Day of Christmas
PT 1-1 New Year's Day|E-2 Good Friday|E+0 Easter Sunday|4-25 Freedom Day|5-1 Labour Day|E+60 Corpus Christi|6-10 Portugal Day|8-15 Assumption|10-5 Republic Day|11-1 All Saints' Day|12-1 Restoration of Independence|12-8 Immaculate Conception|12-25 Christmas Day
RO 1-1 New Year's Day|1-2 New Year Holiday|1-24 Union Day|O-2 Good Friday|O+0 Orthodox Easter|O+1 Easter Monday|5-1 Labour Day|6-1 Children's Day|O+50 Whit Monday|8-15 Assumption|11-30 Saint Andrew's Day|12-1 National Day|12-25 Christmas Day|12-26 Second Day of Christmas
RU 1-1 New Year's Day|1-2 New Year Holiday|1-7 Orthodox Christmas|2-23 Defender of the Fatherland Day|3-8 Women's Day|5-1 Spring and Labour Day|5-9 Victory Day|6-12 Russia Day|11-4 Unity Day
SM 1-1 New Year's Day|1-6 Epiphany|2-5 Feast of Saint Agatha|3-25 Anniversary of the Arengo|E+1 Easter Monday|5-1 Labour Day|E+60 Corpus Christi|7-28 Fall of Fascism|8-15 Assumption|9-3 Feast of Saint Marinus|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day
RS 1-1 New Year's Day|1-2 New Year Holiday|1-7 Orthodox Christmas|2-15 Statehood Day|2-16 Statehood Day|O-2 Good Friday|O+1 Easter Monday|5-1 Labour Day|5-2 Labour Day|11-11 Armistice Day
SK 1-1 Independence Day|1-6 Epiphany|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|5-8 Victory Day|7-5 Saints Cyril and Methodius Day|8-29 National Uprising Day|9-1 Constitution Day|9-15 Our Lady of Sorrows|11-1 All Saints' Day|11-17 Freedom and Democracy Day|12-24 Christmas Eve|12-25 Christmas Day|12-26 St. Stephen's Day
SI 1-1 New Year's Day|1-2 New Year Holiday|2-8 Prešeren Day|E+1 Easter Monday|4-27 Uprising Against Occupation Day|5-1 Labour Day|5-2 Labour Day|6-25 Statehood Day|8-15 Assumption|10-31 Reformation Day|11-1 All Saints' Day|12-25 Christmas Day|12-26 Independence and Unity Day
ES 1-1 New Year's Day|1-6 Epiphany|E-2 Good Friday|5-1 Labour Day|8-15 Assumption|10-12 National Day|11-1 All Saints' Day|12-6 Constitution Day|12-8 Immaculate Conception|12-25 Christmas Day
SE 1-1 New Year's Day|1-6 Epiphany|E-2 Good Friday|E+0 Easter Sunday|E+1 Easter Monday|5-1 May Day|E+39 Ascension Day|6-6 National Day|12-25 Christmas Day|12-26 Boxing Day
CH 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|E+39 Ascension Day|E+50 Whit Monday|8-1 National Day|12-25 Christmas Day
UA 1-1 New Year's Day|3-8 Women's Day|5-1 Labour Day|5-8 Day of Remembrance and Victory|6-28 Constitution Day|7-15 Statehood Day|8-24 Independence Day|10-1 Defenders Day|12-25 Christmas Day
VA 1-1 Solemnity of Mary|1-6 Epiphany|3-19 Saint Joseph's Day|E+1 Easter Monday|5-1 Saint Joseph the Worker|6-29 Saints Peter and Paul|8-15 Assumption|11-1 All Saints' Day|12-8 Immaculate Conception|12-25 Christmas Day|12-26 St. Stephen's Day
XK 1-1 New Year's Day|2-17 Independence Day|4-9 Constitution Day|5-1 Labour Day|H10-1 Eid al-Fitr|H12-10 Eid al-Adha|12-25 Christmas Day

# --- Oceania --------------------------------------------------------------
FJ 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|9-7 Constitution Day|10-10 Fiji Day|12-25 Christmas Day|12-26 Boxing Day|H3-12 Prophet's Birthday
KI 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|7-12 Independence Day|12-25 Christmas Day|12-26 Boxing Day
MH 1-1 New Year's Day|3-1 Nuclear Victims Remembrance Day|5-1 Constitution Day|11-17 President's Day|12-25 Christmas Day
FM 1-1 New Year's Day|5-10 Constitution Day|11-3 Independence Day|12-25 Christmas Day
NR 1-1 New Year's Day|1-31 Independence Day|E-2 Good Friday|E+1 Easter Monday|5-17 Constitution Day|10-26 Angam Day|12-25 Christmas Day|12-26 Boxing Day
NZ 1-1 New Year's Day|1-2 Day after New Year's Day|2-6 Waitangi Day|E-2 Good Friday|E+1 Easter Monday|4-25 Anzac Day|N1.1-6 King's Birthday|N4.1-10 Labour Day|12-25 Christmas Day|12-26 Boxing Day
PW 1-1 New Year's Day|7-9 Constitution Day|10-1 Independence Day|12-25 Christmas Day
PG 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|6-9 King's Birthday|7-23 Remembrance Day|9-16 Independence Day|12-25 Christmas Day|12-26 Boxing Day
WS 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|6-1 Independence Day|12-25 Christmas Day|12-26 Boxing Day
SB 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|7-7 Independence Day|12-25 Christmas Day|12-26 Boxing Day
TO 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|4-25 Anzac Day|6-4 Emancipation Day|7-4 King's Birthday|11-4 Constitution Day|12-4 King Tupou I Day|12-25 Christmas Day|12-26 Boxing Day
TV 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|10-1 Independence Day|12-25 Christmas Day|12-26 Boxing Day
VU 1-1 New Year's Day|E-2 Good Friday|E+1 Easter Monday|5-1 Labour Day|7-30 Independence Day|8-15 Assumption|10-5 Constitution Day|11-29 Unity Day|12-25 Christmas Day
`;

/** Parse one token of the notation into a rule object. */
function parseToken(token) {
  const space = token.indexOf(' ');
  const code = token.slice(0, space);
  const name = token.slice(space + 1).trim();

  let match = code.match(/^(\d{1,2})-(\d{1,2})$/);
  if (match) return { name, month: Number(match[1]), day: Number(match[2]) };

  match = code.match(/^E([+-]\d+)$/);
  if (match) return { name, easter: Number(match[1]) };

  match = code.match(/^O([+-]\d+)$/);
  if (match) return { name, orthodoxEaster: Number(match[1]) };

  match = code.match(/^H(\d{1,2})-(\d{1,2})(?:\*(\d+))?$/);
  if (match) {
    return {
      name,
      hijri: { month: Number(match[1]), day: Number(match[2]) },
      span: match[3] ? Number(match[3]) : 1,
      estimated: true,
    };
  }

  match = code.match(/^N(-?\d+)\.(\d)-(\d{1,2})$/);
  if (match) {
    return { name, nth: Number(match[1]), weekday: Number(match[2]), month: Number(match[3]) };
  }

  throw new Error(`Unparsable holiday token: ${token}`);
}

/** @type {Record<string, {coverage: 'core', rules: object[]}>} */
export const WORLD_RULES = {};

for (const line of TABLE.trim().split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const space = trimmed.indexOf(' ');
  const code = trimmed.slice(0, space);
  WORLD_RULES[code] = {
    coverage: 'core',
    observe: null,
    rules: trimmed
      .slice(space + 1)
      .split('|')
      .map((token) => parseToken(token.trim())),
  };
}

export const WORLD_COUNTRIES = Object.keys(WORLD_RULES).sort();
