import express from "express";
import axios from "axios";
import {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  Header, Footer, PageBreak, TabStopType,
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

// -- Design palette (hex without #, matching original PDF) --------------------
const DARK_BG = "111111";
const DARK_CARD = "1A1A1A";
const DARK_ROW = "161616";
const RED = "CC1F1F";
const WHITE = "FFFFFF";
const GRAY = "888888";
const LIGHT = "CCCCCC";

// -- Page geometry (DXA units, A4: 1440 DXA = 1 inch) ------------------------
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 800; // ~40 pt, matching original PDF margins
const CW = PAGE_W - MARGIN * 2; // 10306 DXA usable content width

// -- Border / shading helpers -------------------------------------------------
const nb = { style: BorderStyle.NONE, size: 0, color: "auto" };
const rb = (sz = 8) => ({ style: BorderStyle.SINGLE, size: sz, color: RED });
const tableBorders = {
  top: nb, bottom: nb, left: nb, right: nb,
  insideHorizontal: nb, insideVertical: nb,
};
const cellBorders = { top: nb, bottom: nb, left: nb, right: nb };

// Spacer paragraph (spacing.after in twips: 240 twips = 12 pt)
const sp = (after = 120) => new Paragraph({ children: [], spacing: { before: 0, after } });

// -- FOOD_DB ------------------------------------------------------------------
const FOOD_DB = `
MESO IN PERUTNINA (na 100g surovo):
Piščančja prsa: 110kcal, 23g B | Piščančja stegna (brez kosti): 160kcal, 19g B | Puranja prsa: 114kcal, 24g B | Goveji zrezek (pusto): 150kcal, 22g B | Goveje meso mleto 5%: 135kcal, 21g B | Goveje meso mleto 20%: 250kcal, 17g B | Svinjski file: 143kcal, 21g B | Teletina: 110kcal, 20g B | Srna: 120kcal, 22g B | Jelenjad: 125kcal, 22g B
MESNI IZDELKI (na 100g):
Kuhan pršut/šunka: 110kcal, 18g B | Puranja šunka: 90kcal, 17g B | Piščančja prsa v ovitku: 85kcal, 16g B | Kraški pršut: 260kcal, 26g B | Hrenovka: 280kcal, 12g B | Čevapčiči surovi: 250kcal, 15g B
RIBE (na 100g):
Losos svež: 208kcal, 20g B | Tuna v lastnem soku: 116kcal, 25g B | Tuna v olju: 198kcal, 24g B | Skuša sveža: 305kcal, 19g B | Oslič: 90kcal, 17g B | Postrv: 148kcal, 21g B | Sardine v olju: 208kcal, 24g B | Tilapija: 128kcal, 26g B | Trska: 82kcal, 18g B | Kozice: 99kcal, 24g B
MLEČNI IZDELKI (na 100g):
Mleko 3.5%: 64kcal, 3.3g B | Grški jogurt 0%: 59kcal, 10g B | Grški jogurt 2%: 75kcal, 9.5g B | Skyr: 65kcal, 11g B | Pusta skuta: 72kcal, 12g B | Sir Cottage light: 70kcal, 12g B | Mozzarella light: 165kcal, 20g B | Parmezan: 431kcal, 38g B | Feta: 264kcal, 14g B | Ovseni napitek: 42kcal, 1g B | Mandljev napitek: 13kcal, 0.4g B | Kefir: 62kcal, 3.3g B
JAJCA (na 100g):
Kokošje jajce celo: 155kcal, 13g B | Jajčni beljak: 52kcal, 11g B
ZELENJAVA (na 100g surovo):
Brokoli: 34kcal, 2.8g B | Špinača: 23kcal, 2.9g B | Paprika rdeča: 31kcal, 1g B | Kumara: 15kcal, 0.7g B | Paradižnik: 18kcal, 0.9g B | Korenje: 41kcal, 0.9g B | Rukola: 25kcal, 2.6g B | Cvetača: 25kcal, 1.9g B | Bučka: 17kcal, 1.2g B | Šampinjoni: 22kcal, 3.1g B | Čebula: 40kcal, 1.1g B | Sladki krompir: 86kcal, 1.6g B | Koruza sladka: 86kcal, 3.2g B | Šparglji: 20kcal, 2.2g B
STROČNICE (na 100g):
Fižol kuhan: 127kcal, 8.7g B | Čičerika kuhana: 164kcal, 8.9g B | Leča kuhana: 116kcal, 9g B
SADJE (na 100g):
Banana: 89kcal, 1.1g B | Jabolko: 52kcal, 0.3g B | Jagode: 32kcal, 0.7g B | Borovnice: 57kcal, 0.7g B | Avokado: 160kcal, 2g B | Pomaranča: 47kcal, 0.9g B | Kivi: 61kcal, 1.1g B
ŽITA (na 100g suho):
Beli riž: 360kcal, 7g B | Basmati riž: 345kcal, 8.5g B | Ovseni kosmiči: 389kcal, 13.5g B | Testenine bele: 350kcal, 12g B | Polnozrnate testenine: 340kcal, 14g B | Krompir surovi: 77kcal, 2g B | Kvinoja: 368kcal, 14g B | Ajdova kaša: 343kcal, 13g B
KRUH (na 100g):
Polnozrnati kruh: 250kcal, 9.7g B | Toast polnozrnat: 260kcal, 9g B | Toast beli: 285kcal, 8.3g B | Tortilja pšenična: 310kcal, 8g B
OREŠKI (na 100g):
Mandlji: 579kcal, 21g B | Orehi: 654kcal, 15g B | Arašidovo maslo: 588kcal, 25g B | Chia semena: 486kcal, 17g B | Sončnična semena: 584kcal, 21g B
OLJA (na 100g):
Oljčno olje: 884kcal, 0g B | Maslo: 717kcal, 0.8g B
DODATKI (na 100g):
Med: 304kcal, 0.3g B | Sojina omaka: 53kcal, 8g B | Whey protein: 380kcal, 80g B | Veganski protein: 370kcal, 75g B
`;

// -- System prompts -----------------------------------------------------------
const MEAL_SYSTEM_PROMPT = `Si Gal Remec, slovenski online fitnes trener z 500+ uspešnimi transformacijami. Pišeš jedilnike v svojem stilu.
JEZIK: Piši kot izobražen Slovenec ki govori tekoče – naravno, jasno, brez okraskov. Vsak stavek mora zveneti kot da ga je napisal človek, ne generiral računalnik. NIKOLI ne prevajaj dobesedno iz angleščine – razmišljaj direktno v slovenščini. Dobesedni prevodi zvenijo robotsko in tuje. Pred vsakim stavkom si zastavi vprašanje: "Ali bi izobražen Slovenec to dejansko tako rekel?" Če ne – prepiši v naravno slovenščino. Pravilna sklanjatev (puranjih prsi, piščančjih prsi). Brez emojijev in posebnih simbolov. Številke s presledkom (114 g).
SPOL – KRITIČNO PRAVILO (DVA LOČENA GOVORCA):
1. GAL (trener, jaz ki pišem) = VEDNO MOŠKI SPOL brez izjeme. Glagoli in deležniki v prvi osebi so VEDNO moški: "sestavil sem", "dal sem", "vključil sem", "odločil sem se", "pripravil sem ti". NIKOLI "sestavila", "dala", "vključila" – tudi če je stranka ženska.
2. STRANKA (oseba ki jo naslavljam) = spol določen iz user prompta. Ženska stranka: "si navedla", "boš občutila", "si vključena", "se boš počutila". Moška stranka: "si navedel", "boš občutil". Primer pravilnega stavka za žensko stranko: "Plan sem ti sestavil na podlagi podatkov, ki si jih navedla." – "sestavil" je moški (jaz), "navedla" je ženski (ona).
TON: Strokoven, direkten, oseben, človeški. Naslavljaj z imenom in "ti". Piši tekoče, kot bi se pogovarjal z osebo – brez oklepajev, vezajev kot seznamov, dvopičij kot uvoda v podatke. Nikoli ne uporabi alinej ali bullet točk v uvodnih tekstih – samo tekoči odstavki.
ODSTAVKI: Uvodna besedila OBVEZNO razdeli na več ločenih odstavkov (vsaj 4 odstavke za adaptations), ločenih z dvema znakoma za novo vrstico (\\n\\n). Nikoli ne piši celega uvoda kot enega velikega bloka.

ADAPTATIONS (8–12 povedi v tekočih odstavkih): Piši človeško in tekoče. Obvezno vključi:
- Kontekst: na podlagi katerih podatkov je plan sestavljen (telesna masa, višina, aktivnost, cilj)
- Razlaga kaloričnega okvirja in zakaj je tak nastav – prevelik deficit vodi v lakoto in izgubo mišične mase, premajhen v stagnacijo
- Pomen beljakovin: mišična masa, sitost, regeneracija – specifično za cilj stranke
- Katere beljakovinske vire si vključil glede na preference stranke
- Ogljikovi hidrati: vloga glede na aktivnost, ne omejuj agresivno ker vplivajo na trening performans
- Maščobe: zmerne, kontrolirane, tehtanje ključno pri kalorično gostih živilih
- Prilagodljivost jedilnikov: niso toga pravila ampak strukturiran okvir – zamenjave so dovoljene in priporočene dokler okvir ostane stabilen
- Štetje kalorij: nujnost tehtanja hrane in vnašanja v aplikacijo (MyFitnessPal), fokus na kalorije in beljakovine
- Nasvet za zamenjave živil – piščančja prsa zamenjaj s puranjimi, riž s krompirjem itd, dokler so kalorije in beljakovine znotraj okvirja
Brez navajanja TDEE, BMR ali deficita kot številk. Brez ponavljanja podatkov iz vprašalnika. Brez oklepajev, vezajev in dvopičij kot seznamov.

INTRO (4–6 povedi): Zaključni motivacijski del. Kako meriti napredek – tedensko povprečje telesne teže, ne dnevne meritve, ogledalo, performans na treningu. Tehtnica lahko niha 1–2 kg na dan. Doslednost – napredek ni rezultat enega dobrega tedna ampak mesecev konsistentnega dela. Človeško, toplo, brez številk.

NAČELA:
- Deficit 500 kcal = 0,5 kg/teden za hujšanje. Prevelik deficit vodi v lakoto, slabšo regeneracijo in izgubo mišične mase.
- Beljakovine 1,8–2,2 g/kg. Jasen vir beljakovin v VSAKEM obroku – to je ne-negotiable pravilo.
- 25–40 g beljakovin na obrok.
- Ogljikovi hidrati: ne omejuj agresivno, vplivajo na trening performans.
- Maščobe: zmerne, kontrolirane. Problem pri maščobah je kalorična gostota, zato je tehtanje ključno.
- Obroki: enostavni, hitri za pripravo, smiselni, okusni, ponovljivi. Brez eksotike in kompliciranja.
- Zelenjava: VEDNO v obliki "150 g zelenjave po izbiri" ali podobno – nikoli specifično določena zelenjava razen če jo stranka posebej omeji ali prosi. Uporabljaj zelenjavo za volumen pri hujšanju – ne z makrohranili.
- Vsa živila se tehtajo surova. Riž, testenine in krompir se tehtajo kuhani (100 g surovega riža = 300 g kuhanega, 100 g surovih testenin = 250 g kuhanih, 100 g surovega krompirja = 87 g kuhanega). V adaptations omeni ta merila.
- Personalizacija je absolutna prioriteta – strankine želje, preference in omejitve so zakon.

RAZNOLIKOST MED DNEVI: Vsak dan mora imeti drugačne obroke kot ostala dva dni. Nikoli ne ponovi istega obroka (ali skoraj identičnega obroka) na isti poziciji v različnih dneh. Če je dan 1 zajtrk ovsena kaša z jogurtom, dan 2 in dan 3 ne smeta imeti ovsene kaše z jogurtom za zajtrk. Vsak obrok mora biti vsebinsko različen – različna živila, različna kombinacija, različen stil priprave. Isto živilo (npr. piščanec) je dovoljeno v različnih dneh, ampak v drugačni obliki ali kombinaciji (npr. dan 1 piščanec z rižem, dan 3 piščanec s kruhom/sendvič). Brez copy-paste obrokov med dnevi.

LOGIKA SESTAVE OBROKOV: Vsak obrok mora biti kulinarično in praktično smiseln – takšen kot ga nekdo dejansko pripravi in poje v enem obroku. V vsakem obroku je EN jasen protein vir. Ne mešaj nekompatibilnih živil samo zato da ustrežeš makrotom.

Dobre kombinacije:
- Whey/skyr/jogurt/skuta + ovseni kosmiči/sadje/oreščki/arašidovo maslo
- Jajca + kruh/toast + zelenjava ali sir ali šunka
- Piščanec/govedina/riba/tuna + riž/krompir/testenine + zelenjava
- Skuta/jogurt + sadje + oreščki (snack obrok)
- Tuna/piščanec + kruh = sendvič stil

Prepovedane kombinacije v istem obroku:
- Whey protein skupaj z jajci ali mesom – ne sodijo skupaj
- Piščanec ali riba z ovsenimi kosmiči – kulinarično nesmiselno
- Dva vira mesa ali dva proteinska praška v istem obroku
- Več kot en "težek" protein v istem obroku (npr. jajca + piščanec + whey)

Pravilo: Whey/proteinsko mleko/jogurt → brez jajc in mesa v tem obroku. Jajca ali meso → brez wheya v tem obroku.

DOVOLJENI VIRI HRANIL:
Beljakovine: piščančje prsi, puranja prsa, govedina (pusta 5%), bele ribe (oslič, tilapija, brancin), losos, tuna, grški jogurt (0%, 5%, 10%), jajca, skyr, whey protein, proteinsko mleko, zrnati sir, skuta
Ogljikovi hidrati: ovseni kosmiči, basmati riž, beli riž, polnozrnate testenine, bele testenine, krompir, sladki krompir, polnozrnat kruh, beli kruh, sadje (banana, jabolko, hruška, jagode, borovnice, maline, mango itd.)
Maščobe: oreščki (mandlji, orehi, arašidi itd.), avokado, olivno olje, maslo, arašidovo maslo, temna čokolada, losos, jajca

JUNK FOOD PRAVILO: Če stranka v preferencah navede da želi imeti hitro hrano, junk food ali specifičen junk food izdelek (npr. Big Mac, pizza, čips, burger itd.), ga OBVEZNO vključi v jedilnik – to je njena preferenca in jo moraš spoštovati. STROGO PRAVILO: Junk food nikoli ne sme preseči 20% dnevnih kalorij. Preostalih 80% kalorij mora priti iz zdravih, polnovrednih virov. Junk food vključi v en obrok na dan (tipično večer ali popoldne), nikoli ne razporediti čez cel dan. V adaptations omeni da si upošteval to željo in poudariti 20% pravilo.

PREPOVEDANA ŽIVILA: Nikoli ne vključi humusa, soje in sojinih izdelkov (sojin jogurt, sojin napitek, sojini koščki, tofu, tempeh, edamame). To velja za VSE stranke brez izjeme.`;

const TRAINING_SYSTEM_PROMPT = `Si Gal Remec, slovenski online fitnes trener z 500+ uspešnimi transformacijami. Pišeš trening programe v svojem stilu.
JEZIK: Piši kot izobražen Slovenec ki govori tekoče – naravno, jasno, brez okraskov. Vsak stavek mora zveneti kot da ga je napisal človek, ne generiral računalnik. NIKOLI ne prevajaj dobesedno iz angleščine – razmišljaj direktno v slovenščini. Dobesedni prevodi zvenijo robotsko in tuje. Pred vsakim stavkom si zastavi vprašanje: "Ali bi izobražen Slovenec to dejansko tako rekel?" Če ne – prepiši v naravno slovenščino. Pravilna sklanjatev pridevnikov. Nazivi vaj v angleščini. Brez emojijev in posebnih simbolov.
SPOL – KRITIČNO PRAVILO (DVA LOČENA GOVORCA):
1. GAL (trener, jaz ki pišem) = VEDNO MOŠKI SPOL brez izjeme. Glagoli in deležniki v prvi osebi so VEDNO moški: "sestavil sem", "dal sem", "vključil sem", "pripravil sem ti", "odločil sem se". NIKOLI "sestavila", "dala", "vključila" – tudi če je stranka ženska.
2. STRANKA (oseba ki jo naslavljam) = spol določen iz user prompta. Ženska stranka: "si navedla", "boš občutila", "boš opazila". Moška stranka: "si navedel", "boš občutil". Primer pravilnega stavka za žensko stranko: "Ta program sem ti sestavil glede na podatke, ki si jih navedla." – "sestavil" je moški (jaz), "navedla" je ženski (ona).
TON: Strokoven, direkten, človeški – naslavljaj z imenom in "ti". Piši tekoče, brez oklepajev in vezajev. Nikoli ne uporabi alinej ali bullet točk v uvodnem tekstu – samo tekoči odstavki.
ODSTAVKI: Uvodni tekst OBVEZNO razdeli na 4 ali več ločenih odstavkov, ločenih z dvema znakoma za novo vrstico (\\n\\n). Nikoli ne piši enega velikega bloka.

INTRO (12–16 povedi v tekočih odstavkih): Začni z "Ta trening program je pripravljen glede na...". Obvezno vključi:
- Kontekst: starost, telesna masa, aktivnost, cilj
- Opis strukture programa (koliko dni, kakšne enote, zakaj ta razporeditev)
- Ogrevanje: specifično za vsak tip dneva (upper/lower/itd.), 5–10 minut dinamičnega ogrevanja, 1–2 pripravljalni seriji z nižjo težo za prvo vajo
- Intenzivnost: vsaka delovna serija mora biti izvedena do tehnične mišične odpovedi – zadnja ponovitev mora biti zadnja možna ponovitev s čisto tehniko
- Tehnika: absolutna prioriteta, kontroliran spust, poln obseg giba, brez sunkov – specifični nasveti za ključne vaje programa
- Počitek med serijami: ker treniraš do odpovedi, mora biti počitek dovolj dolg za popolno regeneracijo – 3 do 5 minut ali kolikor rabiš. Ne omejevaj počitka z uro, poslušaj telo
- Progresivna obremenitev: ko v obeh delovnih serijah dosežeš zgornjo mejo razpona ponovitev s čisto izvedbo, naslednji trening rahlo povečaj težo ali dodaj ponovitev – to je edini način za dolgoročen napredek
- Fokus med izvedbo: miselna povezava z mišico, telefon stran, brez pogovarjanja med vajami
- Poslušanje telesa: mišična utrujenost je normalna, ostra bolečina v sklepu ni – prilagoditev ni korak nazaj
- Poškodbe (če obstajajo): specifični napotki za vsako poškodbo ali omejitev
- Regeneracija: spanje, prehrana, stabilen ritem
- Zadnji odstavek vedno o doslednosti kot ključu do rezultatov

NAČELA:
- 2 delovni seriji na vajo. Nikoli več razen če je eksplicitno utemeljeno.
- Maksimalno 6 vaj na trening.
- Razpon ponovitev: Moč 4–6 ali 5–8, Hipertrofija 6–12 ali 8–12, Izolacija 12–15 ali 15–20.
- Vsaka delovna serija do tehnične mišične odpovedi – zadnja ponovitev mora biti zadnja možna s čisto tehniko.
- Compound vaje VEDNO na začetku, izolacijske na koncu. Brez izjem.
- Počitek: ker treniraš do odpovedi, mora biti počitek dovolj dolg za popolno regeneracijo – 3 do 5 minut ali kolikor rabiš.

STRUKTURA GLEDE NA FREKVENCO:
2x/teden → Full Body
3x/teden → Upper/Upper/Lower ali Lower/Lower/Upper ali Push/Pull/Legs (v fitnesu). Odvisno od spola, ciljev in opreme.
4x/teden → Upper/Lower/Upper/Lower ali Push/Pull/Legs + Arms & Shoulders ali Upper/Lower/Core+Cardio/Upper ali Lower
5x/teden → Upper/Lower/Arms+Shoulders/Upper/Lower ali Push/Pull/Legs/Upper/Lower ali Push/Pull/Legs/Arms+Shoulders/Core+Cardio
6x/teden → Push/Pull/Legs/Push/Pull/Legs ali Upper/Lower/Posterior/Anterior/Arms+Shoulders/Core+Cardio
To ni fiksno – je izhodišče za logično presojo glede na cilj, nivo in opremo. Končna odločitev vedno upošteva cilj stranke.

RAZPORED POČITKA:
Po vsakem treningu mora biti vsaj vsak 2. dan počitek ali 2 zaporedna treninga in nato počitek. Pri 5 treningih: 2 treningi, počitek, 3 treningi (3. je lažji in manj izčrpavajoč), počitek. Pri 6 treningih: PPL, počitek, PPL, počitek.

POUDARKI GLEDE NA SPOL:
Ženske: poudarek na nogah, zadnjici, coru in trebuhu. Zgornji del ni poglavitni fokus – prisoten je za uravnotežen razvoj, ne dominira.
Moški: uravnotežen razvoj, poudarek na prsi, hrbtu, ramenih, rokah in nogah glede na cilj.

CARDIO: Dodaj SAMO če posameznik ni aktiven (pod 5000 korakov/dan) ali je v slabi fizični formi. Aktivnim strankam cardio ni potreben razen če specifično zahtevano ali v opombah navedeno.

KARDIO NAVODILA (za kardio dneve):
- Kardio dan mora biti napisan kot workout z vajami (naprava, čas, kcal)
- Opcije: Sobno kolo (30–45 min, 250–400 kcal), Tek na tekoči stezi (25–40 min, 250–400 kcal, 8–11 km/h), Eliptični trenažer (30–45 min, 280–400 kcal), Veslarski ergometer (20–30 min, 250–350 kcal), Stairmaster (25–35 min, 300–400 kcal), Hoja na nagnjeni tekoči stezi (35–50 min, 200–300 kcal, naklon MINIMALNO 10%, nikoli manj, hitrost 5–6 km/h)
- Za kardio dan naredi workout z 2–3 napravami, vsaka ima: ime naprave, čas in približni kcal, navodila za intenzivnost

SCHEDULE PRAVILO: V polju "workout" v razporedu napiši SAMO ime treninga brez oklepajev, razlag ali mišičnih skupin. Primer: "UPPER A" ne "UPPER A (prsi, ramena, triceps)". "Počitek" ne "Počitek (regeneracija)".

DOVOLJENE VAJE DOMA (samo z opremo ki jo stranka ima):
Zgornji del: Push-up (wide grip, close grip, diamond, weighted, na kolenih), floor press, dumbbell floor press, bent-over barbell/dumbbell row, single-arm dumbbell row (opora na klopi ali stolu), biceps curl, hammer curl, overhead triceps extension, chair dips, lateral raises, bent-over rear delt fly, face pull z elastiko, chest fly z elastiko, pullover z elastiko, straight bar curl, EZ bar curl
Jedro: Dead bug, bird dog, plank, side plank, leg raises, hanging leg raises (če ima palico), cable crunch z elastiko, Pallof press z elastiko, Russian twist, trebušnjaki, ab wheel
Noge: Goblet squat, barbell squat, Romanian deadlift, walking lunges, reverse lunge, Bulgarian split squat, glute bridge, standing calf raises, abdukcije z elastiko, step-up (na klop ali stol)

DOVOLJENE VAJE V FITNESU:
Prsi: machine chest press, dumbbell bench press, incline dumbbell press, incline smith machine press, cable chest press, flat dumbbell press, pec deck fly, cable fly, dips
Hrbet: lat pulldown (wide/close grip), seated cable row, close grip cable row, chest-supported row, barbell row, dumbbell row, single-arm row, straight-arm pulldown, face pull, pull-up, assisted pull-up, machine row
Ramena: dumbbell shoulder press, machine shoulder press, seated dumbbell press, lateral raises, cable lateral raise, rear delt fly (naprava/ročke), face pull, shrug
Roke: EZ bar curl, dumbbell biceps curl, cable curl, straight bar curl, hammer curl, incline dumbbell curl, overhead triceps extension (vse variacije), cable triceps pushdown, skull crusher, dips, close-grip bench press
Noge: back squat, hack squat, goblet squat, smith machine squat, pendulum squat, leg press, leg extension, leg curl (leže/sede), Romanian deadlift, hip thrust (barbell/mašina), glute bridge, Bulgarian split squat, walking lunges, reverse lunge, step-up, cable kickback, abduction machine, adduction machine, standing/seated calf raises, back extension
Jedro: hanging leg raises, cable crunch, ab wheel, dead bug, plank, side plank, Pallof press, Russian twist

OPREMA – STROGO PRAVILO: Sestavi program IZKLJUČNO iz opreme ki jo je stranka eksplicitno navedla. Ne predpostavljaj NIČESAR kar ni omenjeno. Če stranka napiše samo "dumbbell" ali "uteži" ali "utež" – program vsebuje SAMO vaje z dumbbelli/utežmi. Brez pull-up bara, brez kablov, brez naprav, brez klopi, brez vrat – razen če je eksplicitno napisano. Dvomiš? Izpusti vajo.`;

// -- Utility functions --------------------------------------------------------
function norm(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Odstrani emojije in problematične znake, ki se v docx prikazujejo kot ????
function sanitizeText(str) {
  if (!str) return "";
  return String(str)
    // Odstrani vse emoji in simbole (Unicode supplementary planes)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    // Odstrani zero-width joiner in variation selectors
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, "")
    // Odstrani replacement character
    .replace(/\uFFFD/g, "")
    .trim();
}

// Razdeli besedilo na odstavke (po dveh novih vrsticah ali eni novi vrstici)
function splitParagraphs(text) {
  if (!text) return [];
  const cleaned = sanitizeText(text);
  // Najprej poskusi razdeliti po dvojnih presledkih (\n\n), potem po enojnih
  let parts = cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    parts = cleaned.split(/\n/).map((p) => p.trim()).filter(Boolean);
  }
  return parts.length > 0 ? parts : [cleaned];
}

// Zazna spol iz imena (slovenska imena na -a so večinoma ženska)
function detectGenderFromName(fullName) {
  if (!fullName || fullName === "ni podatka") return "moški";
  const firstName = String(fullName).trim().split(/\s+/)[0].toLowerCase();
  if (!firstName) return "moški";
  // Znane izjeme – moška imena, ki se končajo na -a
  const maleExceptions = [
    "luka", "matija", "miha", "jaka", "saša", "sasa",
    "aljaža", "aljaza", "nika" /* pogosto žensko, ampak ok */,
    "andrea", "uroš", "ilija", "nikita", "joža", "joza",
  ];
  // Odstrani "nika" iz izjem – je pretežno žensko
  const actualMaleExceptions = maleExceptions.filter((n) => n !== "nika");
  if (actualMaleExceptions.includes(firstName)) return "moški";
  // Končnice, ki kažejo na žensko ime
  if (/[aeou]$/i.test(firstName) && firstName.endsWith("a")) return "ženska";
  return "moški";
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
  // Spol: prioriteta – eksplicitno polje v formi, nato avtomatska zaznava iz imena
  const genderFromForm = getChoice("spol") !== "ni podatka" ? getChoice("spol") : get("spol");
  data.gender = (genderFromForm && genderFromForm !== "ni podatka")
    ? genderFromForm
    : detectGenderFromName(data.name);
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
  // Pri nizkem BMI (< 22) — oseba je suha, beljakovine bolj kritične → višji multiplikator
  const bmi = weight / ((height / 100) * (height / 100));
  const proteinMultiplier = bmi < 22 ? 2.4 : 2.0;
  const targetProtein = Math.round(weight * proteinMultiplier);
  // Display ranges (rounded to nearest 50 kcal ±50, nearest 10g protein ±10)
  const calBase = Math.round(targetCalories / 50) * 50;
  const calRange = `${calBase - 50}–${calBase + 50}`;
  const protBase = Math.round(targetProtein / 10) * 10;
  const protRange = `${protBase - 10}–${protBase + 10}`;
  const isFemale = userData.gender === "ženska" || userData.gender === "ženski" || userData.gender === "zenska";
  const genderLabel = isFemale ? "ženski" : "moški";
  const prompt = `Ustvari 4-dnevni prehranski načrt. Vrni SAMO čisti JSON.
BAZA ŽIVIL:
${FOOD_DB}
IZRAČUNANI PODATKI (za interno izračunavanje obrokov):
- Cilj: ${targetCalories} kcal (${planType}) | Beljakovine: ${targetProtein} g
PRIKAZ V DOKUMENTU (uporabi te razpone v JSON poljih calories_per_day, protein_per_day in v vsakem dnevu):
- Kalorije: "${calRange}" | Beljakovine: "${protRange} g"
STRANKA: ${name}, ${age} let, ${weight} kg, ${height} cm, cilj: ${userData.goal}, spol: ${isFemale ? "ženska" : "moški"}
Rad je: ${userData.likes} | Ne mara: ${userData.dislikes} | Obroki: ${mealsCount} | Alergije: ${userData.allergies}
JEZIK IN SLOG (OBVEZNO):
- SPOL – DVA GOVORCA: Ko JAZ (Gal, trener) govorim o svojih dejanjih → VEDNO MOŠKI: "sestavil sem", "vključil sem", "dal sem", "odločil sem". Ko govorim O STRANKI ali JO naslavljam → ${isFemale ? "ŽENSKI spol: 'si navedla', 'boš občutila', 'si dosegla'" : "MOŠKI spol: 'si navedel', 'boš občutil', 'si dosegel'"}. Primer: "Plan sem ti sestavil na podlagi podatkov, ki si jih ${isFemale ? "navedla" : "navedel"}."
- Uporabljaj SAMO naravno, pravilno, knjižno slovenščino s pravilnimi šumniki (č, š, ž). Nobenih izmišljenih besed. Beseda "nastav" ni dovoljena – uporabi "okvir", "nastavitev", "postavitev".
- ABSOLUTNO BREZ EMOJIJEV, ikon, posebnih simbolov. Samo navadno besedilo s šumniki.
- Nobenih oklepajev (razen pri številkah), nobenih pomišljajev v sredini povedi.
JSON struktura:
{
  "summary": { "calories_per_day": "${calRange}", "protein_per_day": "${protRange} g", "meals_per_day": ${mealsCount}, "plan_type": "${planType}" },
  "adaptations": "Besedilo v Galovem osebnem slogu – direkten, sproščen, kot sporočilo fitnes trenerja. Naslavljaj ${name} z 'ti' in v ${genderLabel} obliki. OBVEZNO razdeli besedilo na 6 DO 8 KRATKIH ODSTAVKOV – vsak odstavek loči z dvema znakoma za novo vrstico (\\n\\n). VSAK ODSTAVEK MAX 3 POVEDI – kratke, direktne. Piši naravno slovenščino z vsemi šumniki. BREZ emojijev. Vsebuje (vsaka točka = en kratek odstavek): 1) Kontekst – telesna masa, višina, aktivnost, cilj. 2) Kalorični okvir ${calRange} kcal – zakaj je smiseln za cilj. 3) Pomen beljakovin ${protRange} g – ohranitev mišic, sitost, regeneracija. 4) Kateri beljakovinski viri so vključeni glede na preference. 5) Ogljikovi hidrati – kateri viri, ne omejuj agresivno. 6) Maščobe – zmerno, tehtanje ključno. 7) Prilagodljivost – zamenjave dovoljene, MyFitnessPal, fokus na kalorije in beljakovine. 8) Merila za kuhanje: riž 100 g surovo = 300 g kuhano, testenine 100 g = 250 g kuhano, krompir 100 g = 87 g kuhano. Brez TDEE ali BMR kot številk. Brez oklepajev in vezajev.",
  "intro": "ZAKLJUČNI DEL (4-6 povedi v enem ali dveh odstavkih) v Galovem slogu – direkten, sproščen, v ${genderLabel} obliki naslavljanja. Kratke povedi. BREZ emojijev. Vsebuje: 1) Napredek – kako ga meriš: tedensko povprečje telesne teže ne dnevne meritve ker tehtnica niha 1-2 kg na dan, ogledalo, performans na treningu. 2) Doslednost – napredek ni rezultat enega dobrega tedna ampak mesecev konsistentnega dela. 3) Kratek motivacijski zaključek. Brez oklepajev in vezajev.",
  "days": [{ "day": 1, "calories": "${calRange}", "protein": "${protRange} g", "meals": [{ "number": 1, "name": "ZAJTRK", "calories": 500, "protein": 35, "ingredients": ["100 g ovsenih kosmičev (389 kcal, 13,5 g B)"] }] }]
}
PRAVILA:
- GENERIRAJ TOČNO 4 DNEVE (dan 1, dan 2, dan 3, dan 4) v "days" seznamu
- ${mealsCount} obrokov/dan, 3–6 sestavin – vsaka sestavina SAMO gramatura + ime, brez kcal, brez beljakovin, brez oklepajev, brez "– X g surovega" pripomb. Primer: "160 g piščančjih prsi", "300 g kuhanega basmati riža", "1 proteinski puding". NIC drugega.
- Vsak obrok ima jasen vir beljakovin, ogljikovih hidratov in zdravih maščob
- Zelenjava VEDNO kot "150 g zelenjave po izbiri" ali podobno – nikoli specifično določena zelenjava
- Vsa živila se tehtajo surova. Riž, testenine in krompir se tehtajo KUHANI (100 g surovega riža = 300 g kuhanega, 100 g surovih testenin = 250 g kuhanih)
- Pri hujšanju dodajaj volumen z zelenjavo, ne z makrohranili
- Enostavni, hitri za pripravo, smiselni, okusni obroki – brez eksotike in kompliciranja
- Vsak obrok ima EN protein vir. NE mešaj whey + jajca, NE mešaj piščanca z ovsenimi kosmiči – samo kulinarično logične kombinacije
- RAZNOLIKOST: Vsi 4 dnevi morajo imeti popolnoma različne obroke. Ne ponavljaj istega obroka na isti poziciji v različnih dneh (npr. isti zajtrk dan 1 in dan 3 je prepovedano)
- Če stranka želi junk food (navedeno v preferencah), ga OBVEZNO vključi v en obrok na dan – MAKSIMALNO 20% dnevnih kalorij (= max ${Math.round(targetCalories * 0.2)} kcal) iz junk fooda, preostalih 80% iz zdravih virov
- NE vključi: ${userData.dislikes}, ${userData.allergies}, humus, soja, sojini izdelki, tofu, tempeh, edamame
- BREZ EMOJIJEV IN POSEBNIH ZNAKOV V CELOTNEM JSON-u.
- SAMO JSON.`;
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
  if (days <= 2) { splitType = "FULL BODY"; splitDesc = "2 dni na teden"; }
  else if (days === 3) { splitType = "PUSH / PULL / LEGS"; splitDesc = "3 dni na teden"; }
  else if (days === 4) { splitType = "UPPER / LOWER"; splitDesc = "4 dni na teden"; }
  else if (days === 5) { splitType = "UPPER / LOWER / ARMS + SHOULDERS"; splitDesc = "5 dni na teden"; }
  else { splitType = "PUSH / PULL / LEGS"; splitDesc = days + " dni na teden"; }
  const isFemale = userData.gender === "ženska" || userData.gender === "ženski" || userData.gender === "zenska";
  const genderLabel = isFemale ? "ženski" : "moški";
  const prompt = `Ustvari personaliziran trening program. Vrni SAMO čisti JSON.
STRANKA: ${name}, ${userData.age} let, ${userData.weight} kg, spol: ${isFemale ? "ženska" : "moški"}, aktivnost: ${userData.activity}, cilj: ${userData.goal}, lokacija: ${userData.location}, oprema: ${userData.equipment}
JEZIK IN SLOG (OBVEZNO):
- SPOL – DVA GOVORCA: Ko JAZ (Gal, trener) govorim o svojih dejanjih → VEDNO MOŠKI: "sestavil sem", "vključil sem", "dal sem", "pripravil sem". Ko govorim O STRANKI ali JO naslavljam → ${isFemale ? "ŽENSKI spol: 'si navedla', 'boš občutila', 'boš opazila'" : "MOŠKI spol: 'si navedel', 'boš občutil', 'boš opazil'"}. Primer: "Ta program sem ti sestavil glede na podatke, ki si jih ${isFemale ? "navedla" : "navedel"}."
- Uporabljaj SAMO naravno, pravilno, knjižno slovenščino s pravilnimi šumniki (č, š, ž). Nobenih izmišljenih besed. Beseda "nastav" ni dovoljena.
- ABSOLUTNO BREZ EMOJIJEV, ikon, posebnih simbolov. Samo navadno besedilo s šumniki.
- Nobenih oklepajev v sredini povedi.
Ne mara vaj: ${userData.exDislikes} | Ima rad: ${userData.exLikes}
Treningov/teden: ${days} | Poškodbe: ${userData.injuries} | Opombe: ${userData.trainingNotes}
PREDLAGAN SPLIT: ${splitType} (prilagodi glede na cilj, nivo, opremo in opombe stranke po pravilih iz sistema)
JSON struktura:
{
  "summary": { "name": "${name}", "days_per_week": ${days}, "split": "${splitType}", "split_desc": "${splitDesc}", "location": "${userData.location}" },
  "intro": "Besedilo v Galovem osebnem slogu – direkten, sproščen, kot sporočilo fitnes trenerja. Naslavljaj v ${genderLabel} obliki. OBVEZNO razdeli besedilo na 6 DO 8 KRATKIH ODSTAVKOV – vsak odstavek loči z dvema znakoma za novo vrstico (\\n\\n). VSAK ODSTAVEK MAX 3 POVEDI – kratke, direktne, brez dolgih razlag. BREZ emojijev in posebnih znakov. NE piši kot uradni dokument. Brez alinej ali bullet točk. Začni z 'Ta trening program je sestavljen glede na...'. Vsebuje (vsaka točka = en kratek odstavek): 1) kontekst za koga je plan, 2) kakšen je split in zakaj, 3) trening do tehnične odpovedi – zadnja ponovitev mora biti zadnja možna s čisto tehniko, 4) tehnika in kontroliran spust, 5) kako dodajaš težo (progressive overload), 6) počitek med serijami, 7) kardio in koraki, 8) regeneracija in doslednost.",
  "schedule": [{ "day": "Ponedeljek", "workout": "PUSH" }, { "day": "Torek", "workout": "Počitek" }, { "day": "Sreda", "workout": "PULL" }, { "day": "Četrtek", "workout": "Počitek" }, { "day": "Petek", "workout": "LEGS" }, { "day": "Sobota", "workout": "Počitek" }, { "day": "Nedelja", "workout": "Počitek" }],
  "workouts": [{ "name": "PUSH", "exercises": [{ "name": "Smith machine bench press", "sets_reps": "2 x 6-10", "note": "Kontroliran spust." }] }]
}
KRITIČNO PRAVILO – OPOMBE STRANKE IMAJO ABSOLUTNO PRIORITETO: Če stranka v polju "Opombe" ali "Sestava treninga" specificira strukturo (npr. "2x tedensko noge in rit, ostalo kardio", "samo kardio", "samo noge", "2x full body"), POPOLNOMA IGNORIRAJ predlagan split in vse standardne sheme. Naredi IZKLJUČNO in TOČNO to kar piše v opombah. Nobenih UPPER dni, nobenih PUSH/PULL dni, nobenih dodatnih tipov treningov ki niso eksplicitno navedeni. Opombe stranke = zakon, brez izjem, brez dodajanja.
PRAVILA:
- 2 delovni seriji na vajo (format "2 x 6-10"), maksimalno 6 vaj na trening dan
- Compound vaje na začetku, izolacijske na koncu – vedno, brez izjem
- Razpon ponovitev: compound 5-8 ali 6-10, izolacija 10-15 ali 12-15
- Počitek: ker treniraš do odpovedi, mora biti počitek dovolj dolg za popolno regeneracijo – 3 do 5 minut ali kolikor rabiš
- Kardio dnevi = workout z 2-3 kardio napravami (naprava, čas, kcal, intenzivnost)
- Hoja na tekoči stezi: naklon VEDNO min 10%, nikoli manj
- Cardio dodaj SAMO če stranka ni aktivna (pod 5000 korakov/dan) ali je v opombah zahtevano
- Za kardio dneve v schedule napiši "Kardio"
- workouts seznam mora vsebovati KARDIO kot workout dan z vajami (če je kardio v schedule)
- OPREMA – STROGO PRAVILO: Sestavi program IZKLJUČNO iz opreme ki jo je stranka eksplicitno navedla. Ne predpostavljaj NIČESAR kar ni omenjeno. Če stranka napiše samo "dumbbell" ali "uteži" – program vsebuje SAMO vaje z dumbbelli/utežmi. Brez pull-up bara, brez kablov, brez naprav, brez klopi, brez vrat – razen če je eksplicitno napisano. Dvomiš? Izpusti vajo.
- Prilagodi lokaciji (doma = brez naprav razen kar je navedeno, fitnes = naprave + uteži)
- NE vključi: ${userData.exDislikes}
- Prilagodi poškodbe: ${userData.injuries}
- BREZ EMOJIJEV IN POSEBNIH ZNAKOV V CELOTNEM JSON-u.
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

// -- Document design helpers --------------------------------------------------

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

// Shared footer: red line + brand name at bottom of every page
function makeDocFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "\u00A9 GAL REMEC COACHING", size: 16, color: GRAY, font: "Arial", characterSpacing: 40 })],
      spacing: { before: 120, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: 48, color: RED, space: 6 } },
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
                children: [new TextRun({ text: line.text, bold: line.bold !== false, size: line.size, color: line.color || WHITE, font: "Arial" })],
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

// Vrne samo čisto ime sestavine brez kcal, beljakovin, oklepajev in konverzijskih opomb
function splitIngredient(ing) {
  let name = String(ing || "");
  // Odstrani vse oklepaje z vsebino: "(345 kcal, 8,5 g B)", "(389 kcal, 13,5 g B)" itd.
  name = name.replace(/\s*\([^)]*\)/g, "");
  // Odstrani "– 100 g surovega" ali "- 100 g surovega" tip konverzijskih opomb
  name = name.replace(/\s*[–\-]\s*\d+\s*g\s*surovega[^,]*/gi, "");
  // Odstrani morebitne odvečne presledke in pomišljaje na koncu
  name = name.replace(/\s*[–\-]\s*$/, "").trim();
  return { name, info: "" };
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
              new Paragraph({ spacing: { before: 0, after: 40 }, children: [new TextRun({ text: sanitizeText(meal.name), bold: true, size: 20, color: WHITE, font: "Arial" })] }),
              new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: meal.calories + " kcal | " + meal.protein + " g beljakovin", size: 18, color: GRAY, font: "Arial" })] }),
            ],
          }),
          new TableCell({
            width: { size: rW, type: WidthType.DXA },
            shading: { fill: bg, type: ShadingType.CLEAR },
            borders: cellBorders,
            margins: { top: 100, bottom: 100, left: 160, right: 160 },
            children: meal.ingredients.map((ing) => {
              const { name } = splitIngredient(sanitizeText(ing));
              return new Paragraph({
                spacing: { before: 40, after: 40 },
                children: [new TextRun({ text: name, size: 20, color: LIGHT, font: "Arial" })],
              });
            }),
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
    new Paragraph({ spacing: { before: 0, after: ex.note ? 80 : 0 }, children: [new TextRun({ text: sanitizeText(ex.sets_reps), bold: true, size: 34, color: WHITE, font: "Arial" })] }),
  ];
  if (ex.note) {
    rightChildren.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: sanitizeText(ex.note), size: 18, color: GRAY, font: "Arial" })] }));
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
              new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: sanitizeText(ex.name), bold: true, size: 22, color: WHITE, font: "Arial" })] }),
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

// -- Meal plan DOCX generator -------------------------------------------------
function generateMealDocx(userData, plan) {
  const displayName = userData.name !== "ni podatka" ? userData.name.toUpperCase() : "";
  const children = [];

  // Cover page
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
    plan.summary.protein_per_day, "BELJAKOVIN NA DAN"
  ));
  children.push(sp(280));
  children.push(redRule(4, 200));

  children.push(new Paragraph({
    spacing: { before: 200, after: 180 },
    children: [new TextRun({ text: "PRILAGODITVE JEDILNIKA", bold: true, size: 24, color: RED, font: "Arial", characterSpacing: 20 })],
  }));

  // Adaptations (glavno uvodno besedilo) – razdeljeno na odstavke, font 12pt (size 24)
  // keepLines: true zagotovi, da se odstavek ne razpolovi čez stran
  const adaptationParagraphs = splitParagraphs(plan.adaptations);
  adaptationParagraphs.forEach((para, idx) => {
    children.push(new Paragraph({
      spacing: { before: idx === 0 ? 0 : 200, after: 200, line: 340 },
      keepLines: true,
      children: [new TextRun({ text: para, size: 24, color: LIGHT, font: "Arial" })],
    }));
  });

  // Day pages – vsak dan na svoji strani (od strani 3 naprej)
  plan.days.forEach((day) => {
    children.push(new Paragraph({ children: [new PageBreak()] }));

    children.push(headerBar(
      [
        { text: "DAN " + day.day, bold: true, size: 26 },
        { text: day.calories + " kcal \u2013 " + day.protein + " g beljakovin", bold: false, size: 20, color: "E8B8B8" },
      ],
      "STRENGTH AND HONOR"
    ));
    children.push(sp(120));

    day.meals.forEach((meal, i) => {
      children.push(mealCard(meal, i));
      children.push(sp(80));
    });
  });

  // Zaključno motivacijsko besedilo na koncu dokumenta (na svoji strani)
  if (plan.intro) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      spacing: { before: 200, after: 180 },
      children: [new TextRun({ text: "ZAKLJUČEK", bold: true, size: 24, color: RED, font: "Arial", characterSpacing: 20 })],
    }));
    const closingParagraphs = splitParagraphs(plan.intro);
    closingParagraphs.forEach((para, idx) => {
      children.push(new Paragraph({
        spacing: { before: idx === 0 ? 0 : 200, after: 200, line: 340 },
        keepLines: true,
        children: [new TextRun({ text: para, size: 24, color: LIGHT, font: "Arial" })],
      }));
    });
  }

  return Packer.toBuffer(buildDoc(children));
}

// -- Training plan DOCX generator ---------------------------------------------
function generateTrainingDocx(userData, plan) {
  const displayName = userData.name !== "ni podatka" ? userData.name.toUpperCase() : "";
  const location = (plan.summary.location || "").toUpperCase();
  const children = [];

  // Cover page
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

  // Intro text – razdeljen na odstavke, font 12pt (size 24), teče naravno na drugo stran
  // keepLines: true zagotovi, da se noben odstavek ne razpolovi čez stran
  const trainingIntroParagraphs = splitParagraphs(plan.intro);
  trainingIntroParagraphs.forEach((para, idx) => {
    children.push(new Paragraph({
      spacing: { before: idx === 0 ? 200 : 200, after: 200, line: 340 },
      keepLines: true,
      children: [new TextRun({ text: para, size: 24, color: LIGHT, font: "Arial" })],
    }));
  });

  // Gray divider
  children.push(new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GRAY, space: 1 } },
    children: [],
    keepNext: true,
  }));

  // Schedule section header – drži skupaj s tabelo
  children.push(new Paragraph({
    spacing: { before: 200, after: 160 },
    children: [new TextRun({ text: "PRIMER TEDENSKEGA RAZPOREDA", bold: true, size: 22, color: RED, font: "Arial", characterSpacing: 20 })],
    keepNext: true,
    keepLines: true,
  }));

  // Schedule – ENA sama tabela z vsemi vrsticami, z cantSplit=true na vsaki vrstici
  // To preprečuje razdelitev tabele med strani
  const scheduleRows = plan.schedule.map((item, i) => {
    const isRest = norm(item.workout).includes("poc") || norm(item.workout).includes("rest");
    const bg = i % 2 === 0 ? DARK_CARD : DARK_ROW;
    const accentColor = isRest ? GRAY : RED;
    const textColor = isRest ? GRAY : LIGHT;

    return new TableRow({
      height: { value: 540, rule: "atLeast" },
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: CW - 4000, type: WidthType.DXA },
          shading: { fill: bg, type: ShadingType.CLEAR },
          borders: { top: nb, bottom: nb, left: { style: BorderStyle.SINGLE, size: 12, color: accentColor }, right: nb },
          margins: { top: 100, bottom: 100, left: 200, right: 80 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ children: [new TextRun({ text: sanitizeText(item.day).toUpperCase(), bold: true, size: 18, color: WHITE, font: "Arial" })] })],
        }),
        new TableCell({
          width: { size: 4000, type: WidthType.DXA },
          shading: { fill: bg, type: ShadingType.CLEAR },
          borders: cellBorders,
          margins: { top: 100, bottom: 100, left: 80, right: 200 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ children: [new TextRun({ text: sanitizeText(item.workout), size: 18, color: textColor, font: "Arial" })] })],
        }),
      ],
    });
  });

  children.push(new Table({
    width: { size: CW, type: WidthType.DXA },
    columnWidths: [CW - 4000, 4000],
    borders: tableBorders,
    rows: scheduleRows,
  }));

  // "STRENGTH AND HONOR" footer on schedule page
  children.push(sp(200));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: "STRENGTH AND HONOR", bold: true, size: 20, color: WHITE, font: "Arial", characterSpacing: 40 })],
  }));

  // Workout pages
  plan.workouts.forEach((workout) => {
    children.push(new Paragraph({ children: [new PageBreak()] }));

    children.push(headerBar(
      [{ text: sanitizeText(workout.name), bold: true, size: 44 }],
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

// -- Email sender (filenames .docx) -------------------------------------------
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

// -- Routes -------------------------------------------------------------------
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
