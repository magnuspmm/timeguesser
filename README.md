# TimeGuesser – Fase 1 (kamerasporing + tidslinje)

Lokalt spill-prototyp: spor fargede spillbrikker med webkamera, kalibrer mot et fysisk kart og en fysisk **tidslinje** (1850–2025), og gjett sted + år.

## Installer (for andre)

1. **Last ned** prosjektet fra GitHub: **Code → Download ZIP**, og pakk ut mappen.
2. **Installer [Node.js LTS](https://nodejs.org)** (én gang per maskin). Velg standardvalg under installasjonen.
3. **Start programmet:**
   - **Windows:** dobbeltklikk `start.bat`  
     (SmartScreen kan spørre første gang — velg «Mer info» → «Kjør likevel».)
   - **Mac:** dobbeltklikk `start.command`  
     (Hvis macOS blokkerer: Høyreklikk → Åpne, eller Systeminnstillinger → Personvern og sikkerhet.)
4. Første gang installeres avhengigheter automatisk. Nettleseren åpnes på [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Tillat kamera når nettleseren spør.

## Start (når du allerede har prosjektet)

**Mac:** Dobbeltklikk `start.command`  
**Windows:** Dobbeltklikk `start.bat`

Første gang installeres avhengigheter automatisk. Nettleseren åpnes på [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

Fra terminal:

```bash
npm install
npm run dev
```

## Sider

| Side | URL |
|------|-----|
| Spill | [http://127.0.0.1:5173/#/](http://127.0.0.1:5173/#/) |
| Kalibrering | [http://127.0.0.1:5173/#/calibrate](http://127.0.0.1:5173/#/calibrate) |
| Utfordringer | [http://127.0.0.1:5173/#/challenges](http://127.0.0.1:5173/#/challenges) |

## Hurtigbruk

1. **Kalibrering** – velg USB-kamera, kalibrer karthjørner NV → NØ → SØ → SV, prøv brikfarge.
2. **Tidslinje** – sett årsspenn (fra/til), kalibrer fire hjørner rundt den fysiske tidslinjen (venstre = laveste, høyre = høyeste).
3. **Utfordringer** – sett ID, last opp bilde, klikk fasit på kartet, angi fasit-år, lagre.
4. **Låsestein** (valgfritt) – marker rektangel rundt en fysisk stein, ta **baseline** uten hånd. Under spill: legg hånden på steinen i 3 sekunder for å låse (knapp finnes fortsatt som reserve).
5. **Spill** – plasser én brikke på kartet og én på tidslinjen (samme farge), lås med stein eller **Lås svar**.

Bytt digitalt kart ved å erstatte `public/map.png` (samme hjørner som det fysiske kartet). Last siden på nytt etter bytte.

Kalibrering og kameravalg lagres i nettleseren (`localStorage`). Utfordringer lagres i `public/challenges.json` + `public/challenges/` (krever `npm run dev`).

## Låsestein

- Kameraet ser kun på den kalibrerte ROIen og sammenligner mot baseline (luminans-diff).
- Kort debounce (~0,4 s) før 3 s nedtelling; fjern hånden for å avbryte.
- Juster følsomhet (diff-terskel) under kalibrering hvis lysforholdene endrer seg — ta ny baseline ved behov.

## Tidslinje

- Fysisk linje/stripe under kameraet; posisjon langs aksen leses som år (lineært fra → til, satt under kalibrering; standard 1850–2025).
- Samme HSV-farge som kartbrikken; sporing skjer separat i kart-ROI og tidslinje-ROI (to brikker).
- Poeng for år faller med avvik fra fasit (±50 år → nær null). Sted- og år-poeng snittes når begge finnes.

## Krav

- Chrome eller Edge anbefales (kamera-API)
- Jevn belysning og en matt, mettet brikfarge som skiller seg fra bakgrunn/kart
