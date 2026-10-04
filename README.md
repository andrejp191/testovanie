# Precvičovanie — statický kvíz na GitHub Pages

Žiadny backend, žiadne prihlasovanie. Všetky otázky sú súbory v repozitári,
štatistiky sa ukladajú len v prehliadači používateľa (`localStorage`) —
na inom počítači alebo po vymazaní dát stránky začína od nuly.

## Štruktúra

```
index.html
style.css
script.js
themes.json              <- zoznam tém (GitHub Pages nevie listovať priečinky)
Themes/
  Chemia/
    answers.txt
    1.txt   (alebo 1.png)
    2.txt
    3.png
    ...
  Biologia/
    answers.txt
    1.png
    ...
```

## Pridanie novej témy

1. Vytvor priečinok `Themes/<Názov>` (názov = presne to, čo sa zobrazí).
2. Priprav otázky: `1.png` alebo `1.txt`, `2.png`/`2.txt`, atď. Ak pre dané
   číslo existuje aj `.png` aj `.txt`, použije sa `.png`.
3. Vytvor `answers.txt` s jedným riadkom na otázku:

   ```
   <číslo>. <správne písmená oddelené čiarkou, alebo "-"> <celkový počet možností>
   ```

   Príklady:
   ```
   1. a,c 4        -> otázka 1, 4 možnosti (a–d), správne sú a a c
   2. b 6          -> otázka 2, 6 možností (a–f), správna je len b
   3. - 4          -> otázka 3, 4 možnosti, žiadna nie je správna
   ```
   Riadky začínajúce `#` a prázdne riadky sa ignorujú.

4. Samotný text možností (čo znamená a), b), c)…) musí byť súčasťou
   obrázka alebo textu otázky — checkboxy zobrazujú len písmená.
5. Priečinok pridaj do `themes.json`:
   ```json
   ["Chemia", "Biologia"]
   ```
6. Commitni a nahraj zmeny. Hotovo — žiadny ďalší krok netreba.

## Nasadenie na GitHub Pages

1. Vytvor repozitár na GitHube a nahraj doň celý obsah tohto priečinka
   (`index.html`, `style.css`, `script.js`, `themes.json`, `Themes/…`).
2. **Settings → Pages → Source**: `Deploy from a branch`, vetva `main`,
   priečinok `/(root)` → **Save**.
3. Po minúte je web na `https://TVOJE-MENO.github.io/NAZOV-REPA/`.

## Ako funguje výber ďalšej otázky

Pre každú otázku sa lokálne uchováva séria správnych odpovedí za sebou
a dátum poslednej odpovede. Otázka je „na rade“, keď:

- ešte nebola zodpovedaná, alebo posledná odpoveď bola nesprávna, **alebo**
- má sériu N správnych za sebou a od poslednej odpovede uplynulo viac než
  (N + 1) týždňov (1× správne → cez 2 týždne, 2× → cez 3 týždne, 3× → cez
  4 týždne, atď.).

Spomedzi otázok „na rade“ sa uprednostnia tie s najnižšou sériou, výber
medzi rovnocennými je náhodný. Logika je v `script.js` vo funkcii
`pickNextQuestionId` — dá sa kedykoľvek upraviť.

## Štatistika na domovskej stránke

Pri každej téme sa zobrazuje počet otázok (z celkového počtu), ktorých
**posledná** odpoveď bola správna, plus pruh postupu.

## Poznámky

- Keďže sa nič neukladá na server, dvaja ľudia na rôznych zariadeniach
  majú úplne oddelený postup.
- Obsah repozitára (otázky aj odpovede) je verejný, ak je repozitár
  verejný — rovnako ako pri predchádzajúcich návrhoch s GitHub Pages.
  Ak to vadí, repozitár nastav ako **private** a zapni GitHub Pages cez
  platený plán, alebo hostuj na Cloudflare Pages/Netlify so súkromným
  repozitárom.
