# NetSight stodere — prasību sadalījums

Dokuments sadala jūsu 6 ieguvumus un 11 prasības tajā, ko dara **aparāts**, un
tajā, ko dara **platforma**. Bez šī sadalījuma viegli sanāk gaidīt no programmas
to, ko var izdarīt tikai dzelzis.

---

## 1. Kas ir kas

| # | Prasība | Aparāts | Platforma |
|---|---|---|---|
| 1 | Spilgta vizualizācija (oranža) | ● krāsa, atstarotājs | ○ karte rāda oranžu marķieri |
| 2 | Apgaismojums naktī | ● LED | ○ rāda, vai lampiņa deg |
| 3 | Maināms akumulators (Makita/Milwaukee) | ● turētājs, DC-DC | ○ rāda uzlādes līmeni |
| 4 | Žiroskops — pacelšana ±40 cm | ● IMU + filtrs | ○ "pacelts" notikums, trauksme |
| 5 | Temperatūras devējs | ● sensors | ○ vēsture, ledus brīdinājums |
| 6 | Līmeņa devējs | ● spiediena sensors | ○ ūdens līmeņa grafiks |
| 7 | GPS | ● modulis | ○ pozīcija kartē, novirzes kontrole |
| 8 | Nepārtraukta datu nosūtīšana | ● NB-IoT / LTE-M | ○ uztver, glabā, rāda |
| 9 | NFC datu nolasīšanai | ● NFC tags | ○ telefons nolasa → atver karti |
| 10 | Tiešsaistes platforma | — | ● **šī lietotne** |
| 11 | Fotosensors gaismai | ● LDR | ○ rāda gaismas stāvokli |

● = dzelzis, ○ = programmatūra. Prasība 10 ir vienīgā, kas pilnībā pieder šai
lietotnei — pārējās 10 ir aparāts, kuram platforma dod jēgu.

---

## 2. Ko platforma jau dara

| Ieguvums | Kā tas izpildās lietotnē |
|---|---|
| 1. Šķērslis redzams kartē | Karte ar krāsainiem marķieriem; `patrol.html` rāda visus gadījumus |
| 4. Ģeolokācijas ierobežojums | `js/devices.js` → `checkGeofence()` pārbauda atļauto ūdens zonu un 50 m no krasta |
| 5. Monitorings no iestādēm | `admin.html` → Devices: akumulators, temperatūra, līmenis, pēdējā saite |
| 6. Monitorings no zvejniekiem | Lietotājs redz savu rīku stāvokli |
| 10. Datu platforma | Šī lietotne — datu slānis, API līgums `DETECT.md` stilā |

---

## 3. Aparatūras ieteikumi

### Akumulators (prasība 3)

Makita/Milwaukee 18 V ir ērti, bet **smagi**: 5 Ah akumulators sver ~0,65 kg,
8 Ah — ~1,0 kg. Mazai stoderei tas ir daudz — maina peldamību un apgāšanās
stabilitāti.

| Variants | Svars | Der, ja |
|---|---|---|
| Makita 18 V 5 Ah | ~650 g | Stodere ≥ 30 cm diametrā, ar balastu |
| Makita 12 V CXT 2 Ah | ~200 g | Mazāka stodere |
| Milwaukee M12 2 Ah | ~180 g | Mazāka stodere |
| 18650 ×4 (pašu pakete) | ~180 g | Ja gribat vieglāko, bet zaudējat "jebkurā veikalā" |

18 V Makita nozīmē arī DC-DC pārveidotāju uz 3,3 V/5 V — vēl ~20 g un ~85 %
lietderība. Ja izvēlaties Makita, ņemiet vērā, ka akumulatoram ir sava
aizsardzības plate, kas atslēdz pie ~15 V.

**Ieteikums:** M12/Makita CXT klase, ja stodere ir maza; 18 V tikai lielajām
stoderēm ar balastu.

### Žiroskops (prasība 4) — šeit ir īsta problēma

Prasība "ja stodere pacelta par ±40 cm, tas nozīmē, ka rīks tiek izņemts"
**nedarbosies ar žiroskopu vien**. Divi iemesli:

1. **Žiroskops mēra griešanos, ne augstumu.** Augstumu mēra ar akselerometru
   (dubultintegrējot) vai barometru. Žiroskops vien pacelšanu neredzēs.
2. **Vilnis kustina stoderi vairāk par 40 cm.** Rīgas līcī viļņa augstums
   0,3–0,5 m ir norma, vētrā 1 m+. Ja slieksnis ir 40 cm, trauksme būs
   pastāvīgi.

**Ko darīt tā vietā:**

- **Akselerometrs + barometrs**, nevis žiroskops. Barometrs dod augstumu ar
  ~10 cm precizitāti.
- **Filtrēt viļņu frekvenci.** Vilnis ir 0,5–2 Hz; izņemšana ir lēna, monotona
  kustība. Zemo frekvenču filtrs (vai 10 s slīdošais vidējais) atdala vienu no
  otra.
- **Prasīt ilgumu:** pacēlums > 40 cm, kas turas **ilgāk par 30 s**, un pēc tam
  pozīcija mainās > 10 m. Viļnis to nedarīs, cilvēks darīs.
- **Magnēts + Hall sensors** kā otrais kanāls: ja stoderi izceļ, magnēts
  atdalās. Lēti, 0 kļūdu procentu, strādā bez filtrēšanas.

Kombinācija "barometrs + akselerometrs + magnēts" dod uzticamu "izņemts"
signālu. Tikai IMU dos daudz viltus trauksmju.

### Līmeņa devējs (prasība 6)

Stodere **peld**, tāpēc tā pati par sevi ūdens līmeni nemēra — tā mēra savu
iegrimi. Lai iegūtu ūdens līmeni:

- **Spiediena sensors (MS5837-30BA)** stoderes apakšā: mēra dziļumu zem
  virsmas. Ja stodere ir piesieta ar fiksētu tauvu, iegremdējums mainās līdz ar
  līmeni — bet tas ir netieši un jutīgs pret viļņiem.
- **Labāk: atsauces punkts krastā.** Stodere nav īstais instruments līmeņa
  mērīšanai. Ja līmenis vajadzīgs CA (Civilās aviācijas?) vajadzībām, precīzāk
  ir viena fiksēta mērierīce krastā nekā 50 stoderes.
- Ja tomēr stoderē: MS5837 + 60 s vidējais, un **marķēt kā orientējošu**.

### Sakari (prasība 8) — "nepārtraukta" nav iespējama

Nepārtraukta datu sūtīšana ar akumulatoru nav reāla. NB-IoT modulis sūtot
nepārtraukti ēd ~120 mA; 5 Ah akumulators iztukšojas ~40 stundās.

**Reāli:** ziņojums ik 15–60 min, plus tūlītējs ziņojums, ja notikums
(pacelšana, novirze, zema baterija). Tas ir 1–2 % no nepārtrauktā. NB-IoT ir
labākais pārklājums Latvijā; LTE-M ātrāks, bet dārgāks.

### Gaisma (prasības 2 un 11)

LED, kas deg visu nakti, ir lielākais enerģijas patērētājs — lielāks par radiosakariem.

- **Zibšņu režīms**, nevis pastāvīga gaisma: 1 zibsnis / 4 s, 20 ms. Redzams
  naktī, patērē ~1/200 no pastāvīgās gaismas.
- **Fotosensors (LDR)** ieslēdz tikai krēslā — ietaupa dienas stundas.
- **Oranža + atstarotājs** dienai (prasība 1): atstarotājs darbojas bez
  enerģijas, LED vajadzīgs tikai naktij. Krāsa oranža ir pareizā izvēle —
  kontrastē ar ūdeni, nav zaļa/sarkana, ko jauc ar navigācijas zīmēm.

---

## 4. Ko vēl vajag, ko specifikācijā nav

| Trūkst | Kāpēc svarīgi |
|---|---|
| **Korpusa IP klase** | Bez IP67/IP68 stodere pildīsies ar ūdeni pēc pāris nedēļām |
| **Antenas vieta virs ūdens** | NB-IoT antena zem ūdens neizstaros; GPS arī nē |
| **Tauvas stiprinājums ar vājāko posmu** | Ja tauva pārtrūkst, stodere aizpeld — jābūt atslēgai, kas paliek |
| **Fiziska ID (gravēts)** | Ja elektronika nomirst, rīks joprojām jāidentificē |
| **Otrā puse: krasta uztvērējs** | Ja 50 stoderes sūta, vajag datu plūsmas galu (MQTT brokeris) |
| **Juridiskā puse** | Kas atbild, ja stodere noraujas un bojā kuģi? |
| **Servisa plāns** | Kas maina akumulatorus un tīra korpusu |

---

## 5. Kā platforma saņem datus

Līgums ir vienkāršs, līdzīgs `DETECT.md` pieejai:

```http
POST /api/telemetry
Content-Type: application/json

{
  "device_id": "NS-000123",
  "nfc": "04:A2:33:...",
  "at": "2026-11-25T18:40:00Z",
  "lat": 56.9690,
  "lon": 24.0980,
  "battery": 78,
  "temperature_c": 4.2,
  "water_level_cm": 12,
  "tilt": { "lifted": false, "degrees": 3 },
  "light_on": true,
  "signal": -87
}
```

Platforma no tā atvasina:

| Signāls | Slieksnis | Rezultāts |
|---|---|---|
| Pacelts | `tilt.lifted = true` | **Trauksme** — rīks tiek izņemts |
| Novirze | > 25 m no reģistrētās vietas | Brīdinājums — stodere aizpeldējusi |
| Baterija | ≤ 20 % | Brīdinājums — jāmaina |
| Bez saites | > 6 h | Trauksme — aparāts klusē |
| Temperatūra | < 1 °C | Info — iespējams ledus |
| Ģeozona | ārpus atļautās zonas vai < 50 m no krasta | Brīdinājums pie reģistrācijas |

Šie noteikumi ir `js/devices.js → evaluate()`. Mainot sliekšņus, jāmaina tikai
`CONFIG.DEVICES`.

---

## 6. Secība, kādā to būvēt

1. **Viena stodere ar GPS + NB-IoT + bateriju** — tikai pozīcija ik stundu.
   Pārbaudīt, vai sakari strādā no ūdens.
2. **Pievienot barometru + magnētu** — "izņemts" signāls. Testēt mēnesi, skaitīt
   viltus trauksmes. Ja > 1 nedēļā, slieksnis nepareizs.
3. **Pievienot LED + LDR** — pārbaudīt, cik akumulators iztur ar zibšņiem.
4. **Tikai tad** temperatūra un līmenis — tie ir informativi, ne kritiskie.
5. **NFC** pēdējais — tas ir servisa ērtība, ne funkcija.

Pirmais solis dod 80 % vērtības. Pēdējais — 2 %.
