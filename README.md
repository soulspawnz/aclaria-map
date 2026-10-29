# Aclaria Map

A public, mobile-first interactive companion map for **Aclaria RPG** (formerly *Niiiny-RPG*). 

🔗 **Live Map:** [https://soulspawnz.github.io/aclaria-map/](https://soulspawnz.github.io/aclaria-map/) *(deployed with GitHub Pages)*  
📖 **Wiki Hub:** [Aclaria RPG Fandom Wiki](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market)

---

## Scope & Layers

- **Housing (Active):** All 26 estates from the [Grand Homestead Market](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market) in original catalogue order, each with its own developer-annotated map position (markers 1–26). The map shows only those 26 house markers; the 20 named approximate areas stay as searchable context in the list and details, alongside filtering and companion capacity details.
- **Explorations & Dungeons (Planned):** The schema (`data/housing.json`) is structured for extensible layers so expedition destinations and dungeon locations can be toggled on as verified data is integrated. Nothing about travel routes, travel times or a distance scale is inferred here.

## Evidence & Placement

- **Official Artwork:** `assets/aclaria-map.jpg` (`4096×2983`) is the unmodified public world map from the [Aclaria RPG Wiki](https://aclariarpg.fandom.com/wiki/File:Aclaria_world_map.jpg). Its bytes are unchanged; every marker is drawn as an overlay.
- **Catalogue Data:** House names, Gold prices, companion capacities, and location descriptions come directly from the [Grand Homestead Market catalogue](https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market), in the original market order.
- **Annotated positions (markers 1–26):** Every home has its own position taken from the **developer's annotated housing map** (published 2026-10-28). Marker numbers are the annotation's badge numbers and match the catalogue order. These are hand-placed annotations on a stylised map, with half-a-badge-width uncertainty (`±0.00671 × ±0.00922` of the image) — not in-game coordinates, addresses or property boundaries.
- **Approximate areas (1–20, context only):** The approximate city or region named by the catalogue wording (`approximate-city` / `approximate-region`) stays as searchable context in the list and details panel. Areas are not drawn on the map — no rings and no second set of numbers — so the only numbered markers are the 26 annotated homes. A home with no individual annotation yet would appear as a hollow, unnumbered `~` marker on its area, labelled approximate. Six annotated positions sit outside their recorded area extent; each details panel says the area is context only.
- **Coordinate provenance vs textual agreement:** `anchor.provenance` says where a position comes from; `anchor.textAgreement` says whether the catalogue wording names the same place. They are separate fields, never merged into one confidence label.
- **Recorded discrepancies:** **Wood Cabin (18)** and **Padfax House (21)** keep the annotated position with a visible note that the annotation and the catalogue wording name different places. Both records stay as published; nothing here claims a house moved or that either record is stale. **Hut (11)** records the developer's own correction that it is not on the island.
- **Placed with caveats:** **Pine Estate (`Erethune`)** sits at the *Erethune* settlement label on the northern lake (about 0.540, 0.171). **Karnethra** sits on the settlement icon rather than the shoreline.
- **Map label spelling:** The map reads *HEARTHGLEN*; the market card keeps its own wording (*Hearthglem*). Area names follow the map, house cards stay verbatim. **Beresclair Estate (17)** is annotated at the *HORNVEIL* label, east of the *Ebonveil Thicket* area: both labels are recorded and neither place is renamed.
- **Thaldris is not Thalvaris:** **Lovely Cabin (23)** is now placed at the *THALDRIS* label in the northern snow range (area 20). *Thalvaris*, far to the south, is a different place and keeps its own name.

## Repository Structure

- `index.html` / `styles.css` / `app.js`: Static, dependency-free mobile-first map interface with touch/keyboard pan-and-zoom.
- `assets/aclaria-map.jpg`: Original public wiki world map, byte-identical.
- `data/housing.json`: Per-home developer anchors with annotation uncertainty, approximate area context, layer definitions, and market metadata.
- **Pipeline & Tooling:** Initial prototype, data normalization, and task orchestration by **GPT-6.1 Sol Light**. Static site implementation, independent dataset/placement auditing, testing, and GitHub Pages deployment are executed via **Hermes Kanban** (`DeepSeekV4.1Flash1017/OpenRouter Ultra`).

## Credits

Aclaria RPG and all associated world maps and artwork belong to **niiiny** and their respective creators.
- **Official Discord Server:** [Join Aclaria RPG](https://discord.gg/CV3QrrdJSK)
- **Original Game Asset Repository:** [niinybot-hash/rpg-icons](https://github.com/niinybot-hash/rpg-icons)

No additional license for game artwork is asserted in this repository.
