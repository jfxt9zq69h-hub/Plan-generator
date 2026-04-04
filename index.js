import express from "express";
import axios from "axios";
import {
Document, Packer, Paragraph, TextRun,
Table, TableRow, TableCell,
AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
Header, Footer, PageBreak,
} from "docx";
 
const app = express();
app.use(express.json());
 
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
const MODEL = "claude-sonnet-4-6";
const PORT = process.env.PORT || 3000;
 
if (!ANTHROPIC_API_KEY) {
console.error("ANTHROPIC_API_KEY is not set.");
process.exit(1);
}
 
// ── Design palette (hex without #, matching original PDF) ────────────────────
const DARK_BG = "111111";
const DARK_CARD = "1A1A1A";
const DARK_ROW = "161616";
const RED = "CC1F1F";
const WHITE = "FFFFFF";
const GRAY = "888888";
const LIGHT = "CCCCCC";
 
// ── Page geometry (DXA units, A4: 1440 DXA = 1 inch) ─────────────────────────
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 800; // ≈ 40 pt, matching original PDF margins
const CW = PAGE_W - MARGIN * 2; // 10306 DXA usable content width
 
// ── Border / shading helpers ─────────────────────────────────────────────────
const nb = { style: BorderStyle.NONE, size: 0, color: "auto" };
const rb = (sz = 8) => ({ style: BorderStyle.SINGLE, size: sz, color: RED });
const tableBorders = {
top: nb, bottom: nb, left: nb, right: nb,
insideHorizontal: nb, insideVertical: nb,
};
const cellBorders = { top: nb, bottom: nb, left: nb, right: nb };
 
// Spacer paragraph (spacing.after in twips: 240 twips = 12 pt)
const sp = (after = 120) => new Paragraph({ children: [], spacing: { before: 0, after } });
 
// ── FOOD_DB ──────────────────────────────────────────────────────────────────
const FOOD_DB = `
MESO IN PERUTNINA (na 100g surovo):
Piščančja prsa: 110kcal, 23g B | Piščančja stegna (brez kosti): 160kcal, 19g B | Puranja prsa: 114kcal, 24g B | Goveji zrezek (pusto): 150kcal, 22g B | Goveje meso mleto 5%: 135kcal, 21g B | Goveje meso mleto 20%: 250kcal, 17g B | Svinjski file: 143kcal, 21g B | Teletina: 110kcal, 20g B | Srna: 120kcal, 22g B | Jelenjad: 125kcal, 22g B
MESNI IZDELKI (na 100g):
Kuhan pršut/šunka: 110kcal, 18g B | Puranja šunka: 90kcal, 17g B | Piščančja prsa v ovitku: 85kcal, 16g B | Kraški pršut: 260kcal, 26g B | Hrenovka: 280kcal, 12g B | Čevapčiči surovi: 250kcal, 15g B
RIBE (na 100g):
Losos svež: 208kcal, 20g B | Tuna v lastnem soku: 116kcal, 25g B | Tuna v olju: 198kcal, 24g B | Skuša sveža: 305kcal, 19g B | Oslič: 90kcal, 17g B | Postrv: 148kcal, 21g B | Sardine v olju: 208kcal, 24g B | Tilapija: 128kcal, 26g B | Trska: 82kcal, 18g B | Kozice: 99kcal, 24g B
MLECNI IZDELKI (na 100g):
Mleko 3.5%: 64kcal, 3.3g B | Grški jogurt 0%: 59kcal, 10g B | Grški jogurt 2%: 75kcal, 9.5g B | Skyr: 65kcal, 11g B | Pusta skuta: 72kcal, 12g B | Sir Cottage light: 70kcal, 12g B | Mozzarella light: 165kcal, 20g B | Parmezan: 431kcal, 38g B | Feta: 264kcal, 14g B | Ovseni napitek: 42kcal, 1g B | Mandljev napitek: 13kcal, 0.4g B | Kefir: 62kcal, 3.3g B
JAJCA (na 100g):
Kokošje jajce celo: 155kcal, 13g B | Jajčni beljak: 52kcal, 11g B
ZELENJAVA (na 100g surovo):
Brokoli: 34kcal, 2.8g B | Špinača: 23kcal, 2.9g B | Paprika rdeča: 31kcal, 1g B | Kumara: 15kcal, 0.7g B | Paradižnik: 18kcal, 0.9g B | Korenje: 41kcal, 0.9g B | Rukola: 25kcal, 2.6g B | Cvetača: 25kcal, 1.9g B | Bučka: 17kcal, 1.2g B | Šampinjoni: 22kcal, 3.1g B | Čebula: 40kcal, 1.1g B | Sladki krompir: 86kcal, 1.6g B | Koruza sladka: 86kcal, 3.2g B | Šparglji: 20kcal, 2.2g B
STROCNICE (na 100g):
Fižol kuhan: 127kcal, 8.7g B | Čičerika kuhana: 164kcal, 8.9g B | Leča kuhana: 116kcal, 9g B
SADJE (na 100g):
Banana: 89kcal, 1.1g B | Jabolko: 52kcal, 0.3g B | Jagode: 32kcal, 0.7g B | Borovnice: 57kcal, 0.7g B | Avokado: 160kcal, 2g B | Pomaranča: 47kcal, 0.9g B | Kivi: 61kcal, 1.1g B
ZITA (na 100g suho):
Beli riz: 360kcal, 7g B | Basmati riz: 345kcal, 8.5g B | Ovseni kosmiči: 389kcal, 13.5g B | Testenine bele: 350kcal, 12g B | Polnozrnate testenine: 340kcal, 14g B | Krompir surovi: 77kcal, 2g B | Kvinoja: 368kcal, 14g B | Ajdova kaša: 343kcal, 13g B
KRUH (na 100g):
Polnozrnati kruh: 250kcal, 9.7g B | Toast polnozrnat: 260kcal, 9g B | Toast beli: 285kcal, 8.3g B | Tortilja pšenična: 310kcal, 8g B
ORESKI (na 100g):
Mandlji: 579kcal, 21g B | Orehi: 654kcal, 15g B | Arašidovo maslo: 588kcal, 25g B | Chia semena: 486kcal, 17g B | Sončnična semena: 584kcal, 21g B
OLJA (na 100g):
Oljčno olje: 884kcal, 0g B | Maslo: 717kcal, 0.8g B
DODATKI (na 100g):
Med: 304kcal, 0.3g B | Sojina omaka: 53kcal, 8g B | Whey protein: 380kcal, 80g B | Veganski protein: 370kcal, 75g B
`;
 
// ── System prompts (unchanged) ────────────────────────────────────────────────
const MEAL_SYSTEM_PROMPT = `Si Gal Remec, slovenski online fitnes trener z 500+ uspesnimi transformacijami. Pises jedilnike v svojem stilu.
JEZIK: Knjižna slovenščina s šumniki. Brez emojijev. Pravilna locila. Stevilke s presledkom (114 g). Brez anglicizmov.
TON: Strokoven, direkten, oseben. Naslavljaj z imenom in "ti".
ADAPTATIONS (3-5 povedi): Razlozi podatke, kalorije, TDEE, deficit, beljakovine, preference.
INTRO (4-6 povedi): Strategija, pomen beljakovin, deficit, realna pricakovanja, doslednost.
NAČELA: Deficit 500 kcal = 0,5 kg/teden. Beljakovine 1,8–2,2 g/kg. 25–40 g na obrok.
PREPOVEDANA ŽIVILA: Nikoli ne vključi humusa, soje in sojinih izdelkov (sojin jogurt, sojin napitek, sojini koščki, tofu, tempeh, edamame). To velja za VSE stranke brez izjeme.`;
 
const TRAINING_SYSTEM_PROMPT = `Si Gal Remec, slovenski online fitnes trener z 500+ uspesnimi transformacijami. Pises trening programe v svojem stilu.
JEZIK: Knjižna slovenščina s šumniki. Nazivi vaj v anglescini. Brez emojijev.
TON: Strokoven, direkten - naslavljaj z imenom in "ti".
INTRO (8-12 povedi): Zacni z "Ta trening program je pripravljen glede na..." Razloži split, ogrevanje, intenzivnost (blizu tehnične odpovedi), počitek 3–5 minut za VSE vaje brez izjeme, progresivno obremenitev, poškodbe. Zaključi z doslednostjo.
NAČELA: 1–2 seriji do odpovedi zadoščata. 6–10 reps večje vaje, 10–15 izolacijske. Tehnika > teža.
POČITEK: 3–5 minut za VSE vaje — tako večje kot izolacijske. Nikoli manj.
KARDIO NAVODILA (za kardio dneve):
- Kardio dan mora biti napisan kot workout z vajami (naprava, cas, kcal)
- Opcije: Sobno kolo (30-45 min, 250-400 kcal, intenzivnost zmerna-visoka), Tek na tekoci stezi (25-40 min, 250-400 kcal, 8-11 km/h), Elipticni trenazjer (30-45 min, 280-400 kcal), Veslarski ergometer (20-30 min, 250-350 kcal), Stairmaster (25-35 min, 300-400 kcal), Hoja na nagnjeni tekoci stezi (35-50 min, 200-300 kcal, naklon MINIMALNO 10%, nikoli manj, hitrost 5–6 km/h)
- Za kardio dan naredi workout z 2-3 napravami, vsaka ima: ime naprave, cas in priblizni kcal, navodila za intenzivnost
- Hoja na tekoci stezi: naklon VEDNO minimalno 10%, nikoli manj
SPLITI: 3x=PPL, 4x=UPPER/LOWER, 5x=UPPER/LOWER/ARMS+SHOULDERS.`;
 
// ── Utility functions (unchanged) ─────────────────────────────────────────────
function norm(str) {
return (str || "")
.normalize("NFD")
.replace(/[\u0300-\u036f]/g, "")
.toLowerCase();
}
 
function parseCombinedTallyData(body) {
const fields = body?.data?.fields ?? [];
const get = (label) => {
const f = fields.find((f) => norm(f.label || "").includes(norm(label)));
return f?.value ?? "ni podatka";
};
const getChoice = (label) => {
const field = fields.find((f) => norm(f.label || "").includes(norm(label)));
if (!field) return "ni podatka";
const options = field.options ?? [];
const selected = Array.isArray(field.value) ? field.value : [field.value];
const matched = options.filter((o) => selected.includes(o.id)).map((o) => o.text);
return matched.length > 0 ? matched.join(", ") : "ni podatka";
};
const data = {
name: get("ime in priimek") || get("ime"),
age: get("starost"),
weight: get("teza"),
height: get("visina"),
goal: get("cilj"),
activity: getChoice("korakov dela") || getChoice("korakov naredi") || get("korakov"),
likes: get("kaj rad") || get("jedilnik na podlagi"),
dislikes: get("hrane ne maras") || get("ne maras"),
meals: get("koliko obrokov"),
allergies: get("alergije") || get("jedilnika"),
location: get("kje zelis trenirati") || get("kje"),
equipment: get("od doma napisi") || get("opremo imas"),
exDislikes: get("katerih vaj ne maras") || get("vaj ne"),
exLikes: get("vaje imas rad") || get("vaje rad"),
frequency: get("kolikokrat"),
injuries: get("poskodbe") || get("zdravjem"),
trainingNotes: get("sestave treninga"),
};
console.log("Parsed:", JSON.stringify(data));
return data;
}
 
async function generateMealPlan(userData) {
const mealsCount = parseInt(userData.meals) || 4;
const weight = parseFloat(userData.weight) || 80;
const height = parseFloat(userData.height) || 175;
const age = parseFloat(userData.age) || 25;
const name = userData.name !== "ni podatka" ? userData.name : "stranka";
const bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5;
let activityMultiplier = 1.375;
const act = norm(userData.activity);
if (act.includes("0-3k") || act.includes("malo")) activityMultiplier = 1.2;
else if (act.includes("3-5k")) activityMultiplier = 1.375;
else if (act.includes("5-7k") || act.includes("srednje")) activityMultiplier = 1.375;
else if (act.includes("7-10k") || act.includes("veliko")) activityMultiplier = 1.55;
else if (act.includes("10-15k")|| act.includes("zelo veliko")) activityMultiplier = 1.55;
else if (act.includes("20k")) activityMultiplier = 1.725;
const tdee = Math.round(bmr * activityMultiplier);
const goalLower = norm(userData.goal);
let targetCalories, planType;
if (goalLower.includes("huj") || goalLower.includes("cut") || goalLower.includes("izgub")) { targetCalories = tdee - 500; planType = "CUT"; }
else if (goalLower.includes("masa")|| goalLower.includes("bulk") || goalLower.includes("pridobi")){ targetCalories = tdee + 300; planType = "BULK"; }
else { targetCalories = tdee; planType = "MAINTAIN"; }
const targetProtein = Math.round(weight * 2.0);
const prompt = `Ustvari 3-dnevni prehranski nacrt. Vrni SAMO cisti JSON.
BAZA ZIVIL:
${FOOD_DB}
IZRACUNANI PODATKI:
- BMR: ${Math.round(bmr)} kcal | TDEE: ${tdee} kcal | Cilj: ${targetCalories} kcal (${planType}) | Beljakovine: ${targetProtein} g
STRANKA: ${name}, ${age} let, ${weight} kg, ${height} cm, cilj: ${userData.goal}
Rad je: ${userData.likes} | Ne mara: ${userData.dislikes} | Obroki: ${mealsCount} | Alergije: ${userData.allergies}
JSON struktura:
{
"summary": { "calories_per_day": ${targetCalories}, "protein_per_day": ${targetProtein}, "meals_per_day": ${mealsCount}, "plan_type": "${planType}" },
"adaptations": "DALJSI UVODNI DEL (8-12 povedi) v knjizni slovenscini s sumniki, brez emojijev. Naslavlja ${name}. Vsebuje: 1) Na podlagi katerih podatkov je plan sestavljen (starost, teza, visina, aktivnost, cilj). 2) Tocne kalorije (${targetCalories} kcal), TDEE (${tdee} kcal) in deficit (${tdee - targetCalories} kcal) - razlozi zakaj tak okvir. 3) Ciljne beljakovine (${targetProtein} g) in zakaj so kljucne - ohranitev misic, sitost, regeneracija. 4) Katere beljakovinske vire si vkljucil glede na preference stranke. 5) Ogljikovi hidrati - kateri viri so vkljuceni, timing pred/po treningu. 6) Upostevane preference, alergije in omejitve stranke. 7) Nasvet za sledenje kalorijam (MyFitnessPal). 8) Navodilo o zamenjavah zivil - pisc zamenjaj s puranjem, riz s krompirjem itd, dokler so kalorije in beljakovine znotraj okvirja.",
"intro": "ZAKLJUCNI DEL (4-6 povedi) v knjizni slovenscini s sumniki, brez emojijev. Vsebuje: 1) Napredek - kako ga meriti (telesna masa, obseg, pocutje, energija). Tehtnica lahko niha 1-2 kg na dan. 2) Doslednost - napredek ni rezultat enega dne ampak mesecev konsistentnega dela. 3) Motivacijski zakljucek.",
"days": [{ "day": 1, "calories": ${targetCalories}, "protein": ${targetProtein}, "meals": [{ "number": 1, "name": "ZAJTRK", "calories": 500, "protein": 35, "ingredients": ["100 g ovsenih kosmiccev (389 kcal, 13,5 g B)"] }] }]
}
PRAVILA: ${mealsCount} obrokov/dan, 3-6 sestavin z gramažo in kcal v oklepaju, NE vključi: ${userData.dislikes}, ${userData.allergies}, humus, soja, sojini izdelki, tofu, tempeh, edamame. SAMO JSON.`;
const response = await axios.post("https://api.anthropic.com/v1/messages", {
model: MODEL, max_tokens: 4096,
system: MEAL_SYSTEM_PROMPT,
messages: [{ role: "user", content: prompt }],
}, {
headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
timeout: 120000,
});
const text = response.data?.content?.find((b) => b.type === "text")?.text;
if (!text) throw new Error("Prazen odgovor");
return JSON.parse(text.replace(/```json|```/g, "").trim());
}
 
async function generateTrainingPlan(userData) {
const name = userData.name !== "ni podatka" ? userData.name : "stranka";
const days = parseInt(userData.frequency) || 3;
let splitType, splitDesc;
if (days <= 3) { splitType = "PUSH / PULL / LEGS"; splitDesc = "3 dni na teden"; }
else if (days === 4) { splitType = "UPPER / LOWER"; splitDesc = "4 dni na teden"; }
else { splitType = "UPPER / LOWER / ARMS + SHOULDERS"; splitDesc = "5 dni na teden"; }
const prompt = `Ustvari personaliziran trening program. Vrni SAMO cisti JSON.
STRANKA: ${name}, lokacija: ${userData.location}, oprema: ${userData.equipment}
Ne mara vaj: ${userData.exDislikes} | Ima rad: ${userData.exLikes}
Treningov/teden: ${days} | Poskodbe: ${userData.injuries} | Opombe: ${userData.trainingNotes}
SPLIT: ${splitType}
JSON struktura:
{
"summary": { "name": "${name}", "days_per_week": ${days}, "split": "${splitType}", "split_desc": "${splitDesc}", "location": "${userData.location}" },
"intro": "8-12 povedi, knjizna slovenscina, sumniki, brez emojijev. Zacni z 'Ta trening program je pripravljen glede na...'",
"schedule": [{ "day": "Ponedeljek", "workout": "PUSH" }, { "day": "Torek", "workout": "Pocitek" }, { "day": "Sreda", "workout": "PULL" }, { "day": "Cetrtek", "workout": "Pocitek" }, { "day": "Petek", "workout": "LEGS" }, { "day": "Sobota", "workout": "Pocitek" }, { "day": "Nedelja", "workout": "Pocitek" }],
"workouts": [{ "name": "PUSH", "exercises": [{ "name": "Smith machine bench press", "sets_reps": "2 x 6-10", "note": "Kontroliran spust." }] }]
}
POZOR: Če stranka v opombah specificira točno strukturo treninga (npr. "2x noge, 3x kardio", "samo kardio", "samo noge"), IGNORIRAJ standardni split in naredi TOČNO to kar stranka zahteva v opombah.
PRAVILA:
- 4-6 vaj/dan za trening dneve
- Kardio dnevi = workout z 2-3 kardio napravami (naprava, cas, kcal, intenzivnost)
- Hoja na tekoci stezi: naklon VEDNO min 10%, nikoli manj
- Pocitek med serijami: 3-5 minut za VSE vaje
- OPREMA - STROGO PRAVILO: Sestavi program IZKLJUCNO iz opreme ki jo je stranka eksplicitno navedla. Ne predpostavljaj NICESAR kar ni omenjeno. Če stranka napiše samo "dumbbell" ali "utezi" ali "utez" - program vsebuje SAMO vaje z dumbbelli/utezmi. Brez pull-up bara, brez kablov, brez naprav, brez klopi, brez vrat - razen ce je eksplicitno napisano. Dvomis? Izpusti vajo.
- Prilagodi lokaciji (doma=brez naprav razen kar je navedeno, fitnes=naprave+uteži)
- NE vključi: ${userData.exDislikes}
- Prilagodi poškodbe: ${userData.injuries}
- Za kardio dneve v schedule napisi "Kardio"
- workouts seznam mora vsebovati KARDIO kot workout dan z vajami
- SAMO JSON`;
const response = await axios.post("https://api.anthropic.com/v1/messages", {
model: MODEL, max_tokens: 4096,
system: TRAINING_SYSTEM_PROMPT,
messages: [{ role: "user", content: prompt }],
}, {
headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
timeout: 120000,
});
const text = response.data?.content?.find((b) => b.type === "text")?.text;
if (!text) throw new Error("Prazen odgovor");
return JSON.parse(text.replace(/```json|```/g, "").trim());
}
 
// ── Document design helpers ───────────────────────────────────────────────────
 
// Shared header: thin red line at top of every page
function makeDocHeader() {
return new Header({
children: [new Paragraph({
children: [],
spacing: { before: 0, after: 0 },
border: { bottom: { style: BorderStyle.SINGLE, size: 48, color: RED, space: 1 } },
})],
});
}
 
// Shared footer: thin red line at bottom of every page
function makeDocFooter() {
return new Footer({
children: [new Paragraph({
children: [],
spacing: { before: 0, after: 0 },
border: { top: { style: BorderStyle.SINGLE, size: 48, color: RED, space: 1 } },
})],
});
}
 
// Assemble final Document with dark background + header/footer
function buildDoc(children) {
return new Document({
background: { color: DARK_BG },
sections: [{
properties: {
page: {
size: { width: PAGE_W, height: PAGE_H },
margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
},
},
headers: { default: makeDocHeader() },
footers: { default: makeDocFooter() },
children,
}],
});
}
 
// Cover page brand block: "GAL REMEC COACHING" + two big title words
function coverBrand(word1, word2) {
return [
new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 800, after: 560 },
children: [new TextRun({ text: "GAL REMEC COACHING", bold: true, size: 22, color: RED, font: "Arial", characterSpacing: 60 })],
}),
new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 0, after: 0 },
children: [new TextRun({ text: word1, bold: true, size: 104, color: WHITE, font: "Arial" })],
}),
new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 0, after: 560 },
children: [new TextRun({ text: word2, bold: true, size: 104, color: WHITE, font: "Arial" })],
}),
];
}
 
// Red horizontal rule paragraph
function redRule(size = 12, after = 280) {
return new Paragraph({
children: [],
spacing: { before: 0, after },
border: { bottom: { style: BorderStyle.SINGLE, size, color: RED, space: 1 } },
});
}
 
// Stats boxes: two dark cards side by side (with dark spacer column between)
function statsTable(leftVal, leftLabel, rightVal, rightLabel) {
const bw = Math.floor((CW - 300) / 2); // each box width
 
const boxCell = (val, label, w) => new TableCell({
width: { size: w, type: WidthType.DXA },
shading: { fill: DARK_CARD, type: ShadingType.CLEAR },
borders: cellBorders,
margins: { top: 200, bottom: 200, left: 200, right: 200 },
verticalAlign: VerticalAlign.CENTER,
children: [
new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 100 }, children: [new TextRun({ text: String(val), bold: true, size: 68, color: WHITE, font: "Arial" })] }),
new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: label, size: 18, color: GRAY, font: "Arial", characterSpacing: 20 })] }),
],
});
 
const gapCell = new TableCell({
width: { size: 300, type: WidthType.DXA },
shading: { fill: DARK_BG, type: ShadingType.CLEAR },
borders: cellBorders,
children: [new Paragraph({ children: [] })],
});
 
return new Table({
width: { size: CW, type: WidthType.DXA },
columnWidths: [bw, 300, bw],
borders: tableBorders,
rows: [
new TableRow({
height: { value: 1500, rule: "atLeast" },
children: [boxCell(leftVal, leftLabel, bw), gapCell, boxCell(rightVal, rightLabel, bw)],
}),
],
});
}
 
// Full-width red header bar (used for day/workout titles)
function headerBar(leftLines, rightText) {
const lW = CW - 3200;
return new Table({
width: { size: CW, type: WidthType.DXA },
columnWidths: [lW, 3200],
borders: tableBorders,
rows: [
new TableRow({
height: { value: 880, rule: "atLeast" },
children: [
new TableCell({
width: { size: lW, type: WidthType.DXA },
shading: { fill: RED, type: ShadingType.CLEAR },
borders: cellBorders,
margins: { top: 120, bottom: 80, left: 240, right: 80 },
verticalAlign: VerticalAlign.CENTER,
children: leftLines.map((line, i) =>
new Paragraph({
spacing: { before: 0, after: i < leftLines.length - 1 ? 60 : 0 },
children: [new TextRun({ text: line.text, bold: line.bold !== false, size: line.size, color: WHITE, font: "Arial" })],
})
),
}),
new TableCell({
width: { size: 3200, type: WidthType.DXA },
shading: { fill: RED, type: ShadingType.CLEAR },
borders: cellBorders,
margins: { top: 80, bottom: 80, left: 80, right: 240 },
verticalAlign: VerticalAlign.CENTER,
children: [
new Paragraph({
alignment: AlignmentType.RIGHT,
children: [new TextRun({ text: rightText, bold: true, size: 18, color: WHITE, font: "Arial", characterSpacing: 20 })],
}),
],
}),
],
}),
],
});
}
 
// Meal card: dark card with left red accent, number/name/kcal left, ingredients right
function mealCard(meal, idx) {
const bg = idx % 2 === 0 ? DARK_CARD : DARK_ROW;
const lW = 2800, rW = CW - lW;
return new Table({
width: { size: CW, type: WidthType.DXA },
columnWidths: [lW, rW],
borders: tableBorders,
rows: [
new TableRow({
children: [
new TableCell({
width: { size: lW, type: WidthType.DXA },
shading: { fill: bg, type: ShadingType.CLEAR },
borders: { top: nb, bottom: nb, left: rb(16), right: rb(6) },
margins: { top: 120, bottom: 120, left: 200, right: 160 },
children: [
new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: String(meal.number).padStart(2, "0"), bold: true, size: 40, color: RED, font: "Arial" })] }),
new Paragraph({ spacing: { before: 0, after: 40 }, children: [new TextRun({ text: meal.name, bold: true, size: 20, color: WHITE, font: "Arial" })] }),
new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: meal.calories + " kcal | " + meal.protein + " g beljakovin", size: 18, color: GRAY, font: "Arial" })] }),
],
}),
new TableCell({
width: { size: rW, type: WidthType.DXA },
shading: { fill: bg, type: ShadingType.CLEAR },
borders: cellBorders,
margins: { top: 120, bottom: 120, left: 200, right: 200 },
children: meal.ingredients.map((ing) =>
new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: "- " + ing, size: 20, color: LIGHT, font: "Arial" })] })
),
}),
],
}),
],
});
}
 
// Exercise card: dark card with left red accent, number/name left, sets_reps/note right
function exerciseCard(ex, idx) {
const bg = idx % 2 === 0 ? DARK_CARD : DARK_ROW;
const lW = 2800, rW = CW - lW;
const rightChildren = [
new Paragraph({ spacing: { before: 0, after: ex.note ? 80 : 0 }, children: [new TextRun({ text: ex.sets_reps, bold: true, size: 34, color: WHITE, font: "Arial" })] }),
];
if (ex.note) {
rightChildren.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: ex.note, size: 18, color: GRAY, font: "Arial" })] }));
}
return new Table({
width: { size: CW, type: WidthType.DXA },
columnWidths: [lW, rW],
borders: tableBorders,
rows: [
new TableRow({
children: [
new TableCell({
width: { size: lW, type: WidthType.DXA },
shading: { fill: bg, type: ShadingType.CLEAR },
borders: { top: nb, bottom: nb, left: rb(16), right: rb(6) },
margins: { top: 120, bottom: 120, left: 200, right: 160 },
children: [
new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: String(idx + 1).padStart(2, "0"), bold: true, size: 36, color: RED, font: "Arial" })] }),
new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: ex.name, bold: true, size: 22, color: WHITE, font: "Arial" })] }),
],
}),
new TableCell({
width: { size: rW, type: WidthType.DXA },
shading: { fill: bg, type: ShadingType.CLEAR },
borders: cellBorders,
margins: { top: 120, bottom: 120, left: 200, right: 200 },
children: rightChildren,
}),
],
}),
],
});
}
 
// ── Meal plan DOCX generator ──────────────────────────────────────────────────
function generateMealDocx(userData, plan) {
const displayName = userData.name !== "ni podatka" ? userData.name.toUpperCase() : "";
const children = [];
 
// ── Cover page ──────────────────────────────────────────────────────────────
children.push(...coverBrand("MEAL", "PLAN"));
 
if (displayName) {
children.push(new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 0, after: 320 },
children: [new TextRun({ text: displayName, bold: true, size: 32, color: RED, font: "Arial", characterSpacing: 40 })],
}));
}
 
children.push(new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 0, after: 200 },
children: [new TextRun({ text: plan.summary.plan_type + " - " + plan.summary.meals_per_day + "x OBROK", size: 22, color: GRAY, font: "Arial", characterSpacing: 40 })],
}));
 
children.push(redRule(12, 280));
children.push(statsTable(
plan.summary.calories_per_day, "KALORIJ NA DAN",
plan.summary.protein_per_day + " g", "BELJAKOVIN NA DAN"
));
children.push(sp(280));
children.push(redRule(4, 200));
 
children.push(new Paragraph({
spacing: { before: 200, after: 180 },
children: [new TextRun({ text: "PRILAGODITVE JEDILNIKA", bold: true, size: 20, color: RED, font: "Arial", characterSpacing: 20 })],
}));
 
children.push(new Paragraph({
spacing: { before: 0, after: 200 },
children: [new TextRun({ text: plan.adaptations, size: 20, color: LIGHT, font: "Arial" })],
}));
 
// ── Intro page ──────────────────────────────────────────────────────────────
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(new Paragraph({
spacing: { before: 0, after: 200 },
children: [new TextRun({ text: plan.intro, size: 20, color: LIGHT, font: "Arial" })],
}));
 
// ── Day pages ───────────────────────────────────────────────────────────────
plan.days.forEach((day) => {
children.push(new Paragraph({ children: [new PageBreak()] }));
 
children.push(headerBar(
[
{ text: "DAN " + day.day, bold: true, size: 26 },
{ text: day.calories + " kcal - " + day.protein + " g beljakovin - " + day.meals.length + " obroki", bold: false, size: 20 },
],
"STRENGTH AND HONOR"
));
children.push(sp(120));
 
day.meals.forEach((meal, i) => {
children.push(mealCard(meal, i));
children.push(sp(80));
});
});
 
return Packer.toBuffer(buildDoc(children));
}
 
// ── Training plan DOCX generator ─────────────────────────────────────────────
function generateTrainingDocx(userData, plan) {
const displayName = userData.name !== "ni podatka" ? userData.name.toUpperCase() : "";
const location = (plan.summary.location || "").toUpperCase();
const children = [];
 
// ── Cover page ──────────────────────────────────────────────────────────────
children.push(...coverBrand("TRENING", "PROGRAM"));
 
if (displayName) {
children.push(new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 0, after: 320 },
children: [new TextRun({ text: displayName, bold: true, size: 32, color: RED, font: "Arial", characterSpacing: 40 })],
}));
}
 
children.push(new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 0, after: 200 },
children: [new TextRun({ text: plan.summary.split + " - " + (plan.summary.split_desc || "").toUpperCase(), size: 22, color: GRAY, font: "Arial", characterSpacing: 40 })],
}));
 
children.push(redRule(12, 280));
children.push(statsTable(
String(plan.summary.days_per_week), "TRENINGOV NA TEDEN",
location || "GYM", "LOKACIJA"
));
children.push(sp(280));
children.push(redRule(4, 200));
 
// Intro text
children.push(new Paragraph({
spacing: { before: 200, after: 200 },
children: [new TextRun({ text: plan.intro, size: 20, color: LIGHT, font: "Arial" })],
}));
 
// Gray divider
children.push(new Paragraph({
spacing: { before: 0, after: 200 },
border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GRAY, space: 1 } },
children: [],
}));
 
// Schedule section header
children.push(new Paragraph({
spacing: { before: 200, after: 160 },
children: [new TextRun({ text: "PRIMER TEDENSKEGA RAZPOREDA", bold: true, size: 20, color: RED, font: "Arial", characterSpacing: 20 })],
}));
 
// Schedule rows
plan.schedule.forEach((item, i) => {
const isRest = norm(item.workout).includes("poc") || norm(item.workout).includes("rest");
const bg = i % 2 === 0 ? DARK_CARD : DARK_ROW;
const accentColor = isRest ? GRAY : RED;
const textColor = isRest ? GRAY : LIGHT;
 
children.push(new Table({
width: { size: CW, type: WidthType.DXA },
columnWidths: [CW - 4000, 4000],
borders: tableBorders,
rows: [
new TableRow({
height: { value: 480, rule: "atLeast" },
children: [
new TableCell({
width: { size: CW - 4000, type: WidthType.DXA },
shading: { fill: bg, type: ShadingType.CLEAR },
borders: { top: nb, bottom: nb, left: { style: BorderStyle.SINGLE, size: 12, color: accentColor }, right: nb },
margins: { top: 60, bottom: 60, left: 200, right: 80 },
verticalAlign: VerticalAlign.CENTER,
children: [new Paragraph({ children: [new TextRun({ text: item.day.toUpperCase(), bold: true, size: 18, color: WHITE, font: "Arial" })] })],
}),
new TableCell({
width: { size: 4000, type: WidthType.DXA },
shading: { fill: bg, type: ShadingType.CLEAR },
borders: cellBorders,
margins: { top: 60, bottom: 60, left: 80, right: 200 },
verticalAlign: VerticalAlign.CENTER,
children: [new Paragraph({ children: [new TextRun({ text: item.workout, size: 18, color: textColor, font: "Arial" })] })],
}),
],
}),
],
}));
children.push(sp(40));
});
 
// "STRENGTH AND HONOR" footer on schedule page
children.push(sp(200));
children.push(new Paragraph({
alignment: AlignmentType.CENTER,
spacing: { before: 0, after: 0 },
children: [new TextRun({ text: "STRENGTH AND HONOR", bold: true, size: 20, color: WHITE, font: "Arial", characterSpacing: 40 })],
}));
 
// ── Workout pages ───────────────────────────────────────────────────────────
plan.workouts.forEach((workout) => {
children.push(new Paragraph({ children: [new PageBreak()] }));
 
children.push(headerBar(
[{ text: workout.name, bold: true, size: 44 }],
"STRENGTH AND HONOR"
));
children.push(sp(120));
 
workout.exercises.forEach((ex, i) => {
children.push(exerciseCard(ex, i));
children.push(sp(80));
});
});
 
return Packer.toBuffer(buildDoc(children));
}
 
// ── Email sender (unchanged, filenames already .docx) ────────────────────────
async function sendCombinedEmail(userData, mealBuffer, trainingBuffer) {
const name = userData.name !== "ni podatka" ? userData.name : "stranka";
await axios.post("https://api.resend.com/emails", {
from: "Plan Generator <onboarding@resend.dev>",
to: NOTIFY_EMAIL,
subject: name + " - jedilnik + trening program",
html: "<div style='font-family:Arial,sans-serif;background:#111;color:#fff;padding:30px;border-radius:8px;'><h2 style='color:#CC1F1F;'>GAL REMEC COACHING</h2><p>Jedilnik in trening program za <strong>" + name + "</strong> sta pripravljena.</p><table style='margin-top:16px;'><tr><td style='color:#888;padding:4px 12px 4px 0'>Ime:</td><td>" + name + "</td></tr><tr><td style='color:#888;padding:4px 12px 4px 0'>Cilj:</td><td>" + userData.goal + "</td></tr><tr><td style='color:#888;padding:4px 12px 4px 0'>Teza:</td><td>" + userData.weight + " kg</td></tr><tr><td style='color:#888;padding:4px 12px 4px 0'>Lokacija:</td><td>" + userData.location + "</td></tr></table></div>",
attachments: [
{ filename: "jedilnik-" + name.replace(/ /g, "-") + ".docx", content: mealBuffer.toString("base64") },
{ filename: "trening-" + name.replace(/ /g, "-") + ".docx", content: trainingBuffer.toString("base64") },
],
}, { headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" } });
}
 
// ── Routes (unchanged) ────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
res.json({ status: "ok", model: MODEL });
});
 
app.post("/webhook-combined", async (req, res) => {
console.log("Webhook combined received");
res.status(200).json({ received: true });
const userData = parseCombinedTallyData(req.body);
try {
console.log("Generating meal plan...");
const mealPlan = await generateMealPlan(userData);
console.log("Meal plan done");
console.log("Generating training plan...");
const trainingPlan = await generateTrainingPlan(userData);
console.log("Training plan done");
console.log("Generating documents...");
const mealBuffer = await generateMealDocx(userData, mealPlan);
const trainingBuffer = await generateTrainingDocx(userData, trainingPlan);
console.log("Documents done");
await sendCombinedEmail(userData, mealBuffer, trainingBuffer);
console.log("Email sent to:", NOTIFY_EMAIL);
} catch (err) {
console.error("Error:", err.response?.data || err.message);
}
});
 
app.listen(PORT, () => {
console.log("Port " + PORT + " | Model: " + MODEL + " | API key: " + (ANTHROPIC_API_KEY ? "OK" : "MISSING"));
});
