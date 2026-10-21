/**
 * Real public library branches - Jerusalem and Tel Aviv-Yafo.
 *
 * Names and addresses are REAL (public information), collected 21/10/2026:
 *   Tel Aviv-Yafo - official municipality site:
 *     https://tel-aviv.gov.il/en/Live/Education/Pages/Public-Libraries.aspx
 *   Jerusalem - an opening-hours directory (NOT the official site; may be out of date):
 *     https://www.xn----8hcbjj5cq0blc.co.il/opening.asp?eName=ספריות+עירוניות+ירושלים&cid=2067
 *     (names and addresses translated to English)
 *
 * Only the 27 branches whose location was found (library/geocode-libraries.js,
 * OpenStreetMap) are kept. The other 21 - including all 5 Beit Shemesh
 * branches - had addresses OpenStreetMap could not find, and were removed
 * (library/migrate-libraries-english.js).
 *
 * size - only used by the SIMULATED inventory (how much of the catalog a
 * branch holds): large = central library, small = special collections,
 * medium = the rest.
 */

const TA = "https://tel-aviv.gov.il/en/Live/Education/Pages/Public-Libraries.aspx";
const JR = "https://www.xn----8hcbjj5cq0blc.co.il/opening.asp?eName=%D7%A1%D7%A4%D7%A8%D7%99%D7%95%D7%AA+%D7%A2%D7%99%D7%A8%D7%95%D7%A0%D7%99%D7%95%D7%AA+%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D&cid=2067";

const LIBRARIES = [
  // ---------- Jerusalem (15) ----------
  { name: "Central Library – Beit Ha'am", city: "Jerusalem", address: "11 Bezalel Street", size: "large", source: JR },
  { name: "Russian Library", city: "Jerusalem", address: "88 Agripas Street", size: "small", source: JR },
  { name: "Har Nof Library", city: "Jerusalem", address: "48 HaRav Yitzhak Hai Taib Street", size: "medium", source: JR },
  { name: "Beit HaKerem Library", city: "Jerusalem", address: "137 Herzl Boulevard", size: "medium", source: JR },
  { name: "Baka Library", city: "Jerusalem", address: "3 Yissachar Street", size: "medium", source: JR },
  { name: "Gilo Library", city: "Jerusalem", address: "12 Vardinon Street", size: "medium", source: JR },
  { name: "Neve Yaakov Library", city: "Jerusalem", address: "38 Neve Yaakov Boulevard", size: "medium", source: JR },
  { name: "Sawahre Library", city: "Jerusalem", address: "70 Hai Al-Madares", size: "medium", source: JR },
  { name: "Pisgat Ze'ev Library", city: "Jerusalem", address: "3 Gal Street", size: "medium", source: JR },
  { name: "Katamon Library", city: "Jerusalem", address: "2 Eliezer HaGadol Street", size: "medium", source: JR },
  { name: "Kiryat Yovel Library", city: "Jerusalem", address: "8 Chile Street", size: "medium", source: JR },
  { name: "Kiryat Menachem – Ir Ganim Library", city: "Jerusalem", address: "18 HaNurit Street", size: "medium", source: JR },
  { name: "Ramot Library", city: "Jerusalem", address: "6 Avraham Recanati Street", size: "medium", source: JR },
  { name: "Ramat Eshkol Library", city: "Jerusalem", address: "3 Karl Netter Street", size: "medium", source: JR },
  { name: "East Talpiot – Armon HaNatziv Library", city: "Jerusalem", address: "13 Olei HaGardom Street", size: "medium", source: JR },

  // ---------- Tel Aviv-Yafo (12) ----------
  { name: "Chess Center – The Sissy and Marc Sol Library", city: "Tel Aviv-Yafo", address: "26 Tagore Street", size: "small", source: TA },
  { name: "The Felicia Blumenthal Music Center and Library", city: "Tel Aviv-Yafo", address: "26 Bialik Street", size: "small", source: TA },
  { name: "Beit Danni Library (Hatikvah)", city: "Tel Aviv-Yafo", address: "4 Simtat Kabir Street", size: "medium", source: TA },
  { name: "Bat Zion Library", city: "Tel Aviv-Yafo", address: "10 Bat Zion Street", size: "medium", source: TA },
  { name: "Anna Laura Petlik Fischer Library (Arab-Jewish Center)", city: "Tel Aviv-Yafo", address: "109 Kedem Street", size: "medium", source: TA },
  { name: "Yaffo Dalet Library", city: "Tel Aviv-Yafo", address: "14 Rubinstein Street", size: "medium", source: TA },
  { name: "Neve Eliezer Library", city: "Tel Aviv-Yafo", address: "6 Sheshet HaYamim Street", size: "medium", source: TA },
  { name: "Neve Ofer Library", city: "Tel Aviv-Yafo", address: "16 Zalman Shazar Street", size: "medium", source: TA },
  { name: "Neve Sharet Library", city: "Tel Aviv-Yafo", address: "4 Kehilat Cleveland Street", size: "medium", source: TA },
  { name: "Zahala Library", city: "Tel Aviv-Yafo", address: "1 Avner Street", size: "medium", source: TA },
  { name: "Yair HaShulami Library (Nahalat Yitzhak)", city: "Tel Aviv-Yafo", address: "9 Tirat Zvi Street", size: "medium", source: TA },
  { name: "Ramat Aviv Gimel Library", city: "Tel Aviv-Yafo", address: "2 Drezner Street", size: "medium", source: TA },
];

// City names as a user / the chatbot may write them -> the stored name
const CITY_ALIASES = {
  "jerusalem": "Jerusalem", "ירושלים": "Jerusalem",
  "tel aviv": "Tel Aviv-Yafo", "tel aviv-yafo": "Tel Aviv-Yafo", "tel aviv-jaffa": "Tel Aviv-Yafo",
  "tel aviv yafo": "Tel Aviv-Yafo", "tlv": "Tel Aviv-Yafo", "תל אביב": "Tel Aviv-Yafo", "תל אביב-יפו": "Tel Aviv-Yafo",
};
const CITIES = ["Jerusalem", "Tel Aviv-Yafo"];

module.exports = { LIBRARIES, CITY_ALIASES, CITIES };
